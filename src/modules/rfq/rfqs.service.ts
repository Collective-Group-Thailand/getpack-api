import { type Actor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { MoneyDecimal } from '@common/money/money';
import { refuseUnits } from '@common/validation/units';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type MeasurementBasis } from '@generated/prisma/client';
import { Prisma, type RfqStatus, type SalesChannel } from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ToleranceService } from '@modules/pricing/quotes/tolerance.service';
import { rfqSpecLines } from '@modules/quotes/line-summary';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { FilesService } from '@platform/files/files.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { MAX_RFQ_FILES, MAX_RFQ_TIERS, rfqDimensions, rfqFormFields } from './rfq-form';
import { specErrors } from './rfq-spec';
import { type StoreRfqFormDto } from './rfqs.dto';

export const rfqEtag = (r: { publicId: string; rowVersion: number }) => etagOf(r.publicId, r.rowVersion);

export const RFQ_INCLUDE = {
  productType: { select: { code: true, nameTh: true, nameEn: true } },
  styleVariant: {
    select: { code: true, options: true, base: { select: { code: true, nameTh: true, nameEn: true } } },
  },
  province: { select: { nameTh: true, nameEn: true } },
  designDocumentVersion: { select: { versionNo: true, designDocument: { select: { publicId: true } } } },
  customer: {
    select: {
      publicId: true,
      displayName: true,
      email: true,
      phone: true,
      customerProfile: { select: { customerCode: true } },
    },
  },
  assignedTo: { select: { publicId: true, displayName: true } },
  declineReason: { select: { code: true } },
  acceptedQuote: { select: { publicId: true } },
  tiers: { orderBy: { quantity: 'asc' } },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { publicId: true, displayName: true, kind: true } } },
  },
  consultations: {
    orderBy: { createdAt: 'asc' },
    include: {
      factory: { select: { publicId: true, code: true } },
      requestedBy: { select: { publicId: true, displayName: true } },
    },
  },
  quotes: {
    orderBy: { versionNo: 'desc' },
    include: {
      lines: { orderBy: { quantity: 'asc' }, include: { factory: { select: { publicId: true } } } },
    },
  },
} satisfies Prisma.RfqInclude;
export type RfqRow = Prisma.RfqGetPayload<{ include: typeof RFQ_INCLUDE }>;

export interface AttachedFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}
export interface RfqFiles {
  rfq: AttachedFile[];
  messages: Map<bigint, AttachedFile[]>;
}

export interface SubmitRfqInput {
  productTypeCode: string;
  spec: Record<string, unknown>;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  measurementBasis?: MeasurementBasis;
  quantities: number[];
  targetDate?: string | null;
  deliveryPostcode: string;
  notes?: string;
  fileIds?: string[];
  specSchemaVersion?: number;
  routedFrom?: { calculationId: string };
  /** D-247: the customer's target per unit (THB incl. VAT, excl. shipping); staff only, never to a partner (D-190). */
  targetPricePerUnit?: string | null;
  /** D-269: a published style variant of the product type. */
  styleVariantCode?: string | null;
}

/** A checked submission (`RfqsService.prepare`), written by `RfqsService.create`. */
export interface RfqPlan {
  customerUserId: bigint;
  channel: SalesChannel;
  input: SubmitRfqInput;
  createdBy: UserActor | undefined;
  type: { id: bigint; code: string; rfqSpecSchemaVersion: number };
  routedFrom: bigint | null;
  styleVariantId: bigint | null;
  files: bigint[];
  provinceId: bigint | null;
  now: Date;
  slaDueAt: Date | null;
  entityId: bigint;
}

export interface RfqQuoteLineInput {
  quantity: number;
  unitPrice: string;
  shippingNetAmount?: string | null;
  leadTimeDays: number;
  factoryId?: string | null;
  buyUnitPrice?: string | null;
}

const OPEN: RfqStatus[] = ['submitted', 'in_review', 'need_info', 'quoted'];
const DAY_MS = 86_400_000;

/**
 * Requests for quote (D-100, D-043): every type that is not instant, and the fallback when no instant
 * price path covers a configuration. Statuses `submitted → in_review → need_info → quoted → accepted |
 * declined | expired`; first-response SLA per category (setting, unset until the business gives it);
 * CS consults factories for buy prices (the factory never sees the sell price, D-044), sends versioned
 * quotations valid for `quotes.validity_days` (D-051), and the accepted one becomes a `quotes` row
 * (`source = rfq`, manual snapshot) that flows through the same order pipeline. Declined and expired
 * RFQs are unmet demand (D-102).
 */
