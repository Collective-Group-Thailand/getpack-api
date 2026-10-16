import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { orderDto, orderGroupDto, orderViewContext } from '@modules/orders/order-views';
import { ORDER_EXAMPLE, ORDER_GROUP_EXAMPLE, OrderDto, OrderGroupDto } from '@modules/orders/orders.dto';
import { quoteDto } from '@modules/quotes/quote-views';
import { QUOTE_EXAMPLE, SavedQuoteDto } from '@modules/quotes/quotes.dto';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { CustomerDocumentDto, DOCUMENT_EXAMPLE } from '@modules/receivables/receivables.dto';
import { documentDto } from '@modules/receivables/receivables-views';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';
import { SettingsService } from '@platform/settings/settings.service';

import {
  API_CLIENT_EXAMPLE,
  B2B_IDS,
  B2B_ME_EXAMPLE,
  B2bMeDto,
  CompanyApiClientDto,
  CreatedWebhookSubscriptionDto,
  CreateWebhookSubscriptionDto,
  DELIVERY_EXAMPLE,
  IssueApiClientDto,
  IssuedCompanyApiClientDto,
  PlaceB2bOrderDto,
  SUBSCRIPTION_EXAMPLE,
  WebhookDeliveryDto,
  WebhookSubscriptionDto,
} from './b2b.dto';
import { B2bService } from './b2b.service';
import { CompanyApiClientsService } from './company-api-clients.service';
import { WebhooksService } from './webhooks.service';

const DECISIONS = ['D-291', 'D-207'];
const companyParam = ApiParam({ name: 'companyId', format: 'uuid' });
const clientParam = ApiParam({ name: 'clientId', format: 'uuid' });
const subscriptionParam = ApiParam({ name: 'subscriptionId', format: 'uuid' });
const DOWNLOAD_EXAMPLE = {
  url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
  expiresAt: '2026-10-05T10:05:00+07:00',
};
const SCOPED =
  'Company API clients only (client credentials, `aud=b2b`); everything is the client’s company’s (D-291).';

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

// --- the Company Admin issues clients (store) ---------------------------------------------------------------------

@ApiSurface('store', 'companyApiClients')
@Controller('companies/:companyId/api-clients')
export class StoreCompanyApiClientsController {
  constructor(private readonly clients: CompanyApiClientsService) {}

