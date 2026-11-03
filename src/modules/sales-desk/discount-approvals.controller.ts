import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { csvCell } from '@modules/agents/agent-lead-rules';
import { agentRef } from '@modules/agents/agent-shared';
import { discountRequestDto } from '@modules/agents/agents-quotes.controller';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import {
  authorityColour,
  serializeWaterfall,
  type Waterfall,
  type WaterfallTier,
} from './discount-approval-rules';
import {
  APPROVAL_EXAMPLE,
  APPROVAL_SUMMARY_EXAMPLE,
  AuthorityWaterfallDto,
  DecideDiscountApprovalDto,
  DiscountApprovalDto,
  DiscountApprovalListQuery,
  DiscountApprovalSummaryDto,
  DiscountSimulationDto,
  FULL_WATERFALL_EXAMPLE,
  FullWaterfallDto,
  MarginPctWaterfallDto,
  OpenDiscountApprovalDto,
  SimulateDiscountApprovalDto,
  WaterfallViewDto,
  WaterfallViewListQuery,
} from './discount-approvals.dto';
import { type ApprovalRow, DiscountApprovalsService } from './discount-approvals.service';
import { SalesCsvService } from './sales-csv.service';
import { staffActor } from './sales-scope';

const DECISIONS = ['D-470', 'D-468', 'D-449', 'D-141'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

export function approvalSummaryDto(r: ApprovalRow, now = new Date()): DiscountApprovalSummaryDto {
  return {
    id: r.publicId,
    status: r.status,
    level: r.level,
    baseLevel: r.baseLevel,
    authorityLevel: authorityColour(r.level),
    negotiationHeavy: r.negotiationHeavy,
    requestedPct: r.requestedPct.toFixed(2),
    round: r.request.round,
    requestId: r.request.publicId,
    agentQuoteId: r.agentQuote.publicId,
    quote: {
      id: r.quote.publicId,
      quoteCode: r.quote.quoteCode,
      validUntil: toBangkokIso(r.quote.validUntil),
    },
    agent: agentRef(r.agentQuote.agent),
    lead: {
      id: r.agentQuote.lead.publicId,
      contactName: r.agentQuote.lead.contactName,
      organisationName: r.agentQuote.lead.organisationName,
    },
    requestedBy: { id: r.requestedBy.publicId, displayName: r.requestedBy.displayName },
    dueAt: toBangkokIso(r.dueAt),
    overdue: r.status === 'pending' && r.dueAt <= now,
    escalatedAt: iso(r.escalatedAt),
    decidedBy: r.decidedBy ? { id: r.decidedBy.publicId, displayName: r.decidedBy.displayName } : null,
    decidedAt: iso(r.decidedAt),
    validUntil: iso(r.validUntil),
    createdAt: toBangkokIso(r.createdAt),
  };
}

/**
 * D-470 (PLAN A-12, §7): the discount approval & price lock desk. Every response carries the waterfall in the
 * viewer's tier, chosen on the server from permissions: reps the authority colour only; sales managers percentages;
 * C-Level, VP, Director, Finance Manager and Superadmin the full waterfall. Every view is logged; only finance
 * exports.
 */
@ApiSurface('admin', 'discountApprovals')
@ApiExtraModels(AuthorityWaterfallDto, MarginPctWaterfallDto, FullWaterfallDto)
@Controller('sales/discount-approvals')
export class AdminDiscountApprovalsController {
  constructor(
    private readonly approvals: DiscountApprovalsService,
    private readonly csv: SalesCsvService,
    private readonly prisma: PrismaService,
  ) {}

  private async detail(actor: UserActor, row: ApprovalRow): Promise<DiscountApprovalDto> {
    const tier = await this.approvals.tier(actor);
    const { quoteView, options } = await this.approvals.views(row, tier);
    await this.approvals.logView(actor, row, tier, 'view');
    return {
      ...approvalSummaryDto(row),
      request: discountRequestDto(row.request),
      waterfall: quoteView,
      optionWaterfalls: options,
      decisionNote: row.decisionNote,
      counter: (row.counter as Record<string, unknown> | null) ?? null,
      selfApproved: row.selfApproved,
      ...(tier === 'full' && {
        priceLocks: row.priceLocks.map((l) => ({
          id: l.publicId,
          buyPrice: l.buyPrice.toFixed(2),
          status: l.status,
          validUntil: toBangkokIso(l.validUntil),
        })),
      }),
    };
  }

  @Get()
  @Can('discount_approvals.read')
  @ApiEndpoint({
    id: 'admin.discountApprovals.list',
    summary: 'List discount approvals',
    description:
      'The queue with the SLA (`dueAt`, `overdue`, escalation), level and authority colour; no figures. A rep ' +
      'sees their own requests and those their level may decide; `awaitingMe` = pending ones I may decide ' +
      '(D-470).',
    implements: DECISIONS,
  })
  @ApiPaginated(DiscountApprovalSummaryDto, { example: APPROVAL_SUMMARY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: DiscountApprovalListQuery) {
    const { rows, total } = await this.approvals.list(staffActor(actor), q);
    const now = new Date();
    return {
      data: rows.map((r) => approvalSummaryDto(r, now)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Post()
  @Can('discount_approvals.decide')
  @ApiEndpoint({
    id: 'admin.discountApprovals.open',
    summary: 'Open the approval of a discount request',
    description:
      'Normally automatic when an agent or rep asks; by hand for a request opened before or while a cost was ' +
      'unknown. Every quoted quantity needs a buy price (price list, rate card or factory RFQ answer) — else ' +
      '`discount_approval.cost_unknown` and nothing opens (D-470).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: OpenDiscountApprovalDto,
    examples: { default: { value: { discountRequestId: APPROVAL_EXAMPLE.requestId } } },
  })
  @ApiSuccess(201, { description: 'Approval', type: DiscountApprovalDto, example: APPROVAL_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'agents.discount_request_closed',
    'discount_approval.already_open',
    'discount_approval.cost_unknown',
  )
  async open(
    @CurrentActor() actor: Actor,
    @Body() body: OpenDiscountApprovalDto,
  ): Promise<DiscountApprovalDto> {
    const me = staffActor(actor);
    return this.detail(me, await this.approvals.open(me, body.discountRequestId));
  }

  @Get('views')
  @Can('sales_waterfall_views.read')
  @ApiEndpoint({
    id: 'admin.discountApprovals.listViews',
    summary: 'Read the waterfall access log',
    description:
      'Who was shown which quote’s waterfall, when, in which tier and why (view, simulate, export) — newest ' +
      'first, append-only (D-470, like D-444).',
    implements: ['D-470', 'D-444'],
  })
  @ApiPaginated(WaterfallViewDto, {
    example: {
      id: '0192f3a0-7c1e-7d2a-9b1f-0000000a7005',
      viewer: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000a7001', displayName: 'สมหญิง ขายดี' },
      quoteId: APPROVAL_EXAMPLE.quote.id,
      quoteCode: 'QT-2611-00042',
      approvalId: APPROVAL_EXAMPLE.id,
      tier: 'full',
      purpose: 'view',
      viewedAt: '2026-11-03T10:12:00+07:00',
    },
  })
  @ApiStandardErrors('validation.failed')
  async views(@Query() q: WaterfallViewListQuery) {
    const where = {
      ...(q.quoteId && { quote: { publicId: q.quoteId } }),
      ...(q.viewerId && { viewer: { publicId: q.viewerId } }),
    };
    const prisma = this.prisma;
    const [rows, total] = await Promise.all([
      prisma.salesWaterfallView.findMany({
        where,
        include: {
          viewer: { select: { publicId: true, displayName: true } },
          quote: { select: { publicId: true, quoteCode: true } },
          approval: { select: { publicId: true } },
        },
        orderBy: [{ viewedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      prisma.salesWaterfallView.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.publicId,
        viewer: { id: r.viewer.publicId, displayName: r.viewer.displayName },
        quoteId: r.quote.publicId,
        quoteCode: r.quote.quoteCode,
        approvalId: r.approval?.publicId ?? null,
        tier: r.tier,
        purpose: r.purpose,
        viewedAt: toBangkokIso(r.viewedAt),
      })),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get(':approvalId')
  @Can('discount_approvals.read')
  @ApiParam({ name: 'approvalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.discountApprovals.get',
    summary: 'Get a discount approval with its waterfall',
    description:
      'The round (give-get, competitor evidence), the quote’s waterfall at the requested discount and one per ' +
      'offered option — each in the viewer’s tier (`visibility` authority | margin_pct | full); factory price ' +
      'locks only in the full tier. The view is logged (D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Approval', type: DiscountApprovalDto, example: APPROVAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'discount_approval.cost_unknown')
  async get(
    @CurrentActor() actor: Actor,
    @Param('approvalId', ParseUUIDPipe) id: string,
  ): Promise<DiscountApprovalDto> {
    const me = staffActor(actor);
    const row = await this.approvals.row(id);
    await this.approvals.visible(me, row);
    return this.detail(me, row);
  }

  @Post(':approvalId/actions/simulate')
  @HttpCode(200)
  @Can('discount_approvals.read')
  @ApiParam({ name: 'approvalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.discountApprovals.simulate',
    summary: 'Simulate a discount, credit terms or a co-fund rate',
    description:
      'Recomputes the waterfall and the level for a discount %, credit days, a payment schedule template, a ' +
      'deposit, a co-fund / spiff rate, the payment method and free services — in the viewer’s tier. Nothing is ' +
      'saved; the simulation is logged (D-470).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SimulateDiscountApprovalDto,
    examples: { default: { value: { discountPct: '4.00', creditDays: 30, ratePct: '2.5000' } } },
  })
  @ApiSuccess(200, {
    description: 'Simulation',
    type: DiscountSimulationDto,
    example: { level: 'sales_manager', waterfall: FULL_WATERFALL_EXAMPLE },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'discount_approval.cost_unknown')
  async simulate(
    @CurrentActor() actor: Actor,
    @Param('approvalId', ParseUUIDPipe) id: string,
    @Body() body: SimulateDiscountApprovalDto,
  ): Promise<DiscountSimulationDto> {
    return this.approvals.simulate(staffActor(actor), id, body);
  }

  @Post(':approvalId/actions/decide')
  @HttpCode(200)
  @Can('discount_approvals.decide')
  @Idempotent()
  @ApiParam({ name: 'approvalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.discountApprovals.decide',
    summary: 'Approve, reject or counter a discount',
    description:
      '`approve` with 1–3 options (the first `standard` at the agent’s full rate; co-fund lower, spiff higher — ' +
      'each within my level) — they are offered to the agent valid `quotes.discounted_validity_days`; a big deal ' +
      'also locks the factory buy price. `reject` / `counter` need a note (counter: the give-get asked instead). ' +
      'The requester never decides; a Superadmin may self-approve only under solo-owner mode with a typed reason ' +
      '(D-449, flagged). A changed quote voids the approval (`discount_approval.stale`) (D-470).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: DecideDiscountApprovalDto,
    examples: {
      approve: {
        value: {
          decision: 'approve',
          options: [
            { kind: 'standard', discountPct: '3.00' },
            { kind: 'co_fund', discountPct: '5.00', ratePct: '2.0000' },
          ],
          note: 'อนุมัติเมื่อมัดจำ 50%',
        },
      },
      reject: { value: { decision: 'reject', note: 'ต่ำกว่าเส้นขั้นต่ำ' } },
      counter: { value: { decision: 'counter', note: 'ได้ถ้ามัดจำ 50%', counter: { depositPct: '50.00' } } },
    },
  })
  @ApiSuccess(200, {
    description: 'Approval',
    type: DiscountApprovalDto,
    example: { ...APPROVAL_EXAMPLE, status: 'approved' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'discount_approval.not_pending',
    'discount_approval.not_authorised',
    'discount_approval.self_approval',
    'discount_approval.stale',
    'discount_approval.cost_unknown',
    'agents.discount_request_closed',
  )
  async decide(
    @CurrentActor() actor: Actor,
    @Param('approvalId', ParseUUIDPipe) id: string,
    @Body() body: DecideDiscountApprovalDto,
  ): Promise<DiscountApprovalDto> {
    const me = staffActor(actor);
    return this.detail(me, await this.approvals.decide(me, id, body));
  }

  @Get(':approvalId/export')
  @Can('discount_approvals.export')
  @ApiParam({ name: 'approvalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.discountApprovals.export',
    summary: 'Export a deal’s full waterfall as CSV',
    description:
      'Finance only (`discount_approvals.export`): the full waterfall of the quote and of every offered option ' +
      'behind a 5-minute link; logged as a view (export) and audited (D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Download link',
    type: DownloadUrlDto,
    example: { url: 'https://getpack-files.s3.example.com/…', expiresAt: '2026-11-03T10:05:00+07:00' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async export(
    @CurrentActor() actor: Actor,
    @Param('approvalId', ParseUUIDPipe) id: string,
  ): Promise<DownloadUrlDto> {
    const me = staffActor(actor);
    const row = await this.approvals.row(id);
    const tier: WaterfallTier = 'full';
    const { options } = await this.approvals.views(row, tier);
    const w = row.waterfall as unknown as Waterfall;
    const lines = (label: string, v: Record<string, unknown>) =>
      Object.entries(v).map(([k, value]) => [
        label,
        k,
        typeof value === 'object' ? JSON.stringify(value) : value,
      ]);
    const rows: unknown[][] = [
      ['scope', 'line', 'value'],
      ...lines('quote', serializeWaterfall(w, row.level, tier) as unknown as Record<string, unknown>),
      ...options.flatMap((o) => lines(`option:${o.kind}`, o.waterfall as unknown as Record<string, unknown>)),
    ];
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    await this.approvals.logView(me, row, tier, 'export');
    const { url, expiresAt } = await this.csv.publish(
      me,
      `waterfall-${row.quote.quoteCode ?? row.publicId}`,
      csv,
      {
        kind: 'sales_waterfall',
        resourceType: 'sales_discount_approval',
        resourcePublicId: row.publicId,
        rows: rows.length - 1,
      },
    );
    return { url, expiresAt: toBangkokIso(expiresAt) };
  }
}
