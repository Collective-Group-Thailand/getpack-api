import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { type Page } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import {
  APPROVAL_EXAMPLE,
  ApprovalListQuery,
  ApprovalRequestDto,
  ApproveDto,
  CreateDelegationDto,
  DELEGATION_EXAMPLE,
  DelegationDto,
  RejectDto,
  WithdrawDto,
} from './approvals.dto';
import { type ApprovalDetail, ApprovalsService } from './approvals.service';
import { type DelegationDetail, DelegationsService } from './delegations.service';

const userActor = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};
const iso = (date: Date | null) => (date ? toBangkokIso(date) : null);

export function toApprovalDto(request: ApprovalDetail): ApprovalRequestDto {
  return {
    id: request.publicId,
    policy: request.policy.key,
    subjectType: request.subjectType,
    subjectId: request.subjectPublicId,
    status: request.status,
    requester: { id: request.requester.publicId, displayName: request.requester.displayName },
    amount: request.amount?.toFixed(2) ?? null,
    currency: 'THB',
    pct: request.pct?.toFixed(4) ?? null,
    flags: request.flags,
    currentStepNo: request.currentStepNo,
    expiresAt: iso(request.expiresAt),
    decidedAt: iso(request.decidedAt),
    createdAt: toBangkokIso(request.createdAt),
    payload: request.payloadSnapshot as Record<string, unknown>,
    steps: request.steps.map((s) => ({
      stepNo: s.stepNo,
      role: s.approverRole.key,
      quorum: s.quorum,
      status: s.status,
      dueAt: iso(s.dueAt),
      completedAt: iso(s.completedAt),
    })),
    actions: request.actions.map((a) => ({
      action: a.action,
      stepNo: a.requestStep?.stepNo ?? null,
      actor: { id: a.actor.publicId, displayName: a.actor.displayName },
      onBehalfOf: a.onBehalfOf ? { id: a.onBehalfOf.publicId, displayName: a.onBehalfOf.displayName } : null,
      comment: a.comment,
      at: toBangkokIso(a.createdAt),
    })),
  };
}

const toDelegationDto = (d: DelegationDetail): DelegationDto => ({
  id: d.publicId,
  delegator: { id: d.delegator.publicId, displayName: d.delegator.displayName },
  delegate: { id: d.delegate.publicId, displayName: d.delegate.displayName },
  policy: d.policy?.key ?? null,
  validFrom: toBangkokIso(d.validFrom),
  validTo: toBangkokIso(d.validTo),
  reason: d.reason,
  revokedAt: iso(d.revokedAt),
});

const DECISION_ERRORS = [
  'http.not_found',
  'validation.failed',
  'approval.not_pending',
  'approval.expired',
  'approval.not_authorised',
  'approval.self_approval',
] as const;

