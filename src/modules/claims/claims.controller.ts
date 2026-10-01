import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { etagOf } from '@common/etag/etag';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { cartDto } from '@modules/carts/cart-views';
import { CART_EXAMPLE, CartDto } from '@modules/carts/carts.dto';
import { cartEtag } from '@modules/carts/carts.service';
import { CompaniesService } from '@modules/companies/companies.service';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { adminClaimDto, partnerClaimDto, storeClaimDto } from './claim-views';
import {
  ADMIN_CLAIM_EXAMPLE,
  AdminClaimDto,
  AdminClaimListQuery,
  BULK_PREVIEW_EXAMPLE,
  BulkReorderAddDto,
  BulkReorderPreviewDto,
  BulkReorderPreviewRequestDto,
  BulkReorderResultDto,
  CLAIM_FORM_EXAMPLE,
  CLAIM_IDS,
  ClaimFormDto,
  ClaimInfoDto,
  ClaimListQuery,
  ClaimNoteDto,
  DecideClaimDto,
  FactoryClaimResponseDto,
  OverrideLiabilityDto,
  PARTNER_CLAIM_EXAMPLE,
  PartnerClaimDto,
  REORDER_PREVIEW_EXAMPLE,
  ReorderOrderDto,
  ReorderPreviewDto,
  ReorderPreviewQuery,
  ResolveClaimDto,
  RESOLVED_EXAMPLE,
  StaffClaimDto,
  STORE_CLAIM_EXAMPLE,
  StoreClaimDto,
  SubmitClaimDto,
} from './claims.dto';
import { type ClaimRow, ClaimsService } from './claims.service';
import { ReorderService } from './reorder.service';

const claimParam = ApiParam({ name: 'claimId', format: 'uuid' });
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const SUBMIT_EXAMPLE = {
  type: 'damaged',
  description: 'กล่องบุบ 2 ลัง สินค้าด้านในเสียหาย',
  requestedResolution: 'reprint',
  shipmentId: CLAIM_IDS.shipment,
  claimedQuantity: 120,
  productPhotoFileIds: [CLAIM_IDS.photo],
  cartonPhotoFileIds: [CLAIM_IDS.carton],
};

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}
function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}
const listWhere = (q: ClaimListQuery): Prisma.ClaimWhereInput => ({
  ...(q.status && { status: q.status }),
  ...(q.orderId && { order: { publicId: q.orderId } }),
});
const adminListWhere = (q: AdminClaimListQuery): Prisma.ClaimWhereInput => ({
  ...listWhere(q),
  ...(q.type && { type: q.type }),
  ...(q.origin && { origin: q.origin }),
  ...(q.customerId && { customer: { publicId: q.customerId } }),
  ...(q.factoryId && { factory: { publicId: q.factoryId } }),
});

type Photos = { product: string[]; carton: string[] };

abstract class ClaimViews {
  constructor(
    protected readonly claims: ClaimsService,
    protected readonly permissions: PermissionResolver,
  ) {}
  protected async one<T>(
    actor: Actor,
    id: string,
    view: (c: ClaimRow, p: Photos, perms: ReadonlySet<string>) => T,
  ) {
    const row = await this.claims.get(actor, id);
    return view(
      row,
      (await this.claims.photos([row.id])).get(row.id)!,
      await permissionsOf(this.permissions, actor),
    );
  }
  protected async many<T>(
    actor: Actor,
    rows: ClaimRow[],
    view: (c: ClaimRow, p: Photos, perms: ReadonlySet<string>) => T,
  ) {
    const [photos, perms] = await Promise.all([
      this.claims.photos(rows.map((r) => r.id)),
      permissionsOf(this.permissions, actor),
    ]);
    return rows.map((r) => view(r, photos.get(r.id)!, perms));
  }
}

// =====================================================================================================
// Store
// =====================================================================================================

@ApiSurface('store', 'claims')
@Controller()
export class StoreClaimsController extends ClaimViews {
  constructor(
    claims: ClaimsService,
    permissions: PermissionResolver,
    private readonly reorders: ReorderService,
  ) {
    super(claims, permissions);
  }

