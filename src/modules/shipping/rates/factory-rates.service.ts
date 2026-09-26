import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Factory, Prisma } from '@generated/prisma/client';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { CUSTOMER_SCHEME_CODE } from './customer-rates.service';
import {
  type AnswerShippingCountersDto,
  type CreateFactoryRateVersionDto,
  type FactoryRateCardDto,
  type FactoryRateDto,
  type FactoryRateInputDto,
  type FactoryRateVersionDto,
  type FactoryRateVersionSummaryDto,
  type RespondToShippingCardDto,
  type ShippingPayoutSuggestionDto,
} from './factory-rates.dto';
import { matchBand } from './rate-bands';
import { ShippingRatesResolver } from './shipping-rates.resolver';
import { ZoneRefs } from './zone-refs';

/** Back-dating tolerance for clock skew; history is never rewritten (ADR-0005). */
const BACKDATE_SLACK_MS = 60_000;

const SUMMARY_INCLUDE = {
  _count: { select: { rates: true } },
} satisfies Prisma.FactoryShippingRateCardVersionInclude;
type SummaryRow = Prisma.FactoryShippingRateCardVersionGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

const RATE_INCLUDE = {
  zone: { select: { publicId: true, code: true } },
} satisfies Prisma.FactoryShippingRateInclude;
type RateRow = Prisma.FactoryShippingRateGetPayload<{ include: typeof RATE_INCLUDE }>;

const rate6 = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(6).replace(/\.?0+$/, ''));

const rateDto = (r: RateRow): FactoryRateDto => ({
  id: r.publicId,
  zoneId: r.zone.publicId,
  zoneCode: r.zone.code,
  postcode: r.postcode,
  weightMinG: r.weightMinG,
  weightMaxG: r.weightMaxG,
  volumeMinCm3: r.volumeMinCm3 === null ? null : Number(r.volumeMinCm3),
  volumeMaxCm3: r.volumeMaxCm3 === null ? null : Number(r.volumeMaxCm3),
  payoutAmount: r.payoutAmount.toFixed(2),
  perExtraKg: rate6(r.perExtraKg),
  acceptance: r.acceptance,
  counterAmount: r.counterAmount?.toFixed(2) ?? null,
  counterPerExtraKg: rate6(r.counterPerExtraKg),
  counterNote: r.counterNote,
});

type Side = { side: 'admin' } | { side: 'partner' };

/**
 * Factory shipping payout cards (D-013): what Packio pays a factory for delivering with its own fleet.
 * Packio drafts a complete version (Partner Manager, `factory_shipping_rates.manage`), sends it, and
 * the factory accepts the whole card or answers per line (accept / counter); Packio accepts a counter or
 * keeps its value, and the version applies once every line is accepted (D-042 rate-card flow, chosen
 * at B2.4 planning). Buy prices: staff reads need `factory_cost.read` and are audited (D-141, D-044);
 * a factory sees only its own card and never Packio's drafts.
 */
