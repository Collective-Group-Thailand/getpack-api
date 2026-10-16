import { createHash, randomBytes } from 'node:crypto';

import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { type ActionRule, nextActions } from '@common/next-actions/next-actions';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { AppConfig } from '@config/app-config';
import { type Tx } from '@database/prisma.service';
import { type ErpQuotation, type ErpQuotationStatus, type ErpVatMode, type Prisma } from '@generated/prisma/client';
import { bahtText } from '@modules/receivables/thai-text';
import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { fmtMoney } from './erp.math';
import { ErpAlertsService } from './erp-alerts.service';
import { ErpCrmService } from './erp-crm.service';
import {
  type ErpQuotationDto,
  type ErpQuotationLinkDto,
  type ErpQuotationListQuery,
  type ErpQuotationSummaryDto,
  type ErpRecordAcceptanceDto,
  type ErpSaveQuotationDto,
  type PublicAcceptQuotationDto,
  type PublicQuotationDto,
} from './erp-e4.dto';
import {
  addDays,
  buyerOf,
  customerOf,
  day,
  factoryUser,
  iso,
  isoTs,
  LINE,
  partnerRef,
  party,
  priceLines,
  salesLineDto,
  sellerOf,
  today,
  totalsOf,
  userRef,
  vatModeFor,
} from './erp-sales.shared';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const hash = (token: string) => new Uint8Array(createHash('sha256').update(token).digest());
const OPEN: ErpQuotationStatus[] = ['draft', 'sent'];

const QUOTE_INCLUDE = {
  customer: true,
  opportunity: true,
  salesperson: true,
  lines: { include: { item: true }, orderBy: { lineNo: 'asc' } },
  salesOrders: { where: { status: { not: 'cancelled' } }, orderBy: { id: 'desc' } },
} as const satisfies Prisma.ErpQuotationInclude;
type QuoteRow = Prisma.ErpQuotationGetPayload<{ include: typeof QUOTE_INCLUDE }>;

export interface QuoteFacts {
  status: ErpQuotationStatus;
  expired: boolean;
  ordered: boolean;
}

export const QUOTE_ACTIONS: ActionRule<QuoteFacts>[] = [
  { key: 'erp_quote.edit', permissions: ['factory_sales.manage'], when: (q) => q.status === 'draft' },
  { key: 'erp_quote.send', permissions: ['factory_sales.manage'], when: (q) => OPEN.includes(q.status) && !q.expired },
  {
    key: 'erp_quote.revise',
    permissions: ['factory_sales.manage'],
    when: (q) => ['sent', 'rejected', 'expired'].includes(q.status),
  },
  {
    key: 'erp_quote.accept',
    permissions: ['factory_sales.manage'],
    when: (q) => (q.status === 'sent' ? (q.expired ? 'ใบเสนอราคาหมดอายุแล้ว — ออกฉบับแก้ไขใหม่' : true) : false),
  },
  { key: 'erp_quote.reject', permissions: ['factory_sales.manage'], when: (q) => q.status === 'sent' },
  { key: 'erp_quote.order', permissions: ['factory_sales.manage'], when: (q) => q.status === 'accepted' && !q.ordered },
  {
    key: 'erp_quote.cancel',
    permissions: ['factory_sales.manage'],
    irreversible: true,
    when: (q) => OPEN.includes(q.status),
  },
  { key: 'erp_quote.pdf', permissions: ['factory_sales.read'], when: () => true },
];

/**
 * Quotations (D-360): drafted with the factory's own prices, sent with a customer link (token stored hashed),
 * accepted or declined online or recorded by the factory, revised under the same number, expired by a daily job.
 */