@ApiSurface('admin', 'approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @Can('approvals.read')
  @ApiEndpoint({
    id: 'admin.approvals.list',
    summary: 'List approval requests',
    description:
      'All requests of the generic approval engine (discount memos, credit limits, payout runs, price proposals…), newest first.',
    implements: ['ADR-0006', 'D-052', 'D-121', 'D-022'],
  })
  @ApiPaginated(ApprovalRequestDto, { example: APPROVAL_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: ApprovalListQuery): Promise<Page<ApprovalRequestDto>> {
    const { rows, total } = await this.approvals.list({
      ...(query.status && { status: query.status }),
      ...(query.policy && { policyKey: query.policy }),
      ...(query.subjectType && { subjectType: query.subjectType }),
      ...toSkipTake(query),
    });
    return paginated(rows.map(toApprovalDto), total, query);
  }

  @Get('inbox')
  @Can('approvals.act')
  @ApiEndpoint({
    id: 'admin.approvals.inbox',
    summary: 'Requests waiting for my decision',
    description:
      'Pending requests whose current step I can decide through my roles or an active delegation; my own requests and ' +
      'requests I already approved a step of are excluded (maker-checker, ADR-0006).',
    implements: ['ADR-0006'],
  })
  @ApiSuccess(200, { description: 'Inbox', type: [ApprovalRequestDto], example: [APPROVAL_EXAMPLE] })
  @ApiStandardErrors('http.not_found')
  async inbox(@CurrentActor() actor: Actor): Promise<ApprovalRequestDto[]> {
    return (await this.approvals.inbox(userActor(actor))).map(toApprovalDto);
  }

  @Get(':requestId')
  @Can('approvals.read')
  @ApiEndpoint({
    id: 'admin.approvals.get',
    summary: 'Get one approval request with steps and actions',
    description: 'Request snapshot, materialised steps and the action trail.',
    implements: ['ADR-0006'],
  })
  @ApiSuccess(200, { description: 'The request', type: ApprovalRequestDto, example: APPROVAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('requestId', ParseUUIDPipe) requestId: string): Promise<ApprovalRequestDto> {
    return toApprovalDto(await this.approvals.get(requestId));
  }

  @Post(':requestId/actions/approve')
  @HttpCode(200)
  @Can('approvals.act')
  @ApiEndpoint({
    id: 'admin.approvals.approve',
    summary: 'Approve the current step',
    description:
      "Needs the step's role (or a delegation from someone who holds it). The requester never approves, one person " +
      'approves at most one step, and SoD rules are checked. The last step approves the request (`approval.approved`).',
    implements: ['ADR-0006', 'D-166', 'D-169'],
  })
  @ApiBody({
    type: ApproveDto,
    examples: { default: { value: { comment: 'Verified by phone with the factory' } } },
  })
  @ApiSuccess(200, { description: 'Updated request', type: ApprovalRequestDto, example: APPROVAL_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    ...DECISION_ERRORS,
    'approval.already_acted',
    'iam.sod_conflict',
  )
  async approve(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: ApproveDto,
  ): Promise<ApprovalRequestDto> {
    return toApprovalDto(await this.approvals.approve(userActor(actor), requestId, body.comment));
  }

  @Post(':requestId/actions/reject')
  @HttpCode(200)
  @Can('approvals.act')
  @ApiEndpoint({
    id: 'admin.approvals.reject',
    summary: 'Reject the request',
    description: 'Ends the request; remaining steps are skipped. A comment is required.',
    implements: ['ADR-0006'],
  })
  @ApiBody({
    type: RejectDto,
    examples: { default: { value: { comment: 'Bank letter does not match the vendor name' } } },
  })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: ApprovalRequestDto,
    example: { ...APPROVAL_EXAMPLE, status: 'rejected' },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', ...DECISION_ERRORS)
  async reject(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: RejectDto,
  ): Promise<ApprovalRequestDto> {
    return toApprovalDto(await this.approvals.reject(userActor(actor), requestId, body.comment));
  }

  @Post(':requestId/actions/withdraw')
  @HttpCode(200)
  @Can('approvals.read')
  @ApiEndpoint({
    id: 'admin.approvals.withdraw',
    summary: 'Withdraw my pending request',
    description: 'Only the requester withdraws, while the request is pending.',
    implements: ['ADR-0006'],
  })
  @ApiBody({ type: WithdrawDto, examples: { default: { value: { reason: 'Raised by mistake' } } } })
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: ApprovalRequestDto,
    example: { ...APPROVAL_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'approval.not_pending',
    'approval.not_authorised',
  )
  async withdraw(
    @CurrentActor() actor: Actor,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: WithdrawDto,
  ): Promise<ApprovalRequestDto> {
    return toApprovalDto(await this.approvals.withdraw(userActor(actor), requestId, body.reason));
  }
}

@ApiSurface('admin', 'approvalDelegations')
@Controller('approval-delegations')
export class ApprovalDelegationsController {
  constructor(private readonly delegations: DelegationsService) {}

  @Get()
  @Can('approvals.delegate')
  @ApiEndpoint({
    id: 'admin.approvalDelegations.list',
    summary: 'My delegations (given and received)',
    description: 'Time-boxed delegations of approvals.',
    implements: ['ADR-0006'],
  })
  @ApiSuccess(200, { description: 'Delegations', type: [DelegationDto], example: [DELEGATION_EXAMPLE] })
  @ApiStandardErrors('http.not_found')
  async list(@CurrentActor() actor: Actor): Promise<DelegationDto[]> {
    return (await this.delegations.mine(userActor(actor))).map(toDelegationDto);
  }

  @Post()
  @Can('approvals.delegate')
  @ApiEndpoint({
    id: 'admin.approvalDelegations.create',
    summary: 'Delegate my approvals for a period',
    description:
      'The delegate approves on my behalf (recorded as such) for all policies or one; never my own requests. Audited.',
    implements: ['ADR-0006'],
  })
  @ApiBody({
    type: CreateDelegationDto,
    examples: {
      default: {
        value: {
          delegateId: '0192f3a0-7c1e-7d2a-9b1f-00000000c0c1',
          validFrom: '2026-10-01T00:00:00+07:00',
          validTo: '2026-10-08T00:00:00+07:00',
          reason: 'Annual leave',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: DelegationDto, example: DELEGATION_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'approval.delegation_invalid',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateDelegationDto): Promise<DelegationDto> {
    return toDelegationDto(
      await this.delegations.create(userActor(actor), {
        delegatePublicId: body.delegateId,
        ...(body.policy && { policyKey: body.policy }),
        validFrom: body.validFrom,
        validTo: body.validTo,
        reason: body.reason,
      }),
    );
  }

  @Post(':delegationId/actions/revoke')
  @HttpCode(200)
  @Can('approvals.delegate')
  @ApiEndpoint({
    id: 'admin.approvalDelegations.revoke',
    summary: 'End a delegation now',
    description: 'Only the delegator revokes.',
    implements: ['ADR-0006'],
  })
  @ApiSuccess(200, {
    description: 'Revoked',
    type: DelegationDto,
    example: { ...DELEGATION_EXAMPLE, revokedAt: '2026-10-03T09:00:00+07:00' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async revoke(
    @CurrentActor() actor: Actor,
    @Param('delegationId', ParseUUIDPipe) delegationId: string,
  ): Promise<DelegationDto> {
    return toDelegationDto(await this.delegations.revoke(userActor(actor), delegationId));
  }
}
