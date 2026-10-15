import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type JuristicType, type Prisma, type VendorKind, type WhtCategory } from '@generated/prisma/client';
import { sodPartyKey, SodService } from '@modules/iam/sod.service';
import { dateOnly, isDay } from '@common/ledger-core/dates';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);

export const INVOICE_INCLUDE = {
  vendor: { select: { publicId: true, legalName: true, kind: true } },
  billingStatement: { select: { publicId: true, bsNumber: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true } } } },
  file: { select: { publicId: true } },
} as const satisfies Prisma.VendorInvoiceInclude;
export type InvoiceRow = Prisma.VendorInvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

export interface FactoryInvoiceInput {
  vendorInvoiceNo: string;
  invoiceDate: string;
  sellerTaxId: string;
  sellerBranchCode: string;
  netAmount: string;
  vatAmount: string;
  source: 'e_tax' | 'pdf_upload';
  fileId?: string | null;
}

export interface VendorBillInput {
  vendorInvoiceNo: string;
  invoiceDate: string;
  isTaxInvoice: boolean;
  lines: {
    description: string;
    accountCode: string;
    netAmount: string;
    vatAmount: string;
    whtCategory: WhtCategory;
  }[];
  orderId?: string | null;
  shipmentId?: string | null;
  fileId?: string | null;
}

export interface VendorInput {
  kind: Exclude<VendorKind, 'factory'>;
  legalName: string;
  juristicType: JuristicType;
  taxId: string;
  branchCode?: string;
  isVatRegistered: boolean;
  defaultWhtCategory: WhtCategory;
  paymentTermsDays: number;
}

/**
 * Supplier documents (accounting-design §2, §6, D-090): a factory's own tax invoice captured against the
 * billing statement Packio generated (e-Tax or uploaded PDF + number, date, seller tax id and branch) and
 * validated by Finance — input VAT only with a valid document; VAT paid before it stayed pending and moves
 * now (P17V) — and the bills of other vendors (fallback carriers, freelance designers, services: P25, P26),
 * recorded under the SoD rule that the recorder cannot change that vendor's bank account (§8).
 */
