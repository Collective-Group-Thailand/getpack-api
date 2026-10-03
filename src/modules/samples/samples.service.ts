import { createHash } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type MeasurementBasis, Prisma, type Sample, type SampleStatus } from '@generated/prisma/client';
import { type CartRow, CartsService } from '@modules/carts/carts.service';
import { canonical } from '@modules/catalog/imports/import-engine';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { OrderChargesService } from '@modules/payment-schedules/order-charges.service';
import { CsServicePricingService } from '@modules/pricing/quotes/cs-service-pricing.service';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { ShippingRatesResolver } from '@modules/shipping/rates/shipping-rates.resolver';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingsService } from '@platform/settings/settings.service';

const D = (v: Prisma.Decimal | string | number) => new MoneyDecimal(v.toString());
const DAY_MS = 86_400_000;

/** D-253: a sample still moving towards the customer's decision. */
export const LIVE_SAMPLE_STATUSES: SampleStatus[] = [
  'requested',
  'quoted',
  'paid',
  'in_production',
  'shipped',
  'delivered',
];

export const SAMPLE_INCLUDE = {
  productType: { select: { code: true, nameTh: true, nameEn: true } },
  order: { select: { publicId: true, orderCode: true, kind: true, customerUserId: true } },
  productionJob: { select: { publicId: true, jobNo: true, factoryId: true, status: true } },
  quote: {
    select: { publicId: true, status: true, options: { select: { publicId: true }, take: 1 } },
  },
  sourceQuote: { select: { publicId: true } },
  sourceDraft: { select: { publicId: true } },
  previousSample: { select: { publicId: true } },
  approvedProof: { select: { publicId: true } },
  bulkQuote: { select: { publicId: true } },
  creditOrder: { select: { publicId: true, orderCode: true } },
  customer: { select: { publicId: true, displayName: true } },
} satisfies Prisma.SampleInclude;
export type SampleRow = Prisma.SampleGetPayload<{ include: typeof SAMPLE_INCLUDE }>;

export interface SamplePhoto {
  id: string;
  sha256: string | null;
}

export interface PriceInput {
  /** A service catalogue item (e.g. a mockup) whose sell table prices the CS amount (D-194). */
  serviceItemId: string;
  basis: 'buy_cost_net' | 'sell_gross';
  amount: number;
}

/**
 * Samples (U2.4, D-072, D-192–D-197, D-253–D-259). Attached samples are the D-072 add-on of a bulk order (a `mockup`
 * line, job and purchase order) that now ships to the customer, is decided by them with evidence and holds bulk
 * production until approved (finding F4). Standalone samples are requested before any bulk order, quoted by CS as a
 * sample quotation and bought through cart and checkout as an order of kind `sample`. CS prices both from an amount
 * through the service sell table (D-194) and the factory's buy amount reaches its purchase order (D-254). Status
 * changes come from the owning flows and from production, payment and shipping events.
 */
