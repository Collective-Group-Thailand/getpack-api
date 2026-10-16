import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { ApiAsync, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { TRACKING_THROTTLE } from '@modules/timeline/timeline.controller';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam, ApiPropertyOptional, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

import {
  DeclineQuoteDto,
  LEVERS_EXAMPLE,
  QuoteLeversDto,
  SEND_TO_CS_EXAMPLE,
  SendQuoteToCsDto,
  SendQuoteToCsResultDto,
} from './levers/levers.dto';
import { QuoteClosingService } from './levers/quote-closing.service';
import { QuoteLeversService } from './levers/quote-levers.service';
import { QuotePdfService } from './quote-pdf.service';
import { adminQuoteDto, leverSetDto, quoteDto } from './quote-views';
import {
  ADMIN_QUOTE_EXAMPLE,
  AdminSavedQuoteDto,
  ClaimQuoteDto,
  QUOTE_EXAMPLE,
  QuoteListQuery,
  QuotePdfDto,
  SAVE_EXAMPLE,
  SavedQuoteDto,
  SaveQuoteDto,
  ShareQuoteResultDto,
  StaffSaveQuoteDto,
} from './quotes.dto';
import { type QuoteOwner, type QuoteRow, SavedQuotesService } from './saved-quotes.service';

const DECISIONS = ['D-051', 'D-010', 'D-050'];
const quoteParam = ApiParam({ name: 'quoteId', format: 'uuid' });
const anonymousQuery = ApiQuery({
  name: 'anonymousId',
  required: false,
  schema: { type: 'string', format: 'uuid' },
  description: 'The configurator session that saved the quote, when not signed in',
});
const PDF_EXAMPLE = {
  status: 'ready',
  url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
  expiresAt: '2026-10-01T10:05:00+07:00',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ownerOf(actor: Actor | undefined, anonymousId?: string): QuoteOwner {
  if (actor?.type === 'user' && actor.audience === 'customer')
    return { kind: 'customer', userId: actor.userId };
  if (anonymousId && UUID.test(anonymousId)) return { kind: 'anonymous', anonymousId };
  throw new DomainException('http.not_found');
}

async function pdfView(pdf: QuotePdfService, quote: QuoteRow): Promise<QuotePdfDto> {
  if (!quote.pdfFileId)
    return { status: quote.pdfRequestedAt ? 'pending' : 'none', url: null, expiresAt: null };
  const { url, expiresAt } = await pdf.downloadUrl(quote.pdfFileId);
  return { status: 'ready', url, expiresAt: toBangkokIso(expiresAt) };
}

@ApiSurface('store', 'savedQuotes')
@Controller('quotes')
export class StoreSavedQuotesController {
  constructor(
    private readonly quotes: SavedQuotesService,
    private readonly pdf: QuotePdfService,
    private readonly levers: QuoteLeversService,
    private readonly closing: QuoteClosingService,
  ) {}

  @Post()
  @Public()
  @ApiEndpoint({
    id: 'store.quotes.save',
    summary: 'Save a quotation',
    description:
      'Re-prices the configuration on the server and saves every instant quantity with the versions used ' +
      '(snapshot); valid for `quotes.validity_days` (15) days with the price locked (D-051). Signed in, or ' +
      'anonymously with `anonymousId` (claim it after login). No factory data (D-050). With ' +
      '`advisoryRecommendationId` the quotation stores the Structure Advisor recommendation and the board chosen on ' +
      'it, which must be the configuration’s board (D-240).',
    implements: [...DECISIONS, 'D-240'],
  })
  @ApiBody({ type: SaveQuoteDto, examples: { default: { value: SAVE_EXAMPLE } } })
  @ApiSuccess(201, { description: 'Saved', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.not_instant',
    'pricing.vat_rate_missing',
    'quotes.nothing_to_save',
    'advisory.choice_required',
    'advisory.choice_mismatch',
  )
  async save(@OptionalActor() actor: Actor | undefined, @Body() body: SaveQuoteDto): Promise<SavedQuoteDto> {
    const owner =
      actor?.type === 'user'
        ? ownerOf(actor)
        : body.anonymousId
          ? ownerOf(undefined, body.anonymousId)
          : (() => {
              throw new DomainException('validation.failed', {
                errors: [{ path: 'anonymousId', code: 'required', message: 'sign in or send anonymousId' }],
              });
            })();
    const quote = await this.quotes.save(owner, 'web', body, { ip: RequestContext.current()?.ip });
    return quoteDto(quote);
  }

  @Get()
  @ApiEndpoint({
    id: 'store.quotes.list',
    summary: 'List my saved quotations',
    description: 'Newest first; `priceLocked` tells whether the price still holds (D-051).',
    implements: DECISIONS,
  })
  @ApiPaginated(SavedQuoteDto, { example: QUOTE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: QuoteListQuery) {
    const owner = ownerOf(actor);
    if (owner.kind !== 'customer') throw new DomainException('auth.forbidden');
    const { rows, total } = await this.quotes.list(
      { customerUserId: owner.userId, ...(query.status ? { status: query.status } : {}) },
      query.page,
      query.perPage,
    );
    return { data: rows.map((q) => quoteDto(q)), meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Get('shared/:token')
  @Public()
  @Throttle(TRACKING_THROTTLE)
  @ApiParam({ name: 'token', schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } })
  @ApiEndpoint({
    id: 'store.quotes.getShared',
    summary: 'Open a shared quotation',
    description:
      'Anyone with the link sees the quotation, never its owner, while it is shared and the link is live: 404 once ' +
      'the link expired (`configurations.share_link_days`), was revoked or replaced, or the quotation was converted ' +
      'or expired (D-185, D-051).',
    implements: [...DECISIONS, 'D-185'],
  })
  @ApiSuccess(200, {
    description: 'Quotation',
    type: SavedQuoteDto,
    example: { ...QUOTE_EXAMPLE, status: 'shared', quoteCode: 'QT-2026-000042' },
  })
  @ApiStandardErrors('http.not_found', 'http.too_many_requests')
  async shared(@Param('token') token: string): Promise<SavedQuoteDto> {
    return quoteDto(await this.quotes.shared(token));
  }

  @Get(':quoteId')
  @Public()
  @quoteParam
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.get',
    summary: 'Get one of my quotations',
    description:
      'The owner only (signed in, or the anonymous session that saved it); anyone else gets 404 (D-051).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Quotation', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.quotes.get(ownerOf(actor, anonymousId), quoteId));
  }

  @Post(':quoteId/actions/claim')
  @HttpCode(200)
  @quoteParam
  @ApiEndpoint({
    id: 'store.quotes.claim',
    summary: 'Keep a quotation saved before login',
    description:
      'The signed-in customer takes over the quotation the same configurator session saved (D-051).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ClaimQuoteDto,
    examples: { default: { value: { anonymousId: '0192f3a0-7c1e-7d2a-9b1f-00000000e604' } } },
  })
  @ApiSuccess(200, { description: 'Quotation', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async claim(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body() body: ClaimQuoteDto,
  ): Promise<SavedQuoteDto> {
    const owner = ownerOf(actor);
    if (owner.kind !== 'customer') throw new DomainException('auth.forbidden');
    return quoteDto(await this.quotes.claim(owner.userId, quoteId, body.anonymousId));
  }

  @Post(':quoteId/actions/share')
  @HttpCode(200)
  @Public()
  @quoteParam
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.share',
    summary: 'Share a quotation',
    description:
      'Issues the QT number (when missing) and a new share link; the token is shown once and only its hash is ' +
      'kept, so sharing again revokes the previous link. Live quotations only (D-051).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Shared',
    type: ShareQuoteResultDto,
    example: {
      quote: { ...QUOTE_EXAMPLE, status: 'shared', quoteCode: 'QT-2026-000042' },
      shareToken: 'bX2k…',
      sharePath: '/v1/store/quotes/shared/bX2k…',
      expiresAt: '2026-10-17T10:00:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'quotes.not_live', 'numbering.series_missing')
  async share(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<ShareQuoteResultDto> {
    const { quote, token } = await this.quotes.share(ownerOf(actor, anonymousId), quoteId);
    return {
      quote: quoteDto(quote),
      shareToken: token,
      sharePath: `/v1/store/quotes/shared/${token}`,
      expiresAt: toBangkokIso(quote.shareExpiresAt!),
    };
  }

  @Delete(':quoteId/share')
  @Public()
  @quoteParam
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.unshare',
    summary: 'Stop sharing a quotation',
    description: 'Revokes the share link at once; the quotation stays saved (D-185).',
    implements: [...DECISIONS, 'D-185'],
  })
  @ApiSuccess(200, { description: 'Not shared any more', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async unshare(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.quotes.unshare(ownerOf(actor, anonymousId), quoteId));
  }

  @Post(':quoteId/actions/reprice')
  @Public()
  @quoteParam
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.reprice',
    summary: 'Re-price an expired quotation',
    description:
      'A new quotation at today’s prices; the old one becomes `superseded`. A live quotation keeps its lock (D-051).',
    implements: DECISIONS,
  })
  @ApiSuccess(201, { description: 'New quotation', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'quotes.still_valid',
    'quotes.not_repriceable',
    'quotes.nothing_to_save',
    'pricing.not_instant',
  )
  async reprice(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.quotes.reprice(ownerOf(actor, anonymousId), quoteId));
  }

  @Get(':quoteId/levers')
  @Public()
  @quoteParam
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.getLevers',
    summary: 'Ways to reach my target price',
    description:
      'For a quotation saved with a target above it: alternatives re-priced by the real engine — the next quantity ' +
      'breaks, another material the product offers, no back print, no special finish, no coating, no assembly — ' +
      'each kept only when it lowers the unit price, at most 5, largest saving first; reason codes only, valid ' +
      'until the quotation’s validity (D-248, D-191). Computed on the first request (live quotations only) and ' +
      'kept; no factory data (D-050).',
    implements: [...DECISIONS, 'D-248', 'D-191'],
  })
  @ApiSuccess(200, { description: 'Levers', type: QuoteLeversDto, example: LEVERS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'quotes.no_target', 'quotes.not_live')
  async getLevers(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<QuoteLeversDto> {
    return leverSetDto(await this.levers.levers(ownerOf(actor, anonymousId), quoteId));
  }

  @Post(':quoteId/levers/:leverId/actions/apply')
  @Public()
  @quoteParam
  @ApiParam({ name: 'leverId', format: 'uuid' })
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.applyLever',
    summary: 'Take a lever',
    description:
      'Saves a new quotation from the lever’s configuration at today’s prices, with the same target; the original ' +
      'becomes `superseded` and its outcome `revised` (D-249). The quotation and the lever must still be valid; a ' +
      'lever is taken once.',
    implements: [...DECISIONS, 'D-249', 'D-250'],
  })
  @ApiSuccess(201, { description: 'New quotation', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'quotes.not_live',
    'quotes.nothing_to_save',
    'pricing.not_instant',
  )
  async applyLever(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Param('leverId', ParseUUIDPipe) leverId: string,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.levers.apply(ownerOf(actor, anonymousId), quoteId, leverId));
  }

  @Post(':quoteId/actions/decline')
  @HttpCode(200)
  @Public()
  @quoteParam
  @anonymousQuery
  @ApiEndpoint({
    id: 'store.quotes.decline',
    summary: 'Decline a quotation',
    description:
      'The customer will not order this quotation: status `declined`, outcome `lost` with an optional reason ' +
      '(D-250). Live quotations only; a shared link stops resolving.',
    implements: [...DECISIONS, 'D-250'],
  })
  @ApiBody({
    type: DeclineQuoteDto,
    examples: { default: { value: { reasonCode: 'price', note: 'งบประมาณไม่พอ' } } },
  })
  @ApiSuccess(200, {
    description: 'Declined',
    type: SavedQuoteDto,
    example: {
      ...QUOTE_EXAMPLE,
      status: 'declined',
      priceLocked: false,
      outcome: {
        outcome: 'lost',
        occurredAt: '2026-10-03T10:00:00+07:00',
        lossReasonCode: 'price',
        leverTakenId: null,
      },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'quotes.not_live',
  )
  async decline(
    @OptionalActor() actor: Actor | undefined,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body() body: DeclineQuoteDto,
    @Query('anonymousId') anonymousId?: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.closing.decline(ownerOf(actor, anonymousId), quoteId, body));
  }

  @Post(':quoteId/actions/send-to-cs')
  @quoteParam
  @ApiEndpoint({
    id: 'store.quotes.sendToCs',
    summary: 'Send a quotation to CS',
    description:
      'Signed-in owners: the quotation becomes a request for quote pre-filled with its product type, size and basis, ' +
      'quantities, delivery postcode and target, linked to it; status `routed_to_rfq`, outcome `converted_to_rfq` ' +
      '(D-251, D-191). Live quotations only.',
    implements: [...DECISIONS, 'D-251', 'D-100'],
  })
  @ApiBody({
    type: SendQuoteToCsDto,
    examples: { default: { value: { notes: 'ขอราคาที่ 11.50 บาทต่อชิ้น' } } },
  })
  @ApiSuccess(201, { description: 'RFQ created', type: SendQuoteToCsResultDto, example: SEND_TO_CS_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'quotes.not_live',
    'numbering.series_missing',
    'specs.unit_not_accepted',
  )
  async sendToCs(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body() body: SendQuoteToCsDto,
  ): Promise<SendQuoteToCsResultDto> {
    return this.closing.sendToCs(ownerOf(actor), quoteId, body);
  }

  @Post(':quoteId/actions/request-pdf')
  @HttpCode(202)
  @quoteParam
  @ApiEndpoint({
    id: 'store.quotes.requestPdf',
    summary: 'Request the quotation PDF',
    description:
      'Issues the QT number and renders the PDF in the name of the issuing entity under the getpack brand ' +
      '(D-010, D-092) in the background; poll `GET /v1/store/quotes/{quoteId}/pdf`. Signed-in owners only.',
    implements: [...DECISIONS, 'D-092'],
  })
  @ApiAsync({ poll: 'store.quotes.getPdf' })
  @ApiSuccess(202, {
    description: 'Accepted',
    type: SavedQuoteDto,
    example: { ...QUOTE_EXAMPLE, quoteCode: 'QT-2026-000042', pdfStatus: 'pending' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'numbering.series_missing')
  async requestPdf(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.quotes.requestPdf(ownerOf(actor), actor as UserActor, quoteId));
  }

  @Get(':quoteId/pdf')
  @quoteParam
  @ApiEndpoint({
    id: 'store.quotes.getPdf',
    summary: 'Get the quotation PDF',
    description: '`pending` while it renders; a short-lived signed download URL once ready (contract §3).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'PDF', type: QuotePdfDto, example: PDF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getPdf(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<QuotePdfDto> {
    return pdfView(this.pdf, await this.quotes.get(ownerOf(actor), quoteId));
  }
}

class AdminQuoteListQuery extends QuoteListQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this customer’s quotations' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: ['web', 'cs', 'line', 'b2b'], enumName: 'SalesChannel' })
  @IsOptional()
  @IsIn(['web', 'cs', 'line', 'b2b'])
  channel?: 'web' | 'cs' | 'line' | 'b2b';
}

@ApiSurface('admin', 'quotes')
@Controller('quotes')
export class AdminQuotesController {
  constructor(
    private readonly quotes: SavedQuotesService,
    private readonly pdf: QuotePdfService,
    private readonly permissions: PermissionResolver,
    private readonly levers: QuoteLeversService,
  ) {}

  @Get()
  @Can('quotes.read')
  @ApiEndpoint({
    id: 'admin.quotes.list',
    summary: 'List saved quotations',
    description: '`q` matches the QT number; filter by status, customer or channel (D-051).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminSavedQuoteDto, { example: ADMIN_QUOTE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() query: AdminQuoteListQuery) {
    const where: Prisma.QuoteWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { quoteCode: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.customerId ? { customer: { publicId: query.customerId } } : {}),
      ...(query.channel && { channel: query.channel }),
    };
    const { rows, total } = await this.quotes.list(where, query.page, query.perPage);
    const grants = await this.grants(actor);
    return {
      data: rows.map((q) => adminQuoteDto(q, grants)),
      meta: { page: query.page, perPage: query.perPage, total },
    };
  }

  @Get(':quoteId')
  @Can('quotes.read')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.get',
    summary: 'Get a saved quotation with the staff view',
    description: 'Selected factory, price-list version, delivery cost and margins per D-141; audited.',
    implements: [...DECISIONS, 'D-141'],
  })
  @ApiSuccess(200, { description: 'Quotation', type: AdminSavedQuoteDto, example: ADMIN_QUOTE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<AdminSavedQuoteDto> {
    const quote = await this.quotes.get({ kind: 'staff', actor: actor as UserActor }, quoteId);
    await this.quotes.auditStaffRead(quote.publicId);
    return adminQuoteDto(quote, await this.grants(actor));
  }

  @Get(':quoteId/levers')
  @Can('quotes.read')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.getLevers',
    summary: 'The levers shown on a quotation',
    description:
      'What the customer was shown against their target (D-248); empty with `computedAt` null until the customer asked ' +
      'for them — staff reading never computes them (levers shown, D-250).',
    implements: [...DECISIONS, 'D-248', 'D-250'],
  })
  @ApiSuccess(200, { description: 'Levers', type: QuoteLeversDto, example: LEVERS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'quotes.no_target')
  async getLevers(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<QuoteLeversDto> {
    return leverSetDto(
      await this.levers.levers({ kind: 'staff', actor: actor as UserActor }, quoteId, new Date(), false),
    );
  }

  @Post()
  @Can('quotes.manage')
  @ApiEndpoint({
    id: 'admin.quotes.create',
    summary: 'Save a quotation for a customer (CS)',
    description:
      'CS prices and saves a quotation on the customer’s behalf (channel `cs`), with the same snapshot and ' +
      'validity as the store (D-051); works before a type is switched to instant.',
    implements: DECISIONS,
  })
  @ApiBody({ type: StaffSaveQuoteDto, examples: { default: { value: SAVE_EXAMPLE } } })
  @ApiSuccess(201, { description: 'Saved', type: AdminSavedQuoteDto, example: ADMIN_QUOTE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'pricing.not_instant',
    'pricing.vat_rate_missing',
    'quotes.nothing_to_save',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: StaffSaveQuoteDto): Promise<AdminSavedQuoteDto> {
    const customer = body.customerUserId ? await this.quotes.customer(body.customerUserId) : null;
    if (body.customerUserId && !customer) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'customerUserId', code: 'exists', message: 'not a customer' }],
      });
    }
    const quote = await this.quotes.save({ kind: 'staff', actor: actor as UserActor }, 'cs', body, {
      customerUserId: customer?.id,
      ip: RequestContext.current()?.ip,
      staffNote: body.note,
    });
    return adminQuoteDto(quote, await this.grants(actor));
  }

  @Post(':quoteId/actions/share')
  @HttpCode(200)
  @Can('quotes.manage')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.share',
    summary: 'Share a quotation with the customer',
    description: 'Issues the QT number and a new share link (the previous one is revoked, D-051).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Shared',
    type: ShareQuoteResultDto,
    example: {
      quote: { ...QUOTE_EXAMPLE, status: 'shared', quoteCode: 'QT-2026-000042' },
      shareToken: 'bX2k…',
      sharePath: '/v1/store/quotes/shared/bX2k…',
      expiresAt: '2026-10-17T10:00:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'quotes.not_live', 'numbering.series_missing')
  async share(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<ShareQuoteResultDto> {
    const { quote, token } = await this.quotes.share({ kind: 'staff', actor: actor as UserActor }, quoteId);
    return {
      quote: quoteDto(quote),
      shareToken: token,
      sharePath: `/v1/store/quotes/shared/${token}`,
      expiresAt: toBangkokIso(quote.shareExpiresAt!),
    };
  }

  @Delete(':quoteId/share')
  @Can('quotes.manage')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.unshare',
    summary: 'Stop sharing a quotation',
    description: 'Revokes the share link at once; the quotation stays saved (D-185).',
    implements: [...DECISIONS, 'D-185'],
  })
  @ApiSuccess(200, { description: 'Not shared any more', type: SavedQuoteDto, example: QUOTE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async unshare(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<SavedQuoteDto> {
    return quoteDto(await this.quotes.unshare({ kind: 'staff', actor: actor as UserActor }, quoteId));
  }

  @Post(':quoteId/actions/reprice')
  @Can('quotes.manage')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.reprice',
    summary: 'Re-price an expired quotation',
    description:
      'A new quotation at today’s prices for the same customer; the old one becomes `superseded` (D-051).',
    implements: DECISIONS,
  })
  @ApiSuccess(201, { description: 'New quotation', type: AdminSavedQuoteDto, example: ADMIN_QUOTE_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'quotes.still_valid',
    'quotes.not_repriceable',
    'quotes.nothing_to_save',
    'pricing.not_instant',
  )
  async reprice(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<AdminSavedQuoteDto> {
    const quote = await this.quotes.reprice({ kind: 'staff', actor: actor as UserActor }, quoteId);
    return adminQuoteDto(quote, await this.grants(actor));
  }

  @Post(':quoteId/actions/request-pdf')
  @HttpCode(202)
  @Can('quotes.manage')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.requestPdf',
    summary: 'Request the quotation PDF (CS export)',
    description:
      'Issues the QT number and renders the PDF in the background (D-010, D-092); poll `GET …/pdf`.',
    implements: [...DECISIONS, 'D-092'],
  })
  @ApiAsync({ poll: 'admin.quotes.getPdf' })
  @ApiSuccess(202, {
    description: 'Accepted',
    type: AdminSavedQuoteDto,
    example: { ...ADMIN_QUOTE_EXAMPLE, pdfStatus: 'pending' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'numbering.series_missing')
  async requestPdf(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<AdminSavedQuoteDto> {
    const quote = await this.quotes.requestPdf(
      { kind: 'staff', actor: actor as UserActor },
      actor as UserActor,
      quoteId,
    );
    return adminQuoteDto(quote, await this.grants(actor));
  }

  @Get(':quoteId/pdf')
  @Can('quotes.read')
  @quoteParam
  @ApiEndpoint({
    id: 'admin.quotes.getPdf',
    summary: 'Get the quotation PDF',
    description: '`pending` while it renders; a short-lived signed download URL once ready.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'PDF', type: QuotePdfDto, example: PDF_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getPdf(
    @CurrentActor() actor: Actor,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<QuotePdfDto> {
    return pdfView(this.pdf, await this.quotes.get({ kind: 'staff', actor: actor as UserActor }, quoteId));
  }

  private async grants(actor: Actor) {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    return { cost: granted.has('factory_buy_prices.read'), margin: granted.has('margin.read') };
  }
}
