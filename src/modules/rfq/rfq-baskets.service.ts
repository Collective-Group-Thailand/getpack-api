import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { cartDto } from '@modules/carts/cart-views';
import { CartsService } from '@modules/carts/carts.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import {
  type AcceptBasketItemDto,
  type AcceptedBasketDto,
  type AddBasketProductDto,
  MAX_BASKET_ITEMS,
  type RfqBasketDto,
  type RfqBasketItemInputDto,
  type SetBasketDetailsDto,
} from './rfq-baskets.dto';
import { productOf, rfqDto } from './rfq-views';
import { type RfqProductRefDto } from './rfqs.dto';
import { type RfqPlan, RfqsService, type SubmitRfqInput } from './rfqs.service';

const INCLUDE = {
  items: {
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    include: {
      productType: {
        select: {
          publicId: true,
          code: true,
          nameTh: true,
          nameEn: true,
          category: { select: { code: true } },
        },
      },
      designDocumentVersion: { select: { versionNo: true, designDocument: { select: { publicId: true } } } },
      rfq: { select: { publicId: true } },
    },
  },
  conversation: { select: { publicId: true } },
} satisfies Prisma.RfqBasketInclude;
type BasketRow = Prisma.RfqBasketGetPayload<{ include: typeof INCLUDE }>;

/** What an item stores: the RFQ form without the basket-wide delivery fields. */
type ItemSpec = Omit<SubmitRfqInput, 'deliveryPostcode' | 'targetDate' | 'notes' | 'routedFrom'>;

/** The product a line names (C1 product reference), as stored in its specification. */
type ProductRef = { catalogProductSlug?: string; stockProductSku?: string };
const refOf = (specification: unknown): ProductRef => {
  const s = (specification ?? {}) as ProductRef;
  return {
    ...(typeof s.catalogProductSlug === 'string' && { catalogProductSlug: s.catalogProductSlug }),
    ...(typeof s.stockProductSku === 'string' && { stockProductSku: s.stockProductSku }),
  };
};
const sameProduct = (a: ProductRef, b: ProductRef) =>
  (!!a.catalogProductSlug && a.catalogProductSlug === b.catalogProductSlug) ||
  (!!a.stockProductSku && a.stockProductSku === b.stockProductSku);

const invalid = (path: string, message: string, code = 'invalid'): never => {
  throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
};

/** Field errors of an item's checks, placed under the item (`items[2].spec.material`). */
async function under<T>(prefix: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainException && error.code === 'validation.failed' && error.errors)
      throw new DomainException('validation.failed', {
        errors: error.errors.map((e) => ({ ...e, path: `${prefix}.${e.path}` })),
      });
    throw error;
  }
}

/**
 * Multi-item RFQ basket (U5.B3, D-301): one draft per customer, items added one by one (each the store RFQ form of a
 * product type, optionally for one of my design versions), one submission that checks every item first and then, in
 * one transaction, numbers the basket, opens its conversation and creates one RFQ per item. Each RFQ is then quoted,
 * consulted and accepted exactly like a single one; accepting items turns the chosen quantities into cart lines at
 * the quoted price, locked until the quotation's validity (B3.1).
 */
