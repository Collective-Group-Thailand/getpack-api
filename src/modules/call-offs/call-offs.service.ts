import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CallOffStatus, Prisma } from '@generated/prisma/client';
import { type CartRow, CartsService } from '@modules/carts/carts.service';
import { canonical } from '@modules/catalog/imports/import-engine';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { type QuoteStepView, type ToolingAmountsView } from '@modules/pricing/quotes/quote-engine.service';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { addBangkokMonths } from '@modules/tooling/tooling.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type CallOffAgreementDto, type CallOffReleaseDto } from './call-offs.dto';

const D = (v: { toString(): string } | string | number | null | undefined) =>
  new MoneyDecimal(v === null || v === undefined ? '0' : v.toString());
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const DAY_MS = 86_400_000;
const ACTOR = systemActor('call_offs');

const INCLUDE = {
  customer: { select: { publicId: true, displayName: true } },
  quote: { select: { publicId: true, quoteCode: true } },
  quoteOption: {
    select: { publicId: true, unitPrice: true, unit: true, quantity: true, internalBreakdown: true },
  },
  factory: { select: { publicId: true, code: true, tradeName: true, legalName: true } },
  productType: { select: { publicId: true, code: true, nameTh: true, nameEn: true } },
  releases: {
    orderBy: { seq: 'asc' },
    include: {
      quote: { select: { publicId: true } },
      order: { select: { publicId: true, orderCode: true } },
    },
  },
} satisfies Prisma.CallOffAgreementInclude;
type AgreementRow = Prisma.CallOffAgreementGetPayload<{ include: typeof INCLUDE }>;

type Internal = NonNullable<QuoteStepView['internal']> & {
  tooling?: { charged: ToolingAmountsView; waived: ToolingAmountsView } | null;
};

/**
 * D-290 call-off agreements. The customer asks to lock the unit price of a saved quotation option for its quantity
 * for `months` (≤ `calloff.max_months`); the option's factory accepts (the lock starts) or declines. Each release —
 * at least the factory's minimum order, at most what is left — becomes a quotation at the locked unit price (product
 * only; shipping is priced per destination at checkout) in the customer's cart, then a normal order with the normal
 * payment schedule (D-020). The first release carries the quotation's one-off amounts (design fees, plates and die
 * blocks) once. No deposit, no stock; what is not released lapses at expiry without charge.
 */
