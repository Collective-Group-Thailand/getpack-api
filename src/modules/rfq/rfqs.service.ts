import { type Actor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type RfqStatus, type SalesChannel } from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { FilesService } from '@platform/files/files.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { specErrors } from './rfq-spec';

export const RFQ_INCLUDE = {
  productType: { select: { code: true, nameTh: true, nameEn: true } },
  province: { select: { nameTh: true, nameEn: true } },
  customer: { select: { publicId: true, displayName: true } },
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
    include: { factory: { select: { publicId: true, code: true } } },
  },
  quotes: {
    orderBy: { versionNo: 'desc' },
    include: {
      lines: { orderBy: { quantity: 'asc' }, include: { factory: { select: { publicId: true } } } },
    },
  },
} satisfies Prisma.RfqInclude;
export type RfqRow = Prisma.RfqGetPayload<{ include: typeof RFQ_INCLUDE }>;

export interface SubmitRfqInput {
  productTypeCode: string;
  spec: Record<string, unknown>;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  quantities: number[];
  targetDate?: string | null;
  deliveryPostcode: string;
  notes?: string;
  fileIds?: string[];
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
  }

  // --- customer ------------------------------------------------------------------------------------

  async submit(
    customerUserId: bigint,
    channel: SalesChannel,
    input: SubmitRfqInput,
    createdBy?: UserActor,
  ): Promise<RfqRow> {
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
    const files = await this.ownFiles(customerUserId, createdBy, input.fileIds ?? []);
    const province = await this.prisma.geoSubdistrict.findFirst({
      where: { postcode: input.deliveryPostcode },
      select: { district: { select: { provinceId: true } } },
    });
    const now = new Date();
    const slaDueAt = await this.slaDueAt(type.id, now);
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      const rfq = await tx.rfq.create({
        data: {
          rfqCode: await this.numbering.next(tx, 'rfq', now),
          entityId,
          channel,
          customerUserId,
          createdById: createdBy?.userId ?? null,
          productTypeId: type.id,
          spec: input.spec as Prisma.InputJsonValue,
          specSchemaVersion: 1,
          lengthMm: input.lengthMm ?? null,
          widthMm: input.widthMm ?? null,
          heightMm: input.heightMm ?? null,
          targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null,
          deliveryPostcode: input.deliveryPostcode,
          provinceId: province?.district.provinceId ?? null,
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
      return this.load(tx, rfq.id);
    });
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
  async customerMessage(customerUserId: bigint, publicId: string, body: string): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.forCustomer(customerUserId, publicId, tx);
      if (!OPEN.includes(rfq.status)) throw new DomainException('rfq.closed');
      await tx.rfqMessage.create({
        data: { rfqId: rfq.id, authorUserId: customerUserId, visibility: 'customer', body },
      });
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
      };
      const configRefs = {
        rfqQuoteId: quote.publicId,
        rfqQuoteVersion: quote.versionNo,
        vatRateVersionId: vat.versionId.toString(),
      };
      const options = lines.map((l) => {
        const shippingVat = l.shippingNetAmount.mul(vat.ratePct).div(100).toDecimalPlaces(2);
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
          selectedFactoryId: l.factoryId,
          buyCostNet: l.buyUnitPrice ? l.buyUnitPrice.mul(l.quantity).toDecimalPlaces(2) : null,
          marginPct: l.marginPct,
          belowMarginFloor: l.belowMarginFloor,
        };
      });
      const snapshotSha256 = sha256(JSON.stringify(canonical({ input, configRefs, options })));
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
          calculatorVersion: 'manual',
          configRefs,
          status: 'saved',
          validUntil: quote.validUntil,
          deliveryPostcode: rfq.deliveryPostcode,
          snapshotSha256,
          options: { create: options },
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

  async assign(actor: UserActor, publicId: string, userPublicId: string): Promise<RfqRow> {
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
  ): Promise<RfqRow> {
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      await tx.rfqMessage.create({ data: { rfqId: rfq.id, authorUserId: actor.userId, visibility, body } });
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
        { factoryId: factory.publicId, dueAt: dueAt.toISOString() },
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
    const quantities = input.lines.map((l) => l.quantity);
    if (new Set(quantities).size !== quantities.length) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'lines', code: 'unique', message: 'one line per quantity' }],
      });
    }
    const factories = new Map(
      (
        await this.prisma.factory.findMany({
          where: { publicId: { in: input.lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])) } },
          select: { id: true, publicId: true },
        })
      ).map((f) => [f.publicId, f.id]),
    );
    const unknown = input.lines.findIndex((l) => l.factoryId && !factories.has(l.factoryId));
    if (unknown >= 0) {
      throw new DomainException('validation.failed', {
        errors: [{ path: `lines[${unknown}].factoryId`, code: 'exists', message: 'unknown factory' }],
      });
    }
    const now = new Date();
    const floor = new MoneyDecimal(
      String((await this.settings.at('pricing.margin_floor_pct', { at: now })).value),
    );
    return this.prisma.withTx(async (tx) => {
      const rfq = await this.openRfq(tx, publicId);
      const vat = await this.vatRate(tx, now);
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
      await tx.rfqQuoteLine.createMany({
        data: input.lines.map((l) => {
          const unit = new MoneyDecimal(l.unitPrice);
          const shipping = new MoneyDecimal(l.shippingNetAmount ?? '0');
          const net = unit.mul(l.quantity).add(shipping).toDecimalPlaces(2);
          const vatAmount = net.mul(vat.ratePct).div(100).toDecimalPlaces(2);
          const margin =
            l.buyUnitPrice && !unit.isZero()
              ? unit.sub(l.buyUnitPrice).div(unit).mul(100).toDecimalPlaces(4)
              : null;
          return {
            rfqQuoteId: quote.id,
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
        }),
      });
      await this.record(tx, rfq.publicId, 'rfq.quote_drafted', { versionNo: quote.versionNo }, ['internal']);
      return this.load(tx, rfq.id);
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
            targetDate: true,
            productType: { select: { code: true, nameTh: true, nameEn: true } },
            province: { select: { nameTh: true, nameEn: true } },
            tiers: { orderBy: { quantity: 'asc' } },
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