@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: OrderChargesService,
    private readonly pricing: CsServicePricingService,
    private readonly rates: ShippingRatesResolver,
    private readonly settings: SettingsService,
    private readonly entities: EntitiesService,
    private readonly access: FactoryAccess,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly audit: AuditService,
    private readonly quotes: SavedQuotesService,
    private readonly carts: CartsService,
  ) {}

  // --- reads ------------------------------------------------------------------------------------------

  async getForCustomer(customerUserId: bigint, publicId: string): Promise<SampleRow> {
    const row = await this.prisma.sample.findUnique({ where: { publicId }, include: SAMPLE_INCLUDE });
    if (!row || row.customerUserId !== customerUserId) throw new DomainException('http.not_found');
    return row;
  }

  async getForStaff(publicId: string, db: Tx = this.prisma): Promise<SampleRow> {
    const row = await db.sample.findUnique({ where: { publicId }, include: SAMPLE_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** A factory sees the samples of its own jobs only (D-044). */
  async getForPartner(actor: Actor, factoryPublicId: string, publicId: string): Promise<SampleRow> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const row = await this.prisma.sample.findUnique({ where: { publicId }, include: SAMPLE_INCLUDE });
    if (!row || row.productionJob?.factoryId !== factory.id) throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.SampleWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.sample.findMany({
        where,
        include: SAMPLE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.sample.count({ where }),
    ]);
    return { rows, total };
  }

  async listForPartner(actor: Actor, factoryPublicId: string, page: number, perPage: number) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.list({ productionJob: { factoryId: factory.id } }, page, perPage);
  }

  async photos(sampleIds: bigint[], db: Tx = this.prisma): Promise<Map<bigint, SamplePhoto[]>> {
    const map = new Map<bigint, SamplePhoto[]>();
    if (sampleIds.length === 0) return map;
    const rows = await db.attachment.findMany({
      where: { subjectType: 'sample', subjectId: { in: sampleIds } },
      include: { fileObject: { select: { publicId: true, sha256: true } } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    for (const r of rows) {
      const list = map.get(r.subjectId) ?? [];
      list.push({
        id: r.fileObject.publicId,
        sha256: r.fileObject.sha256 ? Buffer.from(r.fileObject.sha256).toString('hex') : null,
      });
      map.set(r.subjectId, list);
    }
    return map;
  }

  // --- attached (D-072 add-on on a bulk order, F4) -----------------------------------------------------

  /**
   * CS adds a sample to a bulk order before production (D-253, D-254): an add-on charge at the CS price, the factory's
   * buy amount kept for its purchase order. One live attached sample per order; after "changes requested" or a
   * rejection a new one may follow (`previousSampleId`).
   */
  async createAttached(
    actor: UserActor,
    orderPublicId: string,
    input: PriceInput & {
      mockupOption: 'with_print' | 'without_print';
      quantity?: number;
      reason: string;
      previousSampleId?: string;
    },
  ): Promise<SampleRow> {
    const quantity = input.quantity ?? 1;
    const price = await this.price(input, quantity);
    return this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        include: { quote: { select: { input: true } } },
      });
      if (!order || order.kind !== 'standard') throw new DomainException('http.not_found');
      if (
        await tx.sample.count({
          where: { orderId: order.id, kind: 'attached', status: { in: LIVE_SAMPLE_STATUSES } },
        })
      )
        throw new DomainException('samples.exists');
      const previous = input.previousSampleId
        ? await tx.sample.findUnique({ where: { publicId: input.previousSampleId } })
        : null;
      if (
        input.previousSampleId &&
        (!previous ||
          previous.orderId !== order.id ||
          !['changes_requested', 'rejected'].includes(previous.status))
      )
        throw new DomainException('samples.invalid_status', {
          params: { status: previous?.status ?? 'unknown', action: 'requote' },
        });
      const printed = input.mockupOption === 'with_print';
      const charge = await this.charges.addCharge(
        tx,
        order.id,
        {
          lineType: 'mockup',
          descriptionTh: printed ? 'ตัวอย่างจริง (ม็อกอัพ) แบบพิมพ์' : 'ตัวอย่างจริง (ม็อกอัพ) แบบไม่พิมพ์',
          descriptionEn: printed ? 'Sample (mockup), printed' : 'Sample (mockup), unprinted',
          unit: 'set',
          netAmount: price.sellNet,
          whtCategory: order.taxNature === 'hire_of_work' ? 'hire_of_work' : 'none',
          revenueCategory: 'mockup',
          reason: `D-253 sample: ${input.reason}`,
          instalmentLabelTh: 'ค่าตัวอย่างจริง (ม็อกอัพ)',
          instalmentLabelEn: 'Sample (mockup)',
        },
        actor,
      );
      if (order.mockupOption === 'none')
        await tx.order.update({
          where: { id: order.id },
          data: { mockupOption: input.mockupOption, rowVersion: { increment: 1 } },
        });
      const stored = (order.quote.input ?? {}) as { configuration?: unknown; dimensions?: unknown };
      const now = new Date();
      const sample = await tx.sample.create({
        data: {
          entityId: order.entityId,
          kind: 'attached',
          status: 'quoted',
          customerUserId: order.customerUserId,
          productTypeId: order.productTypeId,
          configuration: stored.configuration ?? {},
          dimensions: stored.dimensions ?? Prisma.DbNull,
          mockupOption: input.mockupOption,
          quantity,
          orderId: order.id,
          orderLineId: charge.orderLineId,
          previousSampleId: previous?.id ?? null,
          sellNetAmount: charge.net,
          sellGrossAmount: charge.gross,
          buyNetAmount: price.buyNet,
          quotedAt: now,
          quotedById: actor.userId,
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sample.priced',
        actor,
        resourceType: 'sample',
        resourcePublicId: sample.publicId,
        data: {
          kind: 'attached',
          orderId: order.publicId,
          basis: input.basis,
          amount: String(input.amount),
          sellNetAmount: charge.net,
          buyNetAmount: price.buyNet,
          reason: input.reason,
        },
      });
      await this.record(tx, sample, 'sample.quoted', { kind: 'attached', orderId: order.publicId }, actor);
      return this.getForStaff(sample.publicId, tx);
    });
  }

  // --- standalone (D-253, D-254) -------------------------------------------------------------------------

  /** The customer asks for a sample of their own saved quotation or draft configuration. */
  async request(
    customerUserId: bigint,
    input: {
      quoteId?: string;
      draftId?: string;
      mockupOption: 'with_print' | 'without_print';
      quantity?: number;
      deliveryPostcode?: string;
      note?: string;
    },
  ): Promise<SampleRow> {
    if (Boolean(input.quoteId) === Boolean(input.draftId))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'quoteId', code: 'one_of', message: 'give either quoteId or draftId' }],
      });
    let productTypeId: bigint;
    let configuration: unknown;
    let dimensions: unknown = null;
    let postcode: string | null = input.deliveryPostcode ?? null;
    let sourceQuoteId: bigint | null = null;
    let sourceDraftId: bigint | null = null;
    if (input.quoteId) {
      const quote = await this.prisma.quote.findUnique({ where: { publicId: input.quoteId } });
      if (!quote || quote.customerUserId !== customerUserId || quote.source === 'sample')
        throw new DomainException('http.not_found');
      const stored = quote.input as { configuration?: unknown; dimensions?: unknown };
      productTypeId = quote.productTypeId;
      configuration = stored.configuration ?? {};
      dimensions = stored.dimensions ?? null;
      postcode ??= quote.deliveryPostcode;
      sourceQuoteId = quote.id;
    } else {
      const draft = await this.prisma.configurationDraft.findUnique({ where: { publicId: input.draftId } });
      if (!draft || draft.ownerUserId !== customerUserId) throw new DomainException('http.not_found');
      productTypeId = draft.productTypeId;
      configuration = draft.configuration;
      sourceDraftId = draft.id;
    }
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      const sample = await tx.sample.create({
        data: {
          entityId,
          kind: 'standalone',
          status: 'requested',
          customerUserId,
          productTypeId,
          sourceQuoteId,
          sourceDraftId,
          configuration: configuration as Prisma.InputJsonValue,
          dimensions: dimensions ?? Prisma.DbNull,
          mockupOption: input.mockupOption,
          quantity: input.quantity ?? 1,
          deliveryPostcode: postcode,
          customerNote: input.note?.trim() || null,
          createdById: customerUserId,
        },
      });
      await this.record(tx, sample, 'sample.requested', { kind: 'standalone' });
      return this.getForStaff(sample.publicId, tx);
    });
  }

  /**
   * CS quotes a requested standalone sample (D-254): price from the CS amount through the service sell table, freight
   * from the customer rate card for the parcel weight (D-195), lead time, made by `factoryId` (default: the factory of
   * the customer's quotation). The result is a sample quotation (source `sample`, one option) valid
   * `quotes.validity_days` that the customer puts in the cart like any quotation.
   */
  async quoteStandalone(
    actor: UserActor,
    publicId: string,
    input: PriceInput & {
      leadTimeDays: number;
      parcelWeightG: number;
      factoryId?: string;
      deliveryPostcode?: string;
    },
  ): Promise<SampleRow> {
    const now = new Date();
    const sample = await this.getForStaff(publicId);
    if (sample.kind !== 'standalone' || sample.status !== 'requested')
      throw new DomainException('samples.invalid_status', {
        params: { status: sample.status, action: 'quote' },
      });
    const postcode = input.deliveryPostcode ?? sample.deliveryPostcode;
    if (!postcode)
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'deliveryPostcode', code: 'required', message: 'the sample has no delivery postcode' },
        ],
      });
    const factoryId = await this.factoryFor(sample, input.factoryId);
    const price = await this.price(input, sample.quantity);
    const freight = await this.rates.customerRate(
      postcode,
      { weightG: input.parcelWeightG, volumeCm3: null },
      now,
    );
    if (!freight.priced) throw new DomainException('samples.freight_unavailable');
    const vatPct = D(price.vatPct);
    const shipNet = D(freight.net.toString()).toDecimalPlaces(2);
    const shipVat = shipNet.mul(vatPct).div(100).toDecimalPlaces(2);
    const productNet = D(price.sellNet);
    const productVat = D(price.sellVat);
    const net = productNet.add(shipNet);
    const vat = productVat.add(shipVat);
    const gross = net.add(vat);
    const unitPrice = productNet.add(productVat).div(sample.quantity);
    const validity = await this.settings.at('quotes.validity_days', { at: now });
    const validUntil = new Date(now.getTime() + Number(validity.value) * DAY_MS);
    const source = sample.sourceQuoteId
      ? await this.prisma.quote.findUnique({
          where: { id: sample.sourceQuoteId },
          select: { catalogProductId: true, specSummary: true, input: true },
        })
      : null;
    const type = await this.prisma.productType.findUniqueOrThrow({ where: { id: sample.productTypeId } });
    const quoteInput = {
      productTypeCode: type.code,
      configuration: sample.configuration,
      deliveryPostcode: postcode,
      ...(sample.dimensions ? { dimensions: sample.dimensions } : {}),
      sample: { mockupOption: sample.mockupOption, quantity: sample.quantity },
    };
    const configRefs = {
      calculatorVersion: 'manual',
      settingVersionIds: { 'quotes.validity_days': String(validity.versionId) },
      shippingRateCardVersionIds: { customer: String(freight.versionId), factoryPayouts: {} },
    };
    const option = {
      quantity: sample.quantity,
      unit: 'set' as const,
      result: {
        quantity: sample.quantity,
        unitPrice: unitPrice.toFixed(6),
        productAmount: formatMoney(productNet.add(productVat)),
        designFeeAmount: '0.00',
        structureDesignFeeAmount: '0.00',
        toolingAmount: null,
        shippingAmount: formatMoney(shipNet.add(shipVat)),
        shippingNetAmount: formatMoney(shipNet),
        shippingVatAmount: formatMoney(shipVat),
        vatAmount: formatMoney(vat),
        grossAmount: formatMoney(gross),
        leadTimeDays: input.leadTimeDays,
        earliestShipDate: null,
        earliestDeliveryDate: null,
        toleranceShortagePct: null,
        toleranceOveragePct: null,
        toleranceDimensionalMm: null,
        toleranceColourDeltaE: null,
        shippingPending: false,
        shippingPendingReason: null,
      },
      netAmount: formatMoney(net),
      discountAmount: '0.00',
      vatAmount: formatMoney(vat),
      grossAmount: formatMoney(gross),
      shippingAmount: formatMoney(shipNet.add(shipVat)),
      unitPrice: unitPrice.toFixed(6),
      leadTimeDays: input.leadTimeDays,
      selectedFactoryId: factoryId,
      buyCostNet: price.buyNet,
      marginPct: productNet.gt(0) ? productNet.sub(price.buyNet).div(productNet).mul(100).toFixed(4) : null,
    };
    const snapshotSha256 = createHash('sha256')
      .update(JSON.stringify(canonical({ input: quoteInput, configRefs, option })))
      .digest();
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          entityId: sample.entityId,
          channel: 'web',
          source: 'sample',
          customerUserId: sample.customerUserId,
          createdById: actor.userId,
          productTypeId: sample.productTypeId,
          catalogProductId: source?.catalogProductId ?? null,
          input: quoteInput,
          inputSchemaVersion: sample.dimensions ? 2 : 1,
          specSummary: (source?.specSummary ?? Prisma.DbNull) as Prisma.InputJsonValue,
          calculatorVersion: 'manual',
          configRefs,
          status: 'saved',
          validUntil,
          deliveryPostcode: postcode,
          snapshotSha256,
          options: { create: option },
        },
      });
      // Quoted once: a concurrent quote of the same request loses (and its quotation rolls back).
      const { count } = await tx.sample.updateMany({
        where: { id: sample.id, status: 'requested' },
        data: {
          status: 'quoted',
          statusChangedAt: now,
          quoteId: quote.id,
          deliveryPostcode: postcode,
          sellNetAmount: price.sellNet,
          sellGrossAmount: formatMoney(productNet.add(productVat)),
          buyNetAmount: price.buyNet,
          parcelWeightG: input.parcelWeightG,
          leadTimeDays: input.leadTimeDays,
          validUntil,
          quotedAt: now,
          quotedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (count !== 1)
        throw new DomainException('samples.invalid_status', {
          params: { status: 'changed', action: 'quote' },
        });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sample.priced',
        actor,
        resourceType: 'sample',
        resourcePublicId: sample.publicId,
        data: {
          kind: 'standalone',
          basis: input.basis,
          amount: String(input.amount),
          sellNetAmount: price.sellNet,
          buyNetAmount: price.buyNet,
          freightNetAmount: formatMoney(shipNet),
        },
      });
      await this.record(tx, sample, 'sample.quoted', { kind: 'standalone', quoteId: quote.publicId }, actor);
      return this.getForStaff(sample.publicId, tx);
    });
  }

  // --- evidence and decision (D-255) -------------------------------------------------------------------

  /** The factory (Owner, Planner, QC) or staff record what was made, before it ships; once. */
  async recordEvidence(
    actor: UserActor,
    sample: SampleRow,
    input: {
      lengthMm: number;
      widthMm: number;
      depthMm?: number;
      basis: MeasurementBasis;
      materialUsed: string;
      photoFileIds: string[];
    },
  ): Promise<SampleRow> {
    return this.prisma.withTx(async (tx) => {
      const current = await this.lock(tx, sample.id);
      if (!['paid', 'in_production'].includes(current.status) || !current.productionJobId)
        throw new DomainException('samples.invalid_status', {
          params: { status: current.status, action: 'record_evidence' },
        });
      if (current.evidenceRecordedAt) throw new DomainException('samples.evidence_recorded');
      const files = await tx.fileObject.findMany({ where: { publicId: { in: input.photoFileIds } } });
      if (
        files.length !== new Set(input.photoFileIds).size ||
        files.some(
          (f) =>
            f.ownerUserId !== actor.userId || f.uploadStatus !== 'uploaded' || f.scanStatus === 'infected',
        )
      )
        throw new DomainException('artwork.file_not_usable', {
          params: { fileId: input.photoFileIds.join(', ') },
        });
      for (const [i, id] of input.photoFileIds.entries())
        await tx.attachment.create({
          data: {
            subjectType: 'sample',
            subjectId: current.id,
            fileObjectId: files.find((f) => f.publicId === id)!.id,
            role: 'sample.evidence_photo',
            sort: i,
            customerShareable: true,
            createdById: actor.userId,
          },
        });
      const at = new Date();
      await tx.sample.update({
        where: { id: current.id },
        data: {
          measuredLengthMm: String(input.lengthMm),
          measuredWidthMm: String(input.widthMm),
          measuredDepthMm: input.depthMm === undefined ? null : String(input.depthMm),
          measuredBasis: input.basis,
          materialUsed: input.materialUsed.trim(),
          evidenceRecordedAt: at,
          evidenceRecordedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        current,
        'sample.evidence_recorded',
        { photos: input.photoFileIds.length },
        actor,
      );
      return this.getForStaff(current.publicId, tx);
    });
  }

  /**
   * D-255: after delivery the customer approves, asks for changes or rejects; the decision keeps who, when, IP, user
   * agent and the sha256 of every evidence photo. Approval locks the specification and the approved proof.
   */
  async decide(
    actor: UserActor,
    publicId: string,
    decision: 'approved' | 'changes_requested' | 'rejected',
    note?: string,
  ): Promise<SampleRow> {
    if (decision !== 'approved' && !note?.trim())
      throw new DomainException('validation.failed', {
        errors: [{ path: 'note', code: 'required', message: 'say what should change or why it is rejected' }],
      });
    return this.prisma.withTx(async (tx) => {
      const found = await tx.sample.findUnique({ where: { publicId } });
      if (!found || found.customerUserId !== actor.userId) throw new DomainException('http.not_found');
      const sample = await this.lock(tx, found.id);
      if (sample.status !== 'delivered')
        throw new DomainException('samples.invalid_status', {
          params: { status: sample.status, action: decision },
        });
      const photos = (await this.photos([sample.id], tx)).get(sample.id) ?? [];
      const context = RequestContext.current();
      const at = new Date();
      const proof =
        decision === 'approved' && sample.orderId
          ? await tx.proof.findFirst({
              where: { orderId: sample.orderId, status: 'approved' },
              orderBy: { decidedAt: 'desc' },
              select: { id: true },
            })
          : null;
      await tx.sample.update({
        where: { id: sample.id },
        data: {
          status: decision,
          statusChangedAt: at,
          decidedAt: at,
          decidedByUserId: actor.userId,
          decisionIp: context?.ip ?? null,
          decisionUserAgent: context?.userAgent ?? null,
          decisionNote: note?.trim() || null,
          evidencePhotoSha256: photos.map((p) => p.sha256).filter((s): s is string => s !== null),
          ...(decision === 'approved' && {
            approvedSpec: {
              configuration: sample.configuration,
              dimensions: sample.dimensions,
              mockupOption: sample.mockupOption,
              measured: {
                lengthMm: sample.measuredLengthMm?.toFixed(2) ?? null,
                widthMm: sample.measuredWidthMm?.toFixed(2) ?? null,
                depthMm: sample.measuredDepthMm?.toFixed(2) ?? null,
                basis: sample.measuredBasis,
                materialUsed: sample.materialUsed,
              },
            },
            approvedProofId: proof?.id ?? null,
          }),
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, sample, `sample.${decision}`, { photos: photos.length }, actor);
      return this.getForStaff(sample.publicId, tx);
    });
  }

  /**
   * D-257: an approved standalone sample becomes a bulk order — its locked specification saved as a quotation at today's
   * prices (the quantity is the customer's) and put in the cart with the sample's approved proof (as a reorder,
   * D-153). Checkout credits the sample on it within the window (`samples` extension).
   */
  async orderBulk(
    actor: UserActor,
    publicId: string,
    input: { quantity: number; deliveryPostcode?: string },
  ): Promise<{ cart: CartRow; quoteId: string; creditAvailable: boolean }> {
    const sample = await this.getForCustomer(actor.userId, publicId);
    if (sample.kind !== 'standalone' || sample.status !== 'approved' || !sample.approvedSpec)
      throw new DomainException('samples.invalid_status', {
        params: { status: sample.status, action: 'order_bulk' },
      });
    const spec = sample.approvedSpec as { configuration: Record<string, unknown> };
    const quote = await this.quotes.save(
      { kind: 'customer', userId: actor.userId },
      'web',
      {
        productTypeCode: sample.productType.code,
        configuration: { ...spec.configuration, quantities: [input.quantity] },
        deliveryPostcode: input.deliveryPostcode ?? sample.deliveryPostcode ?? undefined,
      },
      { customerUserId: actor.userId },
    );
    const creditAvailable = !sample.creditOrderId;
    if (creditAvailable)
      await this.prisma.withTx(async (tx) => {
        await tx.sample.update({
          where: { id: sample.id },
          data: { bulkQuoteId: quote.id, rowVersion: { increment: 1 } },
        });
        await this.record(tx, sample, 'sample.bulk_quoted', { quoteId: quote.publicId }, actor);
      });
    const cart = await this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId: quote.publicId,
        quoteOptionId: quote.options[0]!.publicId,
        designOption: 'own_file',
      },
      sample.orderId
        ? {
            orderId: sample.orderId,
            reuseArtworkProofId: sample.approvedProof
              ? await this.proofId(sample.approvedProof.publicId)
              : null,
          }
        : undefined,
    );
    return { cart, quoteId: quote.publicId, creditAvailable };
  }

  private async proofId(publicId: string): Promise<bigint> {
    return (await this.prisma.proof.findUniqueOrThrow({ where: { publicId }, select: { id: true } })).id;
  }

  /** CS cancels a live sample with a reason (audited); an attached sample's hold on bulk production lifts (D-256). */
  async cancel(actor: UserActor, publicId: string, reason: string): Promise<SampleRow> {
    return this.prisma.withTx(async (tx) => {
      const found = await this.getForStaff(publicId, tx);
      const sample = await this.lock(tx, found.id);
      if (
        !['requested', 'quoted', 'paid', 'in_production', 'shipped', 'delivered', 'rejected'].includes(
          sample.status,
        )
      )
        throw new DomainException('samples.invalid_status', {
          params: { status: sample.status, action: 'cancel' },
        });
      const at = new Date();
      await tx.sample.update({
        where: { id: sample.id },
        data: {
          status: 'cancelled',
          statusChangedAt: at,
          cancelledAt: at,
          cancelReason: reason.trim(),
          cancelledById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sample.cancelled',
        actor,
        resourceType: 'sample',
        resourcePublicId: sample.publicId,
        data: { from: sample.status, reason },
      });
      await this.record(tx, sample, 'sample.cancelled', { from: sample.status }, actor);
      return this.getForStaff(sample.publicId, tx);
    });
  }

  // --- status from production, payment and shipping ------------------------------------------------------

  /** An attached sample's charge was paid (its mockup instalment). */
  @OnDomainEvent('instalment.paid', { consumer: 'samples.paid' })
  async onInstalmentPaid(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fixedAmount'] !== true || typeof event.payload['instalmentId'] !== 'string') return;
    const instalment = await tx.instalment.findUnique({
      where: { publicId: event.payload['instalmentId'] },
      select: { orderLineId: true },
    });
    if (!instalment?.orderLineId) return;
    const sample = await tx.sample.findUnique({ where: { orderLineId: instalment.orderLineId } });
    if (sample) await this.advance(tx, sample, 'paid', { paidAt: new Date(event.occurredAt) });
  }

  /** A standalone sample order is paid when its gate instalments are (D-020). */
  @OnDomainEvent('order.fact_recorded', { consumer: 'samples.order-facts' })
  async onOrderFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'paid_for_production') return;
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      select: { id: true, kind: true },
    });
    if (order?.kind !== 'sample') return;
    const sample = await tx.sample.findFirst({ where: { orderId: order.id, kind: 'standalone' } });
    if (sample) await this.advance(tx, sample, 'paid', { paidAt: new Date(event.occurredAt) });
  }

  /** The sample's mockup job was released to the factory. */
  @OnDomainEvent('production_job.released', { consumer: 'samples.released' })
  async onJobReleased(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const job = await tx.productionJob.findUnique({
      where: { publicId: event.aggregateId },
      select: { id: true, jobKind: true, orderLineId: true, orderId: true, releasedAt: true },
    });
    if (job?.jobKind !== 'mockup') return;
    const sample =
      (job.orderLineId ? await tx.sample.findUnique({ where: { orderLineId: job.orderLineId } }) : null) ??
      (await tx.sample.findFirst({ where: { orderId: job.orderId, kind: 'standalone' } }));
    if (!sample || sample.productionJobId) return;
    await tx.sample.update({ where: { id: sample.id }, data: { productionJobId: job.id } });
    await this.advance(tx, sample, 'in_production', {
      inProductionAt: job.releasedAt,
      ...(sample.paidAt ? {} : { paidAt: job.releasedAt }),
    });
  }

  /** A shipment carrying a sample's job was picked up / delivered (D-258). */
  @OnDomainEvent(['shipment.picked_up', 'shipment.delivered'], { consumer: 'samples.shipments' })
  async onShipment(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const shipment = await tx.shipment.findUnique({
      where: { publicId: event.aggregateId },
      select: { items: { select: { productionJobId: true } }, pickedUpAt: true, deliveredAt: true },
    });
    if (!shipment) return;
    const samples = await tx.sample.findMany({
      where: { productionJobId: { in: shipment.items.map((i) => i.productionJobId) } },
    });
    for (const sample of samples) {
      if (event.type === 'shipment.picked_up')
        await this.advance(tx, sample, 'shipped', {
          shippedAt: shipment.pickedUpAt ?? new Date(event.occurredAt),
        });
      else
        await this.advance(tx, sample, 'delivered', {
          deliveredAt: shipment.deliveredAt ?? new Date(event.occurredAt),
        });
    }
  }

  /** A standalone sample quotation not bought within its validity expires with it. */
  @OnDomainEvent('quote.expired', { consumer: 'samples.quote-expired' })
  async onQuoteExpired(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({
      where: { publicId: String(event.payload['quoteId']) },
      select: { sample: true },
    });
    const sample = quote?.sample;
    if (sample?.status === 'quoted' && !sample.orderId) await this.advance(tx, sample, 'expired', {});
  }

  /**
   * D-257: cancelling the bulk order that used a sample's credit releases the credit while the window is open; a
   * cancelled sample order cancels its sample.
   */
  @OnDomainEvent('order.cancelled', { consumer: 'samples.order-cancelled' })
  async onOrderCancelled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      select: { id: true, kind: true, cancelledAt: true },
    });
    if (!order) return;
    const at = order.cancelledAt ?? new Date(event.occurredAt);
    const window = (await this.settings.at('samples.credit_window_days', { at, tx })).value;
    for (const sample of await tx.sample.findMany({ where: { creditOrderId: order.id } })) {
      if (!sample.decidedAt || at.getTime() > sample.decidedAt.getTime() + window * DAY_MS) continue;
      await tx.sample.update({
        where: { id: sample.id },
        data: { creditOrderId: null, creditAmount: null, rowVersion: { increment: 1 } },
      });
      await this.record(tx, sample, 'sample.credit_released', {});
    }
    if (order.kind === 'sample') {
      const sample = await tx.sample.findFirst({ where: { orderId: order.id, kind: 'standalone' } });
      if (sample && LIVE_SAMPLE_STATUSES.includes(sample.status)) {
        await tx.sample.update({
          where: { id: sample.id },
          data: {
            status: 'cancelled',
            statusChangedAt: at,
            cancelledAt: at,
            cancelReason: 'sample order cancelled',
            rowVersion: { increment: 1 },
          },
        });
        await this.record(tx, sample, 'sample.cancelled', { from: sample.status });
      }
    }
  }

  // --- helpers -----------------------------------------------------------------------------------------

  private static readonly ORDER: SampleStatus[] = [
    'requested',
    'quoted',
    'paid',
    'in_production',
    'shipped',
    'delivered',
  ];

  /** Moves a live sample forward only (idempotent for redelivered events; final statuses never move). */
  private async advance(tx: Tx, sample: Sample, to: SampleStatus, data: Prisma.SampleUncheckedUpdateInput) {
    const order = SamplesService.ORDER;
    const from = order.indexOf(sample.status);
    if (from < 0) return;
    if (to !== 'expired' && order.indexOf(to) <= from) {
      // Fill a missing timestamp without moving back (e.g. paid after release).
      if (Object.keys(data).length) await tx.sample.update({ where: { id: sample.id }, data });
      return;
    }
    await tx.sample.update({
      where: { id: sample.id },
      data: { ...data, status: to, statusChangedAt: new Date(), rowVersion: { increment: 1 } },
    });
    await this.record(tx, sample, `sample.${to}`, {});
  }

  private async lock(tx: Tx, id: bigint): Promise<Sample> {
    await tx.$queryRaw`SELECT id FROM samples WHERE id = ${id} FOR UPDATE`;
    return tx.sample.findUniqueOrThrow({ where: { id } });
  }

  /** D-254: the CS amount through the service sell table → sell (net, VAT) and the factory's buy amount. */
  private async price(input: PriceInput, quantity: number) {
    const priced = await this.pricing.price(
      { catalogProductId: input.serviceItemId, basis: input.basis, amount: input.amount, quantity },
      { cost: true, margin: true },
    );
    return {
      sellNet: priced.total.netAmount,
      sellVat: priced.total.vatAmount,
      buyNet: priced.total.costAmount ?? '0.00',
      vatPct: priced.vatPct,
    };
  }

  private async factoryFor(sample: SampleRow, factoryPublicId?: string): Promise<bigint> {
    if (factoryPublicId) {
      const factory = await this.prisma.factory.findUnique({ where: { publicId: factoryPublicId } });
      if (!factory) throw new DomainException('http.not_found');
      return factory.id;
    }
    const option = sample.sourceQuoteId
      ? await this.prisma.quoteOption.findFirst({
          where: { quoteId: sample.sourceQuoteId, selectedFactoryId: { not: null } },
          orderBy: { quantity: 'asc' },
          select: { selectedFactoryId: true },
        })
      : null;
    if (!option?.selectedFactoryId)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'factoryId', code: 'required', message: 'name the factory that makes the sample' }],
      });
    return option.selectedFactoryId;
  }

  async record(
    tx: Tx,
    sample: { id: bigint; publicId: string; orderId: bigint | null; customerUserId: bigint; kind: string },
    type: string,
    data: Record<string, unknown>,
    actor?: Actor,
  ): Promise<void> {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'sample',
        aggregateId: sample.publicId,
        payload: { sampleId: sample.publicId, kind: sample.kind, ...data },
      },
      actor,
    );
    const order = sample.orderId
      ? await tx.order.findUnique({ where: { id: sample.orderId }, select: { publicId: true } })
      : null;
    await this.activity.record(tx, {
      aggregateType: order ? 'order' : 'sample',
      aggregatePublicId: order?.publicId ?? sample.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: { sampleId: sample.publicId },
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      ...(actor ? { actor } : {}),
    });
  }
}
