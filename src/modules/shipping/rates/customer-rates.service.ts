import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type ConfigVersionStatus, Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import {
  type CreateCustomerRateVersionDto,
  type CustomerRateCardDto,
  type CustomerRateDto,
  type CustomerRateInputDto,
  type CustomerRateVersionDto,
  type CustomerRateVersionSummaryDto,
  type RateImportPreviewDto,
} from './customer-rates.dto';
import { parseRateSheet, RATE_SHEET, ratePreviewSha, rateSheetHeaders, rateSheetRows } from './rate-sheet';
import { RateWorkbookService } from './rate-workbook.service';
import { ZoneRefs } from './zone-refs';

export const CUSTOMER_RATE_CARD_KEY = 'default';
export const CUSTOMER_SCHEME_CODE = 'customer_default';
const POLICY = 'customer_shipping_rate_change';
const SUBJECT = 'customer_shipping_rate_card_version';
const LAYOUT = { amountColumn: 'price_amount' };
/** Back-dating tolerance for clock skew; history is never rewritten (ADR-0005). */
const BACKDATE_SLACK_MS = 60_000;

const SUMMARY_INCLUDE = {
  scheme: { select: { code: true } },
  approvalRequest: { select: { publicId: true } },
  _count: { select: { rates: true } },
} satisfies Prisma.CustomerShippingRateCardVersionInclude;
type SummaryRow = Prisma.CustomerShippingRateCardVersionGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

const RATE_INCLUDE = {
  zone: { select: { publicId: true, code: true } },
} satisfies Prisma.CustomerShippingRateInclude;
type RateRow = Prisma.CustomerShippingRateGetPayload<{ include: typeof RATE_INCLUDE }>;

const summaryDto = (v: SummaryRow): CustomerRateVersionSummaryDto => ({
  id: v.publicId,
  versionNo: v.versionNo,
  status: v.status,
  effectiveFrom: toBangkokIso(v.effectiveFrom),
  reason: v.reason,
  schemeCode: v.scheme.code,
  rateCount: v._count.rates,
  approvalRequestId: v.approvalRequest?.publicId ?? null,
  createdAt: toBangkokIso(v.createdAt),
  decidedAt: v.decidedAt ? toBangkokIso(v.decidedAt) : null,
});

export const rateDto = (r: RateRow): CustomerRateDto => ({
  zoneId: r.zone.publicId,
  zoneCode: r.zone.code,
  postcode: r.postcode,
  weightMinG: r.weightMinG,
  weightMaxG: r.weightMaxG,
  volumeMinCm3: r.volumeMinCm3 === null ? null : Number(r.volumeMinCm3),
  volumeMaxCm3: r.volumeMaxCm3 === null ? null : Number(r.volumeMaxCm3),
  priceAmount: r.priceAmount.toFixed(2),
  perExtraKg: r.perExtraKg === null ? null : r.perExtraKg.toFixed(6).replace(/\.?0+$/, ''),
});

/**
 * The customer shipping rate card (D-013): Logistics / Admin draft a complete version (copy-on-write,
 * JSON or Excel preview → confirm), submit it, and C-Level approves it through the approval engine
 * (policy `customer_shipping_rate_change`, chosen at B2.4 planning). Approved versions are frozen and
 * never apply retroactively; quotes snapshot the version id (schema-design §2.2).
 */
