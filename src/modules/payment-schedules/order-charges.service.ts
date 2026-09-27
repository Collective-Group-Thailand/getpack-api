import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import {
  type Prisma,
  type ProductUnit,
  type RevenueCategory,
  type WhtCategory,
} from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import { CheckoutService } from '@modules/checkout/checkout.service';
import { type TaxProfileSnapshot } from '@modules/customers/customers.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { PaymentSchedulesService } from './payment-schedules.service';

const BEFORE_PRODUCTION: readonly string[] = ['waiting_payment', 'paid_for_production', 'artwork_approved'];
const D = (v: string | Prisma.Decimal | number) => new MoneyDecimal(v.toString());
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);

export interface ChargeInput {
  lineType: 'extra_revision' | 'mockup';
  descriptionTh: string;
  descriptionEn: string;
  unit: ProductUnit;
  /** Net of VAT, THB decimal string. */
  netAmount: string;
  whtCategory: WhtCategory;
  revenueCategory: RevenueCategory;
  reason: string;
  instalmentLabelTh: string;
  instalmentLabelEn: string;
}

export interface AddedCharge {
  orderLineId: bigint;
  instalmentId: bigint;
  instalmentPublicId: string;
  net: string;
  vat: string;
  gross: string;
  wht: string;
  cash: string;
}

/**
 * Add-on charges after placement (an extra design round D-071, a mockup D-072; ADR-0008 item 6): one more
 * order line at the order's VAT rate (customer withholding per the group's tax profile), the order and
 * group totals and the price snapshot move as a re-price revision (kept in `order_price_revisions`), and a
 * fixed-amount instalment due now carries the charge. Only before production (order-state rule).
 */
