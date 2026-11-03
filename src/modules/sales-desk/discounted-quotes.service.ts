import { createHash, randomBytes } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { recordAgentEvent } from '@modules/agents/agent-shared';
import { canonical } from '@modules/catalog/imports/import-engine';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type DraftOrder,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { discountLine } from '@modules/checkout/order-pricing';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const sha256 = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest();
export const SALES_QUOTE_SCOPE = 'sales_quote';

/**
 * D-470 (P3 deferral): an option the agent accepted becomes a NEW quotation of the quoted quantity at the option's
 * price — the source is a write-once snapshot, so the new one copies it with `discount_amount`, is valid
 * `quotes.discounted_validity_days` (the option's own validity), supersedes the source and takes over the agent's
 * link; its conditions line is printed on the PDF. Checkout honours the price through a discount memo of scope
 * `sales_quote` on the new quotation (the `sales_quote_discounts` extension), capped at the margin floor unless a
 * C-Level approval allowed going below it.
 */
@Injectable()
export class DiscountedQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly numbering: DocumentNumberingService,
    private readonly encryption: FieldEncryption,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  @OnDomainEvent('sales_agent_discount.option_accepted', { consumer: 'sales.discounted_quote' })
  async onOptionAccepted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const option = await tx.salesAgentDiscountOption.findUnique({
      where: { publicId: String(event.payload['optionId']) },
      include: {
        request: {
          include: {
            quoteOption: true,
            agentQuote: true,
            quote: true,
            approval: true,
          },
        },
      },
    });
    if (!option || (await tx.salesDiscountedQuote.findUnique({ where: { optionId: option.id } }))) return;
    const { request } = option;
    const source = request.quote;
    const qo = request.quoteOption;
    const now = new Date();
    const discount = D(option.baseAmount).sub(option.netAmount);
    const vatPct = qo.netAmount.gt(0) ? D(qo.vatAmount).mul(100).div(qo.netAmount).toDecimalPlaces(2) : D(0);
    const vatOnDiscount = discount.mul(vatPct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
    const vat = D(qo.vatAmount).sub(vatOnDiscount);
    const gross = D(qo.grossAmount).sub(discount).sub(vatOnDiscount);
    const result = {
      ...(qo.result as Record<string, unknown>),
      discountPct: option.discountPct.toFixed(4),
      discountAmount: formatMoney(discount),
      vatAmount: formatMoney(vat),
      grossAmount: formatMoney(gross),
    };
    const token = randomBytes(32).toString('base64url');
    const shareDays = Number(await this.settings.value('configurations.share_link_days', now));
    const created = await tx.quote.create({
      data: {
        entityId: source.entityId,
        channel: source.channel,
        source: source.source,
        customerUserId: source.customerUserId,
        companyId: source.companyId,
        anonymousId: source.anonymousId,
        productTypeId: source.productTypeId,
        catalogProductId: source.catalogProductId,
        stockProductId: source.stockProductId,
        input: source.input as Prisma.InputJsonValue,
        inputSchemaVersion: source.inputSchemaVersion,
        specSummary: source.specSummary ?? undefined,
        calculatorVersion: source.calculatorVersion,
        configRefs: source.configRefs as Prisma.InputJsonValue,
        status: 'shared',
        validUntil: option.validUntil,
        deliveryPostcode: source.deliveryPostcode,
        quoteCode: await this.numbering.next(tx, 'qt'),
        shareTokenHash: Uint8Array.from(createHash('sha256').update(token).digest()),
        sharedAt: now,
        shareExpiresAt: new Date(
          Math.min(option.validUntil.getTime(), now.getTime() + shareDays * 86_400_000),
        ),
        designDocumentVersionId: source.designDocumentVersionId,
        specHash: source.specHash,
        snapshotSha256: Uint8Array.from(
          sha256({ source: source.publicId, option: option.publicId, discount: formatMoney(discount) }),
        ),
        options: {
          create: {
            quantity: qo.quantity,
            unit: qo.unit,
            result: result,
            netAmount: qo.netAmount,
            discountAmount: formatMoney(discount),
            vatAmount: formatMoney(vat),
            grossAmount: formatMoney(gross),
            shippingAmount: qo.shippingAmount,
            unitPrice: qo.unitPrice,
            leadTimeDays: qo.leadTimeDays,
            earliestShipDate: qo.earliestShipDate,
            toleranceShortagePct: qo.toleranceShortagePct,
            toleranceOveragePct: qo.toleranceOveragePct,
            toleranceDimensionalMm: qo.toleranceDimensionalMm,
            toleranceColourDeltaE: qo.toleranceColourDeltaE,
            selectedFactoryId: qo.selectedFactoryId,
            priceListVersionId: qo.priceListVersionId,
            internalBreakdown: qo.internalBreakdown ?? undefined,
            buyCostNet: qo.buyCostNet,
            marginPct: qo.marginPct,
            belowMarginFloor: qo.belowMarginFloor,
          },
        },
      },
    });
    await tx.quote.update({
      where: { id: source.id },
      data: { status: 'superseded', supersededById: created.id, rowVersion: { increment: 1 } },
    });
    const approval = request.approval;
    const memo = await tx.discountMemo.create({
      data: {
        entityId: source.entityId,
        scope: SALES_QUOTE_SCOPE,
        requestedById: approval?.decidedById ?? option.offeredById ?? request.createdById,
        customerUserId: source.customerUserId,
        companyId: source.companyId,
        quoteId: created.id,
        orderValue: qo.grossAmount,
        requestedPct: option.discountPct,
        requestedAmount: formatMoney(discount),
        resultingMarginPct: approval?.grossMarginPct ?? null,
        // Only a C-Level approval may go below the floor (D-052, D-470).
        belowMarginFloor: approval?.belowFloor === true && approval.level === 'c_level',
        reason: `D-470 discount approval ${approval?.publicId ?? request.publicId}`,
        status: 'approved',
        approvedPct: option.discountPct,
        validUntil: option.validUntil,
        decidedAt: now,
      },
    });
    await tx.salesDiscountedQuote.create({
      data: {
        quoteId: created.id,
        sourceQuoteId: source.id,
        approvalId: approval?.id ?? null,
        optionId: option.id,
        discountMemoId: memo.id,
        discountPct: option.discountPct,
        discountAmount: formatMoney(discount),
        conditionsTh: option.conditionsTh,
        conditionsEn: option.conditionsEn,
      },
    });
    await tx.salesAgentQuote.update({
      where: { id: request.agentQuoteId },
      data: {
        quoteId: created.id,
        shareTokenEnc: this.encryption.encrypt(token),
        sendCount: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_quote.discounted',
      aggregateType: 'quote',
      aggregateId: created.publicId,
      payload: {
        quoteId: created.publicId,
        sourceQuoteId: source.publicId,
        optionId: option.publicId,
        discountPct: option.discountPct.toFixed(2),
        validUntil: option.validUntil.toISOString(),
      },
      actor: systemActor('sales.discounted_quote'),
    });
  }
}

