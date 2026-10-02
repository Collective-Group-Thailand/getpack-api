import { randomBytes } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type ProductUnit, type QuoteStatus, type SalesChannel } from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import {
  assertStoreRules,
  CALCULATOR_SALES_UNIT,
  validateConfiguration,
} from '@modules/pricing/quotes/configurations';
import {
  QuoteEngineService,
  type QuoteStepView,
  type QuoteView,
} from '@modules/pricing/quotes/quote-engine.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

import { resolveAdvisoryLink } from './advisory-link';
import {
  type BoxConfiguration,
  boxSpecLines,
  type LabelSpecConfiguration,
  labelSpecLines,
  type PouchSpecConfiguration,
  pouchSpecLines,
  serviceSpecLines,
  type StandardProductSpecConfiguration,
  standardProductSpecLines,
  SUMMARY_INCLUDE,
  type TagSleeveSpecConfiguration,
  tagSleeveSpecLines,
  withBasisLines,
} from './line-summary';

const BOX_CALCULATORS: ReadonlySet<string> = new Set(['folding', 'corrugate']);

export const QUOTE_INCLUDE = {
  options: { orderBy: { quantity: 'asc' } },
  productType: SUMMARY_INCLUDE.productType,
  catalogProduct: SUMMARY_INCLUDE.catalogProduct,
  customer: {
    select: { publicId: true, displayName: true, customerProfile: { select: { customerCode: true } } },
  },
  createdBy: { select: { publicId: true, displayName: true } },
  pdfFile: { select: { publicId: true } },
  rfqQuote: { select: { rfq: { select: { publicId: true, rfqCode: true } } } },
  advisoryRecommendation: { select: { publicId: true } },
  advisoryChoice: { select: { publicId: true } },
} satisfies Prisma.QuoteInclude;
export type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

export interface SaveQuoteInput {
  productTypeCode: string;
  /** The configuration of the product type's calculator (validated here against its DTO). */
  configuration: Record<string, unknown>;
  deliveryPostcode?: string;
  anonymousId?: string;
  /** D-240: the Structure Advisor recommendation the quotation follows (store only). */
  advisoryRecommendationId?: string;
}

/** Who asks: a signed-in customer, an anonymous configurator session, or staff (CS). */
export type QuoteOwner =
  | { kind: 'customer'; userId: bigint }
  | { kind: 'anonymous'; anonymousId: string }
  | { kind: 'staff'; actor: UserActor };

/** A lifecycle status in which the price is still locked (D-051). */
const LIVE: QuoteStatus[] = ['saved', 'shared'];
const DAY_MS = 86_400_000;

/**
 * Saved quotations (D-051): the server re-prices the configuration, then stores the input, every
 * instant quantity and the version ids used as a write-once snapshot (schema-design §2.2) valid for
 * `quotes.validity_days` with the price locked; after expiry it is re-priced into a new quote. Share
 * links are opaque tokens stored hashed; the QT number is issued when the quote is shared or its PDF
 * requested (schema-design §3.5).
 */
