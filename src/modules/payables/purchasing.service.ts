import { systemActor } from '@common/context/actor';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type Prisma, type PurchaseOrder } from '@generated/prisma/client';
import { dateOnly } from '@common/ledger-core/dates';
import { TaxRatesReader } from '@modules/ledger/tax-rates.reader';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const round = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const ACTOR = systemActor('payables');
const DAY_MS = 86_400_000;

/** The payout policy a PO keeps (D-022, D-164): the factory's approved version, else the platform defaults. */
export interface PolicySnapshot {
  advancePct: string;
  advanceTrigger: string;
  balanceTrigger: string;
  claimWindowDays: number;
  retentionPct: string;
  retentionReleaseDays: number;
  paymentTermsDays: number;
  source: 'factory' | 'platform';
}

/**
 * Supplier side of an order (accounting-design §6, D-022, D-090, D-165): the factory PO from the job release
 * with the buy-price snapshot (P13 / P24 memo), the advance when the factory accepts, the GR from POD and the
 * reported quantity with the shipping payouts (P15) and the advance applied (P16), the balance payable with
 * its retention after POD and the claim window, a billing statement generated for the factory to confirm, and
 * claim deductions / carrier recoveries (P20, P21).
 */
@Injectable()
export class PurchasingService {
  private readonly logger = new Logger(PurchasingService.name);

  constructor(
    private readonly numbering: DocumentNumberingService,
    private readonly settings: SettingsService,
    private readonly rates: TaxRatesReader,
    private readonly events: DomainEvents,
  ) {}