@Injectable()
export class RfqBasketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rfqs: RfqsService,
    private readonly carts: CartsService,
    private readonly conversations: ConversationsService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- draft -------------------------------------------------------------------------------------------------

  async draft(actor: UserActor): Promise<RfqBasketDto> {
    return this.prisma.withTx(async (tx) => this.view(await this.draftRow(tx, actor, true)));
  }

  async addItem(actor: UserActor, input: RfqBasketItemInputDto): Promise<RfqBasketDto> {
    const { spec, designVersionId, productTypeId } = await this.checkItem(actor, input, 'item');
    return this.prisma.withTx(async (tx) => {
      const basket = await this.draftRow(tx, actor, true);
      // C1b §10.9: the filled form of a product waiting in the basket (put in from the quote tray) fills that line.
      const ref = refOf(spec);
      const waiting = basket.items.find((i) => i.formPending && sameProduct(refOf(i.specification), ref));
      if (waiting) {
        await tx.rfqBasketItem.update({
          where: { id: waiting.id },
          data: {
            productTypeId,
            specification: spec as unknown as Prisma.InputJsonValue,
            designDocumentVersionId: designVersionId,
            formPending: false,
          },
        });
        return this.view(await this.touch(tx, basket.id));
      }
      if (basket.items.length >= MAX_BASKET_ITEMS)
        invalid('items', `a basket holds up to ${MAX_BASKET_ITEMS} items`, 'maxItems');
      await tx.rfqBasketItem.create({
        data: {
          basketId: basket.id,
          sort: (basket.items.at(-1)?.sort ?? -1) + 1,
          productTypeId,
          specification: spec as unknown as Prisma.InputJsonValue,
          designDocumentVersionId: designVersionId,
        },
      });
      return this.view(await this.touch(tx, basket.id));
    });
  }

  async updateItem(actor: UserActor, itemId: string, input: RfqBasketItemInputDto): Promise<RfqBasketDto> {
    const { spec, designVersionId, productTypeId } = await this.checkItem(actor, input, 'item');
    return this.prisma.withTx(async (tx) => {
      const basket = await this.draftRow(tx, actor, false);
      const item = basket?.items.find((i) => i.publicId === itemId);
      if (!basket || !item) throw new DomainException('http.not_found');
      await tx.rfqBasketItem.update({
        where: { id: item.id },
        data: {
          productTypeId,
          specification: spec as unknown as Prisma.InputJsonValue,
          designDocumentVersionId: designVersionId,
          formPending: false,
        },
      });
      return this.view(await this.touch(tx, basket.id));
    });
  }

  /**
   * C1b (owner 2026-10-28, DECISIONS-STAGE-A §10.9): the storefront's quote tray of a signed-in customer — a product
   * goes straight into my draft basket as a line whose form is still to be filled (`formPending`), so the tray follows
   * the account across devices, and a guest's tray merges into it at sign-in. Putting in a product that is already
   * waiting is a no-op; the basket's 20-line limit applies (D-301). The line is filled by `addItem` (the same product's
   * form) or `updateItem`; `submit` refuses a basket with a pending line.
   */
  async addProduct(actor: UserActor, input: AddBasketProductDto): Promise<RfqBasketDto> {
    if (!!input.catalogProductSlug === !!input.stockProductSku)
      invalid('catalogProductSlug', 'give either catalogProductSlug or stockProductSku', 'oneOf');
    const product = input.catalogProductSlug
      ? await this.prisma.catalogProduct.findFirst({
          where: { slug: input.catalogProductSlug, status: 'active', productType: { status: 'active' } },
          select: { productType: { select: { id: true, code: true } } },
        })
      : await this.prisma.stockProduct.findFirst({
          where: { sku: input.stockProductSku, status: 'active', productType: { status: 'active' } },
          select: { productType: { select: { id: true, code: true } } },
        });
    if (!product)
      invalid(
        input.catalogProductSlug ? 'catalogProductSlug' : 'stockProductSku',
        'not an active product',
        'exists',
      );
    const ref: ProductRef = input.catalogProductSlug
      ? { catalogProductSlug: input.catalogProductSlug }
      : { stockProductSku: input.stockProductSku! };
    return this.prisma.withTx(async (tx) => {
      const basket = await this.draftRow(tx, actor, true);
      if (basket.items.some((i) => i.formPending && sameProduct(refOf(i.specification), ref)))
        return this.view(basket);
      if (basket.items.length >= MAX_BASKET_ITEMS)
        invalid('items', `a basket holds up to ${MAX_BASKET_ITEMS} items`, 'maxItems');
      await tx.rfqBasketItem.create({
        data: {
          basketId: basket.id,
          sort: (basket.items.at(-1)?.sort ?? -1) + 1,
          productTypeId: product!.productType.id,
          specification: { productTypeCode: product!.productType.code, ...ref },
          formPending: true,
        },
      });
      return this.view(await this.touch(tx, basket.id));
    });
  }

  async removeItem(actor: UserActor, itemId: string): Promise<RfqBasketDto> {
    return this.prisma.withTx(async (tx) => {
      const basket = await this.draftRow(tx, actor, false);
      const item = basket?.items.find((i) => i.publicId === itemId);
      if (!basket || !item) throw new DomainException('http.not_found');
      await tx.rfqBasketItem.delete({ where: { id: item.id } });
      return this.view(await this.touch(tx, basket.id));
    });
  }

  async setDetails(actor: UserActor, input: SetBasketDetailsDto): Promise<RfqBasketDto> {
    return this.prisma.withTx(async (tx) => {
      const basket = await this.draftRow(tx, actor, true);
      await tx.rfqBasket.update({
        where: { id: basket.id },
        data: {
          ...(input.deliveryPostcode !== undefined && { deliveryPostcode: input.deliveryPostcode }),
          ...(input.targetDate !== undefined && {
            targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null,
          }),
          ...(input.notes !== undefined && { notes: input.notes.trim() }),
        },
      });
      return this.view(await this.touch(tx, basket.id));
    });
  }

  async discard(actor: UserActor): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const basket = await this.draftRow(tx, actor, false);
      if (!basket) throw new DomainException('http.not_found');
      await tx.rfqBasket.update({ where: { id: basket.id }, data: { status: 'discarded' } });
      await this.record(tx, actor, basket.publicId, 'rfq_basket.discarded', { items: basket.items.length });
    });
  }

  // --- submission ----------------------------------------------------------------------------------------------

  /** D-301: every item checked first; then one transaction numbers the basket, opens its thread and creates the RFQs. */
  async submit(actor: UserActor): Promise<RfqBasketDto> {
    const basket = await this.draftRow(this.prisma, actor, false);
    if (!basket) throw new DomainException('http.not_found');
    if (basket.items.length === 0) invalid('items', 'add at least one item', 'minItems');
    // C1b §10.9: a product put in from the quote tray is asked only once its form is filled.
    const pending = basket.items.findIndex((i) => i.formPending);
    if (pending >= 0)
      invalid(`items[${pending}]`, "fill this item's form first (store.rfqBaskets.addItem)", 'required');
    if (!basket.deliveryPostcode)
      invalid('deliveryPostcode', 'set the delivery postcode (store.rfqBaskets.setDetails)', 'required');
    if (basket.targetDate && bangkokDate(basket.targetDate) < bangkokDate(new Date()))
      invalid('targetDate', 'the target date has passed');
    const plans: { plan: RfqPlan; itemId: bigint; designVersionId: bigint | null }[] = [];
    for (const [index, item] of basket.items.entries()) {
      const spec = item.specification as unknown as ItemSpec;
      const plan = await under(`items[${index}]`, () =>
        this.rfqs.prepare(actor.userId, 'web', {
          ...spec,
          deliveryPostcode: basket.deliveryPostcode!,
          targetDate: basket.targetDate ? bangkokDate(basket.targetDate) : null,
          notes: basket.notes,
        }),
      );
      plans.push({ plan, itemId: item.id, designVersionId: item.designDocumentVersionId });
    }
    await this.prisma.withTx(async (tx) => {
      const current = await tx.rfqBasket.findUniqueOrThrow({ where: { id: basket.id } });
      if (current.status !== 'draft' || current.rowVersion !== basket.rowVersion)
        throw new DomainException('rfq_baskets.changed');
      const now = new Date();
      const basketCode = await this.numbering.next(tx, 'rfq_basket', now);
      const created: string[] = [];
      for (const p of plans) {
        const rfq = await this.rfqs.create(tx, p.plan, {
          basketId: basket.id,
          designDocumentVersionId: p.designVersionId,
        });
        await tx.rfqBasketItem.update({ where: { id: p.itemId }, data: { rfqId: rfq.id } });
        created.push(rfq.rfqCode);
      }
      await tx.rfqBasket.update({
        where: { id: basket.id },
        data: { status: 'submitted', basketCode, submittedAt: now, rowVersion: { increment: 1 } },
      });
      // One conversation for the whole basket: the notes (or a line naming the basket) are its first message.
      const conversation = await this.conversations.openBasketThread(
        tx,
        actor.userId,
        basket.id,
        basket.notes || `คำขอใบเสนอราคา ${basketCode} (${plans.length} รายการ)`,
      );
      await tx.rfqBasket.update({ where: { id: basket.id }, data: { conversationId: conversation.id } });
      await this.record(tx, actor, basket.publicId, 'rfq_basket.submitted', {
        basketCode,
        items: plans.length,
        rfqCodes: created,
      });
    });
    // Read once committed: the items' RFQs are read through the RFQ service.
    return this.view(await this.row(this.prisma, basket.id));
  }

  // --- reads ---------------------------------------------------------------------------------------------------

  async list(actor: UserActor): Promise<RfqBasketDto[]> {
    const rows = await this.prisma.rfqBasket.findMany({
      where: { customerUserId: actor.userId, status: { not: 'discarded' } },
      include: INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(actor: UserActor, publicId: string): Promise<RfqBasketDto> {
    const row = await this.prisma.rfqBasket.findUnique({ where: { publicId }, include: INCLUDE });
    if (!row || row.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    return this.view(row);
  }

  // --- acceptance --------------------------------------------------------------------------------------------

  /**
   * D-301: the chosen quotation tier of each item becomes a quotation (`RfqsService.accept`) and a cart line at the
   * quoted price, locked until the quotation's validity. Every choice is checked before anything is accepted.
   */
  async acceptItems(
    actor: UserActor,
    publicId: string,
    choices: AcceptBasketItemDto[],
  ): Promise<AcceptedBasketDto> {
    const basket = await this.prisma.rfqBasket.findUnique({ where: { publicId }, include: INCLUDE });
    if (!basket || basket.customerUserId !== actor.userId) throw new DomainException('http.not_found');
    if (basket.status !== 'submitted') throw new DomainException('rfq_baskets.not_submitted');
    if (new Set(choices.map((c) => c.itemId)).size !== choices.length)
      invalid('items', 'each item once', 'unique');
    const picked: { item: BasketRow['items'][number]; rfqPublicId: string; choice: AcceptBasketItemDto }[] =
      [];
    for (const [index, choice] of choices.entries()) {
      const item = basket.items.find((i) => i.publicId === choice.itemId);
      if (!item?.rfq) invalid(`items[${index}].itemId`, 'not an item of this basket', 'exists');
      const rfq = await this.rfqs.forCustomer(actor.userId, item!.rfq!.publicId);
      const quote = rfq.quotes.find((q) => q.publicId === choice.rfqQuoteId);
      if (!quote) invalid(`items[${index}].rfqQuoteId`, 'not a quotation of this item', 'exists');
      if (
        rfq.status !== 'quoted' ||
        quote!.status !== 'sent' ||
        !quote!.validUntil ||
        quote!.validUntil <= new Date()
      )
        throw new DomainException('rfq.quote_not_open', { params: { item: index } });
      if (!quote!.lines.some((l) => l.quantity === choice.quantity))
        invalid(`items[${index}].quantity`, 'not a quoted quantity', 'invalid');
      picked.push({ item: item!, rfqPublicId: rfq.publicId, choice });
    }
    const who = { actor, customerUserId: actor.userId, channel: 'web' as const, csUserId: null };
    let cart = await this.carts.get(who);
    for (const { item, rfqPublicId, choice } of picked) {
      const accepted = await this.rfqs.accept(actor.userId, rfqPublicId, choice.rfqQuoteId, [
        choice.quantity,
      ]);
      const quote = await this.prisma.quote.findUniqueOrThrow({
        where: { id: accepted.acceptedQuoteId! },
        include: { options: { select: { publicId: true, quantity: true } } },
      });
      const option = quote.options.find((o) => o.quantity === choice.quantity)!;
      const design = item.designDocumentVersion;
      cart = await this.carts.addItem(who, undefined, {
        quoteId: quote.publicId,
        quoteOptionId: option.publicId,
        designOption: design ? 'online_designer' : 'own_file',
        ...(design && {
          designDocumentId: design.designDocument.publicId,
          designVersionNo: design.versionNo,
        }),
      });
    }
    await this.prisma.withTx((tx) =>
      this.record(tx, actor, basket.publicId, 'rfq_basket.items_accepted', {
        items: picked.map((p) => p.item.publicId),
      }),
    );
    return {
      basket: await this.get(actor, publicId),
      cart: cartDto(cart),
    };
  }

  // --- helpers -------------------------------------------------------------------------------------------------

  /** The item's own checks, before it is stored: the product type's form (without delivery) and my design version. */
  private async checkItem(actor: UserActor, input: RfqBasketItemInputDto, path: string) {
    const { design, ...spec } = input;
    // The RFQ checks with a placeholder delivery: the basket's postcode is checked on submission.
    const plan = await under(path, () =>
      this.rfqs.prepare(actor.userId, 'web', { ...spec, deliveryPostcode: '00000' }),
    );
    let designVersionId: bigint | null = null;
    if (design) {
      const doc = await this.prisma.designDocument.findFirst({
        where: { publicId: design.designId, ownerUserId: actor.userId, deletedAt: null },
        select: { id: true, currentVersionId: true },
      });
      if (!doc) invalid(`${path}.design.designId`, 'not a design of mine', 'exists');
      const version = design.versionNo
        ? await this.prisma.designDocumentVersion.findFirst({
            where: { documentId: doc!.id, versionNo: design.versionNo },
            select: { id: true },
          })
        : doc!.currentVersionId
          ? { id: doc!.currentVersionId }
          : null;
      if (!version) invalid(`${path}.design.versionNo`, 'no such version', 'exists');
      designVersionId = version!.id;
    }
    return { spec: spec as ItemSpec, designVersionId, productTypeId: plan.type.id };
  }

  private async draftRow(db: Tx, actor: UserActor, create: true): Promise<BasketRow>;
  private async draftRow(db: Tx, actor: UserActor, create: false): Promise<BasketRow | null>;
  private async draftRow(db: Tx, actor: UserActor, create: boolean): Promise<BasketRow | null> {
    const where = { customerUserId: actor.userId, channel: 'web' as const, status: 'draft' as const };
    const found = await db.rfqBasket.findFirst({ where, include: INCLUDE });
    if (found || !create) return found;
    await db.rfqBasket.createMany({ data: [{ customerUserId: actor.userId }], skipDuplicates: true });
    return db.rfqBasket.findFirstOrThrow({ where, include: INCLUDE });
  }

  private async touch(tx: Tx, id: bigint): Promise<BasketRow> {
    await tx.rfqBasket.update({ where: { id }, data: { rowVersion: { increment: 1 } } });
    return this.row(tx, id);
  }

  private row(db: Tx, id: bigint): Promise<BasketRow> {
    return db.rfqBasket.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }

  /** C1: the products the lines name (by slug / SKU in the item), read once per basket. */
  private async productsOf(
    b: BasketRow,
  ): Promise<(i: BasketRow['items'][number]) => RfqProductRefDto | null> {
    const spec = (i: BasketRow['items'][number]) =>
      i.specification as { catalogProductSlug?: string; stockProductSku?: string };
    const slugs = [
      ...new Set(b.items.map((i) => spec(i).catalogProductSlug).filter((v): v is string => !!v)),
    ];
    const skus = [...new Set(b.items.map((i) => spec(i).stockProductSku).filter((v): v is string => !!v))];
    const [catalog, stock] = await Promise.all([
      slugs.length
        ? this.prisma.catalogProduct.findMany({
            where: { slug: { in: slugs } },
            select: { slug: true, nameTh: true, nameEn: true },
          })
        : [],
      skus.length
        ? this.prisma.stockProduct.findMany({
            where: { sku: { in: skus } },
            select: { sku: true, nameTh: true, nameEn: true },
          })
        : [],
    ]);
    const bySlug = new Map(catalog.map((p) => [p.slug, p]));
    const bySku = new Map(stock.map((p) => [p.sku, p]));
    return (i) => {
      const { catalogProductSlug, stockProductSku } = spec(i);
      return productOf({
        catalogProduct: (catalogProductSlug && bySlug.get(catalogProductSlug)) || null,
        stockProduct: (stockProductSku && bySku.get(stockProductSku)) || null,
      });
    };
  }

  private async view(b: BasketRow): Promise<RfqBasketDto> {
    const productOfItem = await this.productsOf(b);
    return {
      id: b.publicId,
      basketCode: b.basketCode,
      status: b.status,
      deliveryPostcode: b.deliveryPostcode,
      targetDate: b.targetDate ? bangkokDate(b.targetDate) : null,
      notes: b.notes,
      conversationId: b.conversation?.publicId ?? null,
      submittedAt: b.submittedAt ? toBangkokIso(b.submittedAt) : null,
      items: await Promise.all(
        b.items.map(async (i) => {
          const rfq = i.rfq ? await this.rfqs.forCustomer(b.customerUserId, i.rfq.publicId) : null;
          return {
            id: i.publicId,
            sort: i.sort,
            productType: {
              id: i.productType.publicId,
              code: i.productType.code,
              nameTh: i.productType.nameTh,
              nameEn: i.productType.nameEn,
            },
            specification: i.specification as Record<string, unknown>,
            formPending: i.formPending,
            categoryCode: i.productType.category?.code ?? null,
            design: i.designDocumentVersion
              ? {
                  designId: i.designDocumentVersion.designDocument.publicId,
                  versionNo: i.designDocumentVersion.versionNo,
                }
              : null,
            product: productOfItem(i),
            rfq: rfq ? rfqDto(rfq, await this.rfqs.attachments(rfq)) : null,
          };
        }),
      ),
      createdAt: toBangkokIso(b.createdAt),
    };
  }

  private async record(
    tx: Tx,
    actor: UserActor,
    publicId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    const event = await this.events.record(
      tx,
      { type, aggregateType: 'rfq_basket', aggregateId: publicId, payload: { basketId: publicId, ...data } },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'rfq_basket',
      aggregatePublicId: publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}
