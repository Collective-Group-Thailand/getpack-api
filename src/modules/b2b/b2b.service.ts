import { type Actor, type ApiClientActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type CartActor, CartsService } from '@modules/carts/carts.service';
import { CheckoutService } from '@modules/checkout/checkout.service';
import { CompaniesService } from '@modules/companies/companies.service';
import { OrdersService } from '@modules/orders/orders.service';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { CustomerDocumentsService } from '@modules/receivables/customer-documents.service';
import { Injectable } from '@nestjs/common';

import { type B2bMeDto, type B2bScope, type PlaceB2bOrderDto } from './b2b.dto';

export interface B2bClient {
  actor: ApiClientActor;
  apiClientId: bigint;
  publicId: string;
  name: string;
  scopes: B2bScope[];
  company: { id: bigint; publicId: string; legalName: string };
  ownerUserId: bigint;
}

/**
 * D-291 what a company API client does on `/v1/b2b`: reads its company's orders and documents, places orders for the
 * company from its owner's saved quotations (the normal cart and checkout, channel `b2b`, the owner as the customer,
 * the client as the actor), manages webhooks. Every read is scoped to the client's company.
 */
@Injectable()
export class B2bService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly carts: CartsService,
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
    private readonly quotes: SavedQuotesService,
    private readonly documents: CustomerDocumentsService,
  ) {}

  /** The calling client, its company and owner; any other caller is refused. */
  async client(actor: Actor): Promise<B2bClient> {
    if (actor.type !== 'api_client' || actor.audience !== 'b2b') throw new DomainException('auth.forbidden');
    const row = await this.prisma.apiClient.findUnique({
      where: { id: actor.apiClientId },
      include: { company: { select: { id: true, publicId: true, legalName: true, status: true } } },
    });
    if (!row?.company || row.ownerUserId === null || row.company.status !== 'active')
      throw new DomainException('auth.forbidden');
    return {
      actor,
      apiClientId: row.id,
      publicId: row.publicId,
      name: row.name,
      scopes: row.scopes as B2bScope[],
      company: { id: row.company.id, publicId: row.company.publicId, legalName: row.company.legalName },
      ownerUserId: row.ownerUserId,
    };
  }

  me(client: B2bClient): B2bMeDto {
    return {
      clientId: client.publicId,
      name: client.name,
      scopes: client.scopes,
      company: { id: client.company.publicId, legalName: client.company.legalName },
    };
  }

  /** The owner's saved quotations still valid — what the client may order from. */
  liveQuotes(client: B2bClient, page: number, perPage: number) {
    return this.quotes.list(
      {
        customerUserId: client.ownerUserId,
        status: { in: ['saved', 'shared'] },
        validUntil: { gt: new Date() },
      },
      page,
      perPage,
    );
  }

  orderGroups(client: B2bClient, page: number, perPage: number) {
    return this.orders.groups({ companyId: client.company.id }, page, perPage);
  }

  async order(client: B2bClient, orderPublicId: string) {
    const row = await this.orders.order({ publicId: orderPublicId });
    const group = await this.prisma.orderGroup.findUnique({ where: { id: row.orderGroupId } });
    if (group?.companyId !== client.company.id) throw new DomainException('http.not_found');
    return row;
  }

  /**
   * Places an order for the company from one of the owner's saved quotations: the client's `b2b` cart is emptied,
   * the quotation added, checkout run with the company (its PO policy, approval threshold and credit apply, D-123).
   * The owner must still be allowed to order for the company.
   */
  async place(client: B2bClient, input: PlaceB2bOrderDto) {
    if (
      !(await this.companies.hasCompanyPermission(
        client.ownerUserId,
        client.company.id,
        'company_orders.place',
      ))
    )
      throw new DomainException('b2b.owner_cannot_order');
    const who: CartActor = {
      actor: client.actor,
      customerUserId: client.ownerUserId,
      channel: 'b2b',
      csUserId: null,
    };
    const cart = await this.carts.get(who);
    for (const item of cart.items) await this.carts.removeItem(who, item.publicId, undefined);
    await this.carts.addItem(who, undefined, {
      quoteId: input.quoteId,
      quoteOptionId: input.quoteOptionId,
      designOption: 'own_file',
      ...(input.destinations && { destinations: input.destinations }),
    });
    const group = await this.checkout.checkout(who, {
      ...(input.poNumber && { poNumber: input.poNumber }),
      ...(input.expectedGrossAmount && { expectedGrossAmount: input.expectedGrossAmount }),
      extensions: {
        company: { companyId: client.company.publicId, branchId: input.companyBranchId ?? null },
      },
    });
    return this.orders.group(group.publicId);
  }

  documentsOf(client: B2bClient, page: number, perPage: number) {
    return this.documents.list({ companyId: client.company.id }, page, perPage);
  }

  async document(client: B2bClient, documentPublicId: string) {
    const doc = await this.prisma.customerDocument.findFirst({
      where: { publicId: documentPublicId, companyId: client.company.id },
      select: { id: true },
    });
    if (!doc) throw new DomainException('http.not_found');
    const rows = await this.documents.list({ id: doc.id }, 1, 1);
    return rows.rows[0]!;
  }
}