interface SalesQuoteDiscountState {
  memoIds: string[];
}

/**
 * Checkout extension `sales_quote_discounts` (order 310, after `discounts`): an order from a discounted quotation
 * (memo of scope `sales_quote`, approved, valid) gets its % on the non-shipping lines, capped at the margin floor
 * unless the memo allows going below (C-Level). The memo is used once.
 */
@Injectable()
export class SalesQuoteDiscountCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'sales_quote_discounts';
  readonly order = 310;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const memos = await db.discountMemo.findMany({
      where: {
        scope: SALES_QUOTE_SCOPE,
        status: 'approved',
        validUntil: { gt: draft.at },
        quoteId: { in: draft.orders.map((o) => o.quoteId) },
      },
    });
    if (memos.length === 0) return;
    const floor = D(String((await this.settings.at('pricing.margin_floor_pct', { at: draft.at })).value));
    const keep = D(1).sub(floor.div(100));
    for (const memo of memos)
      for (const order of draft.orders.filter((o) => o.quoteId === memo.quoteId)) {
        const [given, capped] = this.apply(order, memo, keep);
        draft.notices.push({
          code: 'discount.applied',
          params: {
            source: 'discount_memo',
            pct: D(memo.approvedPct!).toFixed(4),
            amount: formatMoney(given),
            memoId: memo.publicId,
          },
        });
        if (capped.gt(0))
          draft.notices.push({
            code: 'discount.capped',
            params: { source: 'discount_memo', cappedAmount: formatMoney(capped), reason: 'margin_floor' },
          });
      }
    draft.state[this.key] = { memoIds: memos.map((m) => m.publicId) } satisfies SalesQuoteDiscountState;
  }

  private apply(
    order: DraftOrder,
    memo: {
      id: bigint;
      publicId: string;
      approvedPct: { toString(): string } | null;
      belowMarginFloor: boolean;
    },
    keep: MoneyValue,
  ): [MoneyValue, MoneyValue] {
    const pct = D(memo.approvedPct ?? 0);
    const lines = order.lines
      .map((l, index) => ({ l, index, net: D(l.netAmount).sub(l.discountAmount) }))
      .filter((x) => x.l.lineType !== 'shipping' && x.net.gt(0));
    const wanted = lines.map((x) => x.net.mul(pct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP));
    const total = wanted.reduce((a, w) => a.add(w), D(0));
    let allowed = total;
    if (!memo.belowMarginFloor) {
      const payable = order.lines.reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount)), D(0));
      const room =
        order.buyCostNet && keep.gt(0)
          ? MoneyDecimal.max(
              payable.sub(D(order.buyCostNet).div(keep)).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN),
              D(0),
            )
          : D(0);
      allowed = MoneyDecimal.min(total, room);
    }
    let left = allowed;
    for (const [i, x] of lines.entries()) {
      const share =
        i === lines.length - 1
          ? left
          : MoneyDecimal.min(
              left,
              total.gt(0)
                ? wanted[i]!.mul(allowed).div(total).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN)
                : D(0),
            );
      const amount = MoneyDecimal.min(share, x.net);
      const cappedHere = MoneyDecimal.max(wanted[i]!.sub(amount), D(0));
      if (amount.lte(0) && cappedHere.lte(0)) continue;
      if (amount.gt(0)) order.lines[x.index] = discountLine(order.lines[x.index]!, amount);
      order.discounts.push({
        lineIndex: x.index,
        source: 'discount_memo',
        pct: pct.toFixed(4),
        amount: formatMoney(amount),
        cappedAmount: formatMoney(cappedHere),
        capReason: cappedHere.gt(0) ? 'margin_floor' : null,
        grantedByUserId: null,
        discountMemoId: memo.id,
        meta: { memoId: memo.publicId, scope: SALES_QUOTE_SCOPE },
      });
      left = left.sub(amount);
    }
    return [allowed.sub(MoneyDecimal.max(left, D(0))), total.sub(allowed)];
  }

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    const state = draft.state[this.key] as SalesQuoteDiscountState | undefined;
    if (!state?.memoIds.length) return;
    const { count } = await tx.discountMemo.updateMany({
      where: { publicId: { in: state.memoIds }, status: 'approved' },
      data: {
        status: 'applied',
        appliedOrderGroupId: placed.groupId,
        appliedAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    if (count !== state.memoIds.length)
      throw new DomainException('discount_memos.not_usable', { params: { status: 'applied' } });
  }
}