@Injectable()
export class CustomerRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly workbooks: RateWorkbookService,
    private readonly zones: ZoneRefs,
  ) {}

  async card(at = new Date()): Promise<CustomerRateCardDto> {
    const card = await this.cardRow();
    const [current, scheduled, open] = await Promise.all([
      this.prisma.customerShippingRateCardVersion.findFirst({
        where: { cardId: card.id, status: 'approved', effectiveFrom: { lte: at } },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.customerShippingRateCardVersion.findFirst({
        where: { cardId: card.id, status: 'approved', effectiveFrom: { gt: at } },
        orderBy: [{ effectiveFrom: 'asc' }, { versionNo: 'desc' }],
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.customerShippingRateCardVersion.findMany({
        where: { cardId: card.id, status: { in: ['draft', 'proposed'] } },
        orderBy: { versionNo: 'desc' },
        include: SUMMARY_INCLUDE,
      }),
    ]);
    return {
      id: card.publicId,
      key: card.key,
      description: card.description,
      current: current ? summaryDto(current) : null,
      scheduled: scheduled ? summaryDto(scheduled) : null,
      open: open.map(summaryDto),
    };
  }

  async versions(): Promise<CustomerRateVersionSummaryDto[]> {
    const card = await this.cardRow();
    const rows = await this.prisma.customerShippingRateCardVersion.findMany({
      where: { cardId: card.id },
      orderBy: { versionNo: 'desc' },
      include: SUMMARY_INCLUDE,
    });
    return rows.map(summaryDto);
  }

  async version(publicId: string, db: Tx = this.prisma): Promise<CustomerRateVersionDto> {
    const row = await db.customerShippingRateCardVersion.findUnique({
      where: { publicId },
      include: {
        ...SUMMARY_INCLUDE,
        rates: {
          include: RATE_INCLUDE,
          orderBy: [{ zoneId: 'asc' }, { postcode: 'asc' }, { weightMinG: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!row) throw new DomainException('http.not_found');
    return { ...summaryDto(row), rates: row.rates.map(rateDto) };
  }

  /** A draft with a complete set of rates: given, copied from another version, or empty. */
  async createVersion(
    actor: UserActor,
    input: CreateCustomerRateVersionDto,
  ): Promise<CustomerRateVersionDto> {
    const card = await this.cardRow();
    const scheme = await this.zones.scheme(CUSTOMER_SCHEME_CODE);
    const effectiveFrom = new Date(input.effectiveFrom);
    if (effectiveFrom.getTime() < Date.now() - BACKDATE_SLACK_MS)
      throw new DomainException('partners.backdated');
    let rates: Prisma.CustomerShippingRateCreateManyInput[] | null = null;
    if (input.rates) {
      rates = await this.rateRows(scheme.id, input.rates);
    }
    return this.prisma.withTx(async (tx) => {
      if (!rates && input.copyFromVersionId) {
        const source = await tx.customerShippingRateCardVersion.findUnique({
          where: { publicId: input.copyFromVersionId },
          include: { rates: true },
        });
        if (!source || source.cardId !== card.id) {
          throw new DomainException('validation.failed', {
            errors: [
              { path: 'copyFromVersionId', code: 'exists', message: 'copyFromVersionId does not exist' },
            ],
          });
        }
        if (source.schemeId !== scheme.id) {
          throw new DomainException('validation.failed', {
            errors: [
              { path: 'copyFromVersionId', code: 'invalid', message: 'the source uses another zone scheme' },
            ],
          });
        }
        rates = source.rates.map(
          ({
            zoneId,
            postcode,
            weightMinG,
            weightMaxG,
            volumeMinCm3,
            volumeMaxCm3,
            priceAmount,
            perExtraKg,
          }) => ({
            versionId: 0n,
            schemeId: scheme.id,
            zoneId,
            postcode,
            weightMinG,
            weightMaxG,
            volumeMinCm3,
            volumeMaxCm3,
            priceAmount,
            perExtraKg,
          }),
        );
      }
      const last = await tx.customerShippingRateCardVersion.findFirst({
        where: { cardId: card.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.customerShippingRateCardVersion.create({
        data: {
          cardId: card.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          schemeId: scheme.id,
          effectiveFrom,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      if (rates && rates.length > 0) await this.writeRates(tx, version.id, rates);
      await this.record(tx, card.publicId, 'customer_shipping_rate_card.version_drafted', {
        versionId: version.publicId,
        versionNo: version.versionNo,
        rates: rates?.length ?? 0,
      });
      return this.version(version.publicId, tx);
    });
  }

  async replaceRates(
    actor: UserActor,
    versionPublicId: string,
    input: CustomerRateInputDto[],
  ): Promise<CustomerRateVersionDto> {
    const version = await this.draft(actor, versionPublicId);
    const rows = await this.rateRows(version.schemeId, input);
    return this.prisma.withTx(async (tx) => {
      await tx.customerShippingRate.deleteMany({ where: { versionId: version.id } });
      if (rows.length > 0) await this.writeRates(tx, version.id, rows);
      await this.record(tx, version.card.publicId, 'customer_shipping_rate_card.rates_replaced', {
        versionId: version.publicId,
        versionNo: version.versionNo,
        rates: rows.length,
      });
      return this.version(version.publicId, tx);
    });
  }

  async deleteDraft(actor: UserActor, versionPublicId: string): Promise<void> {
    const version = await this.draft(actor, versionPublicId);
    await this.prisma.withTx(async (tx) => {
      await tx.customerShippingRateCardVersion.delete({ where: { id: version.id } });
      await this.record(tx, version.card.publicId, 'customer_shipping_rate_card.version_deleted', {
        versionId: version.publicId,
        versionNo: version.versionNo,
      });
    });
  }

  /** Draft → proposed with a C-Level approval request (the requester can never approve it). */
  async submit(actor: UserActor, versionPublicId: string): Promise<CustomerRateVersionDto> {
    const version = await this.draft(actor, versionPublicId);
    return this.prisma.withTx(async (tx) => {
      const rates = await tx.customerShippingRate.count({ where: { versionId: version.id } });
      if (rates === 0) throw new DomainException('shipping.rates_empty');
      if (
        (await tx.customerShippingRateCardVersion.count({
          where: { cardId: version.cardId, status: 'proposed' },
        })) > 0
      ) {
        throw new DomainException('partners.version_pending');
      }
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: SUBJECT, id: version.id, publicId: version.publicId },
        requester: actor,
        payload: {
          card: version.card.key,
          versionNo: version.versionNo,
          effectiveFrom: version.effectiveFrom.toISOString(),
          rates,
          reason: version.reason,
        },
      });
      await tx.customerShippingRateCardVersion.update({
        where: { id: version.id },
        data: { status: 'proposed', approvalRequestId: request.id },
      });
      await this.record(tx, version.card.publicId, 'customer_shipping_rate_card.version_submitted', {
        versionId: version.publicId,
        versionNo: version.versionNo,
        approvalRequestId: request.publicId,
      });
      return this.version(version.publicId, tx);
    });
  }

  /** The requester withdraws a version in approval (its approval request is withdrawn with it). */
  async withdraw(actor: UserActor, versionPublicId: string, reason: string): Promise<CustomerRateVersionDto> {
    return this.prisma.withTx(async (tx) => {
      const version = await tx.customerShippingRateCardVersion.findUnique({
        where: { publicId: versionPublicId },
        include: { card: true, approvalRequest: true },
      });
      if (!version) throw new DomainException('http.not_found');
      if (version.status !== 'proposed' || !version.approvalRequest)
        throw new DomainException('shipping.version_not_proposed');
      await this.approvals.withdrawInTx(tx, actor, version.approvalRequest.publicId, reason);
      await tx.customerShippingRateCardVersion.update({
        where: { id: version.id },
        data: { status: 'withdrawn', decidedAt: new Date(), decidedById: actor.userId },
      });
      await this.record(tx, version.card.publicId, 'customer_shipping_rate_card.version_withdrawn', {
        versionId: version.publicId,
        versionNo: version.versionNo,
      });
      return this.version(version.publicId, tx);
    });
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'shipping.customer-rate-card',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const version = await tx.customerShippingRateCardVersion.findFirst({
      where: { approvalRequestId: request.id, status: 'proposed' },
      include: { card: true },
    });
    if (!version) return; // idempotent, or withdrawn in the requester's transaction
    const status: ConfigVersionStatus =
      event.type === 'approval.approved'
        ? 'approved'
        : event.type === 'approval.withdrawn'
          ? 'withdrawn'
          : 'rejected';
    const now = new Date();
    // Never retroactive: an effective date that passed while in approval becomes the decision time.
    const effectiveFrom = status === 'approved' && version.effectiveFrom < now ? now : version.effectiveFrom;
    await tx.customerShippingRateCardVersion.update({
      where: { id: version.id },
      data: { status, effectiveFrom, decidedAt: now, decidedById: null },
    });
    await this.record(tx, version.card.publicId, `customer_shipping_rate_card.version_${status}`, {
      versionId: version.publicId,
      versionNo: version.versionNo,
      effectiveFrom: effectiveFrom.toISOString(),
      approvalRequestId: event.aggregateId,
    });
  }

  // --- Excel -----------------------------------------------------------------------------------------

  async importPreview(
    actor: UserActor,
    versionPublicId: string,
    fileId: string,
  ): Promise<RateImportPreviewDto> {
    const version = await this.draft(actor, versionPublicId);
    const { parsed, sha } = await this.parse(actor, version, fileId);
    return {
      fileId,
      previewSha256: sha,
      rows: parsed.rates.length + new Set(parsed.errors.map((e) => e.row)).size,
      invalid: new Set(parsed.errors.map((e) => e.row)).size,
      canConfirm: parsed.errors.length === 0 && parsed.rates.length > 0,
      errors: parsed.errors.slice(0, 200),
      errorsTruncated: parsed.errors.length > 200,
    };
  }

  /** Replaces the draft's rates with the previewed file; refuses a changed file or plan. */
  async importConfirm(
    actor: UserActor,
    versionPublicId: string,
    fileId: string,
    previewSha256: string,
  ): Promise<CustomerRateVersionDto> {
    const version = await this.draft(actor, versionPublicId);
    const { parsed, sha } = await this.parse(actor, version, fileId);
    if (sha !== previewSha256) throw new DomainException('catalog.import_stale');
    if (parsed.errors.length > 0 || parsed.rates.length === 0)
      throw new DomainException('catalog.import_invalid');
    const zoneIds = await this.zones.byCodes(
      version.schemeId,
      parsed.rates.map((r) => r.zoneCode),
    );
    const rows = parsed.rates.map((r) => ({
      versionId: version.id,
      schemeId: version.schemeId,
      zoneId: zoneIds.get(r.zoneCode)!,
      postcode: r.postcode,
      weightMinG: r.weightMinG,
      weightMaxG: r.weightMaxG,
      volumeMinCm3: r.volumeMinCm3 === null ? null : BigInt(r.volumeMinCm3),
      volumeMaxCm3: r.volumeMaxCm3 === null ? null : BigInt(r.volumeMaxCm3),
      priceAmount: r.amount,
      perExtraKg: r.perExtraKg,
    }));
    return this.prisma.withTx(async (tx) => {
      await tx.customerShippingRate.deleteMany({ where: { versionId: version.id } });
      await this.writeRates(tx, version.id, rows);
      await this.record(tx, version.card.publicId, 'customer_shipping_rate_card.rates_imported', {
        versionId: version.publicId,
        versionNo: version.versionNo,
        fileId,
        rates: rows.length,
      });
      return this.version(version.publicId, tx);
    });
  }

  async export(actor: UserActor, versionPublicId: string) {
    const version = await this.version(versionPublicId);
    return this.workbooks.export(actor, {
      name: `customer-shipping-rates-v${version.versionNo}`,
      sheet: RATE_SHEET,
      headers: rateSheetHeaders(LAYOUT),
      rows: rateSheetRows(
        LAYOUT,
        version.rates.map((r) => ({ ...r, amount: r.priceAmount })),
      ),
      resourceType: 'customer_shipping_rate_card_version',
      resourcePublicId: version.id,
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private async parse(actor: UserActor, version: { publicId: string; schemeId: bigint }, fileId: string) {
    const { workbook, sha256 } = await this.workbooks.load(actor, fileId);
    const parsed = parseRateSheet(workbook, LAYOUT);
    const known = await this.zones.byCodes(
      version.schemeId,
      parsed.rates.map((r) => r.zoneCode),
    );
    const postcodes = await this.zones.postcodeZones(
      version.schemeId,
      parsed.rates.flatMap((r) => (r.postcode ? [r.postcode] : [])),
    );
    for (const rate of [...parsed.rates]) {
      const zoneId = known.get(rate.zoneCode);
      const error = !zoneId
        ? { column: 'zone_code', code: 'ref', message: `zone ${rate.zoneCode} does not exist in the scheme` }
        : rate.postcode && postcodes.get(rate.postcode) !== zoneId
          ? {
              column: 'postcode',
              code: 'ref',
              message: `postcode ${rate.postcode} is not in zone ${rate.zoneCode}`,
            }
          : null;
      if (error) {
        parsed.errors.push({ sheet: RATE_SHEET, row: rate.row, ...error });
        parsed.rates.splice(parsed.rates.indexOf(rate), 1);
      }
    }
    parsed.errors.sort((a, b) => a.row - b.row);
    return { parsed, sha: ratePreviewSha(version.publicId, sha256, parsed) };
  }

  private async cardRow() {
    const card = await this.prisma.customerShippingRateCard.findUnique({
      where: { key: CUSTOMER_RATE_CARD_KEY },
    });
    if (!card) throw new DomainException('http.not_found');
    return card;
  }

  /** A draft the actor may edit: drafts are edited by their author until submitted (ADR-0005). */
  private async draft(actor: UserActor, publicId: string) {
    const version = await this.prisma.customerShippingRateCardVersion.findUnique({
      where: { publicId },
      include: { card: true },
    });
    if (!version) throw new DomainException('http.not_found');
    if (version.status !== 'draft') throw new DomainException('shipping.version_not_draft');
    if (version.createdById !== actor.userId) throw new DomainException('auth.forbidden');
    return version;
  }

  private async rateRows(schemeId: bigint, input: CustomerRateInputDto[]) {
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
        ...(r.weightMaxG !== null && r.weightMaxG <= r.weightMinG
          ? [
              {
                path: `rates[${i}].weightMaxG`,
                code: 'invalid',
                message: 'weightMaxG must exceed weightMinG',
              },
            ]
          : []),
        ...(r.volumeMaxCm3 !== null && r.volumeMaxCm3 <= (r.volumeMinCm3 ?? 0)
          ? [
              {
                path: `rates[${i}].volumeMaxCm3`,
                code: 'invalid',
                message: 'volumeMaxCm3 must exceed volumeMinCm3',
              },
            ]
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
      priceAmount: r.priceAmount,
      perExtraKg: r.perExtraKg ?? null,
    }));
  }

  private async writeRates(tx: Tx, versionId: bigint, rows: Prisma.CustomerShippingRateCreateManyInput[]) {
    try {
      await tx.customerShippingRate.createMany({ data: rows.map((r) => ({ ...r, versionId })) });
    } catch (error) {
      if (
        String(error).includes('ex_customer_shipping_rates__no_overlap') ||
        String(error).includes('ck_customer_shipping_rates')
      ) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'rates', code: 'invalid', message: 'bands overlap within a zone or postcode' }],
        });
      }
      throw error;
    }
  }

  private async record(
    tx: Tx,
    cardPublicId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'customer_shipping_rate_card',
      resourcePublicId: cardPublicId,
      data,
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'customer_shipping_rate_card',
      aggregateId: cardPublicId,
      payload: { cardId: cardPublicId, ...data },
    });
  }
}