  @Get('orders/:orderId/claim-form')
  @orderParam
  @ApiEndpoint({
    id: 'store.claims.getForm',
    summary: 'Get the claim form of my order',
    description:
      'Whether a claim can be submitted now and until when (receipt + `claims.window_days`, D-082), the delivered ' +
      'shipments with their own windows (no addresses), the claim types and resolutions, and the photo rules: at ' +
      'least one photo of the product and one of the cartons, uploaded with purpose `evidence`.',
    implements: ['D-082'],
  })
  @ApiSuccess(200, { description: 'The claim form', type: ClaimFormDto, example: CLAIM_FORM_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  form(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<ClaimFormDto> {
    return this.claims.form(customer(actor).userId, orderId);
  }

  @Post('orders/:orderId/claims')
  @Idempotent()
  @orderParam
  @ApiEndpoint({
    id: 'store.claims.submit',
    summary: 'Claim a problem with my order',
    description:
      'Within 7 days of receipt (D-082; `claims.window_closed` after), with photos of the product **and** of the ' +
      'shipping cartons (evidence uploads). Liability follows the rules (D-083); the claim holds the automatic ' +
      'completion of the order until it is settled.',
    implements: ['D-082', 'D-083'],
  })
  @ApiBody({ type: SubmitClaimDto, examples: { default: { value: SUBMIT_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Submitted',
    type: StoreClaimDto,
    example: { ...STORE_CLAIM_EXAMPLE, status: 'submitted' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'claims.not_delivered',
    'claims.window_closed',
    'claims.evidence_missing',
    'artwork.file_not_usable',
  )
  async submit(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: SubmitClaimDto,
  ) {
    const id = await this.claims.submit(customer(actor), orderId, body);
    return this.one(actor, id, storeClaimDto);
  }

  @Get('claims')
  @ApiEndpoint({
    id: 'store.claims.list',
    summary: 'My claims',
    description: 'Newest first.',
    implements: ['D-082'],
  })
  @ApiPaginated(StoreClaimDto, { example: STORE_CLAIM_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ClaimListQuery) {
    customer(actor);
    const [rows, total] = await this.claims.list(actor, listWhere(q), q.page, q.perPage);
    return {
      data: await this.many(actor, rows, storeClaimDto),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('claims/:claimId')
  @claimParam
  @ApiEndpoint({
    id: 'store.claims.get',
    summary: 'One of my claims',
    description: 'Status, what Packio asked for, the decision and what was done (no factory, D-050).',
    implements: ['D-082', 'D-050'],
  })
  @ApiSuccess(200, { description: 'Claim', type: StoreClaimDto, example: STORE_CLAIM_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('claimId', ParseUUIDPipe) claimId: string) {
    customer(actor);
    return this.one(actor, claimId, storeClaimDto);
  }

  @Post('claims/:claimId/info')
  @HttpCode(200)
  @Idempotent()
  @claimParam
  @ApiEndpoint({
    id: 'store.claims.respondInfo',
    summary: 'Answer Packio’s question about my claim',
    description: 'Only while the claim needs information; more photos may be attached. The review continues.',
    implements: ['D-082'],
  })
  @ApiBody({
    type: ClaimInfoDto,
    examples: {
      default: { value: { response: 'แนบรูปฉลากข้างกล่องแล้ว', photoFileIds: [CLAIM_IDS.photo] } },
    },
  })
  @ApiSuccess(200, { description: 'Answered', type: StoreClaimDto, example: STORE_CLAIM_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'claims.invalid_status', 'artwork.file_not_usable')
  async respondInfo(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: ClaimInfoDto,
  ) {
    await this.claims.respondInfo(customer(actor), claimId, body);
    return this.one(actor, claimId, storeClaimDto);
  }

  @Get('orders/:orderId/reorder')
  @orderParam
  @ApiEndpoint({
    id: 'store.claims.previewReorder',
    summary: 'Preview a reorder of my order',
    description:
      'The same specification priced at today’s cost for `quantity` (default: the past quantity) — nothing is ' +
      'saved; whether the approved artwork carries over (no new proof, D-153); the catalogue quantity limits, lead ' +
      'time and earliest dates. The `previewToken` (30 minutes) makes the reorder refuse a changed price. Plate / ' +
      'die-block reuse is shown once the tooling register exists (D-205).',
    implements: ['D-153'],
  })
  @ApiSuccess(200, { description: 'The preview', type: ReorderPreviewDto, example: REORDER_PREVIEW_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'orders.reorder_unavailable',
    'pricing.not_instant',
  )
  previewReorder(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() q: ReorderPreviewQuery,
  ): Promise<ReorderPreviewDto> {
    return this.reorders.preview(customer(actor), orderId, q);
  }

  @Post('orders/:orderId/actions/reorder')
  @Idempotent()
  @orderParam
  @ApiEndpoint({
    id: 'store.claims.reorder',
    summary: 'Reorder a past order',
    description:
      'Same specification priced again at today’s cost (a new quote), quantity editable, added to my cart. With ' +
      'the artwork unchanged the approved proof carries over and no new proof is needed (D-153). With the ' +
      '`previewToken` of a preview: 409 `orders.reorder_repriced` when today’s price differs from it, 409 ' +
      '`orders.reorder_preview_expired` when it expired or was for another quantity or artwork choice.',
    implements: ['D-153'],
  })
  @ApiBody({
    type: ReorderOrderDto,
    examples: { default: { value: { quantity: 2000, reuseArtwork: true, previewToken: 'Hq3v…' } } },
  })
  @ApiSuccess(201, {
    description: 'Cart with the reorder',
    type: CartDto,
    example: CART_EXAMPLE,
    headers: ['ETag'],
  })
  @ApiStandardErrors(
    ...WRITE,
    'orders.reorder_unavailable',
    'orders.reorder_repriced',
    'orders.reorder_preview_expired',
    'pricing.not_instant',
    'cart.item_exists',
  )
  async reorder(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: ReorderOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cart = await this.reorders.reorder(customer(actor), orderId, body);
    res.setHeader('ETag', cartEtag(cart));
    return cartDto(cart);
  }
}

// =====================================================================================================
// Store: company bulk reorder (U-B0.1, D-153)
// =====================================================================================================

@ApiSurface('store', 'claims')
@Controller('companies/:companyId/bulk-reorders')
export class StoreBulkReorderController {
  constructor(
    private readonly reorders: ReorderService,
    private readonly companies: CompaniesService,
    private readonly prisma: PrismaService,
  ) {}

  private async company(actor: Actor, id: string) {
    return this.companies.orderingCompany(this.prisma, customer(actor).userId, id);
  }

  @Post('actions/preview')
  @HttpCode(200)
  @ApiParam({ name: 'companyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.claims.previewBulkReorder',
    summary: 'Preview reordering several company orders',
    description:
      'For members who order for the company (`company_orders.place`): each row {line, orderCode, quantity} is ' +
      'checked against the company’s delivered orders and priced at today’s cost, or refused with the reason; ' +
      'totals and a `previewToken` (30 minutes) for `store.claims.bulkReorder` (D-153). Nothing is saved.',
    implements: ['D-153', 'D-125'],
  })
  @ApiBody({
    type: BulkReorderPreviewRequestDto,
    examples: { default: { value: { rows: [{ line: 2, orderCode: 'PK-2610-0001-01', quantity: 2000 }] } } },
  })
  @ApiSuccess(200, { description: 'The preview', type: BulkReorderPreviewDto, example: BULK_PREVIEW_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'companies.invalid_status',
  )
  async preview(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: BulkReorderPreviewRequestDto,
  ): Promise<BulkReorderPreviewDto> {
    return this.reorders.bulkPreview(customer(actor), await this.company(actor, id), body.rows);
  }

  @Post()
  @Idempotent()
  @ApiParam({ name: 'companyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.claims.bulkReorder',
    summary: 'Reorder several company orders',
    description:
      'Adds the rows the preview accepted to my cart as reorders at today’s price (D-153). 409 ' +
      '`orders.reorder_repriced` when any price changed since the preview, `orders.reorder_preview_expired` when ' +
      'the token expired; a row the cart refuses is listed under `failed`, the others are added.',
    implements: ['D-153'],
  })
  @ApiBody({ type: BulkReorderAddDto, examples: { default: { value: { previewToken: 'Hq3v…' } } } })
  @ApiSuccess(201, {
    description: 'Added to my cart',
    type: BulkReorderResultDto,
    example: {
      added: [{ line: 2, orderCode: 'PK-2610-0001-01', cartItemId: '0192f3a0-7c1e-7d2a-9b1f-0000000f3010' }],
      failed: [],
    },
  })
  @ApiStandardErrors(
    ...WRITE,
    'companies.invalid_status',
    'orders.reorder_repriced',
    'orders.reorder_preview_expired',
    'pricing.not_instant',
  )
  async add(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: BulkReorderAddDto,
  ): Promise<BulkReorderResultDto> {
    return this.reorders.bulkAdd(customer(actor), await this.company(actor, id), body.previewToken);
  }
}

// =====================================================================================================
// Partner (factory-scoped: claims about its jobs once Packio sent them)
// =====================================================================================================

@ApiSurface('partner', 'claims')
@Controller()
export class PartnerClaimsController extends ClaimViews {
  constructor(claims: ClaimsService, permissions: PermissionResolver) {
    super(claims, permissions);
  }

  @Get('claims')
  @Can('factory_claims.read')
  @ApiEndpoint({
    id: 'partner.claims.list',
    summary: 'Claims about my factory’s jobs',
    description: 'Those Packio sent for review or decided against the factory (D-083).',
    implements: ['D-083'],
  })
  @ApiPaginated(PartnerClaimDto, { example: PARTNER_CLAIM_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ClaimListQuery) {
    const [rows, total] = await this.claims.list(actor, listWhere(q), q.page, q.perPage);
    return {
      data: await this.many(actor, rows, partnerClaimDto),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('claims/:claimId')
  @Can('factory_claims.read')
  @claimParam
  @ApiEndpoint({
    id: 'partner.claims.get',
    summary: 'One claim about my job',
    description: 'With the customer’s photos (no customer contact beyond D-142).',
    implements: ['D-083', 'D-142'],
  })
  @ApiSuccess(200, { description: 'Claim', type: PartnerClaimDto, example: PARTNER_CLAIM_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  get(@CurrentActor() actor: Actor, @Param('claimId', ParseUUIDPipe) claimId: string) {
    return this.one(actor, claimId, partnerClaimDto);
  }

  @Post('claims/:claimId/actions/respond')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_claims.respond')
  @claimParam
  @ApiEndpoint({
    id: 'partner.claims.respond',
    summary: 'Accept or dispute a claim',
    description:
      'While Packio asks for the factory’s review, with the factory’s own evidence files when it has them ' +
      '(U-B0.3); Packio decides afterwards (D-083).',
    implements: ['D-083'],
  })
  @ApiBody({
    type: FactoryClaimResponseDto,
    examples: { default: { value: { response: 'accepted', note: 'ยอมรับ จะผลิตทดแทน' } } },
  })
  @ApiSuccess(200, {
    description: 'Answered',
    type: PartnerClaimDto,
    example: { ...PARTNER_CLAIM_EXAMPLE, status: 'under_review', factoryResponse: 'accepted' },
  })
  @ApiStandardErrors(...WRITE, 'claims.invalid_status', 'artwork.file_not_usable')
  async respond(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: FactoryClaimResponseDto,
  ) {
    await this.claims.factoryRespond(actor, claimId, body);
    return this.one(actor, claimId, partnerClaimDto);
  }
}

// =====================================================================================================
// Admin
// =====================================================================================================

@ApiSurface('admin', 'claims')
@Controller()
export class AdminClaimsController extends ClaimViews {
  constructor(claims: ClaimsService, permissions: PermissionResolver) {
    super(claims, permissions);
  }

  @Get('claims')
  @Can('claims.read')
  @ApiEndpoint({
    id: 'admin.claims.list',
    summary: 'List claims',
    description:
      'Newest first; `type`, `origin` (customer, automatic from the tolerance, staff), `customerId` and ' +
      '`factoryId` narrow it. Each row names the customer.',
    implements: ['D-082'],
  })
  @ApiPaginated(AdminClaimDto, { example: ADMIN_CLAIM_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: AdminClaimListQuery) {
    const [rows, total] = await this.claims.list(actor, adminListWhere(q), q.page, q.perPage);
    return {
      data: await this.many(actor, rows, adminClaimDto),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('claims/:claimId')
  @Can('claims.read')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.get',
    summary: 'Get a claim',
    description:
      'Evidence, liability by rule (with the D-083 rule that gave it) vs decided and who overrode it, the proof ' +
      'the customer approved (evidence for errors in approved artwork), factory response, who decided, and ' +
      'resolutions. Claim actions take an `Idempotency-Key`; the `ETag` tracks changes.',
    implements: ['D-082', 'D-083'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Claim', type: AdminClaimDto, example: ADMIN_CLAIM_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.claims.get(actor, claimId);
    res.setHeader('ETag', etagOf(row.publicId, row.rowVersion));
    return adminClaimDto(
      row,
      (await this.claims.photos([row.id])).get(row.id),
      await permissionsOf(this.permissions, actor),
    );
  }

  @Post('orders/:orderId/claims')
  @Idempotent()
  @Can('claims.manage')
  @orderParam
  @ApiEndpoint({
    id: 'admin.claims.open',
    summary: 'Open a claim for the customer',
    description: 'Staff record a claim received by phone or LINE (not bound by the window); photos optional.',
    implements: ['D-082', 'D-083'],
  })
  @ApiBody({
    type: StaffClaimDto,
    examples: {
      default: {
        value: { ...SUBMIT_EXAMPLE, productPhotoFileIds: undefined, cartonPhotoFileIds: undefined },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Opened',
    type: AdminClaimDto,
    example: { ...ADMIN_CLAIM_EXAMPLE, origin: 'staff', status: 'submitted' },
  })
  @ApiStandardErrors(...WRITE, 'claims.not_delivered', 'artwork.file_not_usable')
  async open(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: StaffClaimDto,
  ) {
    return this.one(actor, await this.claims.openByStaff(staff(actor), orderId, body), adminClaimDto);
  }

  @Post('claims/:claimId/actions/review')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.manage')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.review',
    summary: 'Start the review',
    description: 'Submitted → under review.',
    implements: ['D-082'],
  })
  @ApiSuccess(200, { description: 'Under review', type: AdminClaimDto, example: ADMIN_CLAIM_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'claims.invalid_status')
  async review(@CurrentActor() actor: Actor, @Param('claimId', ParseUUIDPipe) claimId: string) {
    await this.claims.startReview(staff(actor), claimId);
    return this.one(actor, claimId, adminClaimDto);
  }

  @Post('claims/:claimId/actions/request-info')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.manage')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.requestInfo',
    summary: 'Ask the customer for more information',
    description: 'Under review → need info; the customer answers from the store.',
    implements: ['D-082'],
  })
  @ApiBody({
    type: ClaimNoteDto,
    examples: { default: { value: { note: 'โปรดส่งรูปฉลากข้างกล่องเพิ่มเติม' } } },
  })
  @ApiSuccess(200, {
    description: 'Need info',
    type: AdminClaimDto,
    example: { ...ADMIN_CLAIM_EXAMPLE, status: 'need_info' },
  })
  @ApiStandardErrors(...WRITE, 'claims.invalid_status')
  async requestInfo(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: ClaimNoteDto,
  ) {
    await this.claims.requestInfo(staff(actor), claimId, body.note);
    return this.one(actor, claimId, adminClaimDto);
  }

  @Post('claims/:claimId/actions/send-to-factory')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.manage')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.sendToFactory',
    summary: 'Ask the factory for its review',
    description: 'Under review → factory review; the factory accepts or disputes on the partner surface.',
    implements: ['D-083'],
  })
  @ApiSuccess(200, {
    description: 'Factory review',
    type: AdminClaimDto,
    example: { ...ADMIN_CLAIM_EXAMPLE, status: 'factory_review' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'claims.invalid_status',
    'claims.action_not_allowed',
  )
  async sendToFactory(@CurrentActor() actor: Actor, @Param('claimId', ParseUUIDPipe) claimId: string) {
    await this.claims.sendToFactory(staff(actor), claimId);
    return this.one(actor, claimId, adminClaimDto);
  }

  @Post('claims/:claimId/actions/override-liability')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.override_liability')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.overrideLiability',
    summary: 'Override the liability rule',
    description:
      'Another liability than the rule gives (D-083) — e.g. the customer for an error in artwork they approved — ' +
      'with a reason; before the decision only.',
    implements: ['D-083'],
  })
  @ApiBody({
    type: OverrideLiabilityDto,
    examples: {
      default: { value: { liability: 'customer', reason: 'ตำแหน่งตัวอักษรผิดตามไฟล์ที่ลูกค้าอนุมัติ' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Overridden',
    type: AdminClaimDto,
    example: {
      ...ADMIN_CLAIM_EXAMPLE,
      liability: 'customer',
      overrideReason: 'ตำแหน่งตัวอักษรผิดตามไฟล์ที่ลูกค้าอนุมัติ',
    },
  })
  @ApiStandardErrors(...WRITE, 'claims.invalid_status', 'claims.action_not_allowed')
  async override(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: OverrideLiabilityDto,
  ) {
    await this.claims.overrideLiability(staff(actor), claimId, body);
    return this.one(actor, claimId, adminClaimDto);
  }

  @Post('claims/:claimId/actions/decide')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.manage')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.decide',
    summary: 'Approve or reject a claim',
    description: 'From review; approval needs a determined liability (`claims.liability_undetermined`).',
    implements: ['D-082', 'D-083'],
  })
  @ApiBody({
    type: DecideClaimDto,
    examples: { default: { value: { decision: 'approved', note: 'รูปยืนยันความเสียหาย' } } },
  })
  @ApiSuccess(200, {
    description: 'Decided',
    type: AdminClaimDto,
    example: { ...ADMIN_CLAIM_EXAMPLE, status: 'approved' },
  })
  @ApiStandardErrors(...WRITE, 'claims.invalid_status', 'claims.liability_undetermined')
  async decide(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: DecideClaimDto,
  ) {
    await this.claims.decide(staff(actor), claimId, body);
    return this.one(actor, claimId, adminClaimDto);
  }

  @Post('claims/:claimId/actions/resolve')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.resolve')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.resolve',
    summary: 'Resolve an approved claim',
    description:
      'Existing mechanisms only, in one transaction: a re-production job for the liable factory (P24, zero buy ' +
      'price when it is liable), a refund request (Finance Manager approval), credit note / store credit, factory ' +
      'deduction or carrier recovery requests for the ledger (B5).',
    implements: ['D-083', 'D-022'],
  })
  @ApiBody({
    type: ResolveClaimDto,
    examples: { default: { value: { actions: [{ action: 'reproduction_job', quantity: 120 }] } } },
  })
  @ApiSuccess(200, { description: 'Resolved', type: AdminClaimDto, example: RESOLVED_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'claims.invalid_status',
    'claims.action_not_allowed',
    'refunds.not_refundable',
    'refunds.channel_unavailable',
    'production.gate_closed',
  )
  async resolve(
    @CurrentActor() actor: Actor,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: ResolveClaimDto,
  ) {
    await this.claims.resolve(staff(actor), claimId, body.actions);
    return this.one(actor, claimId, adminClaimDto);
  }

  @Post('claims/:claimId/actions/close')
  @HttpCode(200)
  @Idempotent()
  @Can('claims.manage')
  @claimParam
  @ApiEndpoint({
    id: 'admin.claims.close',
    summary: 'Close a claim',
    description: 'Resolved or rejected → closed.',
    implements: ['D-082'],
  })
  @ApiSuccess(200, {
    description: 'Closed',
    type: AdminClaimDto,
    example: { ...RESOLVED_EXAMPLE, status: 'closed' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'claims.invalid_status')
  async close(@CurrentActor() actor: Actor, @Param('claimId', ParseUUIDPipe) claimId: string) {
    await this.claims.close(staff(actor), claimId);
    return this.one(actor, claimId, adminClaimDto);
  }
}