@Injectable()
export class RfqsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly settings: SettingsService,
    private readonly calendars: BusinessCalendarService,
    private readonly entities: EntitiesService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly files: FilesService,
    private readonly access: FactoryAccess,
    private readonly quotes: SavedQuotesService,
    private readonly tolerances: ToleranceService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Spec files of an RFQ: its customer, and staff who work RFQs (D-100).
    this.files.registerAttachmentPolicy('rfq', async (actor, rfqId) => {
      if (actor.type !== 'user') return false;
      if (actor.audience === 'staff') return true;
      const rfq = await this.prisma.rfq.findUnique({
        where: { id: rfqId },
        select: { customerUserId: true },
      });
      return rfq?.customerUserId === actor.userId;
    });
    // Message files: staff, and the RFQ's customer for messages they can see.
    this.files.registerAttachmentPolicy('rfq_message', async (actor, messageId) => {
      if (actor.type !== 'user') return false;
      if (actor.audience === 'staff') return true;
      const message = await this.prisma.rfqMessage.findUnique({
        where: { id: messageId },
        select: { visibility: true, rfq: { select: { customerUserId: true } } },
      });
      return message?.visibility === 'customer' && message.rfq.customerUserId === actor.userId;
    });
  }

  // --- customer ------------------------------------------------------------------------------------

  async submit(
    customerUserId: bigint,
    channel: SalesChannel,
    input: SubmitRfqInput,
    createdBy?: UserActor,
    /** D-251: a quotation sent to CS — linked, and closed in the same transaction. */
    hooks: {
      routedFromQuoteId?: bigint;
      inTx?: (tx: Tx, rfq: { id: bigint; publicId: string }) => Promise<void>;
    } = {},
  ): Promise<RfqRow> {
    const plan = await this.prepare(customerUserId, channel, input, createdBy);
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.create(tx, plan, { routedFromQuoteId: hooks.routedFromQuoteId ?? null });
      if (hooks.inTx) await hooks.inTx(tx, rfq);
      return this.load(tx, rfq.id);
    });
  }

  /** Every check of a submission, outside any transaction (D-301: a basket checks all its items first). */
  async prepare(
    customerUserId: bigint,
    channel: SalesChannel,
    input: SubmitRfqInput,
    createdBy?: UserActor,
  ): Promise<RfqPlan> {
    // D-183: sizes are millimetres; a spec naming a unit is refused, never read in it.
    refuseUnits(input.spec, 'spec');
    const type = await this.prisma.productType.findFirst({
      where: { code: input.productTypeCode, status: 'active' },
    });
    if (!type) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'productTypeCode', code: 'exists', message: 'unknown product type' }],
      });
    }
    const errors = [
      ...specErrors(type.rfqSpecSchema, input.spec),
      ...(new Set(input.quantities).size !== input.quantities.length
        ? [{ path: 'quantities', code: 'unique', message: 'quantities must be different' }]
        : []),
    ];
    if (errors.length > 0) throw new DomainException('validation.failed', { errors });
    if (input.specSchemaVersion !== undefined && input.specSchemaVersion !== type.rfqSpecSchemaVersion) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'specSchemaVersion',
            code: 'outdated',
            message: 'the form of this product type changed; load it again (store.rfqs.getForm)',
          },
        ],
      });
    }
    const routedFrom = await this.routedFrom(customerUserId, type.id, input.routedFrom?.calculationId);
    // D-269: the style travels with the request — a published variant of this product type only.
    const styleVariant = input.styleVariantCode
      ? await this.prisma.styleVariant.findUnique({
          where: { code: input.styleVariantCode },
          select: { id: true, publishable: true, status: true, base: { select: { productTypeId: true } } },
        })
      : null;
    if (
      input.styleVariantCode &&
      (!styleVariant ||
        !styleVariant.publishable ||
        styleVariant.status !== 'active' ||
        styleVariant.base.productTypeId !== type.id)
    )
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'styleVariantCode',
            code: 'exists',
            message: 'not a published style variant of this product type',
          },
        ],
      });
    const files = await this.ownFiles(customerUserId, createdBy, input.fileIds ?? []);
    const province = await this.prisma.geoSubdistrict.findFirst({
      where: { postcode: input.deliveryPostcode },
      select: { district: { select: { provinceId: true } } },
    });
    const now = new Date();
    const slaDueAt = await this.slaDueAt(type.id, now);
    const entityId = await this.entities.defaultEntityId();
    return {
      customerUserId,
      channel,
      input,
      createdBy,
      type,
      routedFrom,
      styleVariantId: styleVariant?.id ?? null,
      files,
      provinceId: province?.district.provinceId ?? null,
      now,
      slaDueAt,
      entityId,
    };
  }

  /** Writes a prepared submission in the caller's transaction. */
  async create(
    tx: Tx,
    plan: RfqPlan,
    extra: {
      routedFromQuoteId?: bigint | null;
      basketId?: bigint | null;
      designDocumentVersionId?: bigint | null;
    } = {},
  ): Promise<{ id: bigint; publicId: string; rfqCode: string }> {
    const { customerUserId, channel, input, createdBy, type, routedFrom, files, now, slaDueAt, entityId } =
      plan;
    const rfq = await tx.rfq.create({
      data: {
        rfqCode: await this.numbering.next(tx, 'rfq', now),
        entityId,
        channel,
        customerUserId,
        createdById: createdBy?.userId ?? null,
        productTypeId: type.id,
        spec: input.spec as Prisma.InputJsonValue,
        specSchemaVersion: type.rfqSpecSchemaVersion,
        routedFromCalculateLogId: routedFrom,
        routedFromQuoteId: extra.routedFromQuoteId ?? null,
        styleVariantId: plan.styleVariantId,
        basketId: extra.basketId ?? null,
        designDocumentVersionId: extra.designDocumentVersionId ?? null,
        targetPricePerUnit: input.targetPricePerUnit ?? null,
        lengthMm: input.lengthMm ?? null,
        widthMm: input.widthMm ?? null,
        heightMm: input.heightMm ?? null,
        measurementBasis: input.measurementBasis ?? 'internal',
        targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null,
        deliveryPostcode: input.deliveryPostcode,
        provinceId: plan.provinceId,
        notes: input.notes ?? '',
        slaDueAt,
        submittedAt: now,
        tiers: { create: [...input.quantities].sort((a, b) => a - b).map((quantity) => ({ quantity })) },
      },
    });
    for (const [index, fileId] of files.entries()) {
      await tx.attachment.create({
        data: {
          fileObjectId: fileId,
          subjectType: 'rfq',
          subjectId: rfq.id,
          role: 'rfq.spec_file',
          sort: index,
          createdById: createdBy?.userId ?? customerUserId,
        },
      });
    }
    await this.record(tx, rfq.publicId, 'rfq.submitted', {
      rfqCode: rfq.rfqCode,
      productTypeCode: type.code,
      quantities: input.quantities.length,
      slaDueAt: slaDueAt?.toISOString() ?? null,
    });
    return rfq;
  }

  async forCustomer(customerUserId: bigint, publicId: string, db: Tx = this.prisma): Promise<RfqRow> {
    const rfq = await db.rfq.findUnique({ where: { publicId }, include: RFQ_INCLUDE });
    if (!rfq || rfq.customerUserId !== customerUserId) throw new DomainException('http.not_found');
    return rfq;
  }

  async list(where: Prisma.RfqWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.rfq.findMany({
        where,
        include: RFQ_INCLUDE,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.rfq.count({ where }),
    ]);
    return { rows, total };
  }

  /** The customer answers; a request waiting for information goes back to review. */
  async customerMessage(
    customerUserId: bigint,
    publicId: string,
    body: string,
    fileIds: string[] = [],
  ): Promise<RfqRow> {
    const files = await this.ownFiles(customerUserId, undefined, fileIds);
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.forCustomer(customerUserId, publicId, tx);
      if (!OPEN.includes(rfq.status)) throw new DomainException('rfq.closed');
      const message = await tx.rfqMessage.create({
        data: { rfqId: rfq.id, authorUserId: customerUserId, visibility: 'customer', body },
      });
      for (const [index, fileId] of files.entries()) {
        await tx.attachment.create({
          data: {
            fileObjectId: fileId,
            subjectType: 'rfq_message',
            subjectId: message.id,
            role: 'rfq.message_file',
            sort: index,
            createdById: customerUserId,
          },
        });
      }
      if (rfq.status === 'need_info') await this.transition(tx, rfq.id, rfq.status, 'in_review');
      await this.record(tx, rfq.publicId, 'rfq.customer_replied', {
        status: rfq.status === 'need_info' ? 'in_review' : rfq.status,
      });
      return this.load(tx, rfq.id);
    });
  }

  /**
   * The customer accepts a sent, valid quotation (one quantity or all): it becomes a `quotes` row with a
   * manual snapshot (`source = rfq`), price-locked until the quotation's validity, for the cart (B3.1).
   */
  async accept(
    customerUserId: bigint,
    publicId: string,
    rfqQuotePublicId: string,
    quantities?: number[],
    recordedBy?: { actor: UserActor; via: string; note: string | null },
  ): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.forCustomer(customerUserId, publicId, tx);
      const quote = rfq.quotes.find((q) => q.publicId === rfqQuotePublicId);
      if (!quote) throw new DomainException('http.not_found');
      if (
        rfq.status !== 'quoted' ||
        quote.status !== 'sent' ||
        !quote.validUntil ||
        quote.validUntil <= new Date()
      ) {
        throw new DomainException('rfq.quote_not_open');
      }
      const lines = quantities?.length
        ? quote.lines.filter((l) => quantities.includes(l.quantity))
        : quote.lines;
      if (lines.length === 0) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'quantities', code: 'invalid', message: 'no quoted quantity matches' }],
        });
      }
      const vat = await this.vatRate(tx, new Date());
      const input = {
        productTypeCode: rfq.productType.code,
        rfqId: rfq.publicId,
        rfqCode: rfq.rfqCode,
        spec: rfq.spec,
        // D-182: the size and its basis travel with the quote to the order and the job (RFQ orders had none).
        size: {
          basis: rfq.measurementBasis,
          lengthMm: rfq.lengthMm === null ? null : Number(rfq.lengthMm),
          widthMm: rfq.widthMm === null ? null : Number(rfq.widthMm),
          heightMm: rfq.heightMm === null ? null : Number(rfq.heightMm),
        },
      };
      const configRefs = {
        rfqQuoteId: quote.publicId,
        rfqQuoteVersion: quote.versionNo,
        vatRateVersionId: vat.versionId.toString(),
      };
      const type = await tx.productType.findUniqueOrThrow({
        where: { id: rfq.productTypeId },
        select: { rfqSpecSchema: true, calculatorKey: true },
      });
      // D-187 (F2): the accepted quote freezes the line factory's tolerance, or the platform default — never 0 %.
      const now = new Date();
      const tolerances = await Promise.all(
        lines.map((l) =>
          this.tolerances.resolve(
            { factoryId: l.factoryId, productTypeId: rfq.productTypeId, calculatorKey: type.calculatorKey },
            now,
            tx,
          ),
        ),
      );
      const options = lines.map((l, i) => {
        const shippingVat = l.shippingNetAmount.mul(vat.ratePct).div(100).toDecimalPlaces(2);
        const tolerance = tolerances[i]!;
        return {
          quantity: l.quantity,
          unit: 'piece' as const,
          result: {
            quantity: l.quantity,
            unitPrice: l.unitPrice.toFixed(6),
            productAmount: l.netAmount.sub(l.shippingNetAmount).toFixed(2),
            designFeeAmount: '0.00',
            structureDesignFeeAmount: '0.00',
            shippingAmount: l.shippingNetAmount.add(shippingVat).toFixed(2),
            shippingNetAmount: l.shippingNetAmount.toFixed(2),
            leadTimeDays: l.leadTimeDays,
            earliestShipDate: null,
            earliestDeliveryDate: null,
            toleranceShortagePct: tolerance.shortage,
            toleranceOveragePct: tolerance.overage,
            toleranceDimensionalMm: tolerance.dimensionalMm,
            toleranceColourDeltaE: tolerance.colourDeltaE,
            shippingPending: false,
            shippingPendingReason: null,
          },
          netAmount: l.netAmount,
          discountAmount: '0.00',
          vatAmount: l.vatAmount,
          grossAmount: l.grossAmount,
          shippingAmount: l.shippingNetAmount.add(shippingVat),
          unitPrice: l.unitPrice,
          leadTimeDays: l.leadTimeDays,
          toleranceShortagePct: tolerance.shortage,
          toleranceOveragePct: tolerance.overage,
          toleranceDimensionalMm: tolerance.dimensionalMm,
          toleranceColourDeltaE: tolerance.colourDeltaE,
          selectedFactoryId: l.factoryId,
          buyCostNet: l.buyUnitPrice ? l.buyUnitPrice.mul(l.quantity).toDecimalPlaces(2) : null,
          marginPct: l.marginPct,
          belowMarginFloor: l.belowMarginFloor,
        };
      });
      const snapshotSha256 = sha256(JSON.stringify(canonical({ input, configRefs, options })));
      const specSummary = rfqSpecLines(type.rfqSpecSchema, (rfq.spec ?? {}) as Record<string, unknown>, {
        lengthMm: rfq.lengthMm === null ? null : Number(rfq.lengthMm),
        widthMm: rfq.widthMm === null ? null : Number(rfq.widthMm),
        heightMm: rfq.heightMm === null ? null : Number(rfq.heightMm),
      });
      const saved = await tx.quote.create({
        data: {
          entityId: rfq.entityId,
          channel: rfq.channel,
          source: 'rfq',
          rfqQuoteId: quote.id,
          customerUserId,
          productTypeId: rfq.productTypeId,
          input: input,
          inputSchemaVersion: 1,
          specSummary: specSummary as unknown as Prisma.InputJsonValue,
          calculatorVersion: 'manual',
          configRefs,
          status: 'saved',
          validUntil: quote.validUntil,
          deliveryPostcode: rfq.deliveryPostcode,
          snapshotSha256,
          options: { create: options },
          targetPricePerUnit: rfq.targetPricePerUnit, // D-247: the accepted quotation keeps the RFQ's target
        },
      });
      await tx.rfqQuote.update({ where: { id: quote.id }, data: { status: 'accepted' } });
      await tx.rfq.update({
        where: { id: rfq.id },
        data: {
          status: 'accepted',
          acceptedQuoteId: saved.id,
          closedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await this.quotes.record(tx, saved.publicId, 'quote.saved', {
        channel: rfq.channel,
        source: 'rfq',
        rfqId: rfq.publicId,
      });
      await this.record(tx, rfq.publicId, 'rfq.accepted', {
        quoteId: saved.publicId,
        quantities: lines.map((l) => l.quantity),
        ...(recordedBy && { recordedBy: recordedBy.actor.publicId, via: recordedBy.via }),
      });
      if (recordedBy)
        await this.audit.record(tx, {
          category: 'approval',
          action: 'rfq.acceptance_recorded',
          actor: recordedBy.actor,
          resourceType: 'rfq',
          resourcePublicId: rfq.publicId,
          data: { quoteId: saved.publicId, via: recordedBy.via, note: recordedBy.note },
        });
      return this.load(tx, rfq.id);
    });
  }

  async customerDecline(customerUserId: bigint, publicId: string, note?: string): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.forCustomer(customerUserId, publicId, tx);
      return this.close(tx, rfq, 'customer_declined', note ?? null);
    });
  }

  // --- staff ---------------------------------------------------------------------------------------

  async get(publicId: string, db: Tx = this.prisma): Promise<RfqRow> {
    const rfq = await db.rfq.findUnique({ where: { publicId }, include: RFQ_INCLUDE });
    if (!rfq) throw new DomainException('http.not_found');
    return rfq;
  }

  async assign(actor: UserActor, publicId: string, userPublicId: string | null): Promise<RfqRow> {
    if (userPublicId === null)
      return this.prisma.withTx(async (tx) => {
        const rfq = await this.openRfq(tx, publicId);
        await tx.rfq.update({
          where: { id: rfq.id },
          data: { assignedToUserId: null, rowVersion: { increment: 1 } },
        });
        await this.record(tx, rfq.publicId, 'rfq.unassigned', {}, ['internal']);
        return this.load(tx, rfq.id);
      });
    const user = await this.prisma.user.findFirst({
      where: { publicId: userPublicId, kind: 'staff', status: 'active' },
    });
    if (!user) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'userId', code: 'exists', message: 'not an active staff user' }],
      });
    }
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      await tx.rfq.update({
        where: { id: rfq.id },
        data: { assignedToUserId: user.id, rowVersion: { increment: 1 } },
      });
      if (rfq.status === 'submitted') await this.transition(tx, rfq.id, rfq.status, 'in_review');
      await this.record(tx, rfq.publicId, 'rfq.assigned', { assignedTo: user.publicId }, ['internal']);
      return this.load(tx, rfq.id);
    });
  }

  async staffMessage(
    actor: UserActor,
    publicId: string,
    body: string,
    visibility: 'customer' | 'internal',
    fileIds: string[] = [],
  ): Promise<RfqRow> {
    const files = await this.ownFiles(actor.userId, undefined, fileIds);
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      const message = await tx.rfqMessage.create({
        data: { rfqId: rfq.id, authorUserId: actor.userId, visibility, body },
      });
      for (const [index, fileId] of files.entries())
        await tx.attachment.create({
          data: {
            fileObjectId: fileId,
            subjectType: 'rfq_message',
            subjectId: message.id,
            role: 'rfq.message_file',
            sort: index,
            createdById: actor.userId,
            // An internal message's files stay with staff.
            customerShareable: visibility === 'customer',
          },
        });
      if (visibility === 'customer') await this.firstResponse(tx, rfq);
      await this.record(
        tx,
        rfq.publicId,
        'rfq.staff_message',
        { visibility },
        visibility === 'customer' ? undefined : ['internal'],
      );
      return this.load(tx, rfq.id);
    });
  }

  async requestInfo(actor: UserActor, publicId: string, body: string): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      if (rfq.status === 'quoted') throw new DomainException('rfq.invalid_transition');
      await tx.rfqMessage.create({
        data: { rfqId: rfq.id, authorUserId: actor.userId, visibility: 'customer', body },
      });
      await this.firstResponse(tx, rfq);
      await this.transition(tx, rfq.id, rfq.status, 'need_info');
      await this.record(tx, rfq.publicId, 'rfq.info_requested', {});
      return this.load(tx, rfq.id);
    });
  }

  /** Packio asks an active factory for its buy price per tier (D-044: spec and tiers only). */
  async requestConsultation(
    actor: UserActor,
    publicId: string,
    input: { factoryId: string; dueAt: string; note?: string },
  ): Promise<RfqRow> {
    const factory = await this.prisma.factory.findUnique({ where: { publicId: input.factoryId } });
    if (!factory || !['active', 'trial'].includes(factory.status)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'factoryId', code: 'exists', message: 'not an active factory' }],
      });
    }
    const dueAt = new Date(input.dueAt);
    if (dueAt <= new Date()) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'dueAt', code: 'min', message: 'dueAt must be in the future' }],
      });
    }
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      try {
        await tx.rfqFactoryConsultation.create({
          data: {
            rfqId: rfq.id,
            factoryId: factory.id,
            requestedById: actor.userId,
            dueAt,
            note: input.note ?? '',
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('rfq.consultation_open');
        }
        throw error;
      }
      if (rfq.status === 'submitted') await this.transition(tx, rfq.id, rfq.status, 'in_review');
      await this.record(
        tx,
        rfq.publicId,
        'rfq.consultation_requested',
        { factoryId: factory.publicId, dueAt: dueAt.toISOString(), rfqCode: rfq.rfqCode },
        ['internal'],
      );
      return this.load(tx, rfq.id);
    });
  }

  /** A draft quotation: amounts from unit prices and shipping, VAT at the rate in force, margin floor flag (D-012). */
  async draftQuote(
    actor: UserActor,
    publicId: string,
    input: { lines: RfqQuoteLineInput[]; note?: string },
  ): Promise<RfqRow> {
    const now = new Date();
    const priced = await this.priceLines(input.lines, now);
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      const rows = await priced(tx);
      const last = await tx.rfqQuote.findFirst({ where: { rfqId: rfq.id }, orderBy: { versionNo: 'desc' } });
      let quote;
      try {
        quote = await tx.rfqQuote.create({
          data: {
            rfqId: rfq.id,
            versionNo: (last?.versionNo ?? 0) + 1,
            createdById: actor.userId,
            note: input.note ?? '',
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('rfq.draft_open');
        }
        throw error;
      }
      await tx.rfqQuoteLine.createMany({ data: rows.map((r) => ({ ...r, rfqQuoteId: quote.id })) });
      await this.record(tx, rfq.publicId, 'rfq.quote_drafted', { versionNo: quote.versionNo }, ['internal']);
      return this.load(tx, rfq.id);
    });
  }

  /** Replaces the lines and note of the draft (re-priced as a new draft would be); If-Match the RFQ's ETag. */
  async replaceDraft(
    actor: UserActor,
    rfqQuotePublicId: string,
    ifMatch: string | undefined,
    input: { lines: RfqQuoteLineInput[]; note?: string },
  ): Promise<RfqRow> {
    const now = new Date();
    const priced = await this.priceLines(input.lines, now);
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.rfqQuote.findUnique({ where: { publicId: rfqQuotePublicId } });
      if (!quote) throw new DomainException('http.not_found');
      if (quote.status !== 'draft') throw new DomainException('rfq.quote_not_draft');
      const current = await tx.rfq.findUniqueOrThrow({ where: { id: quote.rfqId } });
      assertIfMatch(ifMatch, rfqEtag(current));
      const rfq = await this.openRfq(tx, current.publicId);
      const { count } = await tx.rfq.updateMany({
        where: { id: rfq.id, rowVersion: current.rowVersion },
        data: { rowVersion: { increment: 1 } },
      });
      if (count === 0) throw new DomainException('concurrency.stale');
      const rows = await priced(tx);
      await tx.rfqQuoteLine.deleteMany({ where: { rfqQuoteId: quote.id } });
      await tx.rfqQuoteLine.createMany({ data: rows.map((r) => ({ ...r, rfqQuoteId: quote.id })) });
      await tx.rfqQuote.update({ where: { id: quote.id }, data: { note: input.note ?? '' } });
      await this.record(
        tx,
        rfq.publicId,
        'rfq.quote_revised',
        { versionNo: quote.versionNo, by: actor.publicId },
        ['internal'],
      );
      return this.load(tx, rfq.id);
    });
  }

  /** Validates the lines and prices them in the transaction it is given (VAT in force, margin floor, D-012). */
  private async priceLines(lines: RfqQuoteLineInput[], now: Date) {
    const quantities = lines.map((l) => l.quantity);
    if (new Set(quantities).size !== quantities.length) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'lines', code: 'unique', message: 'one line per quantity' }],
      });
    }
    const factories = new Map(
      (
        await this.prisma.factory.findMany({
          where: { publicId: { in: lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])) } },
          select: { id: true, publicId: true },
        })
      ).map((f) => [f.publicId, f.id]),
    );
    const unknown = lines.findIndex((l) => l.factoryId && !factories.has(l.factoryId));
    if (unknown >= 0) {
      throw new DomainException('validation.failed', {
        errors: [{ path: `lines[${unknown}].factoryId`, code: 'exists', message: 'unknown factory' }],
      });
    }
    const floor = new MoneyDecimal(
      String((await this.settings.at('pricing.margin_floor_pct', { at: now })).value),
    );
    return async (tx: Tx) => {
      const vat = await this.vatRate(tx, now);
      return lines.map((l) => {
        const unit = new MoneyDecimal(l.unitPrice);
        const shipping = new MoneyDecimal(l.shippingNetAmount ?? '0');
        const net = unit.mul(l.quantity).add(shipping).toDecimalPlaces(2);
        const vatAmount = net.mul(vat.ratePct).div(100).toDecimalPlaces(2);
        const margin =
          l.buyUnitPrice && !unit.isZero()
            ? unit.sub(l.buyUnitPrice).div(unit).mul(100).toDecimalPlaces(4)
            : null;
        return {
          quantity: l.quantity,
          unitPrice: unit.toFixed(6),
          netAmount: net.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          grossAmount: net.add(vatAmount).toFixed(2),
          shippingNetAmount: shipping.toFixed(2),
          leadTimeDays: l.leadTimeDays,
          factoryId: l.factoryId ? factories.get(l.factoryId)! : null,
          buyUnitPrice: l.buyUnitPrice ?? null,
          marginPct: margin?.toFixed(4) ?? null,
          belowMarginFloor: margin !== null && margin.lessThan(floor),
        };
      });
    };
  }

  /** CS moves a submitted request into review without assigning it (D-100). */
  async startReview(publicId: string): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      if (rfq.status !== 'submitted') throw new DomainException('rfq.invalid_transition');
      await this.transition(tx, rfq.id, rfq.status, 'in_review');
      await this.record(tx, rfq.publicId, 'rfq.review_started', {}, ['internal']);
      return this.load(tx, rfq.id);
    });
  }

  /**
   * Factories that could quote the request (D-043): an active capability for its category, the participation tier
   * in force, whether the tiers fit the capability's quantity range, whether it was consulted, and the on-time
   * shipping % of its latest scorecard (D-155). No prices.
   */
  async candidates(publicId: string) {
    const rfq = await this.get(publicId);
    const now = new Date();
    const capabilities = await this.prisma.factoryCapability.findMany({
      where: {
        productTypeId: rfq.productTypeId,
        status: 'active',
        factory: { status: { in: ['active', 'trial'] } },
      },
      include: {
        factory: {
          select: {
            id: true,
            publicId: true,
            code: true,
            legalName: true,
            tradeName: true,
            status: true,
            participations: {
              where: { productTypeId: rfq.productTypeId },
              include: {
                versions: {
                  where: { status: 'approved', effectiveFrom: { lte: now } },
                  orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    const byFactory = new Map<bigint, typeof capabilities>();
    for (const c of capabilities) byFactory.set(c.factoryId, [...(byFactory.get(c.factoryId) ?? []), c]);
    const scorecards = await this.prisma.factoryScorecard.findMany({
      where: { factoryId: { in: [...byFactory.keys()] } },
      orderBy: { month: 'desc' },
    });
    const quantities = rfq.tiers.map((t) => t.quantity);
    return [...byFactory.values()].map((caps) => {
      const f = caps[0]!.factory;
      const fits = caps.some((c) =>
        quantities.every(
          (q) =>
            (c.minOrderQty === null || q >= c.minOrderQty) && (c.maxOrderQty === null || q <= c.maxOrderQty),
        ),
      );
      const below = caps.every((c) => c.minOrderQty !== null && quantities.some((q) => q < c.minOrderQty!));
      const card = scorecards.find((sc) => sc.factoryId === f.id);
      return {
        factoryId: f.publicId,
        code: f.code,
        name: f.tradeName ?? f.legalName,
        status: f.status,
        tier: f.participations[0]?.versions[0]?.tier ?? null,
        capable: fits,
        reason: fits ? null : below ? 'quantity_below_minimum' : 'quantity_above_maximum',
        alreadyConsulted: rfq.consultations.some((c) => c.factoryId === f.id),
        onTimeShippingPct: card?.onTimeShippingPct?.toFixed(2) ?? null,
      };
    });
  }

  /** Reminds the factory of an open consultation (D-143); once an hour at most (technical anti-spam bound). */
  async remindConsultation(actor: UserActor, consultationPublicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const c = await tx.rfqFactoryConsultation.findUnique({
        where: { publicId: consultationPublicId },
        include: {
          factory: { select: { publicId: true } },
          rfq: { select: { publicId: true, rfqCode: true } },
        },
      });
      if (!c) throw new DomainException('http.not_found');
      if (c.status !== 'requested') throw new DomainException('rfq.consultation_not_open');
      const recent = await tx.domainEvent.count({
        where: {
          type: 'rfq.consultation_reminded',
          aggregateId: c.rfq.publicId,
          occurredAt: { gt: new Date(Date.now() - 60 * 60_000) },
          payload: { path: ['consultationId'], equals: c.publicId },
        },
      });
      if (recent > 0) throw new DomainException('rfq.reminder_recent');
      await this.record(
        tx,
        c.rfq.publicId,
        'rfq.consultation_reminded',
        {
          consultationId: c.publicId,
          factoryId: c.factory.publicId,
          rfqCode: c.rfq.rfqCode,
          dueAt: c.dueAt.toISOString(),
          by: actor.publicId,
        },
        ['internal'],
      );
    });
  }

  /** CS records the customer's acceptance given by phone or LINE: the same path as the customer's own. */
  async recordAcceptance(
    actor: UserActor,
    rfqQuotePublicId: string,
    input: { quantities?: number[]; via: string; note?: string },
  ): Promise<RfqRow> {
    const quote = await this.prisma.rfqQuote.findUnique({
      where: { publicId: rfqQuotePublicId },
      include: { rfq: { select: { publicId: true, customerUserId: true } } },
    });
    if (!quote) throw new DomainException('http.not_found');
    return this.accept(quote.rfq.customerUserId, quote.rfq.publicId, quote.publicId, input.quantities, {
      actor,
      via: input.via,
      note: input.note ?? null,
    });
  }

  async discardDraft(rfqQuotePublicId: string): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.rfqQuote.findUnique({ where: { publicId: rfqQuotePublicId } });
      if (!quote) throw new DomainException('http.not_found');
      if (quote.status !== 'draft') throw new DomainException('rfq.quote_not_draft');
      await tx.rfqQuote.delete({ where: { id: quote.id } });
      const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: quote.rfqId } });
      await this.record(tx, rfq.publicId, 'rfq.quote_discarded', { versionNo: quote.versionNo }, [
        'internal',
      ]);
      return this.load(tx, rfq.id);
    });
  }

  /** Sends a draft: valid for `quotes.validity_days` (D-051); the quotation the customer held is superseded. */
  async sendQuote(actor: UserActor, rfqQuotePublicId: string): Promise<RfqRow> {
    const now = new Date();
    const validity = await this.settings.at('quotes.validity_days', { at: now });
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.rfqQuote.findUnique({
        where: { publicId: rfqQuotePublicId },
        include: { lines: true },
      });
      if (!quote) throw new DomainException('http.not_found');
      if (quote.status !== 'draft') throw new DomainException('rfq.quote_not_draft');
      if (quote.lines.length === 0) throw new DomainException('rfq.quote_empty');
      const rfq = await this.openRfq(
        tx,
        (await tx.rfq.findUniqueOrThrow({ where: { id: quote.rfqId } })).publicId,
      );
      await tx.rfqQuote.updateMany({
        where: { rfqId: rfq.id, status: 'sent' },
        data: { status: 'superseded' },
      });
      const validUntil = new Date(now.getTime() + Number(validity.value) * DAY_MS);
      await tx.rfqQuote.update({
        where: { id: quote.id },
        data: { status: 'sent', sentAt: now, validUntil },
      });
      await this.firstResponse(tx, rfq);
      if (rfq.status !== 'quoted') await this.transition(tx, rfq.id, rfq.status, 'quoted');
      await this.record(tx, rfq.publicId, 'rfq.quoted', {
        versionNo: quote.versionNo,
        validUntil: validUntil.toISOString(),
        sentBy: actor.publicId,
      });
      return this.load(tx, rfq.id);
    });
  }

  async staffDecline(actor: UserActor, publicId: string, reasonCode: string, note?: string): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      return this.close(tx, rfq, reasonCode, note ?? null);
    });
  }

  // --- factory -------------------------------------------------------------------------------------

  async consultations(actor: Actor, factoryPublicId: string, status?: string) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.rfqFactoryConsultation.findMany({
      where: { factoryId: factory.id, ...(status ? { status: status as never } : {}) },
      include: {
        rfq: {
          select: {
            rfqCode: true,
            spec: true,
            lengthMm: true,
            widthMm: true,
            heightMm: true,
            measurementBasis: true,
            targetDate: true,
            productType: { select: { code: true, nameTh: true, nameEn: true } },
            province: { select: { nameTh: true, nameEn: true } },
            tiers: { orderBy: { quantity: 'asc' } },
            styleVariant: {
              select: {
                code: true,
                options: true,
                base: { select: { code: true, nameTh: true, nameEn: true } },
              },
            },
          },
        },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** The factory's buy price per tier (or its refusal); never the customer or the sell price (D-044). */
  async respondConsultation(
    actor: UserActor,
    factoryPublicId: string,
    consultationPublicId: string,
    input: {
      decline?: boolean;
      lines?: { quantity: number; buyUnitPrice: string; leadTimeDays: number }[];
      note?: string;
    },
  ) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const consultation = await tx.rfqFactoryConsultation.findFirst({
        where: { publicId: consultationPublicId, factoryId: factory.id },
        include: { rfq: { select: { publicId: true, tiers: true } } },
      });
      if (!consultation) throw new DomainException('http.not_found');
      if (consultation.status !== 'requested') throw new DomainException('rfq.consultation_closed');
      if (!input.decline) {
        const tiers = new Set(consultation.rfq.tiers.map((t) => t.quantity));
        const bad = (input.lines ?? []).findIndex((l) => !tiers.has(l.quantity));
        if (!input.lines?.length || bad >= 0) {
          throw new DomainException('validation.failed', {
            errors: [
              {
                path: bad >= 0 ? `lines[${bad}].quantity` : 'lines',
                code: 'invalid',
                message: 'answer the requested quantity tiers',
              },
            ],
          });
        }
      }
      const updated = await tx.rfqFactoryConsultation.update({
        where: { id: consultation.id },
        data: {
          status: input.decline ? 'declined' : 'responded',
          response: input.decline
            ? { note: input.note ?? '' }
            : { lines: input.lines, note: input.note ?? '' },
          respondedById: actor.userId,
          respondedAt: new Date(),
        },
      });
      await this.record(
        tx,
        consultation.rfq.publicId,
        input.decline ? 'rfq.consultation_declined' : 'rfq.consultation_responded',
        { factoryId: factory.publicId },
        ['internal'],
      );
      return updated;
    });
  }

  // --- scheduled -------------------------------------------------------------------------------------

  /** Sent quotations past their validity expire; an RFQ left without a live one expires (unmet demand). */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.rfqQuote.findMany({
      where: { status: 'sent', validUntil: { lte: now } },
      select: { id: true, rfqId: true },
      take: 500,
    });
    for (const quote of due) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.rfqQuote.updateMany({
          where: { id: quote.id, status: 'sent' },
          data: { status: 'expired' },
        });
        if (count === 0) return;
        const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: quote.rfqId }, include: RFQ_INCLUDE });
        if (rfq.status === 'quoted') await this.close(tx, rfq, 'expired', null, 'expired');
      });
    }
    await this.prisma.rfqFactoryConsultation.updateMany({
      where: { status: 'requested', dueAt: { lte: now } },
      data: { status: 'expired' },
    });
    return due.length;
  }

  customer(publicId: string) {
    return this.prisma.user.findFirst({ where: { publicId, kind: 'customer' }, select: { id: true } });
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private async close(
    tx: Tx,
    rfq: RfqRow,
    reasonCode: string,
    note: string | null,
    status: 'declined' | 'expired' = 'declined',
  ) {
    if (!OPEN.includes(rfq.status)) throw new DomainException('rfq.closed');
    const reason = await tx.unmetDemandReason.findFirst({ where: { code: reasonCode, active: true } });
    if (!reason) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reasonCode', code: 'exists', message: 'unknown reason code' }],
      });
    }
    await tx.rfqQuote.updateMany({
      where: { rfqId: rfq.id, status: { in: ['draft', 'sent'] } },
      data: { status: 'superseded' },
    });
    await tx.rfq.update({
      where: { id: rfq.id },
      data: {
        status,
        declineReasonId: reason.id,
        declineNote: note,
        closedAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    await this.record(tx, rfq.publicId, status === 'declined' ? 'rfq.declined' : 'rfq.expired', {
      reasonCode,
    });
    return this.load(tx, rfq.id);
  }

  private async openRfq(tx: Tx, publicId: string) {
    const rfq = await this.get(publicId, tx);
    if (!OPEN.includes(rfq.status)) throw new DomainException('rfq.closed');
    return rfq;
  }

  private async transition(tx: Tx, rfqId: bigint, from: RfqStatus, to: RfqStatus) {
    const { count } = await tx.rfq.updateMany({
      where: { id: rfqId, status: from },
      data: { status: to, rowVersion: { increment: 1 } },
    });
    if (count !== 1) throw new DomainException('rfq.invalid_transition');
  }

  private async firstResponse(tx: Tx, rfq: { id: bigint; firstResponseAt: Date | null }) {
    if (!rfq.firstResponseAt)
      await tx.rfq.update({ where: { id: rfq.id }, data: { firstResponseAt: new Date() } });
  }

  private load(tx: Tx, id: bigint) {
    return tx.rfq.findUniqueOrThrow({ where: { id }, include: RFQ_INCLUDE });
  }

  /** The files of an RFQ and of its messages (attachments are polymorphic, so read apart from the row). */
  async attachments(rfq: RfqRow): Promise<RfqFiles> {
    const rows = await this.prisma.attachment.findMany({
      where: {
        OR: [
          { subjectType: 'rfq', subjectId: rfq.id },
          { subjectType: 'rfq_message', subjectId: { in: rfq.messages.map((m) => m.id) } },
        ],
      },
      include: {
        fileObject: { select: { publicId: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    const view = (a: (typeof rows)[number]) => ({
      id: a.fileObject.publicId,
      originalName: a.fileObject.originalName,
      mimeType: a.fileObject.mimeType,
      sizeBytes: Number(a.fileObject.sizeBytes),
    });
    const messages = new Map<bigint, ReturnType<typeof view>[]>();
    for (const a of rows.filter((r) => r.subjectType === 'rfq_message'))
      messages.set(a.subjectId, [...(messages.get(a.subjectId) ?? []), view(a)]);
    return { rfq: rows.filter((r) => r.subjectType === 'rfq').map(view), messages };
  }

  /**
   * The RFQ form of an active product type (U-B0.1): any active type, since an instant type still routes to RFQ
   * outside its price paths (D-043). No price, factory or staff data.
   */
  async form(productTypeCode: string): Promise<StoreRfqFormDto> {
    const type = await this.prisma.productType.findFirst({
      where: { code: productTypeCode, status: 'active' },
    });
    if (!type) throw new DomainException('http.not_found');
    const files = FILE_PURPOSES.artwork;
    return {
      productTypeCode: type.code,
      nameTh: type.nameTh,
      nameEn: type.nameEn,
      specSchemaVersion: type.rfqSpecSchemaVersion,
      fields: rfqFormFields(type.rfqSpecSchema),
      dimensions: rfqDimensions(type.rfqSpecSchema),
      quantity: { min: 1, maxTiers: MAX_RFQ_TIERS },
      files: {
        purpose: 'artwork',
        accept: [...files.mimeTypes],
        maxBytes: files.maxBytes,
        maxFiles: MAX_RFQ_FILES,
      },
      slaTargetHours: await this.slaHours(type.id, new Date()),
    };
  }

  /** The staff view's extras: the category's first-response target, the validity of a quotation sent now. */
  async staffContext(rows: RfqRow[], now = new Date()) {
    const types = [...new Set(rows.map((r) => r.productTypeId))];
    const hours = new Map<bigint, number | null>();
    for (const t of types) hours.set(t, await this.slaHours(t, now));
    const validity = Number((await this.settings.at('quotes.validity_days', { at: now })).value);
    const schemas = new Map(
      (
        await this.prisma.productType.findMany({
          where: { id: { in: types } },
          select: { id: true, rfqSpecSchema: true },
        })
      ).map((t) => [t.id, t.rfqSpecSchema]),
    );
    return { hours, validUntil: new Date(now.getTime() + validity * DAY_MS), schemas };
  }

  /** The unmet-demand reasons a decline takes (D-102). */
  unmetDemandReasons() {
    return this.prisma.unmetDemandReason.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
  }

  async slaHours(productTypeId: bigint, at: Date): Promise<number | null> {
    try {
      return Number(
        (
          await this.settings.at('rfq.sla_business_hours', {
            at,
            scope: { type: 'product_type', id: productTypeId },
          })
        ).value,
      );
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }

  /** First-response due time: the category's SLA in business hours, or none while it is not set. */
  private async slaDueAt(productTypeId: bigint, now: Date): Promise<Date | null> {
    try {
      const hours = Number(
        (
          await this.settings.at('rfq.sla_business_hours', {
            at: now,
            scope: { type: 'product_type', id: productTypeId },
          })
        ).value,
      );
      const calendar = await this.calendars.calendar();
      return calendar.addWorkingMinutes(now, hours * 60);
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }

  private async vatRate(tx: Tx, at: Date) {
    const version = await tx.taxRateVersion.findFirst({
      where: { taxRate: { code: 'vat_standard' }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    if (!version) throw new DomainException('pricing.vat_rate_missing');
    return { versionId: version.id, ratePct: new MoneyDecimal(version.ratePct.toString()) };
  }

  /**
   * The calculation an RFQ was routed from (D-102): one of this product type, made by this customer or without a
   * signed-in customer (they may sign in to submit). Anything else is ignored rather than refused — it is analytics.
   */
  private async routedFrom(
    customerUserId: bigint,
    productTypeId: bigint,
    calculationId: string | undefined,
  ): Promise<bigint | null> {
    if (!calculationId) return null;
    const log = await this.prisma.calculateLog.findFirst({
      where: {
        publicId: calculationId,
        productTypeId,
        OR: [{ actorUserId: customerUserId }, { actorUserId: null }],
      },
      select: { id: true },
    });
    return log?.id ?? null;
  }

  /** Uploaded, clean files of the customer (or of the CS member entering the RFQ for them). */
  private async ownFiles(
    customerUserId: bigint,
    createdBy: UserActor | undefined,
    publicIds: string[],
  ): Promise<bigint[]> {
    if (publicIds.length === 0) return [];
    const owners = [customerUserId, ...(createdBy ? [createdBy.userId] : [])];
    const rows = await this.prisma.fileObject.findMany({
      where: {
        publicId: { in: publicIds },
        ownerUserId: { in: owners },
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
      },
      select: { id: true, publicId: true },
    });
    const found = new Map(rows.map((r) => [r.publicId, r.id]));
    const missing = publicIds.findIndex((id) => !found.has(id));
    if (missing >= 0) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: `fileIds[${missing}]`,
            code: 'exists',
            message: 'not an uploaded, scanned file of the customer',
          },
        ],
      });
    }
    return publicIds.map((id) => found.get(id)!);
  }

  private async record(
    tx: Tx,
    rfqPublicId: string,
    type: string,
    data: Record<string, unknown>,
    visibility: ('internal' | 'customer')[] = ['internal', 'customer'],
  ): Promise<void> {
    const event = await this.events.record(tx, {
      type,
      aggregateType: 'rfq',
      aggregateId: rfqPublicId,
      payload: { rfqId: rfqPublicId, ...data },
    });
    await this.activity.record(tx, {
      aggregateType: 'rfq',
      aggregatePublicId: rfqPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility,
      domainEventId: event.id,
    });
  }
}