@Injectable()
export class FactoryRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
    private readonly zones: ZoneRefs,
    private readonly resolver: ShippingRatesResolver,
  ) {}

  async card(
    actor: UserActor,
    factoryPublicId: string,
    side: Side,
    at = new Date(),
  ): Promise<FactoryRateCardDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const card = await this.prisma.factoryShippingRateCard.findUnique({ where: { factoryId: factory.id } });
    if (side.side === 'admin')
      await this.auditRead(factory, 'factory_shipping_rate_card', card?.publicId ?? factory.publicId);
    if (!card) return { id: null, factoryId: factory.publicId, current: null, scheduled: null, open: null };
    const [current, scheduled, open] = await Promise.all([
      this.prisma.factoryShippingRateCardVersion.findFirst({
        where: { cardId: card.id, status: 'approved', effectiveFrom: { lte: at } },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.factoryShippingRateCardVersion.findFirst({
        where: { cardId: card.id, status: 'approved', effectiveFrom: { gt: at } },
        orderBy: [{ effectiveFrom: 'asc' }, { versionNo: 'desc' }],
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.factoryShippingRateCardVersion.findFirst({
        where: {
          cardId: card.id,
          status: side.side === 'admin' ? { in: ['draft', 'pending_acceptance'] } : 'pending_acceptance',
        },
        include: SUMMARY_INCLUDE,
      }),
    ]);
    return {
      id: card.publicId,
      factoryId: factory.publicId,
      current: current ? await this.summary(current) : null,
      scheduled: scheduled ? await this.summary(scheduled) : null,
      open: open ? await this.summary(open) : null,
    };
  }

  async versions(
    actor: UserActor,
    factoryPublicId: string,
    side: Side,
  ): Promise<FactoryRateVersionSummaryDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.factoryShippingRateCardVersion.findMany({
      where: {
        card: { factoryId: factory.id },
        ...(side.side === 'partner' ? { status: { not: 'draft' } } : {}),
      },
      orderBy: { versionNo: 'desc' },
      include: SUMMARY_INCLUDE,
    });
    if (side.side === 'admin') await this.auditRead(factory, 'factory_shipping_rate_card', factory.publicId);
    return Promise.all(rows.map((r) => this.summary(r)));
  }

  async version(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
    side: Side,
  ): Promise<FactoryRateVersionDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const dto = await this.load(factory.id, versionPublicId);
    // A factory never sees Packio's drafts of its card before they are sent (D-042).
    if (side.side === 'partner' && dto.status === 'draft') throw new DomainException('http.not_found');
    if (side.side === 'admin')
      await this.auditRead(factory, 'factory_shipping_rate_card_version', versionPublicId);
    return dto;
  }

  async createVersion(
    actor: UserActor,
    factoryPublicId: string,
    input: CreateFactoryRateVersionDto,
  ): Promise<FactoryRateVersionDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const scheme = await this.zones.scheme(CUSTOMER_SCHEME_CODE);
    const effectiveFrom = new Date(input.effectiveFrom);
    if (effectiveFrom.getTime() < Date.now() - BACKDATE_SLACK_MS)
      throw new DomainException('partners.backdated');
    let rows: Prisma.FactoryShippingRateCreateManyInput[] | null = input.rates
      ? await this.rateRows(scheme.id, input.rates)
      : null;
    return this.prisma.withTx(async (tx) => {
      const card =
        (await tx.factoryShippingRateCard.findUnique({ where: { factoryId: factory.id } })) ??
        (await tx.factoryShippingRateCard.create({
          data: { factoryId: factory.id, createdById: actor.userId },
        }));
      if (
        (await tx.factoryShippingRateCardVersion.count({
          where: { cardId: card.id, status: { in: ['draft', 'pending_acceptance'] } },
        })) > 0
      ) {
        throw new DomainException('shipping.version_open');
      }
      if (!rows && input.copyFromVersionId) {
        const source = await tx.factoryShippingRateCardVersion.findUnique({
          where: { publicId: input.copyFromVersionId },
          include: { rates: true },
        });
        if (!source || source.cardId !== card.id || source.schemeId !== scheme.id) {
          throw new DomainException('validation.failed', {
            errors: [{ path: 'copyFromVersionId', code: 'exists', message: 'not a version of this card' }],
          });
        }
        rows = source.rates.map((r) => ({
          versionId: 0n,
          schemeId: scheme.id,
          zoneId: r.zoneId,
          postcode: r.postcode,
          weightMinG: r.weightMinG,
          weightMaxG: r.weightMaxG,
          volumeMinCm3: r.volumeMinCm3,
          volumeMaxCm3: r.volumeMaxCm3,
          payoutAmount: r.payoutAmount,
          perExtraKg: r.perExtraKg,
        }));
      }
      const last = await tx.factoryShippingRateCardVersion.findFirst({
        where: { cardId: card.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.factoryShippingRateCardVersion.create({
        data: {
          cardId: card.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          schemeId: scheme.id,
          effectiveFrom,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      if (rows && rows.length > 0) await this.writeRates(tx, version.id, rows);
      await this.record(
        tx,
        factory,
        version.publicId,
        'factory_shipping_rate_card.version_drafted',
        {
          versionNo: version.versionNo,
          rates: rows?.length ?? 0,
        },
        true,
      );
      return this.load(factory.id, version.publicId, tx);
    });
  }

  async replaceRates(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
    input: FactoryRateInputDto[],
  ): Promise<FactoryRateVersionDto> {
    const { factory, version } = await this.draft(actor, factoryPublicId, versionPublicId);
    const rows = await this.rateRows(version.schemeId, input);
    return this.prisma.withTx(async (tx) => {
      await tx.factoryShippingRate.deleteMany({ where: { versionId: version.id } });
      if (rows.length > 0) await this.writeRates(tx, version.id, rows);
      await this.record(
        tx,
        factory,
        version.publicId,
        'factory_shipping_rate_card.rates_replaced',
        {
          versionNo: version.versionNo,
          rates: rows.length,
        },
        true,
      );
      return this.load(factory.id, version.publicId, tx);
    });
  }

  async deleteDraft(actor: UserActor, factoryPublicId: string, versionPublicId: string): Promise<void> {
    const { factory, version } = await this.draft(actor, factoryPublicId, versionPublicId);
    await this.prisma.withTx(async (tx) => {
      await tx.factoryShippingRateCardVersion.delete({ where: { id: version.id } });
      await this.record(
        tx,
        factory,
        version.publicId,
        'factory_shipping_rate_card.version_deleted',
        {
          versionNo: version.versionNo,
        },
        true,
      );
    });
  }

  /** Draft → pending_acceptance: the factory can now read and answer it (D-042). */
  async send(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
  ): Promise<FactoryRateVersionDto> {
    const { factory, version } = await this.draft(actor, factoryPublicId, versionPublicId);
    return this.prisma.withTx(async (tx) => {
      const rates = await tx.factoryShippingRate.count({ where: { versionId: version.id } });
      if (rates === 0) throw new DomainException('shipping.rates_empty');
      await tx.factoryShippingRateCardVersion.update({
        where: { id: version.id },
        data: { status: 'pending_acceptance', sentAt: new Date(), sentById: actor.userId },
      });
      await this.record(tx, factory, version.publicId, 'factory_shipping_rate_card.version_sent', {
        versionNo: version.versionNo,
        rates,
      });
      return this.load(factory.id, version.publicId, tx);
    });
  }

  /** Packio withdraws a draft or a version the factory has not settled yet. */
  async withdraw(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
    reason: string,
  ): Promise<FactoryRateVersionDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const version = await this.lock(tx, factory.id, versionPublicId);
      if (version.status !== 'pending_acceptance') throw new DomainException('shipping.version_not_awaiting');
      await tx.factoryShippingRateCardVersion.update({
        where: { id: version.id },
        data: { status: 'withdrawn', decidedAt: new Date(), decidedById: actor.userId },
      });
      await this.record(tx, factory, version.publicId, 'factory_shipping_rate_card.version_withdrawn', {
        versionNo: version.versionNo,
        reason,
      });
      return this.load(factory.id, version.publicId, tx);
    });
  }

  /**
   * The factory answers a version awaiting it: without lines every pending line is accepted (the whole
   * card); otherwise each named line is accepted or countered. Settles when nothing is left open.
   */
  async respond(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
    input: RespondToShippingCardDto,
  ): Promise<FactoryRateVersionDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const version = await this.lock(tx, factory.id, versionPublicId);
      if (version.status !== 'pending_acceptance') throw new DomainException('shipping.version_not_awaiting');
      let accepted = 0;
      let countered = 0;
      if (!input.lines) {
        accepted = (
          await tx.factoryShippingRate.updateMany({
            where: { versionId: version.id, acceptance: 'pending' },
            data: { acceptance: 'accepted' },
          })
        ).count;
      } else {
        const rates = new Map(
          (
            await tx.factoryShippingRate.findMany({
              where: { versionId: version.id, publicId: { in: input.lines.map((l) => l.rateId) } },
            })
          ).map((r) => [r.publicId, r]),
        );
        const errors = input.lines.flatMap((l, i) => {
          const row = rates.get(l.rateId);
          if (!row)
            return [{ path: `lines[${i}].rateId`, code: 'exists', message: 'not a line of this version' }];
          if (row.acceptance !== 'pending') {
            return [
              {
                path: `lines[${i}].rateId`,
                code: 'invalid',
                message: 'the line is not waiting for an answer',
              },
            ];
          }
          if (l.decision === 'counter' && !l.counterAmount) {
            return [
              { path: `lines[${i}].counterAmount`, code: 'required', message: 'a counter needs an amount' },
            ];
          }
          return [];
        });
        if (errors.length > 0)
          throw new DomainException('validation.failed', { errors: errors.slice(0, 200) });
        for (const line of input.lines) {
          const row = rates.get(line.rateId)!;
          if (line.decision === 'accept') {
            accepted += 1;
            await tx.factoryShippingRate.update({ where: { id: row.id }, data: { acceptance: 'accepted' } });
          } else {
            countered += 1;
            await tx.factoryShippingRate.update({
              where: { id: row.id },
              data: {
                acceptance: 'countered',
                counterAmount: line.counterAmount!,
                counterPerExtraKg: line.counterPerExtraKg ?? null,
                counterNote: line.note ?? null,
              },
            });
          }
        }
      }
      await tx.factoryShippingRateCardVersion.update({
        where: { id: version.id },
        data: { factoryAcceptedById: actor.userId },
      });
      await this.record(tx, factory, version.publicId, 'factory_shipping_rate_card.factory_responded', {
        versionNo: version.versionNo,
        accepted,
        countered,
      });
      await this.settle(tx, factory, version.id);
      return this.load(factory.id, version.publicId, tx);
    });
  }

  /** Packio answers counters: take the factory's values, or keep its own and ask again. */
  async answerCounters(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
    input: AnswerShippingCountersDto,
  ): Promise<FactoryRateVersionDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const version = await this.lock(tx, factory.id, versionPublicId);
      if (version.status !== 'pending_acceptance') throw new DomainException('shipping.version_not_awaiting');
      const rates = new Map(
        (
          await tx.factoryShippingRate.findMany({
            where: { versionId: version.id, publicId: { in: input.lines.map((l) => l.rateId) } },
          })
        ).map((r) => [r.publicId, r]),
      );
      const errors = input.lines.flatMap((l, i) => {
        const row = rates.get(l.rateId);
        if (!row)
          return [{ path: `lines[${i}].rateId`, code: 'exists', message: 'not a line of this version' }];
        return row.acceptance === 'countered'
          ? []
          : [{ path: `lines[${i}].rateId`, code: 'invalid', message: 'the line has no counter' }];
      });
      if (errors.length > 0) throw new DomainException('validation.failed', { errors: errors.slice(0, 200) });
      let taken = 0;
      for (const line of input.lines) {
        const row = rates.get(line.rateId)!;
        const clear = { counterAmount: null, counterPerExtraKg: null, counterNote: null };
        if (line.decision === 'accept_counter') {
          taken += 1;
          await tx.factoryShippingRate.update({
            where: { id: row.id },
            data: {
              ...clear,
              acceptance: 'accepted',
              payoutAmount: row.counterAmount!,
              perExtraKg: row.counterPerExtraKg ?? row.perExtraKg,
            },
          });
        } else {
          await tx.factoryShippingRate.update({
            where: { id: row.id },
            data: { ...clear, acceptance: 'pending' },
          });
        }
      }
      await this.record(tx, factory, version.publicId, 'factory_shipping_rate_card.counters_answered', {
        versionNo: version.versionNo,
        accepted: taken,
        kept: input.lines.length - taken,
      });
      await this.settle(tx, factory, version.id);
      return this.load(factory.id, version.publicId, tx);
    });
  }

  /**
   * Staff-only suggestions for a version's lines (D-040 group 5, D-044): the customer rate of the same
   * zone band less the target shipping margin (setting, unset until the business gives it), and the
   * median payout of other active factories serving the zone when at least
   * `partners.peer_benchmark_min_factories` do (D-101). Audited.
   */
  async suggestions(
    actor: UserActor,
    factoryPublicId: string,
    versionPublicId: string,
    at = new Date(),
  ): Promise<ShippingPayoutSuggestionDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const version = await this.prisma.factoryShippingRateCardVersion.findFirst({
      where: { publicId: versionPublicId, card: { factoryId: factory.id } },
      include: { rates: { orderBy: { id: 'asc' } } },
    });
    if (!version) throw new DomainException('http.not_found');
    let targetPct: MoneyValue | null = null;
    try {
      targetPct = new MoneyDecimal(await this.settings.value('shipping.target_margin_pct', at));
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
    }
    const minPeers = await this.settings.value('partners.peer_benchmark_min_factories', at);
    const customer = await this.resolver.customerCard(at);
    const peers = await this.prisma.factory.findMany({
      where: { status: 'active', id: { not: factory.id }, shippingRateCard: { isNot: null } },
      select: { id: true },
    });
    const peerCards = (await Promise.all(peers.map((p) => this.resolver.factoryCard(p.id, at)))).filter(
      (c) => c !== null && c.version.schemeId === version.schemeId,
    );
    await this.auditRead(
      factory,
      'factory_shipping_rate_card_version',
      version.publicId,
      'price.suggestions_read',
    );
    return version.rates.map((r) => {
      const parcel = {
        weightG: r.weightMinG,
        volumeCm3: r.volumeMinCm3 === null ? null : Number(r.volumeMinCm3),
      };
      const code = r.postcode ?? '';
      const customerBand =
        customer && customer.version.schemeId === version.schemeId
          ? matchBand(customer.bands, r.zoneId, code, parcel)
          : null;
      const customerNet = customerBand ? customerBand.amount : null;
      const suggested =
        customerNet && targetPct
          ? customerNet.mul(new MoneyDecimal(100).sub(targetPct)).div(100).toDecimalPlaces(2)
          : null;
      const peerAmounts = peerCards
        .map((c) => matchBand(c!.bands, r.zoneId, code, parcel)?.amount ?? null)
        .filter((a): a is MoneyValue => a !== null)
        .sort((a, b) => a.comparedTo(b));
      const median =
        peerAmounts.length >= minPeers && peerAmounts.length > 0
          ? peerAmounts.length % 2 === 1
            ? peerAmounts[(peerAmounts.length - 1) / 2]!
            : peerAmounts[peerAmounts.length / 2 - 1]!.add(peerAmounts[peerAmounts.length / 2]!).div(2)
          : null;
      const payout = new MoneyDecimal(r.payoutAmount.toString());
      return {
        rateId: r.publicId,
        payoutAmount: payout.toFixed(2),
        customerNetAmount: customerNet?.toFixed(2) ?? null,
        suggestedAmount: suggested?.toFixed(2) ?? null,
        deviationPct:
          suggested && !suggested.isZero()
            ? payout.sub(suggested).div(suggested).mul(100).toDecimalPlaces(2).toFixed(2)
            : null,
        peerMedianAmount: median ? median.toDecimalPlaces(2).toFixed(2) : null,
        peerCount: peerAmounts.length,
        basis: !customerNet
          ? 'no_customer_rate'
          : !targetPct
            ? 'target_margin_not_set'
            : 'customer_rate_less_target_margin',
      };
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------

  /** Approves the version once no line is pending or countered; never retroactive. */
  private async settle(tx: Tx, factory: Factory, versionId: bigint): Promise<void> {
    const open = await tx.factoryShippingRate.count({
      where: { versionId, acceptance: { not: 'accepted' } },
    });
    if (open > 0) return;
    const version = await tx.factoryShippingRateCardVersion.findUniqueOrThrow({ where: { id: versionId } });
    const now = new Date();
    const effectiveFrom = version.effectiveFrom < now ? now : version.effectiveFrom;
    await tx.factoryShippingRateCardVersion.update({
      where: { id: versionId },
      data: { status: 'approved', effectiveFrom, factoryAcceptedAt: now, decidedAt: now },
    });
    await this.record(tx, factory, version.publicId, 'factory_shipping_rate_card.version_accepted', {
      versionNo: version.versionNo,
      effectiveFrom: effectiveFrom.toISOString(),
    });
  }

  private async summary(v: SummaryRow): Promise<FactoryRateVersionSummaryDto> {
    const openLines =
      v.status === 'draft' || v.status === 'pending_acceptance'
        ? await this.prisma.factoryShippingRate.count({
            where: { versionId: v.id, acceptance: { not: 'accepted' } },
          })
        : 0;
    return {
      id: v.publicId,
      versionNo: v.versionNo,
      status: v.status,
      effectiveFrom: toBangkokIso(v.effectiveFrom),
      reason: v.reason,
      rateCount: v._count.rates,
      openLines,
      sentAt: v.sentAt ? toBangkokIso(v.sentAt) : null,
      factoryAcceptedAt: v.factoryAcceptedAt ? toBangkokIso(v.factoryAcceptedAt) : null,
      decidedAt: v.decidedAt ? toBangkokIso(v.decidedAt) : null,
    };
  }

  private async load(
    factoryId: bigint,
    versionPublicId: string,
    db: Tx = this.prisma,
  ): Promise<FactoryRateVersionDto> {
    const row = await db.factoryShippingRateCardVersion.findFirst({
      where: { publicId: versionPublicId, card: { factoryId } },
      include: {
        ...SUMMARY_INCLUDE,
        rates: {
          include: RATE_INCLUDE,
          orderBy: [{ zoneId: 'asc' }, { postcode: 'asc' }, { weightMinG: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!row) throw new DomainException('http.not_found');
    const openLines = row.rates.filter((r) => r.acceptance !== 'accepted').length;
    return {
      id: row.publicId,
      versionNo: row.versionNo,
      status: row.status,
      effectiveFrom: toBangkokIso(row.effectiveFrom),
      reason: row.reason,
      rateCount: row._count.rates,
      openLines: row.status === 'draft' || row.status === 'pending_acceptance' ? openLines : 0,
      sentAt: row.sentAt ? toBangkokIso(row.sentAt) : null,
      factoryAcceptedAt: row.factoryAcceptedAt ? toBangkokIso(row.factoryAcceptedAt) : null,
      decidedAt: row.decidedAt ? toBangkokIso(row.decidedAt) : null,
      rates: row.rates.map(rateDto),
    };
  }

  private async lock(tx: Tx, factoryId: bigint, versionPublicId: string) {
    const [row] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT v.id FROM factory_shipping_rate_card_versions v
      JOIN factory_shipping_rate_cards c ON c.id = v.card_id
      WHERE v.public_id = ${versionPublicId}::uuid AND c.factory_id = ${factoryId}
      FOR UPDATE OF v`;
    if (!row) throw new DomainException('http.not_found');
    return tx.factoryShippingRateCardVersion.findUniqueOrThrow({ where: { id: row.id } });
  }

  private async draft(actor: UserActor, factoryPublicId: string, versionPublicId: string) {
    const factory = await this.access.factory(actor, factoryPublicId);
    const version = await this.prisma.factoryShippingRateCardVersion.findFirst({
      where: { publicId: versionPublicId, card: { factoryId: factory.id } },
    });
    if (!version) throw new DomainException('http.not_found');
    if (version.status !== 'draft') throw new DomainException('shipping.version_not_draft');
    return { factory, version };
  }

  private async rateRows(schemeId: bigint, input: FactoryRateInputDto[]) {
    const zones = await this.zones.byPublicIds(
      schemeId,
      input.map((r) => r.zoneId),
    );
    const postcodes = await this.zones.postcodeZones(
      schemeId,
      input.flatMap((r) => (r.postcode ? [r.postcode] : [])),
    );
    const errors = input.flatMap((r, i) => {
      const zoneId = zones.get(r.zoneId);
      return [
        ...(!zoneId
          ? [{ path: `rates[${i}].zoneId`, code: 'exists', message: 'zoneId is not a zone of the scheme' }]
          : []),
        ...(zoneId && r.postcode && postcodes.get(r.postcode) !== zoneId
          ? [{ path: `rates[${i}].postcode`, code: 'invalid', message: 'postcode is not in the zone' }]
          : []),
      ];
    });
    if (errors.length > 0) throw new DomainException('validation.failed', { errors: errors.slice(0, 200) });
    return input.map((r) => ({
      versionId: 0n,
      schemeId,
      zoneId: zones.get(r.zoneId)!,
      postcode: r.postcode ?? null,
      weightMinG: r.weightMinG,
      weightMaxG: r.weightMaxG ?? null,
      volumeMinCm3: r.volumeMinCm3 === null || r.volumeMinCm3 === undefined ? null : BigInt(r.volumeMinCm3),
      volumeMaxCm3: r.volumeMaxCm3 === null || r.volumeMaxCm3 === undefined ? null : BigInt(r.volumeMaxCm3),
      payoutAmount: r.payoutAmount,
      perExtraKg: r.perExtraKg ?? null,
    }));
  }

  private async writeRates(tx: Tx, versionId: bigint, rows: Prisma.FactoryShippingRateCreateManyInput[]) {
    try {
      await tx.factoryShippingRate.createMany({ data: rows.map((r) => ({ ...r, versionId })) });
    } catch (error) {
      if (
        String(error).includes('ex_factory_shipping_rates__no_overlap') ||
        String(error).includes('ck_factory_shipping_rates')
      ) {
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'rates',
              code: 'invalid',
              message: 'bands overlap within a zone or postcode, or are out of order',
            },
          ],
        });
      }
      throw error;
    }
  }

  /** D-044: every staff read of a factory's buy prices leaves an audit row. */
  private async auditRead(
    factory: Factory,
    resourceType: string,
    resourcePublicId: string,
    action = 'price.read_other_factory',
  ) {
    await this.audit.record(this.prisma, {
      category: 'data_access',
      action,
      resourceType,
      resourcePublicId,
      data: { factory: factory.code },
    });
  }

  /** Audit + event + factory activity (hidden from the factory while the version is a Packio draft). */
  private async record(
    tx: Tx,
    factory: Factory,
    versionPublicId: string,
    type: string,
    data: Record<string, unknown>,
    internal = false,
  ): Promise<void> {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'factory_shipping_rate_card_version',
      resourcePublicId: versionPublicId,
      data: { factory: factory.code, ...data },
    });
    const event = await this.events.record(tx, {
      type,
      aggregateType: 'factory_shipping_rate_card_version',
      aggregateId: versionPublicId,
      payload: { factoryId: factory.publicId, versionId: versionPublicId, ...data },
    });
    await this.activity.record(tx, {
      aggregateType: 'factory',
      aggregatePublicId: factory.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: internal ? ['internal'] : ['internal', 'partner'],
      domainEventId: event.id,
    });
  }
}
