import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  DiscountMemoDto,
  MEMO_EXAMPLE,
  MemoListQuery,
  RaiseCompanyMemoDto,
  RaiseOrderMemoDto,
} from './discount-memos.dto';
import { DiscountMemosService, type MemoRow } from './discount-memos.service';

const DECISIONS = ['D-052', 'D-162'];
const memoParam = ApiParam({ name: 'memoId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

function memoDto(m: MemoRow, showMargin: boolean): Omit<DiscountMemoDto, 'evidence'> {
  return {
    id: m.publicId,
    scope: m.scope,
    status: m.status,
    requestedBy: { id: m.requestedBy.publicId, displayName: m.requestedBy.displayName },
    customer: m.customer ? { id: m.customer.publicId, displayName: m.customer.displayName } : null,
    companyId: m.company?.publicId ?? null,
    orderValue: m.orderValue.toFixed(2),
    requestedPct: m.requestedPct.toFixed(4),
    requestedAmount: m.requestedAmount.toFixed(2),
    resultingMarginPct: showMargin ? (m.resultingMarginPct?.toFixed(4) ?? null) : null,
    belowMarginFloor: m.belowMarginFloor,
    reason: m.reason,
    approvedPct: m.approvedPct?.toFixed(4) ?? null,
    approvalId: m.approvalRequest?.publicId ?? null,
    validUntil: toBangkokIso(m.validUntil),
    appliedGroupCode: m.appliedOrderGroup?.groupCode ?? null,
    createdAt: toBangkokIso(m.createdAt),
  };
}

@ApiSurface('admin', 'discountMemos')
@Controller()
export class AdminDiscountMemosController {
  constructor(
    private readonly memos: DiscountMemosService,
    private readonly permissions: PermissionResolver,
    private readonly prisma: PrismaService,
  ) {}

  /** The memo with its evidence files (D-052). */
  private async memoView(m: MemoRow, showMargin: boolean): Promise<DiscountMemoDto> {
    const files = m.evidenceFileIds.length
      ? await this.prisma.fileObject.findMany({ where: { id: { in: m.evidenceFileIds } }, orderBy: { id: 'asc' } })
      : [];
    return {
      ...memoDto(m, showMargin),
      evidence: files.map((f) => ({
        id: f.publicId,
        originalName: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: Number(f.sizeBytes),
      })),
    };
  }

  private async showMargin(actor: Actor): Promise<boolean> {
    if (actor.type !== 'user') return false;
    const granted = (await this.permissions.forUser(actor.userId)).permissions;
    return granted.has('margin.read') || granted.has('margin.read_pct_when_discounting');
  }

  @Post('discount-memos')
  @Can('discount_memos.request')
  @ApiEndpoint({
    id: 'admin.discountMemos.raise',
    summary: 'Raise a discount memo for a customer’s order',
    description:
      'Above `discounts.cs_limit_pct` (5 %): prices the customer’s CS cart now (order value, resulting margin) and ' +
      'routes the memo to the matching tier only — > 5–10 % Director, > 10–15 % VP, > 15 % or below the margin ' +
      'floor C-Level (D-052, D-162). Valid until the cart’s price lock (the quote validity); used once at checkout.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RaiseOrderMemoDto,
    examples: {
      default: {
        value: {
          customerId: '0192f3a0-7c1e-7d2a-9b1f-0000000d1002',
          requestedPct: '8',
          reason: 'คู่แข่งเสนอราคาต่ำกว่า 8%',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Memo', type: DiscountMemoDto, example: MEMO_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'discount_memos.within_cs_limit',
    'checkout.cart_empty',
    'checkout.price_expired',
    'approval.no_matching_step',
  )
  async raise(@CurrentActor() actor: Actor, @Body() body: RaiseOrderMemoDto): Promise<DiscountMemoDto> {
    return this.memoView(await this.memos.raiseForOrder(staff(actor), body), await this.showMargin(actor));
  }

  @Post('companies/:companyId/discount-memos')
  @Can('discount_memos.request')
  @ApiParam({ name: 'companyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.discountMemos.raiseForCompany',
    summary: 'Raise a company discount memo',
    description:
      'The company-level discount % through the same approval matrix (D-124); once approved it applies to the company’s orders, never below the margin floor.',
    implements: ['D-124', ...DECISIONS],
  })
  @ApiBody({
    type: RaiseCompanyMemoDto,
    examples: { default: { value: { requestedPct: '7', reason: 'ลูกค้าองค์กร สั่งประจำทุกเดือน' } } },
  })
  @ApiSuccess(201, {
    description: 'Memo',
    type: DiscountMemoDto,
    example: {
      ...MEMO_EXAMPLE,
      scope: 'company',
      customer: null,
      companyId: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003',
      orderValue: '0.00',
      requestedAmount: '0.00',
      resultingMarginPct: null,
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'discount_memos.within_cs_limit',
    'companies.invalid_status',
  )
  async raiseForCompany(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: RaiseCompanyMemoDto,
  ): Promise<DiscountMemoDto> {
    return this.memoView(
      await this.memos.raiseForCompany(staff(actor), companyId, body),
      await this.showMargin(actor),
    );
  }

  @Get('discount-memos')
  @Can('discount_memos.read')
  @ApiEndpoint({
    id: 'admin.discountMemos.list',
    summary: 'List discount memos',
    description: 'Newest first; filter by status or customer (D-052).',
    implements: DECISIONS,
  })
  @ApiPaginated(DiscountMemoDto, { example: MEMO_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: MemoListQuery) {
    const where: Prisma.DiscountMemoWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.customerId && { customer: { publicId: q.customerId } }),
      ...(q.requestedBy && { requestedBy: { publicId: q.requestedBy } }),
    };
    const [rows, total] = await this.memos.list(where, q.page, q.perPage);
    const show = await this.showMargin(actor);
    return {
      data: await Promise.all(rows.map((m) => this.memoView(m, show))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('discount-memos/:memoId')
  @Can('discount_memos.read')
  @memoParam
  @ApiEndpoint({
    id: 'admin.discountMemos.get',
    summary: 'Get a discount memo',
    description: 'With its approval and where it was used (D-052).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Memo', type: DiscountMemoDto, example: MEMO_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('memoId', ParseUUIDPipe) id: string,
  ): Promise<DiscountMemoDto> {
    return this.memoView(await this.memos.get(id), await this.showMargin(actor));
  }

  @Post('discount-memos/:memoId/actions/withdraw')
  @HttpCode(200)
  @Can('discount_memos.request')
  @memoParam
  @ApiEndpoint({
    id: 'admin.discountMemos.withdraw',
    summary: 'Withdraw my pending memo',
    description: 'Only the requester, while it waits for approval.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Memo',
    type: DiscountMemoDto,
    example: { ...MEMO_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'discount_memos.not_usable')
  async withdraw(
    @CurrentActor() actor: Actor,
    @Param('memoId', ParseUUIDPipe) id: string,
  ): Promise<DiscountMemoDto> {
    return this.memoView(await this.memos.withdraw(staff(actor), id), await this.showMargin(actor));
  }
}
