import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type SalesChannel } from '@generated/prisma/client';
import { type AddressSnapshot, CustomersService } from '@modules/customers/customers.service';
import { SUMMARY_INCLUDE } from '@modules/quotes/line-summary';
import { QuoteConversionService } from '@modules/quotes/quote-conversion.service';
import { type QuoteOwner, SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { type AddCartItemDto, type DestinationInputDto, type UpdateCartItemDto } from './carts.dto';
import { quantityLimitError } from './quantity-limits';

export const CART_INCLUDE = {
  items: {
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: {
      quote: { include: { productType: true, catalogProduct: SUMMARY_INCLUDE.catalogProduct } },
      quoteOption: true,
      pendingQuote: true,
      pendingQuoteOption: true,
      destinations: { orderBy: [{ sort: 'asc' }, { id: 'asc' }], include: { customerAddress: true } },
      designDocument: { select: { publicId: true } },
      designDocumentVersion: { select: { versionNo: true } },
      reorderOfOrder: { select: { publicId: true, orderCode: true } },
    },
  },
  codes: { orderBy: { id: 'asc' } },
  customer: true,
} as const satisfies Prisma.CartInclude;

export type CartRow = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;
export type CartItemRow = CartRow['items'][number];

export const cartEtag = (cart: { publicId: string; rowVersion: number }) =>
  etagOf(cart.publicId, cart.rowVersion);

/** Who works the cart: the customer on the store, or CS for the customer (schema-design §2.10). */
export interface CartActor {
  actor: Actor;
  customerUserId: bigint;
  channel: SalesChannel;
  csUserId: bigint | null;
}

export interface RepriceDiff {
  previousGrossAmount: string;
  newGrossAmount: string;
  differenceAmount: string;
  newUnitPrice: string;
  validUntil: string;
}

function invalid(path: string, message: string, code = 'invalid'): never {
  throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
}

/** Gross of the configuration without the quotation's own shipping (re-priced per destination at checkout). */
export function productGross(option: { grossAmount: Prisma.Decimal; shippingAmount: Prisma.Decimal | null }) {
  return new MoneyDecimal(option.grossAmount.toString()).sub(option.shippingAmount?.toString() ?? '0');
}

/**
 * The cart (schema-design §3.6, B3.1): one active cart per customer and channel, one item per quote
 * option with its price lock (D-051), design and mockup options (D-072) and the split of its quantity
 * over delivery addresses. An item past its lock is re-priced into a pending option the client must
 * confirm. Every change bumps the cart's row version (ETag) and records an activity row and an event.
 */
@Injectable()
export class CartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly conversion: QuoteConversionService,
    private readonly quotes: SavedQuotesService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  /** The active cart, created on first use. */
  async active(tx: Tx, who: CartActor): Promise<CartRow> {
    const existing = await tx.cart.findFirst({
      where: { customerUserId: who.customerUserId, channel: who.channel, status: 'active' },
      include: CART_INCLUDE,
    });
    if (existing) return existing;
    await this.customers.ensureProfile(tx, who.customerUserId);
    const customer = await tx.user.findUniqueOrThrow({ where: { id: who.customerUserId } });
    const entity = await tx.entity.findFirstOrThrow({ where: { isDefault: true } });
    await tx.cart.createMany({
      data: [
        {
          entityId: entity.id,
          customerUserId: customer.id,
          channel: who.channel,
          createdByCsUserId: who.csUserId,
        },
      ],
      skipDuplicates: true,
    });
    return tx.cart.findFirstOrThrow({
      where: { customerUserId: who.customerUserId, channel: who.channel, status: 'active' },
      include: CART_INCLUDE,
    });
  }

  async get(who: CartActor): Promise<CartRow> {
    return this.prisma.withTx((tx) => this.active(tx, who));
  }

  async addItem(
    who: CartActor,
    ifMatch: string | undefined,
    body: AddCartItemDto,
    /** A reorder (D-153): the past order and the approved proof carried over when the artwork is unchanged. */
    reorder?: { orderId: bigint; reuseArtworkProofId: bigint | null },
  ): Promise<CartRow> {
    if (body.mockupOption && body.mockupOption !== 'none')
      throw new DomainException('cart.mockup_price_unavailable');
    return this.prisma.withTx(async (tx) => {
      const cart = await this.active(tx, who);
      assertIfMatch(ifMatch, cartEtag(cart), { required: false });
      const snapshot = await this.conversion.cartItem(tx, this.owner(who), body.quoteId, body.quoteOptionId);
      const quote = await tx.quote.findUniqueOrThrow({ where: { id: snapshot.quoteId } });
      // CS works any quote, but only one made for this customer ends up in their cart.
      if (quote.customerUserId !== who.customerUserId) throw new DomainException('http.not_found');
      if (cart.items.some((i) => i.quoteOptionId === snapshot.quoteOptionId))
        throw new DomainException('cart.item_exists');
      // D-454: the minimum order counts per size — each item (one configuration, one size) meets its catalogue
      // product's limits on its own; other items of the same product never count towards it. A customer's instant
      // quotation only: CS quotations, accepted RFQs, samples, call-offs and reorders (D-153) keep their own terms.
      if (
        quote.source === 'instant' &&
        quote.channel !== 'cs' &&
        !reorder &&
        quote.catalogProductId !== null
      ) {
        const product = await tx.catalogProduct.findUnique({
          where: { id: quote.catalogProductId },
          select: { quantityMin: true, quantityMax: true },
        });
        const error = quantityLimitError(snapshot.quantity, product, 'quoteOptionId');
        if (error) throw new DomainException('validation.failed', { errors: [error] });
      }
      const option = await tx.quoteOption.findUniqueOrThrow({ where: { id: snapshot.quoteOptionId } });
      this.checkDesignOption(body.designOption, option.result);
      const design = await this.designDocument(
        tx,
        who,
        body.designDocumentId ?? null,
        body.designOption,
        body.designVersionNo,
      );
      const item = await tx.cartItem.create({
        data: {
          cartId: cart.id,
          quoteId: snapshot.quoteId,
          quoteOptionId: snapshot.quoteOptionId,
          quantity: snapshot.quantity,
          designOption: body.designOption,
          designNote: body.designNote ?? null,
          designDocumentId: design?.documentId ?? null,
          designDocumentVersionId: design?.versionId ?? null,
          mockupOption: body.mockupOption ?? 'none',
          netAmount: snapshot.netAmount,
          vatAmount: snapshot.vatAmount,
          grossAmount: snapshot.grossAmount,
          shippingAmount: snapshot.shippingAmount,
          unitPrice: snapshot.unitPrice,
          priceLockedUntil: snapshot.priceLockedUntil,
          sort: cart.items.length,
          ...(reorder && {
            reorderOfOrderId: reorder.orderId,
            reuseArtworkProofId: reorder.reuseArtworkProofId,
          }),
        },
      });
      const destinations =
        body.destinations ?? (await this.defaultDestination(tx, who.customerUserId, snapshot.quantity));
      if (destinations.length > 0)
        await this.writeDestinations(tx, who, item.id, snapshot.quantity, destinations);
      await this.touch(tx, cart.id);
      await this.record(
        tx,
        cart.publicId,
        'cart.item_added',
        { itemId: item.publicId, quoteId: quote.publicId },
        who,
      );
      return this.load(tx, cart.id);
    });
  }

  async updateItem(
    who: CartActor,
    itemId: string,
    ifMatch: string | undefined,
    body: UpdateCartItemDto,
  ): Promise<CartRow> {
    if (body.mockupOption && body.mockupOption !== 'none')
      throw new DomainException('cart.mockup_price_unavailable');
    return this.prisma.withTx(async (tx) => {
      const { cart, item } = await this.item(tx, who, itemId);
      assertIfMatch(ifMatch, cartEtag(cart));
      if (body.designOption) this.checkDesignOption(body.designOption, item.quoteOption.result);
      // D-276: naming a design (or a version of it) pins a version; a new design option keeps the pinned one.
      const design =
        body.designDocumentId !== undefined
          ? await this.designDocument(
              tx,
              who,
              body.designDocumentId,
              body.designOption ?? item.designOption,
              body.designVersionNo,
            )
          : undefined;
      await tx.cartItem.update({
        where: { id: item.id },
        data: {
          ...(body.designOption !== undefined && { designOption: body.designOption }),
          ...(design !== undefined && {
            designDocumentId: design?.documentId ?? null,
            designDocumentVersionId: design?.versionId ?? null,
          }),
          ...(body.designNote !== undefined && { designNote: body.designNote }),
          ...(body.mockupOption !== undefined && { mockupOption: body.mockupOption }),
          rowVersion: { increment: 1 },
        },
      });
      await this.touch(tx, cart.id);
      await this.record(tx, cart.publicId, 'cart.item_updated', { itemId }, who);
      return this.load(tx, cart.id);
    });
  }

  async setDestinations(
    who: CartActor,
    itemId: string,
    ifMatch: string | undefined,
    destinations: DestinationInputDto[],
  ): Promise<CartRow> {
    return this.prisma.withTx(async (tx) => {
      const { cart, item } = await this.item(tx, who, itemId);
      assertIfMatch(ifMatch, cartEtag(cart));
      await tx.cartItemDestination.deleteMany({ where: { cartItemId: item.id } });
      await this.writeDestinations(tx, who, item.id, item.quantity, destinations);
      await this.touch(tx, cart.id);
      await this.record(
        tx,
        cart.publicId,
        'cart.destinations_set',
        { itemId, count: destinations.length },
        who,
      );
      return this.load(tx, cart.id);
    });
  }

  async removeItem(who: CartActor, itemId: string, ifMatch: string | undefined): Promise<CartRow> {
    return this.prisma.withTx(async (tx) => {
      const { cart, item } = await this.item(tx, who, itemId);
      assertIfMatch(ifMatch, cartEtag(cart), { required: false });
      await tx.cartItem.delete({ where: { id: item.id } });
      await this.touch(tx, cart.id);
      await this.record(tx, cart.publicId, 'cart.item_removed', { itemId }, who);
      return this.load(tx, cart.id);
    });
  }

  /**
   * An item past its price lock is re-priced at today's prices (a new quotation, D-051); the result waits
   * for the client's confirmation. RFQ quotations are not re-priced (ask for a new quotation).
   */
  async reprice(who: CartActor, itemId: string): Promise<CartRow> {
    const { item } = await this.prisma.withTx((tx) => this.item(tx, who, itemId));
    if (item.priceLockedUntil > new Date()) throw new DomainException('cart.price_locked');
    if (item.quote.source !== 'instant') throw new DomainException('quotes.not_repriceable');
    const fresh = await this.quotes.reprice(this.owner(who), item.quote.publicId);
    return this.prisma.withTx(async (tx) => {
      const { cart, item: current } = await this.item(tx, who, itemId);
      const option = await tx.quoteOption.findFirst({
        where: { quoteId: fresh.id, quantity: current.quantity },
      });
      if (!option) throw new DomainException('cart.reprice_unavailable');
      const previous = new MoneyDecimal(current.grossAmount.toString());
      const next = new MoneyDecimal(option.grossAmount.toString());
      const diff: RepriceDiff = {
        previousGrossAmount: previous.toFixed(2),
        newGrossAmount: next.toFixed(2),
        differenceAmount: next.sub(previous).toFixed(2),
        newUnitPrice: option.unitPrice.toFixed(2),
        validUntil: fresh.validUntil.toISOString(),
      };
      await tx.cartItem.update({
        where: { id: current.id },
        data: {
          pendingQuoteId: fresh.id,
          pendingQuoteOptionId: option.id,
          pendingPriceDiff: diff as unknown as Prisma.InputJsonValue,
          rowVersion: { increment: 1 },
        },
      });
      await this.touch(tx, cart.id);
      await this.record(tx, cart.publicId, 'cart.item_repriced', { itemId, ...diff }, who);
      return this.load(tx, cart.id);
    });
  }

  /** The client accepts the re-priced option: the item takes the new quotation and its lock. */
  async confirmReprice(who: CartActor, itemId: string, ifMatch: string | undefined): Promise<CartRow> {
    return this.prisma.withTx(async (tx) => {
      const { cart, item } = await this.item(tx, who, itemId);
      assertIfMatch(ifMatch, cartEtag(cart));
      if (!item.pendingQuoteOptionId || !item.pendingQuote || !item.pendingQuoteOption)
        throw new DomainException('cart.no_pending_reprice');
      const option = item.pendingQuoteOption;
      await tx.cartItem.update({
        where: { id: item.id },
        data: {
          quoteId: item.pendingQuote.id,
          quoteOptionId: option.id,
          netAmount: option.netAmount,
          vatAmount: option.vatAmount,
          grossAmount: option.grossAmount,
          shippingAmount: option.shippingAmount,
          unitPrice: option.unitPrice,
          priceLockedUntil: item.pendingQuote.validUntil,
          repricedAt: new Date(),
          pendingQuoteId: null,
          pendingQuoteOptionId: null,
          pendingPriceDiff: Prisma.DbNull,
          rowVersion: { increment: 1 },
        },
      });
      await this.touch(tx, cart.id);
      await this.record(
        tx,
        cart.publicId,
        'cart.reprice_confirmed',
        { itemId, quoteId: item.pendingQuote.publicId },
        who,
      );
      return this.load(tx, cart.id);
    });
  }

  /**
   * D-452 (Stage C C5): a new quantity for an instant item. The same locked quotation's option for that quantity
   * when it has one (its price and lock stay); otherwise the configuration is priced again by the quote engine as a
   * new saved quotation (today's prices, a new lock — the old quotation stays saved), carrying the other quantities
   * so the tier hint still works. One destination follows the new quantity; a split is cleared (set again at
   * checkout). RFQ quotations, Studio design pins, reorders and items with a re-price waiting are refused.
   */
  async changeQuantity(
    who: CartActor,
    itemId: string,
    ifMatch: string | undefined,
    quantity: number,
  ): Promise<CartRow> {
    const { cart: before, item } = await this.prisma.withTx((tx) => this.item(tx, who, itemId));
    assertIfMatch(ifMatch, cartEtag(before));
    if (
      item.quote.source !== 'instant' ||
      item.quote.designDocumentVersionId !== null ||
      item.reorderOfOrderId !== null ||
      item.pendingQuoteOptionId !== null
    )
      throw new DomainException('cart.quantity_unavailable');
    if (quantity === item.quantity) return before;
    const product = item.quote.catalogProductId
      ? await this.prisma.catalogProduct.findUnique({
          where: { id: item.quote.catalogProductId },
          select: { quantityMin: true, quantityMax: true },
        })
      : null;
    // D-454: this item's own size against the product's limits (never summed with other items).
    const limitError = quantityLimitError(quantity, product);
    if (limitError) invalid(limitError.path, limitError.message, limitError.code);
    const live = item.priceLockedUntil > new Date();
    let option = live
      ? await this.prisma.quoteOption.findFirst({ where: { quoteId: item.quoteId, quantity } })
      : null;
    let lockedUntil = item.priceLockedUntil;
    if (!option) {
      const input = item.quote.input as unknown as {
        productTypeCode: string;
        configuration: Record<string, unknown>;
        deliveryPostcode: string | null;
      };
      const known = (await this.prisma.quoteOption.findMany({ where: { quoteId: item.quoteId } })).map(
        (o) => o.quantity,
      );
      const quantities = [...new Set([...known, quantity])]
        .sort((a, b) => Math.abs(a - quantity) - Math.abs(b - quantity))
        .slice(0, 10)
        .sort((a, b) => a - b);
      let fresh;
      try {
        fresh = await this.quotes.save(
          this.owner(who),
          item.quote.channel,
          {
            productTypeCode: input.productTypeCode,
            configuration: { ...input.configuration, quantities },
            deliveryPostcode: input.deliveryPostcode ?? undefined,
            targetPricePerUnit: item.quote.targetPricePerUnit?.toFixed(2) ?? null,
          },
          { customerUserId: item.quote.customerUserId ?? undefined },
        );
      } catch (error) {
        if (error instanceof DomainException && error.code === 'quotes.nothing_to_save')
          throw new DomainException('cart.quantity_unavailable');
        throw error;
      }
      option = fresh.options.find((o) => o.quantity === quantity) ?? null;
      if (!option) throw new DomainException('cart.quantity_unavailable');
      lockedUntil = fresh.validUntil;
    }
    const chosen = option;
    return this.prisma.withTx(async (tx) => {
      const { cart, item: current } = await this.item(tx, who, itemId);
      assertIfMatch(ifMatch, cartEtag(cart));
      if (cart.items.some((i) => i.id !== current.id && i.quoteOptionId === chosen.id))
        throw new DomainException('cart.item_exists');
      this.checkDesignOption(current.designOption, chosen.result);
      await tx.cartItem.update({
        where: { id: current.id },
        data: {
          quoteId: chosen.quoteId,
          quoteOptionId: chosen.id,
          quantity,
          netAmount: chosen.netAmount,
          vatAmount: chosen.vatAmount,
          grossAmount: chosen.grossAmount,
          shippingAmount: chosen.shippingAmount,
          unitPrice: chosen.unitPrice,
          priceLockedUntil: lockedUntil,
          rowVersion: { increment: 1 },
        },
      });
      if (current.destinations.length === 1)
        await tx.cartItemDestination.update({
          where: { id: current.destinations[0]!.id },
          data: { quantity },
        });
      else if (current.destinations.length > 1)
        await tx.cartItemDestination.deleteMany({ where: { cartItemId: current.id } });
      await this.touch(tx, cart.id);
      await this.record(
        tx,
        cart.publicId,
        'cart.item_quantity_changed',
        { itemId, from: current.quantity, to: quantity, requoted: chosen.quoteId !== current.quoteId },
        who,
      );
      return this.load(tx, cart.id);
    });
  }

  // --- helpers --------------------------------------------------------------------------------------

  load(tx: Tx, cartId: bigint): Promise<CartRow> {
    return tx.cart.findUniqueOrThrow({ where: { id: cartId }, include: CART_INCLUDE });
  }

  owner(who: CartActor): QuoteOwner {
    return who.actor.type === 'user' && who.actor.audience === 'staff'
      ? { kind: 'staff', actor: who.actor }
      : { kind: 'customer', userId: who.customerUserId };
  }

  private async item(tx: Tx, who: CartActor, itemPublicId: string) {
    const cart = await this.active(tx, who);
    const item = cart.items.find((i) => i.publicId === itemPublicId);
    if (!item) throw new DomainException('http.not_found');
    return { cart, item };
  }

  /** `hired_design` only on a quotation priced with the design fee; `free_design` needs a promotion (B3.3). */
  /**
   * The customer's own online design (B4.1), only with `designOption = online_designer`, and the version the item
   * orders (D-276): the one named, else the current one — a design without a saved version cannot be ordered.
   */
  private async designDocument(
    tx: Tx,
    who: CartActor,
    publicId: string | null,
    designOption: string,
    versionNo?: number,
  ): Promise<{ documentId: bigint; versionId: bigint } | null> {
    if (publicId === null) return null;
    const doc = await tx.designDocument.findFirst({
      where: { publicId, ownerUserId: who.customerUserId, deletedAt: null },
    });
    if (!doc) throw new DomainException('http.not_found');
    // My own design (online designer), or a studio design handed to the design service (D-286).
    if (designOption !== 'online_designer' && designOption !== 'hired_design')
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'designDocumentId',
            code: 'invalid',
            message: 'a design needs designOption online_designer or hired_design',
          },
        ],
      });
    const version =
      versionNo !== undefined
        ? await tx.designDocumentVersion.findUnique({
            where: { documentId_versionNo: { documentId: doc.id, versionNo } },
            select: { id: true },
          })
        : doc.currentVersionId !== null
          ? { id: doc.currentVersionId }
          : null;
    if (versionNo !== undefined && !version) throw new DomainException('http.not_found');
    if (!version) throw new DomainException('designs.version_required');
    return { documentId: doc.id, versionId: version.id };
  }

  private checkDesignOption(option: string, result: Prisma.JsonValue) {
    const fee = new MoneyDecimal(((result ?? {}) as { designFeeAmount?: string }).designFeeAmount ?? '0');
    if (option === 'hired_design' && fee.lte(0)) throw new DomainException('cart.design_option_unavailable');
    if (option !== 'hired_design' && fee.gt(0)) throw new DomainException('cart.design_option_unavailable');
    if (option === 'free_design') throw new DomainException('cart.design_option_unavailable');
  }

  private async defaultDestination(tx: Tx, userId: bigint, quantity: number): Promise<DestinationInputDto[]> {
    const address = await tx.customerAddress.findFirst({
      where: { userId, kind: 'delivery', isDefault: true, deletedAt: null },
    });
    return address ? [{ addressId: address.publicId, quantity }] : [];
  }

  private async writeDestinations(
    tx: Tx,
    who: CartActor,
    cartItemId: bigint,
    quantity: number,
    destinations: DestinationInputDto[],
  ) {
    const sum = destinations.reduce((a, d) => a + d.quantity, 0);
    if (sum !== quantity) invalid('destinations', `quantities must add up to ${quantity}`, 'sum');
    const seen = new Set<string>();
    for (const [index, d] of destinations.entries()) {
      if (seen.has(d.addressId)) invalid(`destinations[${index}].addressId`, 'address used twice', 'unique');
      seen.add(d.addressId);
      const { id, snapshot } = await this.addressOf(tx, who.customerUserId, d.addressId, index);
      await tx.cartItemDestination.create({
        data: {
          cartItemId,
          customerAddressId: id,
          addressSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          quantity: d.quantity,
          sort: index,
        },
      });
    }
  }

  private async addressOf(
    tx: Tx,
    userId: bigint,
    publicId: string,
    index: number,
  ): Promise<{ id: bigint; snapshot: AddressSnapshot }> {
    try {
      const found = await this.customers.addressSnapshot(tx, userId, publicId);
      const row = await tx.customerAddress.findUniqueOrThrow({ where: { id: found.id } });
      if (row.kind !== 'delivery') invalid(`destinations[${index}].addressId`, 'not a delivery address');
      return found;
    } catch (error) {
      if (error instanceof DomainException && error.code === 'http.not_found')
        invalid(`destinations[${index}].addressId`, 'unknown address', 'exists');
      throw error;
    }
  }

  private async touch(tx: Tx, cartId: bigint) {
    await tx.cart.update({
      where: { id: cartId },
      data: { lastActivityAt: new Date(), rowVersion: { increment: 1 } },
    });
  }

  private async record(
    tx: Tx,
    cartPublicId: string,
    type: string,
    data: Record<string, unknown>,
    who: CartActor,
  ) {
    const event = await this.events.record(
      tx,
      { type, aggregateType: 'cart', aggregateId: cartPublicId, payload: { cartId: cartPublicId, ...data } },
      who.actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'cart',
      aggregatePublicId: cartPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor: who.actor,
    });
  }
}
