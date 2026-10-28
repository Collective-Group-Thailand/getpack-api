import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  APPROVAL_POLICY_EXAMPLE,
  ApprovalPolicyDto,
  POLICY_VERSION_EXAMPLE,
  PolicyVersionDto,
  ProposePolicyVersionDto,
} from './approval-policies.dto';
import { ApprovalPoliciesService, type PolicyVersionRow } from './approval-policies.service';

const staff = (actor: Actor): UserActor => {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
};

const versionDto = (v: PolicyVersionRow): PolicyVersionDto => ({
  versionNo: v.versionNo,
  status: v.status,
  effectiveFrom: toBangkokIso(v.effectiveFrom),
  reason: v.reason,
  autoApproveMaxAmount: v.autoApproveMaxAmount?.toFixed(2) ?? null,
  steps: v.steps.map((s) => ({
    stepNo: s.stepNo,
    name: s.name,
    approverRole: s.approverRole.key,
    approverScope: s.approverScope,
    condition: s.condition ?? null,
    quorum: s.quorum,
    slaMinutes: s.slaMinutes,
    slaCalendar: s.slaCalendar,
    escalateToRole: s.escalateToRole?.key ?? null,
  })),
  approvalId: v.approvalRequest?.publicId ?? null,
  createdBy: v.createdBy ? { id: v.createdBy.publicId, displayName: v.createdBy.displayName } : null,
  createdAt: toBangkokIso(v.createdAt),
  decidedAt: v.decidedAt ? toBangkokIso(v.decidedAt) : null,
});

@ApiSurface('admin', 'approvals')
@Controller('approval-policies')
export class AdminApprovalPoliciesController {
  constructor(private readonly policies: ApprovalPoliciesService) {}

  @Get()
  @Can('approvals.read')
  @ApiEndpoint({
    id: 'admin.approvalPolicies.list',
    summary: 'The approval matrix',
    description:
      'Every approval policy with the version in force (steps, approver roles, conditions), an approved version ' +
      'waiting for its date and a proposal waiting for the Superadmin (ADR-0006, D-063).',
    implements: ['D-063'],
  })
  @ApiSuccess(200, { description: 'Policies', type: [ApprovalPolicyDto], example: [APPROVAL_POLICY_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<ApprovalPolicyDto[]> {
    return (await this.policies.list()).map(({ policy, current, upcoming, pending }) => ({
      id: policy.publicId,
      key: policy.key,
      subjectType: policy.subjectType,
      description: policy.description,
      decisions: policy.decisionRefs,
      current: current ? versionDto(current) : null,
      upcoming: upcoming ? versionDto(upcoming) : null,
      pending: pending ? versionDto(pending) : null,
    }));
  }

  @Get(':policyId/versions')
  @Can('approvals.read')
  @ApiParam({ name: 'policyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.approvalPolicies.listVersions',
    summary: 'Versions of an approval policy',
    description: 'Newest first, with their steps, approval and decision.',
    implements: ['D-063'],
  })
  @ApiSuccess(200, { description: 'Versions', type: [PolicyVersionDto], example: [POLICY_VERSION_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async versions(@Param('policyId', ParseUUIDPipe) policyId: string): Promise<PolicyVersionDto[]> {
    return (await this.policies.versions(policyId)).versions.map(versionDto);
  }

  @Post(':policyId/versions')
  @Idempotent()
  @Can('approval_policies.manage')
  @ApiParam({ name: 'policyId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.approvalPolicies.proposeVersion',
    summary: 'Propose a new version of an approval policy',
    description:
      'Its steps (approver roles, scope, conditions, quorum, SLA) from `effectiveFrom` (now or later), with a reason. ' +
      'Routed through `approval_policy_change`: a Superadmin approves and the proposer never approves; once approved ' +
      'it applies from its date, and the running version is never edited (D-063). One proposal per policy at a time ' +
      '(409 `approval.already_pending`). The expiry rule is carried over from the version in force. Requires ' +
      '`Idempotency-Key`. Audited. D-449 B: `autoApproveMaxAmount` (THB) approves requests at or below it at creation ' +
      '("below threshold", audited, `approval.approved` with `autoApproved`); only on a policy whose steps have an amount ' +
      'condition (422), set / changed / removed by a Superadmin only (403 `approval.threshold_superadmin_only`); ' +
      'omitted = the value in force is carried over, null = none.',
    implements: ['D-063', 'D-449'],
  })
  @ApiBody({
    type: ProposePolicyVersionDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-11-01T00:00:00+07:00',
          reason: 'Raise the Finance limit to THB 150,000 (board 2026-10)',
          steps: [
            {
              name: 'Finance (≤ THB 150,000)',
              approverRole: 'finance',
              condition: { field: 'amount', op: 'lte', value: '150000.00' },
            },
            {
              name: 'C-Level (> THB 150,000)',
              approverRole: 'c_level',
              condition: { field: 'amount', op: 'gt', value: '150000.00' },
            },
          ],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Proposed', type: PolicyVersionDto, example: POLICY_VERSION_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'approval.already_pending',
    'approval.threshold_superadmin_only',
  )
  async propose(
    @CurrentActor() actor: Actor,
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() body: ProposePolicyVersionDto,
  ): Promise<PolicyVersionDto> {
    return versionDto(
      await this.policies.propose(staff(actor), policyId, {
        effectiveFrom: new Date(body.effectiveFrom),
        reason: body.reason,
        steps: body.steps,
        ...(body.autoApproveMaxAmount !== undefined && { autoApproveMaxAmount: body.autoApproveMaxAmount }),
      }),
    );
  }
}
