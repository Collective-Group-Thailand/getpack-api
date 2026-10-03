import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { discountLine } from '@modules/checkout/order-pricing';
import { OrdersService } from '@modules/orders/orders.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { SamplesService } from './samples.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const DAY_MS = 86_400_000;

interface CreditState {
  credits: { sampleId: bigint; quoteId: bigint; amount: string }[];
}

/**
 * Checkout extension `samples` (order 50, before promotions so their margin guard sees it):
 * - a standalone sample quotation becomes an order of kind `sample` linked to its sample (D-253);
 * - D-257: a bulk quotation saved from an approved standalone sample (`store.samples.orderBulk`) gets a discount
 *   `sample_credit` of `samples.credit_pct` % of the sample's product net on its product line, within
 *   `samples.credit_window_days` of the approval, once.
 */
@Injectable()
export class SamplesCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'samples';
  readonly order = 50;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly settings: SettingsService,
    private readonly samples: SamplesService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const state: CreditState = { credits: [] };
    for (const order of draft.orders) {
      if (order.quoteSource === 'sample') continue;
      const sample = await db.sample.findUnique({ where: { bulkQuoteId: order.quoteId } });
      if (
        !sample ||
        sample.kind !== 'standalone' ||
        sample.status !== 'approved' ||
        sample.creditOrderId ||
        !sample.decidedAt ||
        !sample.sellNetAmount
      )
        continue;
      const window = (await this.settings.at('samples.credit_window_days', { at: draft.at })).value;
      if (draft.at.getTime() > sample.decidedAt.getTime() + window * DAY_MS) continue;
      const pct = (await this.settings.at('samples.credit_pct', { at: draft.at })).value;
      const index = order.lines.findIndex((l) => l.lineType === 'product');
      if (index < 0) continue;
      const line = order.lines[index]!;
      const room = D(line.netAmount).sub(line.discountAmount);
      const wanted = D(sample.sellNetAmount).mul(pct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
      const amount = MoneyDecimal.min(wanted, room);
      if (amount.lte(0)) continue;
      order.lines[index] = discountLine(line, amount);
      order.discounts.push({
        lineIndex: index,
        source: 'sample_credit',
        pct: D(pct).toFixed(4),
        amount: formatMoney(amount),
        cappedAmount: formatMoney(wanted.sub(amount)),
        capReason: wanted.gt(amount) ? 'line_net' : null,
        meta: { sampleId: sample.publicId },
      });
      draft.notices.push({
        code: 'sample.credit_applied',
        params: { sampleId: sample.publicId, amount: formatMoney(amount) },
      });
      state.credits.push({ sampleId: sample.id, quoteId: order.quoteId, amount: formatMoney(amount) });
    }
    draft.state[this.key] = state;
  }

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    for (const o of placed.orders) {
      if (o.draft.quoteSource !== 'sample') continue;
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id: o.draft.quoteId },
        select: { sample: true },
      });
      const sample = quote.sample;
      if (!sample) continue;
      // The sample order makes the sample (D-253): link it, and the order carries the sample's print option.
      await tx.sample.update({
        where: { id: sample.id },
        data: { orderId: o.id, rowVersion: { increment: 1 } },
      });
      await tx.order.update({ where: { id: o.id }, data: { mockupOption: sample.mockupOption } });
      // An unprinted sample needs no artwork: its order records the artwork fact at once (D-253, D-073 gate).
      if (sample.mockupOption === 'without_print')
        await this.orders.applyFact(tx, o.id, { kind: 'artwork_approved' }, draft.actor);
      await this.samples.record(tx, { ...sample, orderId: o.id }, 'sample.ordered', {});
    }
    const state = draft.state[this.key] as CreditState | undefined;
    for (const credit of state?.credits ?? []) {
      const order = placed.orders.find((o) => o.draft.quoteId === credit.quoteId);
      if (!order) continue;
      // Once (D-257): a concurrent checkout of the same bulk quotation loses.
      const { count } = await tx.sample.updateMany({
        where: { id: credit.sampleId, creditOrderId: null, status: 'approved' },
        data: { creditOrderId: order.id, creditAmount: credit.amount, rowVersion: { increment: 1 } },
      });
      if (count !== 1)
        throw new DomainException('samples.invalid_status', {
          params: { status: 'credited', action: 'credit' },
        });
      const sample = await tx.sample.findUniqueOrThrow({ where: { id: credit.sampleId } });
      await this.samples.record(tx, sample, 'sample.credit_applied', { amount: credit.amount });
    }
  }
}