@Injectable()
export class CallOffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly access: FactoryAccess,
    private readonly quotes: SavedQuotesService,
    private readonly carts: CartsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- customer -------------------------------------------------------------------------------------------------

  async request(
    actor: UserActor,
    input: { quoteId: string; quoteOptionId: string; months: number },
  ): Promise<CallOffAgreementDto> {
    const max = Number((await this.settings.at('calloff.max_months')).value);
    if (input.months > max)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'months', code: 'max', message: `at most ${max} months (calloff.max_months)` }],
      });
    return this.prisma.withTx(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { publicId: input.quoteId, customerUserId: actor.userId },
        include: { options: { where: { publicId: input.quoteOptionId } } },
      });
      const option = quote?.options[0];
      if (!quote || !option) throw new DomainException('http.not_found');
      if (
        quote.source !== 'instant' ||
        !['saved', 'shared'].includes(quote.status) ||
        quote.validUntil <= new Date()
      )
        throw new DomainException('call_offs.quote_not_eligible');
      if (!option.selectedFactoryId) throw new DomainException('call_offs.quote_not_eligible');
      const open = await tx.callOffAgreement.count({
        where: { quoteOptionId: option.id, status: { in: ['pending_factory', 'active'] } },
      });
      if (open > 0) throw new DomainException('call_offs.already_requested');
      const capability = await tx.factoryCapability.findFirst({
        where: {
          factoryId: option.selectedFactoryId,
          productTypeId: quote.productTypeId,
          status: 'active',
          minOrderQty: { not: null },
        },
        orderBy: { minOrderQty: 'desc' },
      });
      const row = await tx.callOffAgreement.create({
        data: {
          customerUserId: actor.userId,
          quoteId: quote.id,
          quoteOptionId: option.id,
          factoryId: option.selectedFactoryId,
          productTypeId: quote.productTypeId,
          committedQuantity: option.quantity,
          minReleaseQuantity: Math.min(capability?.minOrderQty ?? 1, option.quantity),
          months: input.months,
        },
        include: INCLUDE,
      });
      await this.record(tx, row, 'call_off.requested', { months: input.months }, actor);
      return dto(row, 'customer');
    });
  }

  async mine(actor: UserActor): Promise<CallOffAgreementDto[]> {
    const rows = await this.prisma.callOffAgreement.findMany({
      where: { customerUserId: actor.userId },
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });
    return rows.map((r) => dto(r, 'customer'));
  }

  async getMine(actor: UserActor, publicId: string): Promise<CallOffAgreementDto> {
    return dto(await this.owned(this.prisma, actor, publicId), 'customer');
  }

  /** Withdraws a request the factory has not answered. */
  async cancel(actor: UserActor, publicId: string): Promise<CallOffAgreementDto> {
    return this.prisma.withTx(async (tx) => {
      const row = await this.owned(tx, actor, publicId);
      if (row.status !== 'pending_factory')
        throw new DomainException('call_offs.invalid_status', { params: { status: row.status } });
      const updated = await this.transition(tx, row, { status: 'cancelled', endedAt: new Date() });
      await this.record(tx, updated, 'call_off.cancelled', {}, actor);
      return dto(updated, 'customer');
    });
  }

  /**
   * A release of `quantity`: a quotation at the locked unit price added to my cart (D-290). The first release carries
   * the quotation's one-off amounts.
   */
  async release(actor: UserActor, publicId: string, quantity: number): Promise<CartRow> {
    const { quoteId, optionId } = await this.prisma.withTx(async (tx) => {
      const row = await this.owned(tx, actor, publicId);
      await tx.$queryRaw`SELECT id FROM call_off_agreements WHERE id = ${row.id} FOR UPDATE`;
      const now = new Date();
      if (row.status !== 'active' || !row.expiresAt || row.expiresAt <= now)
        throw new DomainException('call_offs.invalid_status', { params: { status: row.status } });
      const remaining = row.committedQuantity - this.taken(row);
      if (quantity < row.minReleaseQuantity || quantity > remaining)
        throw new DomainException('call_offs.release_quantity', {
          params: { min: row.minReleaseQuantity, remaining },
        });
      const first = !row.releases.some((r) => r.includesOneOffs && r.status !== 'lapsed');
      const quote = await this.releaseQuote(tx, row, quantity, first, now);
      const release = await tx.callOffRelease.create({
        data: {
          agreementId: row.id,
          seq: row.releases.length + 1,
          quantity,
          quoteId: quote.id,
          includesOneOffs: first,
          createdById: actor.userId,
        },
      });
      await this.record(
        tx,
        row,
        'call_off.released',
        { releaseId: release.publicId, quantity, quoteId: quote.publicId },
        actor,
      );
      return { quoteId: quote.publicId, optionId: quote.optionPublicId };
    });
    return this.carts.addItem(
      { actor, customerUserId: actor.userId, channel: 'web', csUserId: null },
      undefined,
      {
        quoteId,
        quoteOptionId: optionId,
        designOption: 'own_file',
      },
    );
  }

  /** The quotation of a release: product at the locked unit price, VAT at the option's product-side ratio. */
  private async releaseQuote(tx: Tx, row: AgreementRow, quantity: number, first: boolean, now: Date) {
    const source = await tx.quote.findUniqueOrThrow({ where: { id: row.quoteId } });
    const option = await tx.quoteOption.findUniqueOrThrow({ where: { id: row.quoteOptionId } });
    const r = option.result as unknown as QuoteStepView;
    const internal = option.internalBreakdown as unknown as Internal;
    // The product side of the option (its own shipping out) gives the VAT ratio (assumption (3), D-290).
    const shipGross = D(option.shippingAmount);
    const shipVat =
      r.shippingVatAmount !== null && r.shippingVatAmount !== undefined ? D(r.shippingVatAmount) : D(0);
    const sideGross = D(option.grossAmount).sub(shipGross);
    const sideVat = D(option.vatAmount).sub(shipVat);
    const product = round2(D(option.unitPrice).mul(quantity));
    const fees = first ? D(r.designFeeAmount).add(D(r.structureDesignFeeAmount)) : D(0);
    const tooling = first ? D(r.toolingAmount) : D(0);
    const gross = product.add(fees).add(tooling);
    const vat = sideGross.gt(0) ? round2(gross.mul(sideVat).div(sideGross)) : D(0);
    const net = gross.sub(vat);
    // Buy: the product's buy per unit (the option's buy without its shipping and tooling), the tooling once.
    const toolingBuy = internal.tooling
      ? D(internal.tooling.charged.platesBuy).add(D(internal.tooling.charged.dieBlockBuy))
      : D(0);
    const buyUnit = D(internal.buyPrice).sub(toolingBuy).div(option.quantity);
    const buy = round2(buyUnit.mul(quantity)).add(first ? toolingBuy : D(0));
    const marginPct = net.gt(0) ? net.sub(buy).div(net).mul(100) : D(0);
    const validity = Number((await this.settings.at('quotes.validity_days', { at: now })).value);
    const validUntil = new Date(Math.min(now.getTime() + validity * DAY_MS, row.expiresAt!.getTime()));
    const result: Omit<QuoteStepView, 'internal'> = {
      quantity,
      instant: true,
      reason: null,
      unitPrice: r.unitPrice,
      productAmount: formatMoney(product),
      designFeeAmount: first ? (r.designFeeAmount ?? '0.00') : '0.00',
      structureDesignFeeAmount: first ? (r.structureDesignFeeAmount ?? '0.00') : '0.00',
      toolingAmount: r.toolingAmount === null ? null : formatMoney(tooling),
      toolingWaiver: null,
      shippingAmount: null,
      shippingNetAmount: null,
      shippingVatAmount: null,
      vatAmount: formatMoney(vat),
      grossAmount: formatMoney(gross),
      leadTimeDays: r.leadTimeDays,
      earliestShipDate: null,
      earliestDeliveryDate: null,
      toleranceShortagePct: r.toleranceShortagePct,
      toleranceOveragePct: r.toleranceOveragePct,
      toleranceDimensionalMm: r.toleranceDimensionalMm,
      toleranceColourDeltaE: r.toleranceColourDeltaE,
      shippingPending: true,
      shippingPendingReason: null,
    };
    const input = source.input as { configuration?: Record<string, unknown> } & Record<string, unknown>;
    const releaseInput = {
      ...input,
      ...(input.configuration && { configuration: { ...input.configuration, quantities: [quantity] } }),
    };
    const configRefs = {
      ...(source.configRefs as Record<string, unknown>),
      callOffAgreementId: row.publicId,
      sourceQuoteOptionId: row.quoteOption.publicId,
    };
    const optionRow = {
      quantity,
      unit: option.unit,
      result: result as unknown as Prisma.InputJsonValue,
      netAmount: formatMoney(net),
      discountAmount: '0.00',
      vatAmount: formatMoney(vat),
      grossAmount: formatMoney(gross),
      shippingAmount: null,
      unitPrice: option.unitPrice,
      leadTimeDays: option.leadTimeDays,
      toleranceShortagePct: option.toleranceShortagePct,
      toleranceOveragePct: option.toleranceOveragePct,
      toleranceDimensionalMm: option.toleranceDimensionalMm,
      toleranceColourDeltaE: option.toleranceColourDeltaE,
      selectedFactoryId: option.selectedFactoryId,
      priceListVersionId: option.priceListVersionId,
      internalBreakdown: {
        ...internal,
        buyPrice: formatMoney(buy),
        marginPct: marginPct.toFixed(4),
        productionRun: quantity,
        parts: [],
        shipping: null,
        tooling: first ? (internal.tooling ?? null) : null,
      } as unknown as Prisma.InputJsonValue,
      buyCostNet: formatMoney(buy),
      marginPct: marginPct.toFixed(4),
      belowMarginFloor: option.belowMarginFloor,
    };
    const quote = await tx.quote.create({
      data: {
        entityId: source.entityId,
        channel: source.channel,
        source: 'call_off',
        customerUserId: row.customerUserId,
        productTypeId: source.productTypeId,
        catalogProductId: source.catalogProductId,
        stockProductId: source.stockProductId,
        input: releaseInput as Prisma.InputJsonValue,
        inputSchemaVersion: source.inputSchemaVersion,
        specSummary: source.specSummary ?? Prisma.DbNull,
        calculatorVersion: source.calculatorVersion,
        configRefs: configRefs,
        status: 'saved',
        validUntil,
        deliveryPostcode: null,
        snapshotSha256: sha256(
          JSON.stringify(canonical({ input: releaseInput, configRefs, options: [optionRow] })),
        ),
        options: { create: [optionRow] },
      },
      include: { options: { select: { publicId: true } } },
    });
    await this.quotes.record(tx, quote.publicId, 'quote.saved', {
      channel: source.channel,
      source: 'call_off',
      callOffAgreementId: row.publicId,
      quantities: [quantity],
    });
    return { id: quote.id, publicId: quote.publicId, optionPublicId: quote.options[0]!.publicId };
  }

  // --- factory --------------------------------------------------------------------------------------------------

  async listForFactory(actor: Actor, factoryPublicId: string): Promise<CallOffAgreementDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.callOffAgreement.findMany({
      where: { factoryId: factory.id, status: { not: 'cancelled' } },
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });
    return rows.map((r) => dto(r, 'partner'));
  }

  /** The quotation's factory accepts the lock (it starts now) or declines it with a reason (D-290). */
  async respond(
    actor: UserActor,
    publicId: string,
    decision: { accept: true } | { accept: false; reason: string },
  ): Promise<CallOffAgreementDto> {
    return this.prisma.withTx(async (tx) => {
      const found = await tx.callOffAgreement.findFirst({
        where: { publicId, factory: await this.access.where(actor) },
        include: INCLUDE,
      });
      if (!found) throw new DomainException('http.not_found');
      if (found.status !== 'pending_factory')
        throw new DomainException('call_offs.invalid_status', { params: { status: found.status } });
      const now = new Date();
      const updated = decision.accept
        ? await this.transition(tx, found, {
            status: 'active',
            respondedAt: now,
            respondedById: actor.userId,
            startsAt: now,
            expiresAt: addBangkokMonths(now, found.months),
          })
        : await this.transition(tx, found, {
            status: 'declined',
            respondedAt: now,
            respondedById: actor.userId,
            declineReason: decision.reason.trim(),
          });
      await this.record(
        tx,
        updated,
        decision.accept ? 'call_off.accepted' : 'call_off.declined',
        decision.accept ? { expiresAt: toBangkokIso(updated.expiresAt!) } : { reason: updated.declineReason },
        actor,
      );
      return dto(updated, 'partner');
    });
  }

  // --- staff ----------------------------------------------------------------------------------------------------

  async list(query: {
    page: number;
    perPage: number;
    status?: CallOffStatus;
  }): Promise<{ rows: CallOffAgreementDto[]; total: number }> {
    const where: Prisma.CallOffAgreementWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.callOffAgreement.findMany({
        where,
        include: INCLUDE,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.callOffAgreement.count({ where }),
    ]);
    return { rows: rows.map((r) => dto(r, 'staff')), total };
  }

  // --- lifecycle ------------------------------------------------------------------------------------------------

  /** An order placed from a release's quotation marks the release ordered (checkout extension). */
  async onOrderPlaced(tx: Tx, quoteId: bigint, order: { id: bigint }, at: Date): Promise<void> {
    await tx.callOffRelease.updateMany({
      where: { quoteId, status: 'quoted' },
      data: { status: 'ordered', orderId: order.id, orderedAt: at },
    });
  }

  /**
   * Daily: releases whose quotation expired unordered lapse (their quantity is free again); active agreements past
   * their end expire with what was not released lapsing (no charge); requests unanswered while their quotation was
   * valid expire.
   */
  async lapse(now = new Date()): Promise<number> {
    let n = 0;
    const releases = await this.prisma.callOffRelease.findMany({
      where: { status: 'quoted', quote: { validUntil: { lte: now } } },
      select: { id: true },
    });
    if (releases.length > 0)
      n += (
        await this.prisma.callOffRelease.updateMany({
          where: { id: { in: releases.map((r) => r.id) }, status: 'quoted' },
          data: { status: 'lapsed', lapsedAt: now },
        })
      ).count;
    const due = await this.prisma.callOffAgreement.findMany({
      where: {
        OR: [
          { status: 'active', expiresAt: { lte: now } },
          { status: 'pending_factory', quote: { validUntil: { lte: now } } },
        ],
      },
      include: INCLUDE,
    });
    for (const row of due) {
      await this.prisma.withTx(async (tx) => {
        const lapsedQuantity = row.status === 'active' ? row.committedQuantity - this.taken(row, true) : null;
        const updated = await this.transition(tx, row, { status: 'expired', endedAt: now, lapsedQuantity });
        await this.record(tx, updated, 'call_off.expired', { lapsedQuantity }, ACTOR);
      });
      n++;
    }
    return n;
  }

  // --- helpers --------------------------------------------------------------------------------------------------

  /** Quantity released (quoted or ordered; only ordered once the agreement ended). */
  private taken(row: AgreementRow, orderedOnly = false): number {
    return row.releases
      .filter((r) => r.status === 'ordered' || (!orderedOnly && r.status === 'quoted'))
      .reduce((a, r) => a + r.quantity, 0);
  }

  private async owned(db: Tx, actor: UserActor, publicId: string): Promise<AgreementRow> {
    const row = await db.callOffAgreement.findFirst({
      where: { publicId, customerUserId: actor.userId },
      include: INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private transition(tx: Tx, row: AgreementRow, data: Prisma.CallOffAgreementUncheckedUpdateInput) {
    return tx.callOffAgreement.update({
      where: { id: row.id },
      data: { ...data, rowVersion: { increment: 1 } },
      include: INCLUDE,
    });
  }

  private async record(
    tx: Tx,
    row: AgreementRow,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ): Promise<void> {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'call_off_agreement',
        aggregateId: row.publicId,
        payload: {
          agreementId: row.publicId,
          customerId: row.customer.publicId,
          factoryId: row.factory.publicId,
          quoteId: row.quote.publicId,
          committedQuantity: row.committedQuantity,
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'call_off_agreement',
      aggregatePublicId: row.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer', 'partner'],
      domainEventId: event.id,
      actor,
    });
  }
}

type View = 'customer' | 'partner' | 'staff';

/** The factory's product buy price per unit as locked: the option's buy without its plates and die blocks. */
function buyUnit(r: AgreementRow): MoneyValue {
  const internal = r.quoteOption.internalBreakdown as unknown as Internal;
  const tooling = internal.tooling
    ? D(internal.tooling.charged.platesBuy).add(D(internal.tooling.charged.dieBlockBuy))
    : D(0);
  return D(internal.buyPrice).sub(tooling).div(r.quoteOption.quantity);
}

function dto(r: AgreementRow, view: View): CallOffAgreementDto {
  const released = r.releases.filter((x) => x.status !== 'lapsed').reduce((a, x) => a + x.quantity, 0);
  return {
    id: r.publicId,
    status: r.status,
    quoteId: r.quote.publicId,
    quoteOptionId: r.quoteOption.publicId,
    quoteCode: r.quote.quoteCode,
    productType: {
      id: r.productType.publicId,
      code: r.productType.code,
      nameTh: r.productType.nameTh,
      nameEn: r.productType.nameEn,
    },
    // D-050: customers never see the factory; D-044: the factory sees its own price, never Packio's sell side.
    factory:
      view === 'customer'
        ? null
        : { id: r.factory.publicId, code: r.factory.code, name: r.factory.tradeName ?? r.factory.legalName },
    unit: r.quoteOption.unit,
    unitPrice: view === 'partner' ? null : r.quoteOption.unitPrice.toFixed(2),
    buyUnitPrice: view === 'customer' ? null : buyUnit(r).toFixed(6),
    committedQuantity: r.committedQuantity,
    releasedQuantity: released,
    remainingQuantity: r.status === 'active' ? r.committedQuantity - released : 0,
    minReleaseQuantity: r.minReleaseQuantity,
    months: r.months,
    startsAt: r.startsAt ? toBangkokIso(r.startsAt) : null,
    expiresAt: r.expiresAt ? toBangkokIso(r.expiresAt) : null,
    declineReason: r.declineReason,
    lapsedQuantity: r.lapsedQuantity,
    releases: r.releases.map((x): CallOffReleaseDto => ({
      id: x.publicId,
      seq: x.seq,
      quantity: x.quantity,
      status: x.status,
      quoteId: x.quote.publicId,
      order: x.order ? { orderId: x.order.publicId, orderCode: x.order.orderCode } : null,
      includesOneOffs: x.includesOneOffs,
      createdAt: toBangkokIso(x.createdAt),
    })),
    createdAt: toBangkokIso(r.createdAt),
  };
}