  @Get()
  @companyParam
  @ApiEndpoint({
    id: 'store.companyApiClients.list',
    summary: 'List my company’s API clients',
    description: 'Company Admin (`company_api.manage`): every client, newest first, never a secret (D-291).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Clients', type: [CompanyApiClientDto], example: [API_CLIENT_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.clients.list(customer(actor), companyId);
  }

  @Post()
  @Idempotent()
  @companyParam
  @ApiBody({
    type: IssueApiClientDto,
    examples: {
      default: { value: { name: 'ERP connector', scopes: ['b2b_orders.read', 'b2b_documents.read'] } },
    },
  })
  @ApiEndpoint({
    id: 'store.companyApiClients.issue',
    summary: 'Issue an API client for my company',
    description:
      'Company Admin (`company_api.manage`): at most `api.max_keys_per_company` active clients, with scopes; the ' +
      'secret is shown once. Orders the client places are mine, for the company (D-291).',
    implements: DECISIONS,
  })
  @ApiSuccess(201, {
    description: 'Issued',
    type: IssuedCompanyApiClientDto,
    example: { ...API_CLIENT_EXAMPLE, clientSecret: 'example-client-secret' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'companies.invalid_status',
    'b2b.client_limit',
  )
  issue(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: IssueApiClientDto,
  ) {
    return this.clients.issue(customer(actor), companyId, body);
  }

  @Post(':clientId/actions/revoke')
  @HttpCode(200)
  @Idempotent()
  @companyParam
  @clientParam
  @ApiEndpoint({
    id: 'store.companyApiClients.revoke',
    summary: 'Revoke an API client',
    description: 'No new token is issued to it; its tokens stop within the principal cache (30 s) (D-291).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Revoked',
    type: CompanyApiClientDto,
    example: { ...API_CLIENT_EXAMPLE, status: 'revoked' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'b2b.client_revoked')
  revoke(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clients.revoke(customer(actor), companyId, clientId);
  }
}

// --- the client (b2b) ---------------------------------------------------------------------------------------------

@ApiSurface('b2b', 'me')
@Controller('me')
export class B2bMeController {
  constructor(private readonly b2b: B2bService) {}

  @Get()
  @ApiEndpoint({
    id: 'b2b.me.get',
    summary: 'Who am I',
    description: `The calling client, its scopes and its company. ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Client', type: B2bMeDto, example: B2B_ME_EXAMPLE })
  @ApiStandardErrors()
  async get(@CurrentActor() actor: Actor) {
    return this.b2b.me(await this.b2b.client(actor));
  }
}

@ApiSurface('b2b', 'orders')
@Controller()
export class B2bOrdersController {
  constructor(
    private readonly b2b: B2bService,
    private readonly settings: SettingsService,
  ) {}

  @Get('quotes')
  @Can('b2b_orders.write')
  @ApiEndpoint({
    id: 'b2b.orders.listQuotes',
    summary: 'List the quotations I may order from',
    description: `The client owner’s saved quotations still valid, newest first (scope \`b2b_orders.write\`). ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiPaginated(SavedQuoteDto, { example: QUOTE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async quotes(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const { rows, total } = await this.b2b.liveQuotes(await this.b2b.client(actor), q.page, q.perPage);
    return { data: rows.map((r) => quoteDto(r)), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('order-groups')
  @Can('b2b_orders.read')
  @ApiEndpoint({
    id: 'b2b.orders.listGroups',
    summary: 'List my company’s order groups',
    description: `Newest first, with their orders and statuses; no factory data (D-050). ${SCOPED}`,
    implements: [...DECISIONS, 'D-050'],
  })
  @ApiPaginated(OrderGroupDto, { example: ORDER_GROUP_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async groups(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const { rows, total } = await this.b2b.orderGroups(await this.b2b.client(actor), q.page, q.perPage);
    const ctx = await orderViewContext(this.settings);
    return {
      data: rows.map((g) => orderGroupDto(g, ctx)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('orders/:orderId')
  @Can('b2b_orders.read')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'b2b.orders.get',
    summary: 'Get one of my company’s orders',
    description: `Lines, destinations and status (payment, artwork, production and shipping facts). ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Order', type: OrderDto, example: ORDER_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('orderId', ParseUUIDPipe) orderId: string) {
    const row = await this.b2b.order(await this.b2b.client(actor), orderId);
    return orderDto(row, await orderViewContext(this.settings));
  }

  @Post('orders')
  @Idempotent()
  @Can('b2b_orders.write')
  @ApiBody({
    type: PlaceB2bOrderDto,
    examples: {
      default: {
        value: {
          quoteId: B2B_IDS.quote,
          quoteOptionId: B2B_IDS.option,
          destinations: [{ addressId: B2B_IDS.address, quantity: 1000 }],
          poNumber: 'PO-2026-0042',
          expectedGrossAmount: '13508.40',
        },
      },
    },
  })
  @ApiEndpoint({
    id: 'b2b.orders.place',
    summary: 'Place an order for my company',
    description:
      'From a saved quotation of the client’s owner: the normal checkout for the company (channel `b2b`) — its PO ' +
      'policy, approval threshold and credit apply (D-123); shipping is priced per destination; the order follows ' +
      `the normal payment schedule (D-020). \`expectedGrossAmount\` guards the price. ${SCOPED}`,
    implements: [...DECISIONS, 'D-123', 'D-020'],
  })
  @ApiSuccess(201, { description: 'Placed', type: OrderGroupDto, example: ORDER_GROUP_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'quotes.not_live',
    'b2b.owner_cannot_order',
    'checkout.total_changed',
    'checkout.price_expired',
    'checkout.destinations_incomplete',
    'checkout.shipping_unavailable',
  )
  async place(@CurrentActor() actor: Actor, @Body() body: PlaceB2bOrderDto) {
    const group = await this.b2b.place(await this.b2b.client(actor), body);
    return orderGroupDto(group, await orderViewContext(this.settings));
  }
}

@ApiSurface('b2b', 'documents')
@Controller('documents')
export class B2bDocumentsController {
  constructor(
    private readonly b2b: B2bService,
    private readonly files: DocumentFilesService,
  ) {}

  @Get()
  @Can('b2b_documents.read')
  @ApiEndpoint({
    id: 'b2b.documents.list',
    summary: 'List my company’s documents',
    description: `Tax invoices, receipts and notes issued to the company (D-010, D-125). ${SCOPED}`,
    implements: [...DECISIONS, 'D-010', 'D-125'],
  })
  @ApiPaginated(CustomerDocumentDto, { example: DOCUMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const { rows, total } = await this.b2b.documentsOf(await this.b2b.client(actor), q.page, q.perPage);
    return { data: rows.map((r) => documentDto(r)), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get(':documentId/pdf')
  @Can('b2b_documents.read')
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'b2b.documents.pdf',
    summary: 'Download a document',
    description: `A short-lived signed URL of the PDF of one of the company’s documents. ${SCOPED}`,
    implements: [...DECISIONS, 'D-010'],
  })
  @ApiSuccess(200, { description: 'Signed URL', type: DownloadUrlDto, example: DOWNLOAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async pdf(
    @CurrentActor() actor: Actor,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DownloadUrlDto> {
    const doc = await this.b2b.document(await this.b2b.client(actor), documentId);
    const signed = await this.files.downloadUrl(doc.pdfFileId);
    return { url: signed.url, expiresAt: toBangkokIso(signed.expiresAt) };
  }
}

@ApiSurface('b2b', 'webhooks')
@Controller('webhook-subscriptions')
export class B2bWebhooksController {
  constructor(
    private readonly b2b: B2bService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get()
  @Can('b2b_webhooks.manage')
  @ApiEndpoint({
    id: 'b2b.webhooks.list',
    summary: 'List my company’s webhook subscriptions',
    description: `Never their secrets (D-291). ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Subscriptions',
    type: [WebhookSubscriptionDto],
    example: [SUBSCRIPTION_EXAMPLE],
  })
  @ApiStandardErrors()
  async list(@CurrentActor() actor: Actor) {
    return this.webhooks.list(await this.b2b.client(actor));
  }

  @Post()
  @Idempotent()
  @Can('b2b_webhooks.manage')
  @ApiBody({
    type: CreateWebhookSubscriptionDto,
    examples: {
      default: {
        value: {
          url: 'https://erp.example.com/getpack/webhooks',
          eventTypes: ['order.placed', 'shipment.delivered'],
        },
      },
    },
  })
  @ApiEndpoint({
    id: 'b2b.webhooks.create',
    summary: 'Subscribe to my company’s events',
    description:
      'Order (`order.placed`, `order.updated`), shipment (`shipment.shipped`, `shipment.delivered`) and document ' +
      '(`document.issued`) events of the company are POSTed to the HTTPS `url` with `Getpack-Event`, ' +
      '`Getpack-Delivery` and `Getpack-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` (the secret is shown ' +
      'once); a body holds ids, codes and statuses only. Non-2xx answers are retried after 1, 5, 30 min, 2 h and ' +
      `12 h, then the delivery fails (D-291). ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiSuccess(201, {
    description: 'Subscribed',
    type: CreatedWebhookSubscriptionDto,
    example: { ...SUBSCRIPTION_EXAMPLE, secret: 'whsec_example' },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async create(@CurrentActor() actor: Actor, @Body() body: CreateWebhookSubscriptionDto) {
    return this.webhooks.create(await this.b2b.client(actor), body);
  }

  @Post(':subscriptionId/actions/disable')
  @HttpCode(200)
  @Idempotent()
  @Can('b2b_webhooks.manage')
  @subscriptionParam
  @ApiEndpoint({
    id: 'b2b.webhooks.disable',
    summary: 'Disable a webhook subscription',
    description: `No new deliveries; pending ones are dropped (D-291). ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Disabled',
    type: WebhookSubscriptionDto,
    example: { ...SUBSCRIPTION_EXAMPLE, status: 'disabled' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async disable(@CurrentActor() actor: Actor, @Param('subscriptionId', ParseUUIDPipe) id: string) {
    return this.webhooks.disable(await this.b2b.client(actor), id);
  }

  @Get(':subscriptionId/deliveries')
  @Can('b2b_webhooks.manage')
  @subscriptionParam
  @ApiEndpoint({
    id: 'b2b.webhooks.listDeliveries',
    summary: 'The delivery log of a subscription',
    description: `Newest first: what was sent, every attempt’s status, the next retry (D-291). ${SCOPED}`,
    implements: DECISIONS,
  })
  @ApiPaginated(WebhookDeliveryDto, { example: DELIVERY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async deliveries(
    @CurrentActor() actor: Actor,
    @Param('subscriptionId', ParseUUIDPipe) id: string,
    @Query() q: PageQuery,
  ) {
    const { rows, total } = await this.webhooks.deliveries(
      await this.b2b.client(actor),
      id,
      q.page,
      q.perPage,
    );
    return { data: rows, meta: { page: q.page, perPage: q.perPage, total } };
  }
}
