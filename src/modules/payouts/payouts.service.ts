import { createHash } from 'node:crypto';

import { systemActor, type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type PayableItem, type PayoutKind, type Prisma, type WhtForm } from '@generated/prisma/client';
import {
  bankFileAdapter,
  BankFileError,
  type TransferConfirmation,
} from '@integrations/bank-files/bank-files';
import { PDF_RENDERER, type PdfRenderer } from '@integrations/pdf/pdf-renderer.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { CompanyBankAccountsService } from '@modules/banking/company-bank-accounts.service';
import { dateOnly, dayOf, isDay } from '@modules/ledger/ledger-dates';
import { TaxRatesReader, WHT_RATE_CODE } from '@modules/ledger/tax-rates.reader';
import { PurchasingService } from '@modules/payables/purchasing.service';
import { VendorInvoicesService } from '@modules/payables/vendor-invoices.service';
import { CustomerDocumentsService } from '@modules/receivables/customer-documents.service';
import { Inject, Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';
import { FilesService } from '@platform/files/files.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import { readObject } from './read-object';
import { renderWhtCertificateHtml } from './wht-certificate-render';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const round = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const POLICY = 'payout_run';
const DAY_MS = 86_400_000;
const KIND_OF: Record<string, PayoutKind> = {
  advance: 'advance',
  goods_receipt: 'balance',
  retention: 'retention_release',
  vendor_invoice: 'vendor_bill',
};

export const RUN_INCLUDE = {
  companyBankAccount: {
    select: { publicId: true, bankCode: true, accountNoLast4: true, glAccount: { select: { code: true } } },
  },
  approvalRequest: { select: { publicId: true, status: true } },
  bankFile: { select: { publicId: true } },
  items: {
    include: {
      vendor: { select: { publicId: true, legalName: true, kind: true } },
      vendorBankAccount: { select: { bankCode: true, accountNoLast4: true } },
      allocations: true,
    },
    orderBy: { id: 'asc' },
  },
} as const satisfies Prisma.PayoutRunInclude;
export type RunRow = Prisma.PayoutRunGetPayload<{ include: typeof RUN_INCLUDE }>;

/**
 * Factory and vendor payouts (accounting-design §6, D-022, D-093, D-164, D-166): a run selects the payables
 * eligible by the pay date — advances on acceptance, balances after POD and the claim window, released
 * retentions, vendor bills — groups them per vendor and kind, withholds tax at each payment (production 3 %,
 * transport 1 %, services 3 %, ⚖), holds the retention on balances; Finance proposes it, a C-Level other than
 * the proposer approves it (2 levels, SoD), the bank file is written by the adapter the run names, and the
 * bank's confirmation pays the items: PV numbers, postings (P14, P17, P18, P25P), 50 ทวิ, retention payables.
 * Failed transfers go back to the queue (exceptions).
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly accounts: CompanyBankAccountsService,
    private readonly invoices: VendorInvoicesService,
    private readonly purchasing: PurchasingService,
    private readonly rates: TaxRatesReader,
    private readonly approvals: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
    private readonly files: FilesService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly documents: CustomerDocumentsService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async get(publicId: string, db: Tx = this.prisma): Promise<RunRow> {
    const row = await db.payoutRun.findUnique({ where: { publicId }, include: RUN_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.payoutRun.findMany({
        include: RUN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.payoutRun.count(),
    ]);
    return { rows, total };
  }

  /** The eligible payables at a date (the proposal queue). */
  async eligible(payOn: string, db: Tx = this.prisma) {
    const end = new Date(Date.parse(`${payOn}T00:00:00+07:00`) + DAY_MS);
    return db.payableItem.findMany({
      where: {
        status: { in: ['open', 'eligible'] },
        eligibleAt: { lt: end },
        OR: [{ openNetAmount: { gt: 0 } }, { openVatAmount: { gt: 0 } }],
      },
      include: {
        vendor: true,
        purchaseOrder: { select: { poNumber: true } },
        order: { select: { orderCode: true } },
      },
      orderBy: [{ vendorId: 'asc' }, { eligibleAt: 'asc' }],
    });
  }

  async create(
    actor: UserActor,
    input: { companyBankAccountId: string; payOn: string; vendorIds?: string[]; bankFormat?: string },
  ): Promise<RunRow> {
    if (!isDay(input.payOn))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'payOn', code: 'date', message: 'YYYY-MM-DD' }],
      });
    const entityId = await this.entities.defaultEntityId();
    const id = await this.prisma.withTx(
      async (tx) => {
        const bank = await this.accounts.active(input.companyBankAccountId, tx);
        if (bank.purpose === 'collection') throw new DomainException('payouts.bank_account_missing');
        const format = input.bankFormat ?? bank.defaultBulkFormat;
        bankFileAdapter(format);
        let payables = await this.eligible(input.payOn, tx);
        if (input.vendorIds?.length)
          payables = payables.filter((p) => input.vendorIds!.includes(p.vendor.publicId));
        if (payables.length === 0) throw new DomainException('payouts.nothing_eligible');
        const run = await tx.payoutRun.create({
          data: {
            entityId,
            runNo: `PR${input.payOn.replaceAll('-', '')}-${Date.now().toString(36).toUpperCase()}`,
            companyBankAccountId: (
              await tx.companyBankAccount.findUniqueOrThrow({ where: { publicId: bank.publicId } })
            ).id,
            bankFormatAdapter: format,
            payOn: dateOnly(input.payOn),
            createdById: actor.userId,
          },
        });
        const at = new Date(`${input.payOn}T12:00:00+07:00`);
        const rates = {
          hire: (await this.rates.rate(WHT_RATE_CODE.hire_of_work, at, tx)).pct,
          transport: (await this.rates.rate(WHT_RATE_CODE.transport, at, tx)).pct,
          service: (await this.rates.rate(WHT_RATE_CODE.service, at, tx)).pct,
        };
        const groups = new Map<
          string,
          { vendorId: bigint; kind: PayoutKind; claimable: boolean; items: typeof payables }
        >();
        for (const p of payables) {
          const kind = KIND_OF[p.source]!;
          const claimable = kind === 'retention_release' ? false : await this.invoices.vatClaimable(tx, p);
          const key = `${p.vendorId}:${kind}:${claimable}`;
          const group = groups.get(key) ?? { vendorId: p.vendorId, kind, claimable, items: [] };
          group.items.push(p);
          groups.set(key, group);
        }
        for (const g of groups.values()) {
          const vendor = g.items[0]!.vendor;
          const bankAccount = await tx.vendorBankAccount.findFirst({
            where: { vendorId: vendor.id, status: 'active' },
          });
          const apNet = g.items.reduce((a, p) => a.add(p.openNetAmount.toString()), ZERO());
          const vat = g.items.reduce((a, p) => a.add(p.openVatAmount.toString()), ZERO());
          const form: WhtForm = vendor.juristicType === 'individual' ? 'pnd3' : 'pnd53';
          const whtBase =
            g.kind === 'retention_release'
              ? ZERO()
              : g.items.reduce(
                  (a, p) =>
                    a
                      .add(p.whtBaseHire.toString())
                      .add(p.whtBaseTransport.toString())
                      .add(p.whtBaseService.toString()),
                  ZERO(),
                );
          const wht =
            g.kind === 'retention_release'
              ? ZERO()
              : g.items.reduce(
                  (a, p) =>
                    a
                      .add(round(D(p.whtBaseHire).mul(rates.hire).div(100)))
                      .add(round(D(p.whtBaseTransport).mul(rates.transport).div(100)))
                      .add(round(D(p.whtBaseService).mul(rates.service).div(100))),
                  ZERO(),
                );
          const retention =
            g.kind === 'balance'
              ? g.items.reduce(
                  (a, p) =>
                    a.add(
                      round(
                        D(p.openNetAmount)
                          .add(p.openVatAmount.toString())
                          .mul(p.retentionPct.toString())
                          .div(100),
                      ),
                    ),
                  ZERO(),
                )
              : ZERO();
          const cash = apNet.add(vat).sub(wht).sub(retention);
          await tx.payoutItem.create({
            data: {
              runId: run.id,
              vendorId: vendor.id,
              vendorBankAccountId: bankAccount?.id ?? null,
              kind: g.kind,
              apNetAmount: formatMoney(apNet),
              vatAmount: formatMoney(vat),
              vatClaimable: g.claimable,
              whtAmount: formatMoney(wht),
              whtBase: formatMoney(whtBase),
              whtForm: wht.gt(0) ? form : null,
              retentionAmount: formatMoney(retention),
              cashAmount: formatMoney(cash),
              status: bankAccount ? 'included' : 'excluded',
              failureReason: bankAccount ? null : 'no active verified bank account',
              allocations: {
                create: g.items.map((p) => ({
                  payableItemId: p.id,
                  netAmount: p.openNetAmount,
                  vatAmount: p.openVatAmount,
                })),
              },
            },
          });
          if (bankAccount)
            await tx.payableItem.updateMany({
              where: { id: { in: g.items.map((p) => p.id) } },
              data: { status: 'in_run' },
            });
        }
        await this.totals(tx, run.id);
        await this.audit.record(tx, {
          category: 'finance',
          action: 'payout_run.create',
          actor,
          resourceType: 'payout_run',
          resourcePublicId: run.publicId,
          entityId,
          data: { payOn: input.payOn, format },
        });
        return run.publicId;
      },
      { timeout: 60_000 },
    );
    return this.get(id);
  }

  private async totals(tx: Tx, runId: bigint) {
    const items = await tx.payoutItem.findMany({ where: { runId, status: { in: ['included', 'paid'] } } });
    const sum = (f: (i: (typeof items)[number]) => { toString(): string }) =>
      formatMoney(items.reduce((a, i) => a.add(f(i).toString()), ZERO()));
    await tx.payoutRun.update({
      where: { id: runId },
      data: {
        apNetAmount: sum((i) => i.apNetAmount),
        vatAmount: sum((i) => i.vatAmount),
        whtAmount: sum((i) => i.whtAmount),
        retentionAmount: sum((i) => i.retentionAmount),
        cashAmount: sum((i) => i.cashAmount),
        rowVersion: { increment: 1 },
      },
    });
  }

  /** Finance proposes the run; an executive approves it (policy `payout_run`: C-Level, D-166). */
  async propose(actor: UserActor, publicId: string): Promise<RunRow> {
    await this.prisma.withTx(async (tx) => {
      const run = await this.lockRun(tx, publicId, ['draft']);
      if ((await tx.payoutItem.count({ where: { runId: run.id, status: 'included' } })) === 0)
        throw new DomainException('payouts.nothing_eligible');
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'payout_run', id: run.id, publicId: run.publicId },
        requester: actor,
        amount: run.cashAmount.toFixed(2),
        entityId: run.entityId,
        payload: {
          runNo: run.runNo,
          payOn: dayOf(run.payOn),
          cash: run.cashAmount.toFixed(2),
          wht: run.whtAmount.toFixed(2),
          retention: run.retentionAmount.toFixed(2),
        },
      });
      await tx.payoutRun.update({
        where: { id: run.id },
        data: {
          status: 'proposed',
          proposedById: actor.userId,
          proposedAt: new Date(),
          approvalRequestId: request.id,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'payout_run.propose',
        actor,
        resourceType: 'payout_run',
        resourcePublicId: run.publicId,
        entityId: run.entityId,
        data: { cash: run.cashAmount.toFixed(2) },
      });
    });
    return this.get(publicId);
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'payouts.approvals',
  })
  async onApproval(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    const run = request ? await tx.payoutRun.findUnique({ where: { id: request.subjectId } }) : null;
    if (!run || run.status !== 'proposed') return;
    if (event.type === 'approval.approved') {
      await tx.payoutRun.update({
        where: { id: run.id },
        data: { status: 'approved', approvedAt: new Date(), rowVersion: { increment: 1 } },
      });
    } else {
      await this.release(tx, run.id);
      await tx.payoutRun.update({
        where: { id: run.id },
        data: { status: 'rejected', rowVersion: { increment: 1 } },
      });
    }
    await this.events.record(tx, {
      type: event.type === 'approval.approved' ? 'payout_run.approved' : 'payout_run.rejected',
      aggregateType: 'payout_run',
      aggregateId: run.publicId,
      entityId: run.entityId,
      payload: { payoutRunId: run.publicId, runNo: run.runNo },
    });
  }

  /** Cancels a run not yet approved: its payables go back to the queue. */
  async cancel(actor: UserActor, publicId: string, reason: string): Promise<RunRow> {
    await this.prisma.withTx(async (tx) => {
      const run = await this.lockRun(tx, publicId, ['draft', 'proposed', 'approved']);
      if (run.approvalRequestId && run.status === 'proposed') {
        const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: run.approvalRequestId } });
        if (request.requesterUserId === actor.userId)
          await this.approvals.withdrawInTx(tx, actor, request.publicId, 'run cancelled');
      }
      await this.release(tx, run.id);
      await tx.payoutRun.update({
        where: { id: run.id },
        data: { status: 'cancelled', rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'payout_run.cancel',
        actor,
        resourceType: 'payout_run',
        resourcePublicId: run.publicId,
        entityId: run.entityId,
        data: { reason },
      });
      await this.events.record(
        tx,
        {
          type: 'payout_run.cancelled',
          aggregateType: 'payout_run',
          aggregateId: run.publicId,
          entityId: run.entityId,
          payload: { payoutRunId: run.publicId, runNo: run.runNo, reason },
        },
        actor,
      );
    });
    return this.get(publicId);
  }

  private async release(tx: Tx, runId: bigint) {
    const items = await tx.payoutItem.findMany({
      where: { runId, status: 'included' },
      include: { allocations: true },
    });
    await tx.payableItem.updateMany({
      where: {
        id: { in: items.flatMap((i) => i.allocations.map((a) => a.payableItemId)) },
        status: 'in_run',
      },
      data: { status: 'eligible' },
    });
    await tx.payoutItem.updateMany({
      where: { runId, status: 'included' },
      data: { status: 'excluded', failureReason: 'run not paid' },
    });
  }

  /** The bank bulk-transfer file of an approved run, by the run's adapter (D-093); audited as an export. */
  async bankFile(actor: UserActor, publicId: string): Promise<RunRow> {
    await this.prisma.withTx(async (tx) => {
      const run = await this.lockRun(tx, publicId, ['approved', 'file_generated']);
      const full = await tx.payoutRun.findUniqueOrThrow({
        where: { id: run.id },
        include: {
          companyBankAccount: true,
          items: { where: { status: 'included' }, include: { vendor: true, vendorBankAccount: true } },
        },
      });
      const adapter = bankFileAdapter(full.bankFormatAdapter);
      const file = adapter.transferFile(
        full.items.map((i) => ({
          reference: i.publicId,
          vendorName: i.vendor.legalName,
          bankCode: i.vendorBankAccount!.bankCode,
          accountNo: this.encryption.decrypt(Buffer.from(i.vendorBankAccount!.accountNoEnc)),
          accountName: i.vendorBankAccount!.accountName,
          amount: i.cashAmount.toFixed(2),
          payOn: dayOf(full.payOn),
        })),
        { runNo: full.runNo, debitAccountLast4: full.companyBankAccount.accountNoLast4 },
      );
      const stored = await this.files.storeSystem({
        body: file.body,
        fileName: file.fileName,
        mimeType: file.mimeType,
        retentionClass: 'financial_record',
        ownerUserId: actor.userId,
      });
      await tx.payoutRun.update({
        where: { id: run.id },
        data: {
          status: 'file_generated',
          bankFileId: stored.id,
          bankFileSha256: new Uint8Array(createHash('sha256').update(file.body).digest()),
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'export',
        action: 'payout_run.bank_file',
        actor,
        resourceType: 'payout_run',
        resourcePublicId: run.publicId,
        entityId: run.entityId,
        data: { format: full.bankFormatAdapter, items: full.items.length },
      });
    });
    return this.get(publicId);
  }

  async bankFileId(publicId: string): Promise<bigint | null> {
    return (await this.get(publicId)).bankFileId;
  }

  /**
   * The bank's confirmation: paid items get their PV number and post (P14 / P17 / P18 / P25P), withholding gets
   * its 50 ทวิ, balances open their retention payable (D-164), advances paid after the GR are applied (P16);
   * failed transfers go back to the queue.
   */
  async confirm(
    actor: UserActor,
    publicId: string,
    input: { confirmations?: TransferConfirmation[]; fileId?: string },
  ): Promise<RunRow> {
    let rows = input.confirmations ?? [];
    let confirmationFileId: bigint | null = null;
    if (input.fileId) {
      const file = await this.prisma.fileObject.findUnique({ where: { publicId: input.fileId } });
      if (!file) throw new DomainException('http.not_found');
      if (file.uploadStatus !== 'uploaded' || file.scanStatus === 'infected')
        throw new DomainException('file.not_ready');
      const run = await this.get(publicId);
      try {
        rows = bankFileAdapter(run.bankFormatAdapter).parseConfirmation(
          await readObject(this.storage, file.storageKey),
        );
      } catch (error) {
        if (error instanceof BankFileError)
          throw new DomainException('payouts.confirmation_mismatch', { params: { reason: error.message } });
        throw error;
      }
      confirmationFileId = file.id;
    }
    await this.prisma.withTx(
      async (tx) => {
        const run = await this.lockRun(tx, publicId, ['file_generated']);
        const full = await tx.payoutRun.findUniqueOrThrow({
          where: { id: run.id },
          include: {
            companyBankAccount: { include: { glAccount: true } },
            items: {
              where: { status: 'included' },
              include: {
                allocations: { include: { payableItem: true } },
                vendor: { include: { factory: true } },
              },
            },
          },
        });
        const byRef = new Map(rows.map((r) => [r.reference, r]));
        const unknown = rows.filter((r) => !full.items.some((i) => i.publicId === r.reference));
        if (unknown.length > 0 || full.items.some((i) => !byRef.has(i.publicId)))
          throw new DomainException('payouts.confirmation_mismatch', {
            params: {
              reason:
                unknown.length > 0
                  ? `unknown reference ${unknown[0]!.reference}`
                  : 'every item needs a result',
            },
          });
        const paidOn = dayOf(full.payOn);
        let failed = 0;
        for (const item of full.items) {
          const r = byRef.get(item.publicId)!;
          if (r.status === 'failed') {
            failed++;
            await tx.payoutItem.update({
              where: { id: item.id },
              data: { status: 'failed', failureReason: r.reason ?? 'rejected by the bank' },
            });
            await tx.payableItem.updateMany({
              where: { id: { in: item.allocations.map((a) => a.payableItemId) }, status: 'in_run' },
              data: { status: 'eligible' },
            });
            continue;
          }
          await this.pay(tx, full, item, r.bankRef, paidOn);
        }
        await tx.payoutRun.update({
          where: { id: run.id },
          data: {
            status: failed > 0 ? 'partially_failed' : 'confirmed',
            confirmedAt: new Date(),
            confirmationFileId,
            rowVersion: { increment: 1 },
          },
        });
        await this.totals(tx, run.id);
        await this.audit.record(tx, {
          category: 'finance',
          action: 'payout_run.confirm',
          actor,
          resourceType: 'payout_run',
          resourcePublicId: run.publicId,
          entityId: run.entityId,
          data: { failed, paid: full.items.length - failed },
        });
      },
      { timeout: 60_000 },
    );
    return this.get(publicId);
  }

  private async pay(
    tx: Tx,
    run: { entityId: bigint; companyBankAccount: { glAccount: { code: string } } },
    item: Prisma.PayoutItemGetPayload<{
      include: { allocations: { include: { payableItem: true } }; vendor: { include: { factory: true } } };
    }>,
    bankRef: string | null,
    paidOn: string,
  ) {
    const at = new Date(`${paidOn}T12:00:00+07:00`);
    const pvNumber = await this.numbering.next(tx, 'pv', at, run.entityId);
    await tx.payoutItem.update({
      where: { id: item.id },
      data: { status: 'paid', pvNumber, bankRef, paidOn: dateOnly(paidOn) },
    });
    const orders = new Set<bigint>();
    for (const a of item.allocations) {
      const p = a.payableItem;
      if (p.orderId) orders.add(p.orderId);
      const openNet = D(p.openNetAmount).sub(a.netAmount.toString());
      const openVat = D(p.openVatAmount).sub(a.vatAmount.toString());
      await tx.payableItem.update({
        where: { id: p.id },
        data: {
          openNetAmount: formatMoney(MoneyDecimal.max(openNet, 0)),
          openVatAmount: formatMoney(MoneyDecimal.max(openVat, 0)),
          status: 'paid',
          rowVersion: { increment: 1 },
        },
      });
      if (item.kind === 'balance') await this.openRetention(tx, p, a, at);
      if (item.kind === 'advance' && p.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: p.purchaseOrderId } });
        if ((await tx.goodsReceipt.count({ where: { poId: po.id } })) > 0)
          await this.purchasing.applyAdvance(tx, po, D(a.netAmount), at);
      }
    }
    let certificateNo: string | null = null;
    if (D(item.whtAmount).gt(0)) certificateNo = await this.issueCertificate(tx, run.entityId, item, paidOn);
    const order =
      orders.size === 1
        ? await tx.order.findUnique({ where: { id: [...orders][0]! }, include: { productType: true } })
        : null;
    await this.events.record(
      tx,
      {
        type: 'payout_item.paid',
        aggregateType: 'payout_item',
        aggregateId: item.publicId,
        entityId: run.entityId,
        payload: {
          payoutItemId: item.publicId,
          pvNumber,
          paidOn,
          kind: item.kind,
          vendorId: item.vendor.publicId,
          vendorKind: item.vendor.kind,
          factoryId: item.vendor.factory?.publicId ?? null,
          orderId: order?.publicId ?? null,
          productTypeId: order?.productType.publicId ?? null,
          apNet: item.apNetAmount.toFixed(2),
          vatAmount: item.vatAmount.toFixed(2),
          vatClaimable: item.vatClaimable,
          whtAmount: item.whtAmount.toFixed(2),
          whtBase: item.whtBase.toFixed(2),
          whtForm: item.whtForm,
          retentionAmount:
            item.kind === 'retention_release' ? item.apNetAmount.toFixed(2) : item.retentionAmount.toFixed(2),
          cashAmount: item.cashAmount.toFixed(2),
          bankAccountCode: run.companyBankAccount.glAccount.code,
          certificateNo,
          bankRef,
        },
      },
      systemActor('payouts'),
    );
  }

  /** The retention held on a balance is paid after the release period (D-164). */
  private async openRetention(
    tx: Tx,
    p: PayableItem,
    a: { netAmount: { toString(): string }; vatAmount: { toString(): string } },
    at: Date,
  ) {
    const amount = round(D(a.netAmount).add(a.vatAmount.toString()).mul(p.retentionPct.toString()).div(100));
    if (!amount.gt(0)) return;
    const po = p.purchaseOrderId
      ? await tx.purchaseOrder.findUnique({ where: { id: p.purchaseOrderId } })
      : null;
    const policy = (po?.payoutPolicy ?? {}) as { retentionReleaseDays?: number };
    const order = p.orderId ? await tx.order.findUnique({ where: { id: p.orderId } }) : null;
    const from = order?.claimWindowEndsAt ?? at;
    await tx.payableItem.create({
      data: {
        entityId: p.entityId,
        vendorId: p.vendorId,
        source: 'retention',
        purchaseOrderId: p.purchaseOrderId,
        goodsReceiptId: p.goodsReceiptId,
        orderId: p.orderId,
        netAmount: formatMoney(amount),
        vatAmount: '0.00',
        openNetAmount: formatMoney(amount),
        openVatAmount: '0.00',
        eligibleAt: new Date(from.getTime() + (policy.retentionReleaseDays ?? 0) * DAY_MS),
        status: 'open',
      },
    });
  }

  /** 50 ทวิ issued to the vendor for the tax withheld (WT series, §4), with its PDF. */
  private async issueCertificate(
    tx: Tx,
    entityId: bigint,
    item: Prisma.PayoutItemGetPayload<{
      include: { vendor: true; allocations: { include: { payableItem: true } } };
    }>,
    paidOn: string,
  ) {
    const at = new Date(`${paidOn}T12:00:00+07:00`);
    const wtNumber = await this.numbering.next(tx, 'wt', at, entityId);
    const bases = item.allocations.reduce(
      (a, x) => ({
        hire: a.hire.add(x.payableItem.whtBaseHire.toString()),
        transport: a.transport.add(x.payableItem.whtBaseTransport.toString()),
        service: a.service.add(x.payableItem.whtBaseService.toString()),
      }),
      { hire: ZERO(), transport: ZERO(), service: ZERO() },
    );
    const main =
      bases.hire.gte(bases.transport) && bases.hire.gte(bases.service)
        ? 'hire_of_work'
        : bases.transport.gte(bases.service)
          ? 'transport'
          : 'service';
    const rate = D(item.whtBase).isZero()
      ? ZERO()
      : D(item.whtAmount).mul(100).div(item.whtBase.toString()).toDecimalPlaces(4);
    const seller = await this.documents.seller(tx, entityId, at);
    const html = renderWhtCertificateHtml({
      wtNumber,
      paidOn,
      form: item.whtForm!,
      payer: { name: seller.legalNameTh ?? '', taxId: seller.taxId ?? '', address: seller.addressTh ?? '' },
      payee: { name: item.vendor.legalName, taxId: item.vendor.taxId, branchCode: item.vendor.branchCode },
      incomeTypeCode: main,
      paidAmount: item.whtBase.toFixed(2),
      whtAmount: item.whtAmount.toFixed(2),
    });
    const body = await this.renderer.render(html);
    const file = await this.files.storeSystem({
      body,
      fileName: `${wtNumber}.pdf`,
      mimeType: 'application/pdf',
      retentionClass: 'financial_record',
      ownerUserId: null,
      ownerFactoryId: (await tx.factory.findUnique({ where: { vendorId: item.vendorId } }))?.id ?? null,
    });
    await tx.whtCertificate.create({
      data: {
        entityId,
        wtNumber,
        vendorId: item.vendorId,
        payoutItemId: item.id,
        form: item.whtForm!,
        incomeTypeCode: main,
        paidOn: dateOnly(paidOn),
        paidAmount: item.whtBase,
        whtRatePct: rate.toFixed(4),
        whtAmount: item.whtAmount,
        fileObjectId: file.id,
      },
    });
    return wtNumber;
  }

  private async lockRun(tx: Tx, publicId: string, allowed: string[]) {
    const run = await tx.payoutRun.findUnique({ where: { publicId } });
    if (!run) throw new DomainException('http.not_found');
    await tx.$queryRaw`SELECT id FROM payout_runs WHERE id = ${run.id} FOR UPDATE`;
    const fresh = await tx.payoutRun.findUniqueOrThrow({ where: { id: run.id } });
    if (!allowed.includes(fresh.status))
      throw new DomainException('payouts.run_invalid_status', { params: { status: fresh.status } });
    return fresh;
  }

  /** Items of paid runs that failed, waiting to be paid again (the exceptions queue). */
  async exceptions() {
    return this.prisma.payoutItem.findMany({
      where: {
        status: { in: ['failed', 'excluded'] },
        run: {
          status: {
            in: ['partially_failed', 'confirmed', 'file_generated', 'approved', 'draft', 'proposed'],
          },
        },
      },
      include: {
        vendor: { select: { publicId: true, legalName: true } },
        run: { select: { publicId: true, runNo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** What a factory was paid (partner payout statement). */
  async statementOf(vendorId: bigint, from?: string, to?: string) {
    return this.prisma.payoutItem.findMany({
      where: {
        vendorId,
        status: 'paid',
        ...((from || to) && {
          paidOn: { ...(from && { gte: dateOnly(from) }), ...(to && { lte: dateOnly(to) }) },
        }),
      },
      include: { whtCertificates: true, vendorBankAccount: { select: { accountNoLast4: true } } },
      orderBy: { paidOn: 'desc' },
      take: 500,
    });
  }

  /** A 50 ทวิ of a vendor (partner download: the vendor must be the actor's factory's). */
  async certificate(publicId: string, vendorId: bigint | null) {
    const cert = await this.prisma.whtCertificate.findUnique({ where: { publicId } });
    if (!cert || (vendorId !== null && cert.vendorId !== vendorId))
      throw new DomainException('http.not_found');
    return cert;
  }

  static today = () => bangkokDate(new Date());
}
