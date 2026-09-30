import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { OptionalReasonDto } from '@common/dto/optional-reason.dto';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { type Campaign, type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { campaignDto, couponDto, promotionDto } from './promotion-views';
import {
  CAMPAIGN_EXAMPLE,
  CampaignDto,
  CampaignListQuery,
  COUPON_EXAMPLE,
  CouponBatchDto,
  CouponBatchResultDto,
  CouponCodeDto,
  CouponExportDto,
  CouponExportQuery,
  CouponListQuery,
  CREATE_PROMOTION_EXAMPLE,
  CreateCampaignDto,
  CreatePromotionDto,
  GenerateCouponsDto,
  PROMOTION_EXAMPLE,
  PromotionDto,
  PromotionListQuery,
  PromotionPriorityDto,
  PromotionPriorityResultDto,
  PromotionReportDto,
  REPORT_EXAMPLE,
  ReportQuery,
  UpdateCampaignDto,
  UpdatePromotionDto,
} from './promotions.dto';
import { campaignEtag, promotionEtag, type PromotionRow, PromotionsAdminService } from './promotions-admin.service';

const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const campaignParam = ApiParam({ name: 'campaignId', format: 'uuid' });
const promotionParam = ApiParam({ name: 'promotionId', format: 'uuid' });
const actionParam = ApiParam({
  name: 'action',
  enum: ['activate', 'pause', 'end'],
  enumName: 'PromotionAction',
});
const couponActionParam = ApiParam({ name: 'action', enum: ['disable', 'enable'], enumName: 'CouponAction' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'campaigns')
@Controller('campaigns')
export class AdminCampaignsController {
  constructor(private readonly promotions: PromotionsAdminService) {}

  @Get()
  @Can('promotions.read')
  @ApiEndpoint({
    id: 'admin.campaigns.list',
    summary: 'List campaigns',
    description: 'Newest first, with budget and spend (D-154).',
    implements: ['D-154'],
  })
  @ApiPaginated(CampaignDto, { example: CAMPAIGN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: CampaignListQuery) {
    const [rows, total] = await this.promotions.listCampaigns(
      q.status ? { status: q.status } : {},
      q.page,
      q.perPage,
    );
    const extras = await this.promotions.campaignExtras(rows.map((r) => r.id));
    return { data: rows.map((r) => campaignDto(r, extras.get(r.id))), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post()
  @Can('campaigns.manage')
  @ApiEndpoint({
    id: 'admin.campaigns.create',
    summary: 'Create a campaign',
    description:
      'Marketing creates a campaign as a draft with an optional THB budget; the alert threshold is the ' +
      '`campaigns.budget_alert_pct` setting in force (80 %, D-154), kept on the campaign.',
    implements: ['D-154'],
  })
  @ApiBody({
    type: CreateCampaignDto,
    examples: {
      default: {
        value: {
          code: 'launch-2026',
          name: 'เปิดตัว Packio',
          startsAt: '2026-11-01T00:00:00+07:00',
          budgetAmount: '50000.00',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Campaign',
    type: CampaignDto,
    example: { ...CAMPAIGN_EXAMPLE, status: 'draft', spentAmount: '0.00' },
  })
  @ApiStandardErrors(...WRITE, 'promotions.code_taken')
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateCampaignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.promotions.createCampaign(staff(actor), body);
    res.setHeader('ETag', campaignEtag(row));
    return this.campaignView(row);
  }

  @Get(':campaignId')
  @Can('promotions.read')
  @campaignParam
  @ApiEndpoint({
    id: 'admin.campaigns.get',
    summary: 'Get a campaign',
    description: 'With its budget, spend and alert (D-154).',
    implements: ['D-154'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Campaign', type: CampaignDto, example: CAMPAIGN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('campaignId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const row = await this.promotions.campaign(id);
    res.setHeader('ETag', campaignEtag(row));
    return this.campaignView(row);
  }

  @Patch(':campaignId')
  @Can('campaigns.manage')
  @campaignParam
  @ApiEndpoint({
    id: 'admin.campaigns.update',
    summary: 'Update a campaign',
    description:
      'Name, window, goals or budget; the budget never goes below what is already spent. Raising the budget ' +
      'of an exhausted campaign reopens it (D-154). Guarded by `If-Match`.',
    implements: ['D-154'],
  })
  @ApiConcurrency()
  @ApiBody({ type: UpdateCampaignDto, examples: { default: { value: { budgetAmount: '80000.00' } } } })
  @ApiSuccess(200, { description: 'Campaign', type: CampaignDto, example: CAMPAIGN_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'promotions.ended')
  async update(
    @CurrentActor() actor: Actor,
    @Param('campaignId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateCampaignDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.promotions.updateCampaign(staff(actor), id, ifMatch, body);
    res.setHeader('ETag', campaignEtag(row));
    return this.campaignView(row);
  }

  @Post(':campaignId/actions/:action')
  @HttpCode(200)
  @Can('campaigns.manage')
  @campaignParam
  @actionParam
  @ApiEndpoint({
    id: 'admin.campaigns.action',
    summary: 'Activate, pause or end a campaign',
    description:
      '`activate` makes it active (or scheduled before its start); `pause` stops its promotions applying; ' +
      '`end` is final. A campaign whose budget is spent stops by itself (`exhausted`, D-154). An optional ' +
      '`reason` is recorded with the change.',
    implements: ['D-154'],
  })
  @ApiBody({ type: OptionalReasonDto, required: false, examples: { default: { value: { reason: 'งบหมดก่อนกำหนด (fake)' } } } })
  @ApiSuccess(200, { description: 'Campaign', type: CampaignDto, example: CAMPAIGN_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json','http.not_found', 'validation.failed', 'promotions.invalid_transition')
  async action(
    @CurrentActor() actor: Actor,
    @Param('campaignId', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: OptionalReasonDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.promotions.campaignAction(staff(actor), id, action, ifMatch, body.reason);
    res.setHeader('ETag', campaignEtag(row));
    return this.campaignView(row);
  }

  private async campaignView(row: Campaign): Promise<CampaignDto> {
    return campaignDto(row, (await this.promotions.campaignExtras([row.id])).get(row.id));
  }
}

@ApiSurface('admin', 'promotions')
@Controller('promotions')
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsAdminService) {}

  @Get()
  @Can('promotions.read')
  @ApiEndpoint({
    id: 'admin.promotions.list',
    summary: 'List promotions',
    description: 'Filter by status, kind or campaign; ordered by status then priority (D-053).',
    implements: ['D-053'],
  })
  @ApiPaginated(PromotionDto, { example: PROMOTION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: PromotionListQuery) {
    const where: Prisma.PromotionWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.kind && { kind: q.kind }),
      ...(q.campaignId && { campaign: { publicId: q.campaignId } }),
    };
    const [rows, total] = await this.promotions.listPromotions(where, q.page, q.perPage);
    const usage = await this.promotions.usage(rows.map((r) => r.id));
    return { data: rows.map((r) => promotionDto(r, usage.get(r.id))), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Put('priority')
  @Can('promotions.manage')
  @Idempotent({ optional: true })
  @ApiEndpoint({
    id: 'admin.promotions.reorder',
    summary: 'Set the evaluation order of promotions',
    description:
      'The promotions in the order given get priorities 10, 20, … in one transaction; each change is recorded ' +
      '(D-053). Referral promotions are system-managed (409 `promotions.system_managed`).',
    implements: ['D-053'],
  })
  @ApiBody({ type: PromotionPriorityDto, examples: { default: { value: { promotionIds: [PROMOTION_EXAMPLE.id] } } } })
  @ApiSuccess(200, { description: 'Reordered', type: PromotionPriorityResultDto, example: { updated: 3 } })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed', 'promotions.system_managed')
  async reorder(@CurrentActor() actor: Actor, @Body() body: PromotionPriorityDto): Promise<PromotionPriorityResultDto> {
    return { updated: await this.promotions.reorder(staff(actor), body.promotionIds) };
  }

  @Get('report')
  @Can('promotions.read')
  @ApiEndpoint({
    id: 'admin.promotions.report',
    summary: 'Redemption and cost report',
    description:
      'Reserved and applied redemptions of a campaign or promotion (or all) in a period: discounts given, ' +
      'amounts capped by the margin guard or budget, order groups, their gross and customers (D-053).',
    implements: ['D-053', 'D-154'],
  })
  @ApiSuccess(200, { description: 'Report', type: PromotionReportDto, example: REPORT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async report(@Query() q: ReportQuery): Promise<PromotionReportDto> {
    const where: Prisma.PromotionRedemptionWhereInput = {
      ...(q.campaignId && { campaign: { publicId: q.campaignId } }),
      ...(q.promotionId && { promotion: { publicId: q.promotionId } }),
      ...((q.from || q.to) && {
        reservedAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(q.to) }) },
      }),
    };
    return { ...(await this.promotions.report(where)), currency: 'THB' };
  }

  @Post()
  @Can('promotions.manage')
  @ApiEndpoint({
    id: 'admin.promotions.create',
    summary: 'Create a promotion',
    description:
      'A draft coupon or automatic promotion. Conditions and the benefit are validated against JSON schema ' +
      'v1 (D-053); the margin guard applies whatever the benefit (`pricing.margin_floor_pct`).',
    implements: ['D-053'],
  })
  @ApiBody({ type: CreatePromotionDto, examples: { default: { value: CREATE_PROMOTION_EXAMPLE } } })
  @ApiSuccess(201, {
    description: 'Promotion',
    type: PromotionDto,
    example: { ...PROMOTION_EXAMPLE, status: 'draft' },
  })
  @ApiStandardErrors(...WRITE)
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreatePromotionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.promotions.createPromotion(staff(actor), body);
    res.setHeader('ETag', promotionEtag(row));
    return this.promotionView(row);
  }

  @Get(':promotionId')
  @Can('promotions.read')
  @promotionParam
  @ApiEndpoint({
    id: 'admin.promotions.get',
    summary: 'Get a promotion',
    description: 'Conditions, benefit, limits and spend (D-053).',
    implements: ['D-053'],
  })
  @ApiEtag()
  @ApiSuccess(200, { description: 'Promotion', type: PromotionDto, example: PROMOTION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('promotionId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const row = await this.promotions.promotion(id);
    res.setHeader('ETag', promotionEtag(row));
    return this.promotionView(row);
  }

  @Patch(':promotionId')
  @Can('promotions.manage')
  @promotionParam
  @ApiEndpoint({
    id: 'admin.promotions.update',
    summary: 'Update a promotion',
    description:
      'Anything but its kind and campaign, until it ends; orders already placed keep the redemption they ' +
      'reserved (D-053). Guarded by `If-Match`.',
    implements: ['D-053'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: UpdatePromotionDto,
    examples: { default: { value: { priority: 50, usageLimitTotal: 2000 } } },
  })
  @ApiSuccess(200, { description: 'Promotion', type: PromotionDto, example: PROMOTION_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'promotions.ended')
  async update(
    @CurrentActor() actor: Actor,
    @Param('promotionId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdatePromotionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.promotions.updatePromotion(staff(actor), id, ifMatch, body);
    res.setHeader('ETag', promotionEtag(row));
    return this.promotionView(row);
  }

  @Post(':promotionId/actions/:action')
  @HttpCode(200)
  @Can('promotions.manage')
  @promotionParam
  @actionParam
  @ApiEndpoint({
    id: 'admin.promotions.action',
    summary: 'Activate, pause or end a promotion',
    description: 'A coupon promotion needs at least one code before it is activated; `end` is final (D-053).',
    implements: ['D-053'],
  })
  @ApiBody({ type: OptionalReasonDto, required: false, examples: { default: { value: { reason: 'งบหมดก่อนกำหนด (fake)' } } } })
  @ApiSuccess(200, { description: 'Promotion', type: PromotionDto, example: PROMOTION_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'promotions.invalid_transition',
    'promotions.no_codes',
  )
  async action(
    @CurrentActor() actor: Actor,
    @Param('promotionId', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: OptionalReasonDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.promotions.promotionAction(staff(actor), id, action, ifMatch, body.reason);
    res.setHeader('ETag', promotionEtag(row));
    return this.promotionView(row);
  }

  @Post(':promotionId/coupons')
  @Can('promotions.manage')
  @Idempotent()
  @promotionParam
  @ApiEndpoint({
    id: 'admin.promotions.generateCoupons',
    summary: 'Generate coupon codes',
    description:
      '`single`: one shared code; `bulk_unique`: up to 10,000 one-use codes with a prefix; `per_customer`: one ' +
      'code assigned to each listed customer (D-053). Codes are unique regardless of case. Needs `Idempotency-Key`.',
    implements: ['D-053'],
  })
  @ApiBody({
    type: GenerateCouponsDto,
    examples: {
      single: { value: { kind: 'single', code: 'WELCOME10' } },
      bulk: { value: { kind: 'bulk_unique', count: 500, prefix: 'PK' } },
    },
  })
  @ApiSuccess(201, {
    description: 'Batch generated',
    type: CouponBatchResultDto,
    example: {
      batchId: '0192f3a0-7c1e-7d2a-9b1f-000000090004',
      count: 500,
      kind: 'bulk_unique',
      prefix: 'PK',
      usageLimit: 1,
      generatedAt: '2026-10-20T10:00:00+07:00',
      generatedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001', displayName: 'Dev Marketing' },
    },
  })
  @ApiStandardErrors(...WRITE, 'promotions.not_a_coupon', 'promotions.ended', 'promotions.code_taken')
  async generate(
    @CurrentActor() actor: Actor,
    @Param('promotionId', ParseUUIDPipe) id: string,
    @Body() body: GenerateCouponsDto,
  ): Promise<CouponBatchResultDto> {
    return this.promotions.generateCoupons(staff(actor), id, body);
  }

  @Get(':promotionId/coupons')
  @Can('promotions.read')
  @promotionParam
  @ApiEndpoint({
    id: 'admin.promotions.listCoupons',
    summary: 'List coupon codes of a promotion',
    description: 'In generation order, with uses, batch and the assigned customer; filter by batch or status (D-053).',
    implements: ['D-053'],
  })
  @ApiPaginated(CouponCodeDto, { example: COUPON_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async coupons(@Param('promotionId', ParseUUIDPipe) id: string, @Query() q: CouponListQuery) {
    const promotion = await this.promotions.promotion(id);
    const [rows, total] = await this.promotions.coupons(promotion.id, q.page, q.perPage, q);
    return { data: rows.map(couponDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post(':promotionId/coupons/exports')
  @HttpCode(200)
  @Can('promotions.manage')
  @promotionParam
  @ApiEndpoint({
    id: 'admin.promotions.exportCoupons',
    summary: 'Export coupon codes as CSV',
    description:
      'All codes of the promotion, or of one batch, as UTF-8 CSV (formula-safe) behind a 5-minute signed URL. ' +
      'Codes are bearer values: the export is audited (`export.generated`, D-053, D-033).',
    implements: ['D-053', 'D-033'],
  })
  @ApiBody({
    type: CouponExportQuery,
    examples: { default: { value: { batchId: '0192f3a0-7c1e-7d2a-9b1f-000000090004' } } },
  })
  @ApiSuccess(200, {
    description: 'Export ready',
    type: CouponExportDto,
    example: {
      fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f11f',
      url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
      codes: 500,
      expiresAt: '2026-11-01T10:05:00+07:00',
    },
  })
  @ApiStandardErrors(...WRITE, 'promotions.not_a_coupon')
  async exportCoupons(
    @CurrentActor() actor: Actor,
    @Param('promotionId', ParseUUIDPipe) id: string,
    @Body() body: CouponExportQuery,
  ): Promise<CouponExportDto> {
    const r = await this.promotions.exportCoupons(staff(actor), id, body.batchId);
    return { ...r, expiresAt: toBangkokIso(r.expiresAt) };
  }

  @Post(':promotionId/coupons/:couponId/actions/:action')
  @HttpCode(200)
  @Can('promotions.manage')
  @promotionParam
  @ApiParam({ name: 'couponId', format: 'uuid' })
  @couponActionParam
  @ApiEndpoint({
    id: 'admin.promotions.setCouponStatus',
    summary: 'Disable or re-enable a coupon code',
    description:
      'A disabled code is refused at the cart; re-enabling restores `active` or `used_up` (D-053).',
    implements: ['D-053'],
  })
  @ApiBody({ type: OptionalReasonDto, required: false, examples: { default: { value: { reason: 'รหัสรั่วไหล (fake)' } } } })
  @ApiSuccess(200, { description: 'Coupon code', type: CouponCodeDto, example: COUPON_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async setCouponStatus(
    @CurrentActor() actor: Actor,
    @Param('promotionId', ParseUUIDPipe) id: string,
    @Param('couponId', ParseUUIDPipe) couponId: string,
    @Param('action') action: string,
    @Body() body: OptionalReasonDto,
  ) {
    if (action !== 'disable' && action !== 'enable') throw new DomainException('http.not_found');
    return couponDto(
      await this.promotions.setCouponStatus(staff(actor), id, couponId, action === 'disable', body.reason),
    );
  }

  @Get(':promotionId/coupon-batches')
  @Can('promotions.read')
  @promotionParam
  @ApiEndpoint({
    id: 'admin.promotions.listCouponBatches',
    summary: 'List the coupon batches of a promotion',
    description: 'Each generation: kind, count, prefix, uses per code, when and by whom (D-053).',
    implements: ['D-053'],
  })
  @ApiSuccess(200, {
    description: 'Batches',
    type: [CouponBatchDto],
    example: [
      {
        id: '0192f3a0-7c1e-7d2a-9b1f-000000090004',
        kind: 'bulk_unique',
        count: 500,
        prefix: 'PK',
        usageLimit: 1,
        generatedAt: '2026-10-20T10:00:00+07:00',
        generatedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e0001', displayName: 'Dev Marketing' },
      },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async batches(@Param('promotionId', ParseUUIDPipe) id: string): Promise<CouponBatchDto[]> {
    const promotion = await this.promotions.promotion(id);
    return (await this.promotions.batches(promotion.id)).map((b) => ({
      id: b.publicId,
      kind: b.kind,
      count: b.count,
      prefix: b.prefix,
      usageLimit: b.usageLimit,
      generatedAt: toBangkokIso(b.generatedAt),
      generatedBy: b.createdBy ? { id: b.createdBy.publicId, displayName: b.createdBy.displayName } : null,
    }));
  }

  private async promotionView(row: PromotionRow): Promise<PromotionDto> {
    return promotionDto(row, (await this.promotions.usage([row.id])).get(row.id));
  }
}