@Injectable()
export class VendorInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly sod: SodService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // --- other vendors --------------------------------------------------------------------------------------

  async createVendor(actor: UserActor, input: VendorInput) {
    return this.prisma.withTx(async (tx) => {
      const vendor = await tx.vendor.create({
        data: {
          kind: input.kind,
          legalName: input.legalName,
          juristicType: input.juristicType,
          taxId: input.taxId,
          branchCode: input.branchCode ?? '00000',
          isVatRegistered: input.isVatRegistered,
          defaultWhtCategory: input.defaultWhtCategory,
          paymentTermsDays: input.paymentTermsDays,
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'vendor.created',
        actor,
        resourceType: 'vendor',
        resourcePublicId: vendor.publicId,
        data: { kind: input.kind, legalName: input.legalName },
      });
      return vendor;
    });
  }

  async vendors(kind?: VendorKind) {
    return this.prisma.vendor.findMany({
      where: kind ? { kind } : {},
      orderBy: { legalName: 'asc' },
      take: 500,
    });
  }

  async recordBill(actor: UserActor, vendorPublicId: string, input: VendorBillInput): Promise<InvoiceRow> {
    if (!isDay(input.invoiceDate))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'invoiceDate', code: 'date', message: 'YYYY-MM-DD' }],
      });
    const entityId = await this.entities.defaultEntityId();
    const id = await this.prisma.withTx((tx) =>
      this.recordBillIn(tx, actor, vendorPublicId, input, entityId),
    );
    return this.get(id);
  }

  /**
   * The bill inside the caller's transaction (a sales agent statement becomes its vendor's bill on approval,
   * D-420). Returns the bill's public id.
   */
  async recordBillIn(
    tx: Tx,
    actor: UserActor,
    vendorPublicId: string,
    input: VendorBillInput,
    entityId: bigint,
  ): Promise<string> {
    if (!isDay(input.invoiceDate))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'invoiceDate', code: 'date', message: 'YYYY-MM-DD' }],
      });
    {
      const vendor = await tx.vendor.findUnique({ where: { publicId: vendorPublicId } });
      if (!vendor || vendor.kind === 'factory') throw new DomainException('http.not_found');
      if (
        await tx.vendorInvoice.findUnique({
          where: {
            vendorId_vendorInvoiceNo: { vendorId: vendor.id, vendorInvoiceNo: input.vendorInvoiceNo },
          },
        })
      )
        throw new DomainException('payables.invoice_duplicate', {
          params: { number: input.vendorInvoiceNo },
        });
      const accounts = new Map(
        (
          await tx.account.findMany({
            where: { entityId, code: { in: input.lines.map((l) => l.accountCode) } },
          })
        ).map((a) => [a.code, a]),
      );
      for (const l of input.lines) {
        const a = accounts.get(l.accountCode);
        if (
          !a ||
          !a.isPostable ||
          a.isControl ||
          a.status !== 'active' ||
          !['expense', 'cost_of_sales', 'asset'].includes(a.accountType)
        )
          throw new DomainException('ledger.account_invalid', {
            params: { code: l.accountCode, reason: 'an active postable expense, cost or asset account' },
          });
      }
      const net = input.lines.reduce((a, l) => a.add(l.netAmount), ZERO());
      const vat = input.lines.reduce((a, l) => a.add(l.vatAmount), ZERO());
      const claimable = input.isTaxInvoice && vendor.isVatRegistered && vat.gt(0);
      const order = input.orderId ? await tx.order.findUnique({ where: { publicId: input.orderId } }) : null;
      const shipment = input.shipmentId
        ? await tx.shipment.findUnique({ where: { publicId: input.shipmentId } })
        : null;
      const file = input.fileId
        ? await tx.fileObject.findUnique({ where: { publicId: input.fileId } })
        : null;
      const invoice = await tx.vendorInvoice.create({
        data: {
          entityId,
          vendorId: vendor.id,
          vendorInvoiceNo: input.vendorInvoiceNo,
          invoiceDate: dateOnly(input.invoiceDate),
          sellerTaxId: vendor.taxId,
          sellerBranchCode: vendor.branchCode,
          isTaxInvoice: input.isTaxInvoice,
          source: file ? 'pdf_upload' : 'manual',
          fileObjectId: file?.id ?? null,
          netAmount: formatMoney(net),
          vatAmount: formatMoney(vat),
          grossAmount: formatMoney(net.add(vat)),
          inputVatStatus: claimable ? 'claimable' : vat.gt(0) ? 'pending_document' : 'not_claimable',
          status: 'validated',
          validatedById: actor.userId,
          validatedAt: new Date(),
          dueDate: dateOnly(addCalendarDays(input.invoiceDate, vendor.paymentTermsDays)),
          orderId: order?.id ?? null,
          shipmentId: shipment?.id ?? null,
          recordedById: actor.userId,
          lines: {
            create: input.lines.map((l, i) => ({
              lineNo: i + 1,
              description: l.description,
              netAmount: formatMoney(l.netAmount),
              vatAmount: formatMoney(l.vatAmount),
              grossAmount: formatMoney(D(l.netAmount).add(l.vatAmount)),
              whtCategory: l.whtCategory,
              accountId: accounts.get(l.accountCode)!.id,
            })),
          },
        },
      });
      const base = (c: WhtCategory) =>
        input.lines.filter((l) => l.whtCategory === c).reduce((a, l) => a.add(l.netAmount), ZERO());
      await tx.payableItem.create({
        data: {
          entityId,
          vendorId: vendor.id,
          source: 'vendor_invoice',
          vendorInvoiceId: invoice.id,
          orderId: order?.id ?? null,
          netAmount: formatMoney(net),
          vatAmount: formatMoney(vat),
          openNetAmount: formatMoney(net),
          openVatAmount: formatMoney(vat),
          whtBaseHire: formatMoney(base('hire_of_work')),
          whtBaseTransport: formatMoney(base('transport')),
          whtBaseService: formatMoney(base('service')),
          whtBaseCommission: formatMoney(base('commission')),
          eligibleAt: dateOnly(addCalendarDays(input.invoiceDate, vendor.paymentTermsDays)),
          status: 'eligible',
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'vendor_invoice.record',
        actor,
        resourceType: 'vendor_invoice',
        resourcePublicId: invoice.publicId,
        entityId,
        data: {
          sodParty: sodPartyKey({ kind: 'vendor', publicId: vendor.publicId }),
          invoiceNo: input.vendorInvoiceNo,
          gross: formatMoney(net.add(vat)),
        },
      });
      await this.events.record(
        tx,
        {
          type: 'vendor_invoice.recorded',
          aggregateType: 'vendor_invoice',
          aggregateId: invoice.publicId,
          entityId,
          payload: {
            vendorInvoiceId: invoice.publicId,
            vendorInvoiceNo: input.vendorInvoiceNo,
            invoiceDate: input.invoiceDate,
            vendorId: vendor.publicId,
            vendorKind: vendor.kind,
            orderId: order?.publicId ?? null,
            lines: input.lines.map((l) => ({
              accountCode: l.accountCode,
              net: formatMoney(l.netAmount),
              whtCategory: l.whtCategory,
            })),
            netAmount: formatMoney(net),
            vatAmount: formatMoney(vat),
            grossAmount: formatMoney(net.add(vat)),
            vatClaimable: claimable,
          },
        },
        actor,
      );
      return invoice.publicId;
    }
  }

  // --- factory tax invoices (D-090) --------------------------------------------------------------------------

  /** The factory confirms or disputes the billing statement Packio generated. */
  async decideStatement(
    actor: UserActor,
    statementPublicId: string,
    factoryId: bigint | null,
    decision: { confirm: boolean; note?: string; lineNos?: number[] },
  ) {
    return this.prisma.withTx(async (tx) => {
      const statement = await tx.billingStatement.findUnique({
        where: { publicId: statementPublicId },
        include: { lines: { select: { lineNo: true } } },
      });
      if (!statement || (factoryId !== null && statement.factoryId !== factoryId))
        throw new DomainException('http.not_found');
      if (!['generated', 'sent', 'disputed'].includes(statement.status))
        throw new DomainException('payables.statement_not_confirmable', {
          params: { status: statement.status },
        });
      if (!decision.confirm && !decision.note?.trim())
        throw new DomainException('validation.failed', {
          errors: [{ path: 'note', code: 'required', message: 'a dispute needs a note' }],
        });
      const lineNos = [...new Set(decision.lineNos ?? [])].sort((a, b) => a - b);
      const unknown = lineNos.filter((n) => !statement.lines.some((l) => l.lineNo === n));
      if (unknown.length)
        throw new DomainException('validation.failed', {
          errors: [
            { path: 'lineNos', code: 'unknown_line', message: `not on the statement: ${unknown.join(', ')}` },
          ],
        });
      const updated = await tx.billingStatement.update({
        where: { id: statement.id },
        data: decision.confirm
          ? {
              status: 'confirmed',
              confirmedAt: new Date(),
              confirmedByUserId: actor.userId,
              rowVersion: { increment: 1 },
            }
          : {
              status: 'disputed',
              disputeNote: decision.note!,
              disputedLineNos: lineNos,
              rowVersion: { increment: 1 },
            },
      });
      await this.events.record(
        tx,
        {
          type: decision.confirm ? 'billing_statement.confirmed' : 'billing_statement.disputed',
          aggregateType: 'billing_statement',
          aggregateId: statement.publicId,
          entityId: statement.entityId,
          payload: {
            billingStatementId: statement.publicId,
            bsNumber: statement.bsNumber,
            note: decision.note ?? null,
            ...(!decision.confirm && { lineNos }),
          },
        },
        actor,
      );
      return updated;
    });
  }

  /** The factory's own tax invoice for a statement (its number, its name — Packio never issues it, §2). */
  async captureFactoryInvoice(
    actor: UserActor,
    statementPublicId: string,
    factoryId: bigint | null,
    input: FactoryInvoiceInput,
  ): Promise<InvoiceRow> {
    if (!isDay(input.invoiceDate))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'invoiceDate', code: 'date', message: 'YYYY-MM-DD' }],
      });
    const id = await this.prisma.withTx(async (tx) => {
      const statement = await tx.billingStatement.findUnique({
        where: { publicId: statementPublicId },
        include: { factory: true },
      });
      if (!statement || (factoryId !== null && statement.factoryId !== factoryId))
        throw new DomainException('http.not_found');
      if (
        await tx.vendorInvoice.findUnique({
          where: {
            vendorId_vendorInvoiceNo: {
              vendorId: statement.vendorId,
              vendorInvoiceNo: input.vendorInvoiceNo,
            },
          },
        })
      )
        throw new DomainException('payables.invoice_duplicate', {
          params: { number: input.vendorInvoiceNo },
        });
      const file = input.fileId
        ? await tx.fileObject.findUnique({ where: { publicId: input.fileId } })
        : null;
      if (input.fileId && (!file || file.uploadStatus !== 'uploaded' || file.scanStatus === 'infected'))
        throw new DomainException('file.not_ready');
      if (file)
        await tx.fileObject.update({ where: { id: file.id }, data: { retentionClass: 'financial_record' } });
      const net = D(input.netAmount);
      const vat = D(input.vatAmount);
      const invoice = await tx.vendorInvoice.create({
        data: {
          entityId: statement.entityId,
          vendorId: statement.vendorId,
          billingStatementId: statement.id,
          vendorInvoiceNo: input.vendorInvoiceNo,
          invoiceDate: dateOnly(input.invoiceDate),
          sellerTaxId: input.sellerTaxId,
          sellerBranchCode: input.sellerBranchCode,
          isTaxInvoice: statement.factory.isVatRegistered,
          source: input.source,
          fileObjectId: file?.id ?? null,
          netAmount: formatMoney(net),
          vatAmount: formatMoney(vat),
          grossAmount: formatMoney(net.add(vat)),
          inputVatStatus: vat.gt(0) ? 'pending_document' : 'not_claimable',
          status: 'recorded',
          recordedById: actor.userId,
        },
      });
      await this.events.record(
        tx,
        {
          type: 'vendor_invoice.captured',
          aggregateType: 'vendor_invoice',
          aggregateId: invoice.publicId,
          entityId: invoice.entityId,
          payload: {
            vendorInvoiceId: invoice.publicId,
            billingStatementId: statement.publicId,
            vendorInvoiceNo: input.vendorInvoiceNo,
          },
        },
        actor,
      );
      return invoice.publicId;
    });
    return this.get(id);
  }

  /**
   * Finance validates the factory's tax invoice against the statement: the seller is the factory (tax id and
   * branch), the amounts are the statement's. A valid invoice makes the input VAT claimable (§2): VAT already
   * paid with advances or payouts moves from pending to input VAT (P17V); later payouts claim it at once.
   */
  async validateFactoryInvoice(
    actor: UserActor,
    publicId: string,
    decision: { valid: boolean; reason?: string },
  ): Promise<InvoiceRow> {
    await this.prisma.withTx(async (tx) => {
      const invoice = await tx.vendorInvoice.findUnique({
        where: { publicId },
        include: { billingStatement: { include: { factory: { include: { vendor: true } }, lines: true } } },
      });
      if (!invoice?.billingStatement) throw new DomainException('http.not_found');
      if (invoice.status !== 'recorded')
        throw new DomainException('payables.invoice_mismatch', {
          params: { reason: `the invoice is ${invoice.status}` },
        });
      const statement = invoice.billingStatement;
      if (!decision.valid) {
        await tx.vendorInvoice.update({
          where: { id: invoice.id },
          data: {
            status: 'rejected',
            rejectionReason: decision.reason ?? 'rejected',
            validatedById: actor.userId,
            validatedAt: new Date(),
          },
        });
        return;
      }
      const factory = statement.factory;
      const problems = [
        invoice.sellerTaxId !== factory.taxId && 'seller tax id is not the factory’s',
        invoice.sellerBranchCode !== factory.branchCode && 'seller branch is not the factory’s',
        !D(invoice.netAmount).eq(statement.netAmount.toString()) &&
          `net ${invoice.netAmount.toFixed(2)} ≠ statement ${statement.netAmount.toFixed(2)}`,
        !D(invoice.vatAmount).eq(statement.vatAmount.toString()) &&
          `VAT ${invoice.vatAmount.toFixed(2)} ≠ statement ${statement.vatAmount.toFixed(2)}`,
      ].filter(Boolean) as string[];
      if (problems.length > 0)
        throw new DomainException('payables.invoice_mismatch', { params: { reason: problems.join('; ') } });
      if (
        (await tx.vendorInvoice.count({ where: { billingStatementId: statement.id, status: 'validated' } })) >
        0
      )
        throw new DomainException('payables.invoice_duplicate', {
          params: { number: 'a validated invoice already covers this statement' },
        });
      await tx.vendorInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'validated',
          inputVatStatus: invoice.isTaxInvoice && D(invoice.vatAmount).gt(0) ? 'claimable' : 'not_claimable',
          validatedById: actor.userId,
          validatedAt: new Date(),
        },
      });
      // VAT paid for these POs while the document was missing (pending in 1242) is now claimable.
      const grIds = [
        ...new Set(statement.lines.map((l) => l.goodsReceiptId).filter((x): x is bigint => x !== null)),
      ];
      const pos = (
        await tx.goodsReceipt.findMany({ where: { id: { in: grIds } }, select: { poId: true } })
      ).map((g) => g.poId);
      const parked = await tx.payoutItemAllocation.findMany({
        where: {
          payableItem: { purchaseOrderId: { in: pos } },
          payoutItem: { status: 'paid', vatClaimable: false },
        },
      });
      const vat = parked.reduce((a, p) => a.add(p.vatAmount.toString()), ZERO());
      const base = parked.reduce((a, p) => a.add(p.netAmount.toString()), ZERO());
      await this.audit.record(tx, {
        category: 'finance',
        action: 'vendor_invoice.validated',
        actor,
        resourceType: 'vendor_invoice',
        resourcePublicId: invoice.publicId,
        entityId: invoice.entityId,
        data: { vendorInvoiceNo: invoice.vendorInvoiceNo, pendingVatClaimed: formatMoney(vat) },
      });
      await this.events.record(
        tx,
        {
          type: 'vendor_invoice.validated',
          aggregateType: 'vendor_invoice',
          aggregateId: invoice.publicId,
          entityId: invoice.entityId,
          payload: {
            vendorInvoiceId: invoice.publicId,
            vendorInvoiceNo: invoice.vendorInvoiceNo,
            invoiceDate: bangkokDate(invoice.invoiceDate),
            vendorId: factory.vendor.publicId,
            factoryId: factory.publicId,
            pendingVatToClaim: formatMoney(vat),
            pendingVatBase: formatMoney(base),
          },
        },
        actor,
      );
    });
    return this.get(publicId);
  }

  /** Whether the payable's PO has a validated, claimable tax invoice (for payouts: 1241 or 1242). */
  async vatClaimable(
    tx: Tx,
    payable: { purchaseOrderId: bigint | null; vendorInvoiceId: bigint | null },
  ): Promise<boolean> {
    if (payable.vendorInvoiceId) {
      const inv = await tx.vendorInvoice.findUnique({ where: { id: payable.vendorInvoiceId } });
      return inv?.inputVatStatus === 'claimable';
    }
    if (!payable.purchaseOrderId) return false;
    const found = await tx.vendorInvoice.count({
      where: {
        inputVatStatus: 'claimable',
        status: 'validated',
        billingStatement: { lines: { some: { goodsReceipt: { poId: payable.purchaseOrderId } } } },
      },
    });
    return found > 0;
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<InvoiceRow> {
    const row = await db.vendorInvoice.findUnique({ where: { publicId }, include: INVOICE_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.VendorInvoiceWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.vendorInvoice.findMany({
        where,
        include: INVOICE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.vendorInvoice.count({ where }),
    ]);
    return { rows, total };
  }

  /** SoD (§8): whoever recorded a bill of the vendor cannot change its bank account. */
  async assertMayChangeBankAccount(tx: Tx, actor: Actor, vendorPublicId: string, subjectPublicId: string) {
    if (actor.type !== 'user') return;
    await this.sod.checkAction(tx, {
      actorUserId: actor.userId,
      action: 'vendor_bank_account.change',
      subject: { type: 'vendor_bank_account', publicId: subjectPublicId },
      party: { kind: 'vendor', publicId: vendorPublicId },
    });
  }
}