@Injectable()
export class OrderChargesService {
  constructor(
    private readonly schedules: PaymentSchedulesService,
    private readonly checkout: CheckoutService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async addCharge(
    tx: Tx,
    orderId: bigint,
    input: ChargeInput,
    actor: UserActor,
    at = new Date(),
  ): Promise<AddedCharge> {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { orderBy: { lineNo: 'asc' } }, orderGroup: true },
    });
    if (!BEFORE_PRODUCTION.includes(order.status))
      throw new DomainException('order.invalid_transition', {
        params: { from: order.status, fact: 'charge_added', reason: 'only before production' },
      });
    const net = round2(D(input.netAmount));
    if (net.lte(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'netAmount', code: 'min', message: 'must be positive' }],
      });
    const vatPct =
      order.lines.find((l) => l.lineType === 'product')?.vatRatePct ?? order.lines[0]!.vatRatePct;
    const snapshot = order.orderGroup.taxProfileSnapshot as TaxProfileSnapshot | null;
    const withholds = !!snapshot && snapshot.withholdsTax && snapshot.taxType !== 'individual';
    const whtPct =
      withholds && input.whtCategory !== 'none'
        ? (await this.checkout.whtRates(at)).rates[input.whtCategory]
        : '0';
    const vat = round2(net.mul(vatPct.toString()).div(100));
    const gross = net.add(vat);
    const wht = round2(net.mul(whtPct).div(100));
    const cash = gross.sub(wht);
    const amounts = {
      net: formatMoney(net),
      vat: formatMoney(vat),
      gross: formatMoney(gross),
      wht: formatMoney(wht),
      cash: formatMoney(cash),
    };

    const line = await tx.orderLine.create({
      data: {
        orderId: order.id,
        lineNo: Math.max(...order.lines.map((l) => l.lineNo)) + 1,
        lineType: input.lineType,
        descriptionTh: input.descriptionTh,
        descriptionEn: input.descriptionEn,
        quantity: '1',
        unit: input.unit,
        unitPrice: net.toFixed(6),
        netAmount: amounts.net,
        vatRatePct: vatPct,
        vatAmount: amounts.vat,
        grossAmount: amounts.gross,
        whtCategory: input.whtCategory,
        whtRatePct: whtPct,
        whtAmount: amounts.wht,
        revenueCategory: input.revenueCategory,
        taxNature: order.taxNature,
      },
    });
    await tx.orderPriceRevision.create({
      data: {
        orderId: order.id,
        revision: order.pricingRevision,
        previousSnapshot: order.pricingSnapshot as Prisma.InputJsonValue,
        previousLines: order.lines.map((l) => ({
          lineType: l.lineType,
          netAmount: l.netAmount.toFixed(2),
          vatAmount: l.vatAmount.toFixed(2),
          grossAmount: l.grossAmount.toFixed(2),
          whtAmount: l.whtAmount.toFixed(2),
        })),
        previousGross: order.grossAmount,
        newGross: formatMoney(D(order.grossAmount).add(gross)),
        reason: input.reason,
        createdById: actor.userId,
      },
    });
    const previous = (order.pricingSnapshot ?? {}) as Record<string, unknown>;
    const addOns = [
      ...((previous['addOns'] as unknown[] | undefined) ?? []),
      { lineType: input.lineType, ...amounts, at: at.toISOString() },
    ];
    const totals = {
      netAmount: formatMoney(D(order.netAmount).add(net)),
      discountAmount: order.discountAmount.toFixed(2),
      shippingNetAmount: order.shippingNetAmount.toFixed(2),
      vatAmount: formatMoney(D(order.vatAmount).add(vat)),
      grossAmount: formatMoney(D(order.grossAmount).add(gross)),
      whtAmount: formatMoney(D(order.whtAmount).add(wht)),
      cashAmount: formatMoney(D(order.cashAmount).add(cash)),
    };
    const pricingSnapshot = { ...previous, addOns, totals };
    await tx.order.update({
      where: { id: order.id },
      data: {
        netAmount: totals.netAmount,
        vatAmount: totals.vatAmount,
        grossAmount: totals.grossAmount,
        whtAmount: totals.whtAmount,
        cashAmount: totals.cashAmount,
        pricingSnapshot: pricingSnapshot as Prisma.InputJsonValue,
        snapshotSha256: createHash('sha256')
          .update(JSON.stringify(canonical({ snapshot: pricingSnapshot, configRefs: order.configRefs })))
          .digest(),
        pricingRevision: order.pricingRevision + 1,
        updatedById: actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    const group = order.orderGroup;
    await tx.orderGroup.update({
      where: { id: group.id },
      data: {
        netAmount: formatMoney(D(group.netAmount).add(net)),
        vatAmount: formatMoney(D(group.vatAmount).add(vat)),
        grossAmount: formatMoney(D(group.grossAmount).add(gross)),
        whtAmount: formatMoney(D(group.whtAmount).add(wht)),
        cashAmount: formatMoney(D(group.cashAmount).add(cash)),
        rowVersion: { increment: 1 },
      },
    });
    const instalment = await this.schedules.addFixedInstalment(
      tx,
      {
        groupId: group.id,
        orderId: order.id,
        orderLineId: line.id,
        labelTh: input.instalmentLabelTh,
        labelEn: input.instalmentLabelEn,
        amounts,
      },
      actor,
      at,
    );
    const customer = await tx.user.findUniqueOrThrow({
      where: { id: order.customerUserId },
      select: { publicId: true },
    });
    const event = await this.events.record(
      tx,
      {
        type: 'order.charge_added',
        aggregateType: 'order',
        aggregateId: order.publicId,
        payload: {
          orderId: order.publicId,
          customerId: customer.publicId,
          lineType: input.lineType,
          instalmentId: instalment.publicId,
          ...amounts,
          reason: input.reason,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: order.publicId,
      action: 'order.charge_added',
      messageKey: 'activity.order.charge_added',
      messageParams: { lineType: input.lineType, grossAmount: amounts.gross },
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
    return {
      orderLineId: line.id,
      instalmentId: instalment.id,
      instalmentPublicId: instalment.publicId,
      ...amounts,
    };
  }
}
