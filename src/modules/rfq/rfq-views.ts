import { toBangkokIso } from '@common/time/bangkok';

import {
  type ConsultationLineDto,
  type FactoryConsultationDto,
  type RfqDto,
  type RfqQuotationDto,
  type RfqQuoteLineDto,
  type StaffRfqDto,
} from './rfqs.dto';
import { type RfqRow } from './rfqs.service';

const num = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

type QuoteRow = RfqRow['quotes'][number];

function line(l: QuoteRow['lines'][number]): RfqQuoteLineDto {
  return {
    quantity: l.quantity,
    unitPrice: l.unitPrice.toFixed(6),
    netAmount: l.netAmount.toFixed(2),
    vatAmount: l.vatAmount.toFixed(2),
    grossAmount: l.grossAmount.toFixed(2),
    shippingNetAmount: l.shippingNetAmount.toFixed(2),
    leadTimeDays: l.leadTimeDays,
  };
}

function quotation(q: QuoteRow): RfqQuotationDto {
  return {
    id: q.publicId,
    versionNo: q.versionNo,
    status: q.status,
    validUntil: iso(q.validUntil),
    sentAt: iso(q.sentAt),
    note: q.note,
    lines: q.lines.map(line),
  };
}

/** The customer view: customer-visible messages, sent quotations, no factory or buy price (D-050). */
export function rfqDto(r: RfqRow): RfqDto {
  return {
    id: r.publicId,
    rfqCode: r.rfqCode,
    status: r.status,
    productTypeCode: r.productType.code,
    productTypeName: r.productType.nameTh,
    spec: r.spec as Record<string, unknown>,
    lengthMm: num(r.lengthMm),
    widthMm: num(r.widthMm),
    heightMm: num(r.heightMm),
    quantities: r.tiers.map((t) => t.quantity),
    targetDate: date(r.targetDate),
    deliveryPostcode: r.deliveryPostcode,
    notes: r.notes,
    slaDueAt: iso(r.slaDueAt),
    messages: r.messages
      .filter((m) => m.visibility === 'customer')
      .map((m) => ({
        id: m.publicId,
        author: m.authorUserId === r.customerUserId ? 'customer' : 'packio',
        body: m.body,
        createdAt: toBangkokIso(m.createdAt),
      })),
    quotations: r.quotes.filter((q) => q.status !== 'draft').map(quotation),
    acceptedQuoteId: r.acceptedQuote?.publicId ?? null,
    declineReasonCode: r.declineReason?.code ?? null,
    submittedAt: toBangkokIso(r.submittedAt),
    closedAt: iso(r.closedAt),
  };
}

/** The staff view; buy prices need `factory_cost.read`, margins `margin.read` (D-141). */
export function staffRfqDto(
  r: RfqRow,
  grants: { cost: boolean; margin: boolean },
  now = new Date(),
): StaffRfqDto {
  const base = rfqDto(r);
  const open = ['submitted', 'in_review', 'need_info'].includes(r.status);
  return {
    ...base,
    channel: r.channel,
    customer: { id: r.customer.publicId, displayName: r.customer.displayName },
    assignedTo: r.assignedTo ? { id: r.assignedTo.publicId, displayName: r.assignedTo.displayName } : null,
    firstResponseAt: iso(r.firstResponseAt),
    overdue: open && !r.firstResponseAt && r.slaDueAt !== null && r.slaDueAt < now,
    messages: r.messages.map((m) => ({
      id: m.publicId,
      author: m.authorUserId === r.customerUserId ? 'customer' : 'packio',
      body: m.body,
      createdAt: toBangkokIso(m.createdAt),
      visibility: m.visibility,
      authorUser: { id: m.author.publicId, displayName: m.author.displayName },
    })),
    quotations: r.quotes.map((q) => ({
      ...quotation(q),
      lines: q.lines.map((l) => ({
        ...line(l),
        factoryId: l.factory?.publicId ?? null,
        buyUnitPrice: grants.cost && l.buyUnitPrice ? l.buyUnitPrice.toFixed(6) : null,
        marginPct: grants.margin && l.marginPct ? l.marginPct.toFixed(4) : null,
        belowMarginFloor: l.belowMarginFloor,
      })),
    })),
    consultations: r.consultations.map((c) => {
      const response = c.response as { lines?: ConsultationLineDto[]; note?: string } | null;
      return {
        id: c.publicId,
        factoryId: c.factory.publicId,
        factoryCode: c.factory.code,
        status: c.status,
        dueAt: toBangkokIso(c.dueAt),
        note: c.note,
        lines: grants.cost ? (response?.lines ?? null) : null,
        responseNote: response?.note ?? null,
        respondedAt: iso(c.respondedAt),
      };
    }),
  };
}

type ConsultationRow = Awaited<ReturnType<import('./rfqs.service').RfqsService['consultations']>>[number];

/** The factory view: spec, tiers and the delivery province only — no customer, no sell price (D-044, D-142). */
export function factoryConsultationDto(c: ConsultationRow): FactoryConsultationDto {
  const response = c.response as { lines?: ConsultationLineDto[] } | null;
  return {
    id: c.publicId,
    status: c.status,
    dueAt: toBangkokIso(c.dueAt),
    note: c.note,
    rfqCode: c.rfq.rfqCode,
    productTypeCode: c.rfq.productType.code,
    productTypeName: c.rfq.productType.nameTh,
    spec: c.rfq.spec as Record<string, unknown>,
    lengthMm: num(c.rfq.lengthMm),
    widthMm: num(c.rfq.widthMm),
    heightMm: num(c.rfq.heightMm),
    quantities: c.rfq.tiers.map((t) => t.quantity),
    targetDate: date(c.rfq.targetDate),
    deliveryProvince: c.rfq.province?.nameTh ?? null,
    lines: response?.lines ?? null,
    respondedAt: iso(c.respondedAt),
  };
}