  async policy(
    tx: Tx,
    factoryId: bigint,
    at: Date,
  ): Promise<{ versionId: bigint | null; snapshot: PolicySnapshot }> {
    const version = await tx.factoryPayoutPolicyVersion.findFirst({
      where: { policy: { factoryId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    if (version)
      return {
        versionId: version.id,
        snapshot: {
          advancePct: version.advancePct.toString(),
          advanceTrigger: version.advanceTrigger,
          balanceTrigger: version.balanceTrigger,
          claimWindowDays: version.claimWindowDays,
          retentionPct: version.retentionPct.toString(),
          retentionReleaseDays: version.retentionReleaseDays,
          paymentTermsDays: version.paymentTermsDays,
          source: 'factory',
        },
      };
    const value = async <T>(key: string) => (await this.settings.at<T>(key, { at, tx })).value;
    return {
      versionId: null,
      snapshot: {
        advancePct: String(await value('payouts.advance_pct')),
        advanceTrigger: 'job_accepted',
        balanceTrigger: String(await value('payouts.balance_trigger')),
        claimWindowDays: Number(await value('claims.window_days')),
        retentionPct: String(await value('payouts.retention_pct')),
        retentionReleaseDays: Number(await value('payouts.retention_release_days')),
        paymentTermsDays: 0,
        source: 'platform',
      },
    };
  }

  // --- PO at release (P13 / P24) -------------------------------------------------------------------------

  @OnDomainEvent('production_job.released', { consumer: 'payables.purchase_orders' })
  async onReleased(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const job = await tx.productionJob.findUnique({
      where: { publicId: event.aggregateId },
      include: { factory: true, order: { include: { productType: true } } },
    });
    if (!job || (await tx.purchaseOrder.count({ where: { productionJobId: job.id } })) > 0) return;
    const at = new Date(event.occurredAt);
    const snapshot = job.buyPriceSnapshot as { priced?: boolean; buyCostNet?: string | null };
    const net = snapshot.priced && snapshot.buyCostNet ? D(snapshot.buyCostNet) : ZERO();
    const vatPct = job.factory.isVatRegistered ? (await this.rates.rate('vat_standard', at, tx)).pct : ZERO();
    const vat = round(net.mul(vatPct).div(100));
    const { versionId, snapshot: policy } = await this.policy(tx, job.factoryId, at);
    const kind = job.jobKind;
    const qty = job.quantityOrdered;
    const po = await tx.purchaseOrder.create({
      data: {
        entityId: job.entityId,
        poNumber: await this.numbering.next(tx, 'po', at, job.entityId),
        poKind: kind,
        vendorId: job.factory.vendorId,
        factoryId: job.factoryId,
        productionJobId: job.id,
        orderId: job.orderId,
        priceListVersionId: job.priceListVersionId,
        priceSnapshot: job.buyPriceSnapshot as Prisma.InputJsonValue,
        payoutPolicyVersionId: versionId,
        payoutPolicy: policy as unknown as Prisma.InputJsonValue,
        isVatRegistered: job.factory.isVatRegistered,
        netAmount: formatMoney(net),
        vatRatePct: vatPct.toFixed(4),
        vatAmount: formatMoney(vat),
        grossAmount: formatMoney(net.add(vat)),
        lines: {
          create: [
            {
              lineNo: 1,
              lineType: kind === 'production' ? 'production' : kind,
              description: `${job.order.productType.nameTh} — ${job.jobNo}`,
              quantity: qty,
              unitPrice: qty > 0 ? net.div(qty).toFixed(6) : '0',
              netAmount: formatMoney(net),
              vatAmount: formatMoney(vat),
              grossAmount: formatMoney(net.add(vat)),
              whtCategory: 'hire_of_work',
            },
          ],
        },
      },
    });
    await this.publish(tx, po, 'purchase_order.issued', {
      poKind: kind,
      jobNo: job.jobNo,
      priced: snapshot.priced === true,
    });
    if (policy.advanceTrigger === 'immediate') await this.openAdvance(tx, po, at);
  }

  @OnDomainEvent(['production_job.accepted', 'production_job.rejected', 'production_job.reassigned'], {
    consumer: 'payables.po_status',
  })
  async onJobDecision(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const job = await tx.productionJob.findUnique({ where: { publicId: event.aggregateId } });
    const po = job ? await tx.purchaseOrder.findUnique({ where: { productionJobId: job.id } }) : null;
    if (!po || po.status !== 'issued') return;
    if (event.type !== 'production_job.accepted') {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'cancelled' } });
      await tx.payableItem.updateMany({
        where: { purchaseOrderId: po.id, status: { in: ['open', 'eligible'] } },
        data: { status: 'cancelled' },
      });
      await this.publish(tx, po, 'purchase_order.cancelled', { reason: event.type });
      return;
    }
    const at = new Date(event.occurredAt);
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'accepted', acceptedAt: at } });
    if ((po.payoutPolicy as unknown as PolicySnapshot).advanceTrigger === 'job_accepted')
      await this.openAdvance(tx, po, at);
  }

  /** The advance (30 % default) payable on acceptance, WHT on its production base (P14). */
  private async openAdvance(tx: Tx, po: PurchaseOrder, at: Date) {
    const policy = po.payoutPolicy as unknown as PolicySnapshot;
    const pct = D(policy.advancePct);
    if (!pct.gt(0) || !D(po.netAmount).gt(0) || po.poKind === 'mockup') return;
    if ((await tx.payableItem.count({ where: { purchaseOrderId: po.id, source: 'advance' } })) > 0) return;
    const net = round(D(po.netAmount).mul(pct).div(100));
    const vat = round(D(po.vatAmount).mul(pct).div(100));
    await tx.payableItem.create({
      data: {
        entityId: po.entityId,
        vendorId: po.vendorId,
        source: 'advance',
        purchaseOrderId: po.id,
        orderId: po.orderId,
        netAmount: formatMoney(net),
        vatAmount: formatMoney(vat),
        openNetAmount: formatMoney(net),
        openVatAmount: formatMoney(vat),
        whtBaseHire: formatMoney(net),
        eligibleAt: new Date(at.getTime() + policy.paymentTermsDays * DAY_MS),
        status: 'eligible',
      },
    });
  }

  // --- GR from POD + reported quantity (P15, P16) ------------------------------------------------------------

  @OnDomainEvent('delivery.reconciled', { consumer: 'payables.goods_receipts' })
  async onReconciled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({
      where: { publicId: String(event.payload['orderId']) },
      include: { productType: true },
    });
    if (!order) return;
    const po = await tx.purchaseOrder.findFirst({
      where: { orderId: order.id, poKind: 'production', status: { in: ['issued', 'accepted'] } },
      include: { lines: true, productionJob: true },
    });
    if (!po || (await tx.goodsReceipt.count({ where: { poId: po.id } })) > 0) return;
    const received = Number(event.payload['deliveredQuantity'] ?? 0);
    const payable = Number(event.payload['payableQuantity'] ?? Math.min(received, order.quantityOrdered));
    const at = new Date(event.occurredAt);
    const production = po.lines.find((l) => l.lineType === 'production');
    const unit = production ? D(production.unitPrice) : ZERO();
    const productionNet = MoneyDecimal.min(round(unit.mul(payable)), D(po.netAmount));
    const vatPct = D(po.vatRatePct);
    const shipments = await tx.shipment.findMany({
      where: {
        items: { some: { productionJobId: po.productionJobId } },
        status: 'delivered',
        payoutAmount: { not: null },
        carrier: { code: 'factory_fleet' },
      },
      orderBy: { id: 'asc' },
    });
    const lines: Prisma.GoodsReceiptLineUncheckedCreateWithoutGrInput[] = [];
    const vatOf = (net: MoneyValue) => round(net.mul(vatPct).div(100));
    lines.push({
      lineNo: 1,
      lineType: 'production',
      description: production?.description ?? 'production',
      quantity: payable,
      unitPrice: unit.toFixed(6),
      netAmount: formatMoney(productionNet),
      vatAmount: formatMoney(vatOf(productionNet)),
      grossAmount: formatMoney(productionNet.add(vatOf(productionNet))),
      whtCategory: 'hire_of_work',
    });
    let shippingNet = ZERO();
    shipments.forEach((s, i) => {
      const net = D(s.payoutAmount!);
      shippingNet = shippingNet.add(net);
      lines.push({
        lineNo: i + 2,
        lineType: 'shipping',
        description: `ค่าขนส่ง ${s.shipmentNo}`,
        quantity: 1,
        unitPrice: net.toFixed(6),
        netAmount: formatMoney(net),
        vatAmount: formatMoney(vatOf(net)),
        grossAmount: formatMoney(net.add(vatOf(net))),
        whtCategory: 'transport',
        shipmentId: s.id,
      });
    });
    // D-205: a reused tool the factory found unusable was remade at Packio's cost (the PO keeps its snapshot): it is
    // received in full with the goods; the customer price is unchanged (D-012).
    let toolingNet = ZERO();
    const remakes = await tx.toolingRemake.findMany({
      where: { productionJobId: po.productionJobId },
      include: { tooling: { select: { kind: true } } },
      orderBy: { id: 'asc' },
    });
    for (const r of remakes) {
      const tNet = D(r.buyNetAmount);
      if (!tNet.gt(0)) continue;
      toolingNet = toolingNet.add(tNet);
      lines.push({
        lineNo: lines.length + 1,
        lineType: 'tooling',
        description: `ทำ${r.tooling.kind === 'plates' ? 'เพลท' : 'บล็อกไดคัท'}ใหม่ (เครื่องมือเดิมใช้ไม่ได้)`,
        quantity: 1,
        unitPrice: tNet.toFixed(6),
        netAmount: formatMoney(tNet),
        vatAmount: formatMoney(vatOf(tNet)),
        grossAmount: formatMoney(tNet.add(vatOf(tNet))),
        whtCategory: 'hire_of_work',
      });
    }
    const net = productionNet.add(shippingNet).add(toolingNet);
    const vat = lines.reduce((a, l) => a.add(l.vatAmount as string), ZERO());
    const gr = await tx.goodsReceipt.create({
      data: {
        entityId: po.entityId,
        grNumber: await this.numbering.next(tx, 'gr', at, po.entityId),
        poId: po.id,
        vendorId: po.vendorId,
        factoryId: po.factoryId,
        orderId: order.id,
        receivedQuantity: received,
        payableQuantity: payable,
        receivedOn: dateOnly(bangkokDate(at)),
        netAmount: formatMoney(net),
        vatAmount: formatMoney(vat),
        grossAmount: formatMoney(net.add(vat)),
        lines: { create: lines },
      },
    });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'received' } });
    const factory = await tx.factory.findUniqueOrThrow({
      where: { id: po.factoryId },
      include: { vendor: true },
    });
    await this.events.record(
      tx,
      {
        type: 'goods_receipt.recorded',
        aggregateType: 'goods_receipt',
        aggregateId: gr.publicId,
        entityId: gr.entityId,
        payload: {
          goodsReceiptId: gr.publicId,
          grNumber: gr.grNumber,
          receivedOn: bangkokDate(at),
          poNumber: po.poNumber,
          orderId: order.publicId,
          productTypeId: order.productType.publicId,
          vendorId: factory.vendor.publicId,
          factoryId: factory.publicId,
          receivedQuantity: received,
          payableQuantity: payable,
          productionNet: formatMoney(productionNet),
          shippingNet: formatMoney(shippingNet),
          otherNet: formatMoney(toolingNet),
          vatAmount: formatMoney(vat),
        },
      },
      ACTOR,
    );

    // The advance: what was paid is applied to the payable (P16); an unpaid advance is dropped.
    const advances = await tx.payableItem.findMany({ where: { purchaseOrderId: po.id, source: 'advance' } });
    let advanceNet = ZERO();
    let advanceVat = ZERO();
    for (const a of advances) {
      if (a.status === 'paid' || a.status === 'in_run') {
        advanceNet = advanceNet.add(a.netAmount.toString());
        advanceVat = advanceVat.add(a.vatAmount.toString());
      } else if (a.status !== 'cancelled') {
        await tx.payableItem.update({
          where: { id: a.id },
          data: { status: 'cancelled', rowVersion: { increment: 1 } },
        });
      }
    }
    const paidAdvance = advances
      .filter((a) => a.status === 'paid')
      .reduce((s, a) => s.add(a.netAmount.toString()), ZERO());
    if (paidAdvance.gt(0)) await this.applyAdvance(tx, po, paidAdvance, at);

    // The balance: after POD and the claim window (D-022), retention held at payment (D-164).
    const policy = po.payoutPolicy as unknown as PolicySnapshot;
    const windowEnd = order.claimWindowEndsAt ?? new Date(at.getTime() + policy.claimWindowDays * DAY_MS);
    const eligibleAt =
      policy.balanceTrigger === 'immediate'
        ? at
        : policy.balanceTrigger === 'after_pod'
          ? new Date(at.getTime() + policy.paymentTermsDays * DAY_MS)
          : new Date(windowEnd.getTime() + policy.paymentTermsDays * DAY_MS);
    const balanceNet = MoneyDecimal.max(net.sub(advanceNet), 0);
    const balanceVat = MoneyDecimal.max(vat.sub(advanceVat), 0);
    if (balanceNet.add(balanceVat).gt(0))
      await tx.payableItem.create({
        data: {
          entityId: po.entityId,
          vendorId: po.vendorId,
          source: 'goods_receipt',
          purchaseOrderId: po.id,
          goodsReceiptId: gr.id,
          orderId: order.id,
          netAmount: formatMoney(balanceNet),
          vatAmount: formatMoney(balanceVat),
          openNetAmount: formatMoney(balanceNet),
          openVatAmount: formatMoney(balanceVat),
          whtBaseHire: formatMoney(MoneyDecimal.max(productionNet.add(toolingNet).sub(advanceNet), 0)),
          whtBaseTransport: formatMoney(shippingNet),
          retentionPct: policy.retentionPct,
          eligibleAt,
          status: eligibleAt <= at ? 'eligible' : 'open',
        },
      });

    // The billing statement the factory confirms (D-090).
    const statement = await tx.billingStatement.create({
      data: {
        entityId: po.entityId,
        bsNumber: await this.numbering.next(tx, 'bs', at, po.entityId),
        vendorId: po.vendorId,
        factoryId: po.factoryId,
        periodFrom: dateOnly(bangkokDate(po.issuedAt)),
        periodTo: dateOnly(bangkokDate(at)),
        status: 'sent',
        netAmount: formatMoney(net),
        vatAmount: formatMoney(vat),
        grossAmount: formatMoney(net.add(vat)),
        lines: {
          create: lines.map((l, i) => ({
            lineNo: i + 1,
            goodsReceiptId: gr.id,
            description: `${gr.grNumber} ${l.description}`,
            netAmount: l.netAmount,
            vatAmount: l.vatAmount,
            grossAmount: l.grossAmount,
          })),
        },
      },
    });
    await this.events.record(
      tx,
      {
        type: 'billing_statement.generated',
        aggregateType: 'billing_statement',
        aggregateId: statement.publicId,
        entityId: statement.entityId,
        payload: {
          billingStatementId: statement.publicId,
          bsNumber: statement.bsNumber,
          factoryId: factory.publicId,
          grossAmount: statement.grossAmount.toFixed(2),
        },
      },
      ACTOR,
    );
  }

  /** P16: the paid advance is applied to the factory payable. */
  async applyAdvance(tx: Tx, po: PurchaseOrder, amount: MoneyValue, at: Date) {
    const [factory, order] = await Promise.all([
      tx.factory.findUniqueOrThrow({ where: { id: po.factoryId }, include: { vendor: true } }),
      tx.order.findUniqueOrThrow({ where: { id: po.orderId }, include: { productType: true } }),
    ]);
    await this.events.record(
      tx,
      {
        type: 'advance.applied',
        aggregateType: 'purchase_order',
        aggregateId: po.publicId,
        entityId: po.entityId,
        payload: {
          purchaseOrderId: po.publicId,
          poNumber: po.poNumber,
          appliedOn: bangkokDate(at),
          vendorId: factory.vendor.publicId,
          factoryId: factory.publicId,
          orderId: order.publicId,
          productTypeId: order.productType.publicId,
          amount: formatMoney(amount),
        },
      },
      ACTOR,
    );
  }

  // --- claims (P20, P21) --------------------------------------------------------------------------------

  @OnDomainEvent('claim.factory_deduction_requested', { consumer: 'payables.deductions' })
  async onFactoryDeduction(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const claim = await tx.claim.findUnique({
      where: { publicId: event.aggregateId },
      include: { factory: { include: { vendor: true } }, order: { include: { productType: true } } },
    });
    if (!claim?.factory) return;
    const amount = D(String(event.payload['amount']));
    if (!amount.gt(0)) return;
    // Deducted from the factory's open payables (oldest first) or, when there is not enough, a claim receivable.
    const open = await tx.payableItem.findMany({
      where: {
        vendorId: claim.factory.vendorId,
        source: 'goods_receipt',
        status: { in: ['open', 'eligible'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const available = open.reduce((a, p) => a.add(p.openNetAmount.toString()), ZERO());
    const offset = available.gte(amount) ? 'payable' : 'receivable';
    let applied: bigint | null = null;
    if (offset === 'payable') {
      let left = amount;
      for (const p of open) {
        if (left.lte(0)) break;
        const take = MoneyDecimal.min(left, D(p.openNetAmount));
        const ratio = D(p.openNetAmount).isZero() ? ZERO() : take.div(p.openNetAmount.toString());
        const vatDown = round(D(p.openVatAmount).mul(ratio));
        const hireDown = MoneyDecimal.min(D(p.whtBaseHire), take);
        await tx.payableItem.update({
          where: { id: p.id },
          data: {
            openNetAmount: formatMoney(D(p.openNetAmount).sub(take)),
            openVatAmount: formatMoney(D(p.openVatAmount).sub(vatDown)),
            whtBaseHire: formatMoney(D(p.whtBaseHire).sub(hireDown)),
            rowVersion: { increment: 1 },
          },
        });
        applied ??= p.id;
        left = left.sub(take);
      }
    }
    const deduction = await tx.vendorDeduction.create({
      data: {
        entityId: claim.entityId,
        vendorId: claim.factory.vendorId,
        factoryId: claim.factory.id,
        claimId: claim.id,
        amount: formatMoney(amount),
        offsetAgainst: offset,
        status: offset === 'payable' ? 'applied' : 'pending',
        appliedPayableItemId: applied,
      },
    });
    const resolution = await tx.claimResolution.findFirst({
      where: { claimId: claim.id, action: 'factory_deduction', vendorDeductionId: null },
    });
    if (resolution)
      await tx.claimResolution.update({
        where: { id: resolution.id },
        data: { vendorDeductionId: deduction.id },
      });
    await this.events.record(
      tx,
      {
        type: 'vendor_deduction.recorded',
        aggregateType: 'vendor_deduction',
        aggregateId: deduction.publicId,
        entityId: deduction.entityId,
        payload: {
          deductionId: deduction.publicId,
          claimNo: claim.claimNo,
          recordedOn: bangkokDate(new Date(event.occurredAt)),
          vendorId: claim.factory.vendor.publicId,
          factoryId: claim.factory.publicId,
          orderId: claim.order.publicId,
          productTypeId: claim.order.productType.publicId,
          offsetAgainst: offset,
          amount: formatMoney(amount),
        },
      },
      ACTOR,
    );
  }

  @OnDomainEvent('claim.carrier_recovery_requested', { consumer: 'payables.carrier_recoveries' })
  async onCarrierRecovery(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const claim = await tx.claim.findUnique({
      where: { publicId: event.aggregateId },
      include: { order: true },
    });
    if (!claim) return;
    const customer = await tx.user.findUniqueOrThrow({
      where: { id: claim.customerUserId },
      select: { publicId: true },
    });
    await this.events.record(
      tx,
      {
        type: 'carrier_recovery.recorded',
        aggregateType: 'claim',
        aggregateId: claim.publicId,
        entityId: claim.entityId,
        payload: {
          claimId: claim.publicId,
          claimNo: claim.claimNo,
          recordedOn: bangkokDate(new Date(event.occurredAt)),
          orderId: claim.order.publicId,
          customerId: customer.publicId,
          amount: formatMoney(String(event.payload['amount'])),
        },
      },
      ACTOR,
    );
  }

  private async publish(tx: Tx, po: PurchaseOrder, type: string, data: Record<string, unknown>) {
    const [factory, order] = await Promise.all([
      tx.factory.findUniqueOrThrow({ where: { id: po.factoryId }, include: { vendor: true } }),
      tx.order.findUniqueOrThrow({ where: { id: po.orderId } }),
    ]);
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'purchase_order',
        aggregateId: po.publicId,
        entityId: po.entityId,
        payload: {
          purchaseOrderId: po.publicId,
          poNumber: po.poNumber,
          factoryId: factory.publicId,
          vendorId: factory.vendor.publicId,
          orderId: order.publicId,
          netAmount: po.netAmount.toFixed(2),
          ...data,
        },
      },
      ACTOR,
    );
  }
}