@Injectable()
export class SavedQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly settings: SettingsService,
    private readonly entities: EntitiesService,
    private readonly numbering: DocumentNumberingService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async save(
    owner: QuoteOwner,
    channel: SalesChannel,
    input: SaveQuoteInput,
    extra: { customerUserId?: bigint; supersedes?: bigint; ip?: string; staffNote?: string } = {},
  ): Promise<QuoteRow> {
    const now = new Date();
    const { type, calculatorKey, configuration, view } = await this.priced(owner, channel, input, now, {
      ip: extra.ip,
    });
    const steps = view.steps.filter((s) => s.instant && s.internal);
    if (steps.length === 0) throw new DomainException('quotes.nothing_to_save');
    const validity = await this.settings.at('quotes.validity_days', { at: now });
    const entityId = await this.entities.defaultEntityId();
    const factories = await this.factoryIds(steps);
    const versions = await this.priceListVersionIds(steps);
    const snapshotInput = {
      productTypeCode: input.productTypeCode,
      configuration: configuration,
      deliveryPostcode: input.deliveryPostcode ?? null,
      // D-182: the sizes on every basis and the size priced, frozen with the quote (input schema 2).
      ...(view.dimensions && { dimensions: view.dimensions }),
    };
    const configRefs = {
      ...view.configRefs,
      settingVersionIds: {
        ...view.configRefs.settingVersionIds,
        'quotes.validity_days': String(validity.versionId),
      },
    };
    const unit = CALCULATOR_SALES_UNIT[calculatorKey] ?? 'piece';
    const options = steps.map((s) => this.optionRow(s, factories, versions, unit));
    const snapshotSha256 = sha256(
      JSON.stringify(
        canonical({ input: snapshotInput, configRefs, calculatorVersion: view.calculatorVersion, options }),
      ),
    );
    const customerUserId = owner.kind === 'customer' ? owner.userId : (extra.customerUserId ?? null);
    // Box calculators (folding, corrugate) share one configuration shape; others get their lines when ported.
    const specLines = BOX_CALCULATORS.has(calculatorKey)
      ? await boxSpecLines(this.prisma, configuration as unknown as BoxConfiguration)
      : calculatorKey === 'label'
        ? await labelSpecLines(this.prisma, configuration as unknown as LabelSpecConfiguration)
        : calculatorKey === 'tag_sleeve'
          ? await tagSleeveSpecLines(this.prisma, configuration as unknown as TagSleeveSpecConfiguration)
          : calculatorKey === 'pouch'
            ? await pouchSpecLines(this.prisma, configuration as unknown as PouchSpecConfiguration)
            : calculatorKey === 'standard_product'
              ? await standardProductSpecLines(
                  this.prisma,
                  configuration as unknown as StandardProductSpecConfiguration,
                )
              : calculatorKey === 'service'
                ? await serviceSpecLines(
                    this.prisma,
                    configuration as unknown as { catalogProductId: string },
                  )
                : null;
    const specSummary = specLines ? withBasisLines(specLines, view.dimensions) : null;
    const advisory = input.advisoryRecommendationId
      ? await resolveAdvisoryLink(this.prisma, owner, input.advisoryRecommendationId, configuration)
      : null;
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          entityId,
          channel,
          source: 'instant',
          customerUserId,
          createdById: owner.kind === 'staff' ? owner.actor.userId : null,
          staffNote: owner.kind === 'staff' ? extra.staffNote?.trim() || null : null,
          anonymousId: owner.kind === 'anonymous' ? owner.anonymousId : null,
          productTypeId: type.id,
          catalogProductId: await this.catalogProductId(configuration),
          stockProductId: await this.stockProductId(configuration),
          input: snapshotInput as unknown as Prisma.InputJsonValue,
          inputSchemaVersion: view.dimensions ? 2 : 1,
          specSummary: specSummary ? (specSummary as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          calculatorVersion: view.calculatorVersion,
          configRefs: configRefs,
          status: 'saved',
          validUntil: new Date(now.getTime() + Number(validity.value) * DAY_MS),
          deliveryPostcode: input.deliveryPostcode ?? null,
          snapshotSha256,
          options: { create: options },
          advisoryRecommendationId: advisory?.recommendationId ?? null,
          advisoryChoiceId: advisory?.choiceId ?? null,
        },
      });
      if (extra.supersedes) {
        await tx.quote.update({
          where: { id: extra.supersedes },
          data: { status: 'superseded', supersededById: quote.id },
        });
      }
      if (view.calculateLog) {
        await tx.calculateLog.update({
          where: { id_occurredAt: { id: view.calculateLog.id, occurredAt: view.calculateLog.occurredAt } },
          data: { quoteId: quote.id },
        });
      }
      await this.record(tx, quote.publicId, 'quote.saved', {
        channel,
        productTypeCode: input.productTypeCode,
        quantities: steps.map((s) => s.quantity),
        validUntil: quote.validUntil.toISOString(),
        supersedes: extra.supersedes ? true : undefined,
        advisoryRecommendationId: input.advisoryRecommendationId,
      });
      return tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: QUOTE_INCLUDE });
    });
  }

  /** A quote the owner may read; anything else is 404 (contract §5). */
  async get(owner: QuoteOwner, publicId: string, db: Tx = this.prisma): Promise<QuoteRow> {
    const quote = await db.quote.findUnique({ where: { publicId }, include: QUOTE_INCLUDE });
    if (!quote || !this.owns(owner, quote)) throw new DomainException('http.not_found');
    return quote;
  }

  async list(where: Prisma.QuoteWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: QUOTE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.quote.count({ where }),
    ]);
    return { rows, total };
  }

  /** A signed-in customer takes over the quote saved before login in the same session. */
  async claim(userId: bigint, publicId: string, anonymousId: string): Promise<QuoteRow> {
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.quote.findUnique({ where: { publicId } });
      if (
        !quote ||
        quote.anonymousId !== anonymousId ||
        (quote.customerUserId && quote.customerUserId !== userId)
      ) {
        throw new DomainException('http.not_found');
      }
      if (!quote.customerUserId) {
        await tx.quote.update({
          where: { id: quote.id },
          data: { customerUserId: userId, rowVersion: { increment: 1 } },
        });
        await this.record(tx, quote.publicId, 'quote.claimed', {});
      }
      return tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: QUOTE_INCLUDE });
    });
  }

  /**
   * Prices a specification exactly as saving it would, without saving or logging a calculation (a preview, e.g. of a
   * reorder, D-153).
   */
  async preview(owner: QuoteOwner, channel: SalesChannel, input: SaveQuoteInput): Promise<QuoteView> {
    return (await this.priced(owner, channel, input, new Date(), { log: false })).view;
  }

  private async priced(
    owner: QuoteOwner,
    channel: SalesChannel,
    input: SaveQuoteInput,
    now: Date,
    extra: { ip?: string; log?: boolean },
  ) {
    const type = await this.prisma.productType.findFirst({
      where: { code: input.productTypeCode, status: 'active' },
    });
    if (
      !type?.calculatorKey ||
      !this.engine.hasCalculator(type.calculatorKey) ||
      (owner.kind !== 'staff' && type.quoteMode !== 'instant')
    ) {
      throw new DomainException('pricing.not_instant');
    }
    const configuration = await validateConfiguration(type.calculatorKey, input.configuration, {
      staff: owner.kind === 'staff',
    });
    if (owner.kind !== 'staff') await assertStoreRules(this.prisma, type.calculatorKey, configuration);
    const view = await this.engine.price(type.calculatorKey, configuration, {
      channel,
      at: now,
      actorUserId:
        owner.kind === 'customer' ? owner.userId : owner.kind === 'staff' ? owner.actor.userId : undefined,
      anonymousId: owner.kind === 'anonymous' ? owner.anonymousId : undefined,
      deliveryPostcode: input.deliveryPostcode,
      ip: extra.ip,
      ...(extra.log === false && { log: false }),
    });
    return { type, calculatorKey: type.calculatorKey, configuration, view };
  }

  /**
   * Issues the QT number when missing and a new share token (returned once; only its hash is kept,
   * so sharing again revokes the previous link).
   */
  async share(owner: QuoteOwner, publicId: string): Promise<{ quote: QuoteRow; token: string }> {
    return this.prisma.withTx(async (tx) => {
      const quote = await this.live(tx, owner, publicId);
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      // D-185 / F5: a share link expires like a design link (setting `configurations.share_link_days`).
      const days = Number((await this.settings.at('configurations.share_link_days', { at: now })).value);
      const expiresAt = new Date(now.getTime() + days * DAY_MS);
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          quoteCode: quote.quoteCode ?? (await this.numbering.next(tx, 'qt')),
          shareTokenHash: sha256(token),
          sharedAt: now,
          shareExpiresAt: expiresAt,
          status: 'shared',
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, quote.publicId, 'quote.shared', { expiresAt: expiresAt.toISOString() });
      return {
        quote: await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: QUOTE_INCLUDE }),
        token,
      };
    });
  }

  /** Revokes the share link (D-185): the link stops resolving; the quotation is saved again. */
  async unshare(owner: QuoteOwner, publicId: string): Promise<QuoteRow> {
    return this.prisma.withTx(async (tx) => {
      const quote = await this.get(owner, publicId, tx);
      if (!quote.shareTokenHash) return quote;
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          shareTokenHash: null,
          shareExpiresAt: null,
          ...(quote.status === 'shared' && { status: 'saved' }),
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, quote.publicId, 'quote.share_revoked', {});
      return tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: QUOTE_INCLUDE });
    });
  }

  /**
   * The quote behind a share link (D-185, F5): only while it is shared and the link has neither expired nor been
   * revoked — a converted, expired or superseded quotation is no longer shown. 404 either way (no existence oracle).
   */
  async shared(token: string): Promise<QuoteRow> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainException('http.not_found');
    const quote = await this.prisma.quote.findUnique({
      where: { shareTokenHash: sha256(token) },
      include: QUOTE_INCLUDE,
    });
    const live = quote?.shareExpiresAt && quote.shareExpiresAt > new Date();
    if (!quote || quote.status !== 'shared' || !live) throw new DomainException('http.not_found');
    return quote;
  }

  /** After expiry the quote is re-priced into a new one at today's prices (D-051); a live quote keeps its lock. */
  async reprice(owner: QuoteOwner, publicId: string): Promise<QuoteRow> {
    const quote = await this.get(owner, publicId);
    if (quote.source !== 'instant') throw new DomainException('quotes.not_repriceable');
    if (LIVE.includes(quote.status) && quote.validUntil > new Date())
      throw new DomainException('quotes.still_valid');
    if (!['saved', 'shared', 'expired'].includes(quote.status))
      throw new DomainException('quotes.not_repriceable');
    const input = quote.input as unknown as {
      productTypeCode: string;
      configuration: Record<string, unknown>;
      deliveryPostcode: string | null;
    };
    return this.save(
      owner,
      quote.channel,
      {
        productTypeCode: input.productTypeCode,
        configuration: input.configuration,
        deliveryPostcode: input.deliveryPostcode ?? undefined,
        anonymousId: quote.anonymousId ?? undefined,
      },
      { customerUserId: quote.customerUserId ?? undefined, supersedes: quote.id },
    );
  }

  /**
   * Requests the quotation PDF (issued in the name of the entity, D-010/D-092): the QT number is taken
   * now and the worker renders the document (`quote.pdf_requested`); poll the quote for `pdf`.
   */
  async requestPdf(owner: QuoteOwner, requester: UserActor, publicId: string): Promise<QuoteRow> {
    return this.prisma.withTx(async (tx) => {
      const quote = await this.get(owner, publicId, tx);
      if (!quote.pdfFileId && !quote.pdfRequestedAt) {
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            quoteCode: quote.quoteCode ?? (await this.numbering.next(tx, 'qt')),
            pdfRequestedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await this.events.record(tx, {
          type: 'quote.pdf_requested',
          aggregateType: 'quote',
          aggregateId: quote.publicId,
          payload: { quoteId: quote.publicId, requestedByUserId: requester.userId.toString() },
        });
      }
      return tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: QUOTE_INCLUDE });
    });
  }

  /** Scheduled: live quotes past their validity become `expired` (D-051), one event each. */
  async expireDue(now = new Date(), limit = 500): Promise<number> {
    const due = await this.prisma.quote.findMany({
      where: { status: { in: LIVE }, validUntil: { lte: now } },
      select: { id: true, publicId: true },
      take: limit,
    });
    for (const quote of due) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.quote.updateMany({
          where: { id: quote.id, status: { in: LIVE } },
          data: { status: 'expired', rowVersion: { increment: 1 } },
        });
        if (count === 1)
          await this.record(
            tx,
            quote.publicId,
            'quote.expired',
            {},
            { type: 'system', name: 'quotes.expire' },
          );
      });
    }
    return due.length;
  }

  // --- helpers ---------------------------------------------------------------------------------------

  owns(owner: QuoteOwner, quote: { customerUserId: bigint | null; anonymousId: string | null }): boolean {
    if (owner.kind === 'staff') return true;
    if (owner.kind === 'customer') return quote.customerUserId === owner.userId;
    return quote.customerUserId === null && quote.anonymousId === owner.anonymousId;
  }

  private async live(tx: Tx, owner: QuoteOwner, publicId: string) {
    const quote = await this.get(owner, publicId, tx);
    if (!LIVE.includes(quote.status) || quote.validUntil <= new Date())
      throw new DomainException('quotes.not_live');
    return quote;
  }

  private optionRow(
    s: QuoteStepView,
    factories: Map<string, bigint>,
    versions: Map<string, bigint>,
    unit: ProductUnit,
  ): Omit<Prisma.QuoteOptionCreateManyQuoteInput, 'quoteId'> {
    const { internal, ...customer } = s;
    const gross = new MoneyDecimal(s.grossAmount!);
    const vat = new MoneyDecimal(s.vatAmount!);
    const shippingCost = internal!.shipping
      ? new MoneyDecimal(internal!.shipping.costAmount)
      : new MoneyDecimal(0);
    return {
      quantity: s.quantity,
      unit,
      result: customer,
      netAmount: gross.sub(vat).toFixed(2),
      discountAmount: '0.00',
      vatAmount: vat.toFixed(2),
      grossAmount: gross.toFixed(2),
      shippingAmount: s.shippingAmount,
      unitPrice: s.unitPrice!,
      leadTimeDays: s.leadTimeDays,
      earliestShipDate: s.earliestShipDate ? new Date(`${s.earliestShipDate}T00:00:00Z`) : null,
      toleranceShortagePct: s.toleranceShortagePct,
      toleranceOveragePct: s.toleranceOveragePct,
      toleranceDimensionalMm: s.toleranceDimensionalMm,
      toleranceColourDeltaE: s.toleranceColourDeltaE,
      selectedFactoryId: factories.get(internal!.factoryId) ?? null,
      priceListVersionId: versions.get(internal!.priceListVersionId) ?? null,
      internalBreakdown: internal as unknown as Prisma.InputJsonValue,
      buyCostNet: new MoneyDecimal(internal!.buyPrice).add(shippingCost).toFixed(2),
      marginPct: internal!.marginPct,
      belowMarginFloor: internal!.belowMarginFloor,
    };
  }

  private async factoryIds(steps: QuoteStepView[]) {
    const ids = [...new Set(steps.map((s) => s.internal!.factoryId))];
    const rows = await this.prisma.factory.findMany({
      where: { publicId: { in: ids } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((r) => [r.publicId, r.id]));
  }

  private async priceListVersionIds(steps: QuoteStepView[]) {
    const ids = [...new Set(steps.map((s) => s.internal!.priceListVersionId))];
    const rows = await this.prisma.priceListVersion.findMany({
      where: { publicId: { in: ids } },
      select: { id: true, publicId: true },
    });
    return new Map(rows.map((r) => [r.publicId, r.id]));
  }

  /** The stock product of a standard-product quote (U-B6): checkout and the order read it (`quote.stockProductId`). */
  private async stockProductId(cfg: Record<string, unknown>): Promise<bigint | null> {
    if (typeof cfg['stockProductId'] !== 'string') return null;
    const row = await this.prisma.stockProduct.findUnique({
      where: { publicId: cfg['stockProductId'] },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async catalogProductId(cfg: Record<string, unknown>): Promise<bigint | null> {
    if (typeof cfg['catalogProductId'] !== 'string') return null;
    const row = await this.prisma.catalogProduct.findUnique({
      where: { publicId: cfg['catalogProductId'] },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async record(
    tx: Tx,
    quotePublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor?: Actor,
  ): Promise<void> {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'quote',
        aggregateId: quotePublicId,
        payload: { quoteId: quotePublicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'quote',
      aggregatePublicId: quotePublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      ...(actor ? { actor } : {}),
    });
  }

  customer(publicId: string) {
    return this.prisma.user.findFirst({ where: { publicId, kind: 'customer' }, select: { id: true } });
  }

  /** Staff reads of quotes carry buy prices only through `internal_breakdown` (masked by the controller). */
  auditStaffRead(quotePublicId: string) {
    return this.audit.record(this.prisma, {
      category: 'data_access',
      action: 'quote.read_staff',
      resourceType: 'quote',
      resourcePublicId: quotePublicId,
    });
  }
}

export type { QuoteView };