@Injectable()
export class ErpQuotationsService {
  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly crm: ErpCrmService,
    private readonly alerts: ErpAlertsService,
    private readonly config: AppConfig,
  ) {}

  async list(scope: ErpScope, q: ErpQuotationListQuery) {
    const where: Prisma.ErpQuotationWhereInput = { factoryId: scope.factory.id };
    if (q.status === 'open') where.status = { in: OPEN };
    else if (q.status) where.status = q.status as ErpQuotationStatus;
    else where.status = { not: 'superseded' };
    if (q.customerId) where.customer = { publicId: q.customerId };
    if (q.opportunityId) where.opportunity = { publicId: q.opportunityId };
    if (q.q)
      where.OR = [
        { quoteNo: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    const [rows, total] = await Promise.all([
      this.workspace.db.erpQuotation.findMany({
        where,
        include: { customer: true, salesperson: true },
        orderBy: [{ quoteDate: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpQuotation.count({ where }),
    ]);
    return paginated(rows.map(quoteSummary), total, q);
  }

  async get(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpQuotationDto> {
    const row = await this.workspace.db.erpQuotation.findFirst({
      where: { publicId, factoryId: scope.factory.id },
      include: QUOTE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    const revisions = await this.workspace.db.erpQuotation.findMany({
      where: { factoryId: scope.factory.id, quoteNo: row.quoteNo },
      orderBy: { revision: 'asc' },
    });
    return quoteDto(row, revisions, perms);
  }

  async create(scope: ErpScope, body: ErpSaveQuotationDto, perms: ReadonlySet<string>): Promise<ErpQuotationDto> {
    const id = await this.workspace.tx(async (tx) => {
      const data = await this.fields(tx, scope, body, null);
      const quoteNo = await this.workspace.nextNumber(tx, scope.factory.id, 'qt');
      const q = await tx.erpQuotation.create({
        data: { factoryId: scope.factory.id, quoteNo, createdById: scope.actor.userId, ...data },
      });
      await this.workspace.record(tx, scope, 'erp_quotation.drafted', 'erp_quotation', q.publicId, { quoteNo });
      return q.publicId;
    });
    return this.get(scope, id, perms);
  }

  async update(
    scope: ErpScope,
    publicId: string,
    ifMatch: string | undefined,
    body: ErpSaveQuotationDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpQuotationDto> {
    await this.workspace.tx(async (tx) => {
      const q = await this.lock(tx, scope, publicId);
      assertIfMatch(ifMatch, etagOf(q.publicId, q.rowVersion));
      if (q.status !== 'draft') throw new DomainException('erp.invalid_status', { params: { status: q.status } });
      const data = await this.fields(tx, scope, body, q);
      await tx.erpQuotationLine.deleteMany({ where: { quotationId: q.id } });
      await tx.erpQuotation.update({
        where: { id: q.id },
        data: { ...data, pdfFileId: null, updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
      });
    });
    return this.get(scope, publicId, perms);
  }

  /** Sends it (D-360): the buyer is frozen and a new customer link replaces any earlier one. */
  async send(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpQuotationLinkDto> {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = await this.workspace.tx(async (tx) => {
      const q = await this.lock(tx, scope, publicId);
      if (!OPEN.includes(q.status)) throw new DomainException('erp.invalid_status', { params: { status: q.status } });
      if (iso(q.validUntil)! < today())
        throw new DomainException('erp.quotation_expired', {
          params: { quoteNo: q.quoteNo, validUntil: iso(q.validUntil)! },
        });
      const customer = await tx.erpTradingPartner.findUniqueOrThrow({ where: { id: q.customerId } });
      const until = new Date(`${iso(q.validUntil)}T23:59:59+07:00`);
      await tx.erpQuotation.update({
        where: { id: q.id },
        data: {
          status: 'sent',
          sentAt: q.sentAt ?? new Date(),
          buyerSnapshot: buyerOf(customer) as unknown as Prisma.InputJsonValue,
          linkTokenHash: hash(token),
          linkExpiresAt: until,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (q.opportunityId)
        await tx.erpOpportunity.updateMany({
          where: { id: q.opportunityId, stage: 'prospecting' },
          data: { stage: 'proposal', probabilityPct: 40, rowVersion: { increment: 1 } },
        });
      await this.workspace.record(tx, scope, 'erp_quotation.sent', 'erp_quotation', q.publicId, {
        quoteNo: q.quoteNo,
      });
      return until;
    });
    return { quotation: await this.get(scope, publicId, perms), url: this.linkUrl(token), expiresAt: isoTs(expiresAt)! };
  }

  /** A new revision under the same number (D-360); the earlier one is superseded. */
  async revise(scope: ErpScope, publicId: string, perms: ReadonlySet<string>): Promise<ErpQuotationDto> {
    const id = await this.workspace.tx(async (tx) => {
      const q = await this.lock(tx, scope, publicId);
      if (!['sent', 'rejected', 'expired'].includes(q.status))
        throw new DomainException('erp.invalid_status', { params: { status: q.status } });
      const lines = await tx.erpQuotationLine.findMany({ where: { quotationId: q.id }, orderBy: { lineNo: 'asc' } });
      const settings = await this.workspace.settings(tx, scope.factory.id);
      const latest = await tx.erpQuotation.aggregate({
        where: { factoryId: scope.factory.id, quoteNo: q.quoteNo },
        _max: { revision: true },
      });
      await tx.erpQuotation.update({
        where: { id: q.id },
        data: { status: 'superseded', linkTokenHash: null, updatedById: scope.actor.userId, rowVersion: { increment: 1 } },
      });
      const next = await tx.erpQuotation.create({
        data: {
          factoryId: scope.factory.id,
          quoteNo: q.quoteNo,
          revision: (latest._max.revision ?? q.revision) + 1,
          customerId: q.customerId,
          opportunityId: q.opportunityId,
          salespersonId: q.salespersonId,
          previousId: q.id,
          quoteDate: day(today()),
          validUntil: day(addDays(today(), settings.quoteValidDays)),
          paymentTermDays: q.paymentTermDays,
          leadTimeDays: q.leadTimeDays,
          terms: q.terms,
          note: q.note,
          vatMode: q.vatMode,
          vatRatePct: q.vatRatePct,
          subtotal: q.subtotal,
          vatAmount: q.vatAmount,
          total: q.total,
          createdById: scope.actor.userId,
          lines: {
            create: lines.map((l) => ({
              lineNo: l.lineNo,
              itemId: l.itemId,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              amount: l.amount,
            })),
          },
        },
      });
      await this.workspace.record(tx, scope, 'erp_quotation.revised', 'erp_quotation', next.publicId, {
        quoteNo: q.quoteNo,
        revision: next.revision,
      });
      return next.publicId;
    });
    return this.get(scope, id, perms);
  }

  /** The factory records an acceptance it received another way (phone, the customer's PO, LINE). */
  async accept(
    scope: ErpScope,
    publicId: string,
    body: ErpRecordAcceptanceDto,
    perms: ReadonlySet<string>,
  ): Promise<ErpQuotationDto> {
    await this.workspace.tx(async (tx) => {
      const q = await this.lock(tx, scope, publicId);
      await this.markAccepted(tx, scope, q, body, 'factory');
    });
    return this.get(scope, publicId, perms);
  }

  async reject(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const q = await this.lock(tx, scope, publicId);
      if (q.status !== 'sent') throw new DomainException('erp.invalid_status', { params: { status: q.status } });
      await tx.erpQuotation.update({
        where: { id: q.id },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectReason: reason,
          linkTokenHash: null,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_quotation.rejected', 'erp_quotation', q.publicId);
    });
    return this.get(scope, publicId, perms);
  }

  async cancel(scope: ErpScope, publicId: string, reason: string, perms: ReadonlySet<string>) {
    await this.workspace.tx(async (tx) => {
      const q = await this.lock(tx, scope, publicId);
      if (!OPEN.includes(q.status)) throw new DomainException('erp.invalid_status', { params: { status: q.status } });
      await tx.erpQuotation.update({
        where: { id: q.id },
        data: {
          status: 'cancelled',
          cancelReason: reason,
          linkTokenHash: null,
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.workspace.record(tx, scope, 'erp_quotation.cancelled', 'erp_quotation', q.publicId);
    });
    return this.get(scope, publicId, perms);
  }

  // ----------------------------------------------------------------------------- customer link

  async publicView(token: string): Promise<PublicQuotationDto> {
    const q = await this.byToken(this.workspace.db, token);
    const factory = await this.workspace.db.factory.findUniqueOrThrow({ where: { id: q.factoryId } });
    const settings = await this.workspace.settings(this.workspace.db, q.factoryId);
    const seller = await this.workspace.tx((tx) => sellerOf(tx, factory));
    const customer = await this.workspace.db.erpTradingPartner.findUniqueOrThrow({ where: { id: q.customerId } });
    const expired = q.status === 'sent' && iso(q.validUntil)! < today();
    return {
      seller,
      sellerLogoUrl: null,
      buyer: party(q.buyerSnapshot) ?? buyerOf(customer),
      quoteNo: q.quoteNo,
      revision: q.revision,
      status: expired ? 'expired' : q.status,
      quoteDate: iso(q.quoteDate)!,
      validUntil: iso(q.validUntil)!,
      paymentTermDays: q.paymentTermDays,
      leadTimeDays: q.leadTimeDays,
      terms: q.terms,
      vatMode: q.vatMode,
      vatRatePct: q.vatRatePct.toFixed(4),
      lines: q.lines.map((l) => salesLineDto(l, LINE.quote)),
      subtotal: fmtMoney(q.subtotal),
      vatAmount: fmtMoney(q.vatAmount),
      total: fmtMoney(q.total),
      totalInWords: bahtText(fmtMoney(q.total)),
      acceptedAt: isoTs(q.acceptedAt),
      acceptedName: q.acceptedName,
      sellerContact: settings.documentFooter,
    };
  }

  async publicAccept(token: string, body: PublicAcceptQuotationDto): Promise<PublicQuotationDto> {
    if (!body.agree)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'agree', code: 'required', message: 'Agree to the quotation to accept it' }],
      });
    await this.workspace.tx(async (tx) => {
      const found = await this.byToken(tx, token);
      const factory = await tx.factory.findUniqueOrThrow({ where: { id: found.factoryId } });
      const q = await this.lock(tx, { factory, actor: null as never }, found.publicId);
      await this.markAccepted(tx, { factory, actor: null }, q, body, 'link');
    });
    return this.publicView(token);
  }

  async publicDecline(token: string, reason: string): Promise<PublicQuotationDto> {
    await this.workspace.tx(async (tx) => {
      const found = await this.byToken(tx, token);
      if (found.status !== 'sent')
        throw new DomainException('erp.invalid_status', { params: { status: found.status } });
      await tx.erpQuotation.update({
        where: { id: found.id },
        data: { status: 'rejected', rejectedAt: new Date(), rejectReason: reason, rowVersion: { increment: 1 } },
      });
      const factory = await tx.factory.findUniqueOrThrow({ where: { id: found.factoryId } });
      await this.workspace.recordSystem(tx, factory.publicId, 'erp_quotation.declined_online', 'erp_quotation', found.publicId, {
        quoteNo: found.quoteNo,
      });
    });
    return this.publicView(token);
  }

  // ------------------------------------------------------------------------------- daily job

  /** D-360, D-371: sent quotations past their date expire; those ending within 3 days raise a follow-up alert. */
  @ScheduledJob({ name: 'factory_erp.quotation_expiry', cron: '25 7 * * *' })
  async expiryCheck(): Promise<number> {
    const t = today();
    const expired = await this.workspace.db.erpQuotation.updateMany({
      where: { status: 'sent', validUntil: { lt: day(t) } },
      data: { status: 'expired', linkTokenHash: null, rowVersion: { increment: 1 } },
    });
    const soon = await this.workspace.db.erpQuotation.findMany({
      where: { status: 'sent', validUntil: { gte: day(t), lte: day(addDays(t, 3)) } },
      include: { customer: true, factory: true },
    });
    for (const q of soon)
      await this.workspace.tx((tx) =>
        this.alerts.raise(tx, {
          factoryId: q.factoryId,
          factoryPublicId: q.factory.publicId,
          kind: 'quote_follow_up',
          dedupeKey: `quote_follow_up:${q.publicId}`,
          subjectType: 'quotation',
          subjectPublicId: q.publicId,
          dueOn: iso(q.validUntil),
          payload: { quoteNo: q.quoteNo, revision: q.revision, customer: q.customer.name, validUntil: iso(q.validUntil) },
        }),
      );
    return expired.count + soon.length;
  }

  // ----------------------------------------------------------------------------------- helpers

  linkUrl(token: string): string {
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.getpack.invalid';
    return `${web.replace(/\/$/, '')}/q/${token}`;
  }

  private async markAccepted(
    tx: Tx,
    ctx: { factory: ErpScope['factory']; actor: ErpScope['actor'] | null },
    q: ErpQuotation,
    body: { name: string; position?: string | null; customerPoNo?: string | null },
    via: 'link' | 'factory',
  ) {
    if (q.status !== 'sent') throw new DomainException('erp.invalid_status', { params: { status: q.status } });
    if (iso(q.validUntil)! < today())
      throw new DomainException('erp.quotation_expired', {
        params: { quoteNo: q.quoteNo, validUntil: iso(q.validUntil)! },
      });
    await tx.erpQuotation.update({
      where: { id: q.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedName: body.name,
        acceptedPosition: body.position ?? null,
        acceptedVia: via,
        customerPoNo: body.customerPoNo ?? null,
        linkTokenHash: via === 'link' ? q.linkTokenHash : null,
        rowVersion: { increment: 1 },
      },
    });
    if (q.opportunityId) {
      const opp = await tx.erpOpportunity.findUniqueOrThrow({ where: { id: q.opportunityId } });
      await this.crm.win(tx, ctx, opp);
    }
    const payload = { quoteNo: q.quoteNo, via };
    if (ctx.actor)
      await this.workspace.record(tx, ctx as ErpScope, 'erp_quotation.accepted', 'erp_quotation', q.publicId, payload);
    else
      await this.workspace.recordSystem(tx, ctx.factory.publicId, 'erp_quotation.accepted', 'erp_quotation', q.publicId, payload);
  }

  private async byToken(db: Tx | ErpWorkspace['db'], token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new DomainException('http.not_found');
    const q = await db.erpQuotation.findFirst({
      where: { linkTokenHash: hash(token) },
      include: { lines: { include: { item: true }, orderBy: { lineNo: 'asc' } } },
    });
    if (!q || !q.linkExpiresAt) throw new DomainException('http.not_found');
    if (q.status === 'sent' && q.linkExpiresAt < new Date())
      throw new DomainException('erp.quotation_expired', {
        params: { quoteNo: q.quoteNo, validUntil: iso(q.validUntil)! },
      });
    return q;
  }

  private async lock(tx: Tx, scope: ErpScope, publicId: string): Promise<ErpQuotation> {
    const q = await tx.erpQuotation.findFirst({ where: { publicId, factoryId: scope.factory.id } });
    if (!q) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM erp_quotations WHERE id = ${q.id} FOR UPDATE`;
    return q;
  }

  private async fields(tx: Tx, scope: ErpScope, body: ErpSaveQuotationDto, current: ErpQuotation | null) {
    const customer = await customerOf(tx, scope, body.customerId);
    const opportunity = body.opportunityId
      ? await tx.erpOpportunity.findFirst({ where: { publicId: body.opportunityId, factoryId: scope.factory.id } })
      : null;
    if (body.opportunityId && !opportunity) throw new DomainException('http.not_found');
    const salespersonId =
      body.salespersonId === undefined
        ? (current?.salespersonId ?? customer.salespersonId ?? scope.actor.userId)
        : body.salespersonId === null
          ? null
          : (await factoryUser(tx, scope.factory.id, body.salespersonId)).id;
    const settings = await this.workspace.settings(tx, scope.factory.id);
    const quoteDate = body.quoteDate ?? (current ? iso(current.quoteDate)! : today());
    const validUntil = body.validUntil ?? (current ? iso(current.validUntil)! : addDays(quoteDate, settings.quoteValidDays));
    if (validUntil < quoteDate)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'validUntil', code: 'invalid', message: 'On or after the quotation date' }],
      });
    const vatMode: ErpVatMode = vatModeFor(scope.factory, body.vatMode ?? current?.vatMode);
    const lines = await priceLines(tx, scope, body.lines);
    const totals = totalsOf(lines, vatMode, '7');
    return {
      customerId: customer.id,
      opportunityId: opportunity?.id ?? null,
      salespersonId,
      quoteDate: day(quoteDate),
      validUntil: day(validUntil),
      paymentTermDays: body.paymentTermDays ?? current?.paymentTermDays ?? customer.paymentTermDays,
      leadTimeDays: body.leadTimeDays === undefined ? (current?.leadTimeDays ?? null) : body.leadTimeDays,
      terms: body.terms === undefined ? (current?.terms ?? null) : body.terms,
      note: body.note === undefined ? (current?.note ?? null) : body.note,
      vatMode,
      vatRatePct: '7',
      ...totals,
      lines: {
        create: lines.map((l) => ({
          lineNo: l.lineNo,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          amount: l.amount,
        })),
      },
    };
  }
}

export function quoteSummary(
  r: Prisma.ErpQuotationGetPayload<{ include: { customer: true; salesperson: true } }>,
): ErpQuotationSummaryDto {
  return {
    id: r.publicId,
    quoteNo: r.quoteNo,
    revision: r.revision,
    status: r.status,
    customer: partnerRef(r.customer),
    salesperson: userRef(r.salesperson),
    quoteDate: iso(r.quoteDate)!,
    validUntil: iso(r.validUntil)!,
    total: fmtMoney(r.total),
    createdAt: isoTs(r.createdAt)!,
  };
}

function quoteDto(r: QuoteRow, revisions: ErpQuotation[], perms: ReadonlySet<string>): ErpQuotationDto {
  const expired = r.status === 'sent' && iso(r.validUntil)! < today();
  const order = r.salesOrders[0] ?? null;
  return {
    ...quoteSummary(r),
    opportunity: r.opportunity ? { id: r.opportunity.publicId, code: r.opportunity.title, name: r.opportunity.title } : null,
    paymentTermDays: r.paymentTermDays,
    leadTimeDays: r.leadTimeDays,
    terms: r.terms,
    note: r.note,
    vatMode: r.vatMode,
    vatRatePct: r.vatRatePct.toFixed(4),
    subtotal: fmtMoney(r.subtotal),
    vatAmount: fmtMoney(r.vatAmount),
    lines: r.lines.map((l) => salesLineDto(l, LINE.quote)),
    sentAt: isoTs(r.sentAt),
    linkActive: r.status === 'sent' && !!r.linkTokenHash && !expired,
    acceptedAt: isoTs(r.acceptedAt),
    acceptedName: r.acceptedName,
    acceptedPosition: r.acceptedPosition,
    acceptedVia: r.acceptedVia,
    customerPoNo: r.customerPoNo,
    rejectedAt: isoTs(r.rejectedAt),
    rejectReason: r.rejectReason,
    cancelReason: r.cancelReason,
    salesOrder: order ? { id: order.publicId, code: order.soNo, name: order.soNo } : null,
    revisions: revisions.map((v) => ({ id: v.publicId, revision: v.revision, status: v.status, total: fmtMoney(v.total) })),
    nextActions: nextActions({ status: r.status, expired, ordered: order !== null }, QUOTE_ACTIONS, perms),
    version: r.rowVersion,
  };
}
