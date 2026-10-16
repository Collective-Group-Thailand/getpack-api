import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { ReasonDto } from '@common/dto/reason.dto';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { dateOnly } from '@common/ledger-core/dates';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { MonthDto } from '@modules/financial-reports/financial-reports.dto';
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
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { AgentAttributionService } from './agent-attribution.service';
import { type FactoryLinkRow } from './agent-attribution.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentStatementsService, periodBounds, statementEtag } from './agent-statements.service';
import { type StatementRow } from './agent-statements.service';
import {
  AdjustAgentCommissionDto,
  ADMIN_AGENT_EXAMPLE,
  ADMIN_AGENT_LINK_EXAMPLE,
  ADMIN_APPLICATION_EXAMPLE,
  ADMIN_COMMISSION_EXAMPLE,
  ADMIN_LEAD_EXAMPLE,
  ADMIN_STATEMENT_DETAIL_EXAMPLE,
  ADMIN_STATEMENT_EXAMPLE,
  AdminAgentApplicationDto,
  AdminAgentCommissionDto,
  AdminAgentDto,
  AdminAgentLeadDto,
  AdminAgentLinkDto,
  AdminAgentStatementDetailDto,
  AdminAgentStatementDto,
  AGENT_IDS,
  AgentFactoryLinkDto,
  AgentListQuery,
  AgentMarkPaidDto,
  AgentPayrollExportDto,
  AgentPlanDto,
  AgentStatementsGeneratedDto,
  ApplicationListQuery,
  ApproveAgentApplicationDto,
  AssignAgentLinkDto,
  CommissionListQuery,
  CreateAgentPlanDto,
  CreateEmployeeAgentDto,
  DecideHeldAgentCommissionDto,
  DraftAgentPlanVersionDto,
  FACTORY_LINK_EXAMPLE,
  FactoryLinkListQuery,
  LeadListQuery,
  LinkAgentFactoryDto,
  LinkListQuery,
  PLAN_EXAMPLE,
  StatementListQuery,
  UpdateAgentDto,
} from './agents.dto';
import { agentEtag, AgentsService } from './agents.service';
import { type AgentRow, type PlanRow } from './agents.service';
import {
  adminAgentDto,
  adminAgentLinkDto,
  adminApplicationDto,
  adminCommissionDto,
  adminLeadDto,
  adminStatementDto,
  factoryLinkDto,
  planDto,
} from './agents-views';

const DECISIONS = ['D-416', 'D-417', 'D-418', 'D-419', 'D-420', 'D-423'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const REASON_EXAMPLE = { default: { value: { reason: 'ตรวจสอบแล้ว ตามที่ตกลงในที่ประชุมฝ่ายขาย' } } };

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'agents')
@Controller()
export class AdminAgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly attribution: AgentAttributionService,
    private readonly commissions: AgentCommissionsService,
    private readonly statements: AgentStatementsService,
  ) {}

  private async agentView(row: AgentRow): Promise<AdminAgentDto> {
    return adminAgentDto(
      row,
      this.agents.linkFor(row.code),
      await this.agents.termsNow(row.planId),
      await this.agents.totals(row.id),
    );
  }

  private async factoryLinkView(row: FactoryLinkRow): Promise<AgentFactoryLinkDto> {
    const from = row.factory.activatedAt;
    const jobs = from ? await this.commissions.qualifyingJobs(row.factory.id, from, new Date()) : 0;
    return factoryLinkDto(row, jobs);
  }

  private statementView(row: StatementRow, res?: Response): AdminAgentStatementDto {
    if (res) res.setHeader('ETag', statementEtag(row));
    return adminStatementDto(row, this.statements.payment(row));
  }

  // --- applications ---------------------------------------------------------------------------------------

  @Get('agent-applications')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.listApplications',
    summary: 'List agent applications',
    description: 'Newest first; `status=submitted` is Sales’ queue (D-416).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentApplicationDto, { example: ADMIN_APPLICATION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async listApplications(@Query() q: ApplicationListQuery) {
    const [rows, total] = await this.agents.applications(
      q.status ? { status: q.status } : {},
      q.page,
      q.perPage,
    );
    const data = await Promise.all(
      rows.map(async (r) => adminApplicationDto(r, await this.agents.checks(r))),
    );
    return { data, meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('agent-applications/:applicationId')
  @Can('agents.read')
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.getApplication',
    summary: 'Get an agent application',
    description:
      'With the checks Sales should make: tax id already an agent or vendor, bank account name ≠ legal name, ' +
      'the applicant already buys (D-416). The account number shows its last 4 digits only.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Application',
    type: AdminAgentApplicationDto,
    example: ADMIN_APPLICATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getApplication(@Param('applicationId', ParseUUIDPipe) id: string): Promise<AdminAgentApplicationDto> {
    const row = await this.agents.application(id);
    return adminApplicationDto(row, await this.agents.checks(row));
  }

  @Post('agent-applications/:applicationId/actions/approve')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.approveApplication',
    summary: 'Approve an agent application',
    description:
      'Creates the agent on a freelance plan, its vendor (kind `sales_agent`) and proposes its bank account for ' +
      'Finance’s dual approval and verification call; grants the customer role `sales_agent` (D-416).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ApproveAgentApplicationDto, examples: { default: { value: { planId: AGENT_IDS.plan } } } })
  @ApiSuccess(200, { description: 'The agent', type: AdminAgentDto, example: ADMIN_AGENT_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'agents.application_decided',
    'agents.already_agent',
    'agents.plan_not_in_force',
    'partners.bank_account_pending',
  )
  async approveApplication(
    @CurrentActor() actor: Actor,
    @Param('applicationId', ParseUUIDPipe) id: string,
    @Body() body: ApproveAgentApplicationDto,
  ): Promise<AdminAgentDto> {
    return this.agentView(await this.agents.approve(staff(actor), id, body));
  }

  @Post('agent-applications/:applicationId/actions/reject')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.rejectApplication',
    summary: 'Reject an agent application',
    description: 'With a reason the applicant sees (D-416).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Application',
    type: AdminAgentApplicationDto,
    example: ADMIN_APPLICATION_EXAMPLE,
  })
  @ApiStandardErrors(...WRITE, 'agents.application_decided')
  async rejectApplication(
    @CurrentActor() actor: Actor,
    @Param('applicationId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ): Promise<AdminAgentApplicationDto> {
    const row = await this.agents.reject(staff(actor), id, body.reason);
    return adminApplicationDto(row, await this.agents.checks(row));
  }

  // --- agents ---------------------------------------------------------------------------------------------

  @Get('agents')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.list',
    summary: 'List sales agents',
    description:
      'Newest first, with totals by commission status; `q` searches the name, code and employee code.',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentDto, { example: ADMIN_AGENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: AgentListQuery) {
    const text = q.q?.trim();
    const [rows, total] = await this.agents.agents(
      {
        ...(q.status && { status: q.status }),
        ...(q.kind && { kind: q.kind }),
        ...(text && {
          OR: [
            { legalName: { contains: text, mode: 'insensitive' as const } },
            { code: { contains: text.toUpperCase() } },
            { employeeCode: { contains: text, mode: 'insensitive' as const } },
          ],
        }),
      },
      q.page,
      q.perPage,
    );
    return {
      data: await Promise.all(rows.map((r) => this.agentView(r))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('agents/:agentId')
  @Can('agents.read')
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiEtag()
  @ApiEndpoint({
    id: 'admin.agents.get',
    summary: 'Get a sales agent',
    description: 'Profile, plan in force, bank account state and totals (D-416).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Agent', type: AdminAgentDto, example: ADMIN_AGENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAgentDto> {
    const row = await this.agents.agent(id);
    res.setHeader('ETag', agentEtag(row));
    return this.agentView(row);
  }

  @Post('agents')
  @Can('agents.manage')
  @ApiEndpoint({
    id: 'admin.agents.createEmployee',
    summary: 'Make an employee a sales agent',
    description:
      'A Collective employee’s customer account becomes an agent on an employee plan, with their employee code ' +
      '(and their staff account, when they have one); paid through payroll (D-416, D-420).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateEmployeeAgentDto,
    examples: {
      default: {
        value: {
          customerId: AGENT_IDS.user,
          legalName: 'สมหญิง พนักงานขาย',
          employeeCode: 'CG-0142',
          planId: AGENT_IDS.plan,
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Agent',
    type: AdminAgentDto,
    example: { ...ADMIN_AGENT_EXAMPLE, kind: 'employee' },
  })
  @ApiStandardErrors(...WRITE, 'agents.already_agent', 'agents.plan_not_in_force')
  async createEmployee(
    @CurrentActor() actor: Actor,
    @Body() body: CreateEmployeeAgentDto,
  ): Promise<AdminAgentDto> {
    return this.agentView(await this.agents.createEmployee(staff(actor), body));
  }

  @Patch('agents/:agentId')
  @Can('agents.manage')
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'admin.agents.update',
    summary: 'Update a sales agent',
    description:
      'Plan (same kind; applies to orders placed from now — a reason is required), note and employee code. ' +
      'Guarded by `If-Match` (D-418).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdateAgentDto,
    examples: { default: { value: { planId: AGENT_IDS.plan, reason: 'ยอดขายผ่านเกณฑ์' } } },
  })
  @ApiSuccess(200, { description: 'Agent', type: AdminAgentDto, example: ADMIN_AGENT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'agents.plan_not_in_force')
  async update(
    @CurrentActor() actor: Actor,
    @Param('agentId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: UpdateAgentDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAgentDto> {
    const row = await this.agents.update(staff(actor), id, ifMatch, body);
    res.setHeader('ETag', agentEtag(row));
    return this.agentView(row);
  }

  @Post('agents/:agentId/actions/suspend')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.suspend',
    summary: 'Suspend a sales agent',
    description: 'No new links or leads; commission already accrued is still paid (D-416).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Agent',
    type: AdminAgentDto,
    example: { ...ADMIN_AGENT_EXAMPLE, status: 'suspended' },
  })
  @ApiStandardErrors(...WRITE, 'agents.invalid_status')
  async suspend(
    @CurrentActor() actor: Actor,
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return this.agentView(await this.agents.setStatus(staff(actor), id, 'suspended', body.reason));
  }

  @Post('agents/:agentId/actions/reactivate')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.reactivate',
    summary: 'Reactivate a suspended sales agent',
    description: 'With a reason (D-416).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, { description: 'Agent', type: AdminAgentDto, example: ADMIN_AGENT_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'agents.invalid_status')
  async reactivate(
    @CurrentActor() actor: Actor,
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return this.agentView(await this.agents.setStatus(staff(actor), id, 'active', body.reason));
  }

  @Post('agents/:agentId/actions/end')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'agentId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.end',
    summary: 'End a sales agent',
    description:
      'Links end, protected leads expire, pending factory links end; accrued commission is still paid (D-416).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Agent',
    type: AdminAgentDto,
    example: { ...ADMIN_AGENT_EXAMPLE, status: 'ended' },
  })
  @ApiStandardErrors(...WRITE, 'agents.invalid_status')
  async end(
    @CurrentActor() actor: Actor,
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return this.agentView(await this.agents.setStatus(staff(actor), id, 'ended', body.reason));
  }

  // --- links ----------------------------------------------------------------------------------------------

  @Get('agent-links')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.listLinks',
    summary: 'List customer and company links',
    description: 'Who belongs to which agent, by agent, customer, company or status (D-417).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentLinkDto, { example: ADMIN_AGENT_LINK_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async listLinks(@Query() q: LinkListQuery) {
    const [rows, total] = await this.attribution.links(
      {
        ...(q.agentId && { agent: { publicId: q.agentId } }),
        ...(q.status && { status: q.status }),
        ...(q.customerId && { customerUser: { publicId: q.customerId } }),
        ...(q.companyId && { company: { publicId: q.companyId } }),
      },
      q.page,
      q.perPage,
    );
    return { data: rows.map(adminAgentLinkDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('agent-links')
  @Can('agents.manage')
  @ApiEndpoint({
    id: 'admin.agents.assignLink',
    summary: 'Assign or transfer a customer or company',
    description:
      'Links a customer or company to an agent, ending any current link — the only way to give an existing ' +
      'customer to an agent or move one between agents; audited with the reason (D-417).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AssignAgentLinkDto,
    examples: {
      default: {
        value: {
          agentId: AGENT_IDS.agent,
          customerId: AGENT_IDS.customer,
          reason: 'ลูกค้าแจ้งว่าตัวแทนคนนี้แนะนำมา',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Link',
    type: AdminAgentLinkDto,
    example: { ...ADMIN_AGENT_LINK_EXAMPLE, source: 'staff' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'agents.agent_inactive',
    'agents.self_link',
    'agents.already_linked',
    'agents.plan_not_in_force',
  )
  async assignLink(
    @CurrentActor() actor: Actor,
    @Body() body: AssignAgentLinkDto,
  ): Promise<AdminAgentLinkDto> {
    return adminAgentLinkDto(await this.attribution.assign(staff(actor), body));
  }

  @Post('agent-links/:linkId/actions/end')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'linkId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.endLink',
    summary: 'End a link',
    description: 'Orders placed afterwards earn the agent nothing (D-417).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Link',
    type: AdminAgentLinkDto,
    example: { ...ADMIN_AGENT_LINK_EXAMPLE, status: 'ended' },
  })
  @ApiStandardErrors(...WRITE, 'agents.link_ended')
  async endLink(
    @CurrentActor() actor: Actor,
    @Param('linkId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return adminAgentLinkDto(await this.attribution.endLink(staff(actor), id, body.reason));
  }

  // --- leads ----------------------------------------------------------------------------------------------

  @Get('agent-leads')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.listLeads',
    summary: 'List leads',
    description: 'Every agent’s customer and factory leads with their protection (D-417, D-419).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentLeadDto, { example: ADMIN_LEAD_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async listLeads(@Query() q: LeadListQuery) {
    const text = q.q?.trim();
    const [rows, total] = await this.attribution.leads(
      {
        ...(q.agentId && { agent: { publicId: q.agentId } }),
        ...(q.status && { status: q.status }),
        ...(q.kind && { kind: q.kind }),
        ...(text && {
          OR: [
            { contactName: { contains: text, mode: 'insensitive' as const } },
            { organisationName: { contains: text, mode: 'insensitive' as const } },
            { phone: { contains: text } },
            { email: { contains: text } },
            { taxId: { contains: text } },
          ],
        }),
      },
      q.page,
      q.perPage,
    );
    return { data: rows.map(adminLeadDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('agent-leads/:leadId/actions/release')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.releaseLead',
    summary: 'Release a lead',
    description: 'Ends its protection early (a dispute, a wrong entry), with a reason (D-417).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Lead',
    type: AdminAgentLeadDto,
    example: { ...ADMIN_LEAD_EXAMPLE, status: 'rejected' },
  })
  @ApiStandardErrors(...WRITE, 'agents.lead_closed')
  async releaseLead(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return adminLeadDto(await this.attribution.releaseLead(staff(actor), id, body.reason));
  }

  // --- factory links ----------------------------------------------------------------------------------------

  @Get('agent-factory-links')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.listFactoryLinks',
    summary: 'List factories brought by agents',
    description: 'With the factory’s status and qualifying jobs so far (D-419).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentFactoryLinkDto, { example: FACTORY_LINK_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async listFactoryLinks(@Query() q: FactoryLinkListQuery) {
    const [rows, total] = await this.attribution.factoryLinks(
      { ...(q.agentId && { agent: { publicId: q.agentId } }), ...(q.status && { status: q.status }) },
      q.page,
      q.perPage,
    );
    return {
      data: await Promise.all(rows.map((r) => this.factoryLinkView(r))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Post('agent-factory-links')
  @Can('partners.manage')
  @ApiEndpoint({
    id: 'admin.agents.linkFactory',
    summary: 'Link a factory to the agent who brought it',
    description:
      'Partner management records which agent brought a factory when no lead matched it automatically; one ' +
      'agent per factory (D-419).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: LinkAgentFactoryDto,
    examples: {
      default: {
        value: { agentId: AGENT_IDS.agent, factoryId: AGENT_IDS.factory, reason: 'ตัวแทนพาโรงงานมาสมัคร' },
      },
    },
  })
  @ApiSuccess(201, { description: 'Factory link', type: AgentFactoryLinkDto, example: FACTORY_LINK_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'agents.agent_inactive', 'agents.factory_linked')
  async linkFactory(
    @CurrentActor() actor: Actor,
    @Body() body: LinkAgentFactoryDto,
  ): Promise<AgentFactoryLinkDto> {
    return this.factoryLinkView(await this.attribution.linkFactory(staff(actor), body));
  }

  @Post('agent-factory-links/:factoryLinkId/actions/end')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'factoryLinkId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.endFactoryLink',
    summary: 'End a pending factory link',
    description: 'No bounty will be earned for it (D-419).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Factory link',
    type: AgentFactoryLinkDto,
    example: { ...FACTORY_LINK_EXAMPLE, status: 'ended' },
  })
  @ApiStandardErrors(...WRITE, 'agents.link_ended')
  async endFactoryLink(
    @CurrentActor() actor: Actor,
    @Param('factoryLinkId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ): Promise<AgentFactoryLinkDto> {
    return this.factoryLinkView(await this.attribution.endFactoryLink(staff(actor), id, body.reason));
  }

  // --- commissions ------------------------------------------------------------------------------------------

  @Get('agent-commissions')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.listCommissions',
    summary: 'List commission entries',
    description:
      'By agent, status or kind, newest first; `status=held` is Sales’ review queue (D-417, D-418).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentCommissionDto, { example: ADMIN_COMMISSION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async listCommissions(@Query() q: CommissionListQuery) {
    const [rows, total] = await this.commissions.list(
      {
        ...(q.agentId && { agent: { publicId: q.agentId } }),
        ...(q.status && { status: q.status }),
        ...(q.kind && { kind: q.kind }),
      },
      q.page,
      q.perPage,
    );
    return { data: rows.map(adminCommissionDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('agent-commissions')
  @Can('agent_commissions.adjust')
  @Idempotent()
  @ApiEndpoint({
    id: 'admin.agents.adjustCommission',
    summary: 'Add a commission adjustment',
    description:
      'A signed amount with a reason, earned at once and netted in the next statement (D-418). Requires `Idempotency-Key`.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AdjustAgentCommissionDto,
    examples: {
      default: {
        value: { agentId: AGENT_IDS.agent, amount: '-150.00', note: 'ปรับคืนส่วนต่างราคาที่ตกลงกับลูกค้า' },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Entry',
    type: AdminAgentCommissionDto,
    example: { ...ADMIN_COMMISSION_EXAMPLE, kind: 'adjustment', status: 'earned', amount: '-150.00' },
  })
  @ApiStandardErrors(...WRITE)
  async adjust(
    @CurrentActor() actor: Actor,
    @Body() body: AdjustAgentCommissionDto,
  ): Promise<AdminAgentCommissionDto> {
    return adminCommissionDto(await this.commissions.adjust(staff(actor), body));
  }

  @Post('agent-commissions/:commissionId/actions/decide')
  @HttpCode(200)
  @Can('agents.manage')
  @ApiParam({ name: 'commissionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.decideHeldCommission',
    summary: 'Release or cancel a held commission',
    description:
      'A commission held because agent and customer share a phone, address, card or device (D-417).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: DecideHeldAgentCommissionDto,
    examples: { default: { value: { decision: 'release', reason: 'ตรวจแล้ว ลูกค้าเป็นคนละคนกับตัวแทน' } } },
  })
  @ApiSuccess(200, { description: 'Entry', type: AdminAgentCommissionDto, example: ADMIN_COMMISSION_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'agents.commission_not_held')
  async decideHeld(
    @CurrentActor() actor: Actor,
    @Param('commissionId', ParseUUIDPipe) id: string,
    @Body() body: DecideHeldAgentCommissionDto,
  ): Promise<AdminAgentCommissionDto> {
    return adminCommissionDto(await this.commissions.decideHeld(staff(actor), id, body));
  }

  // --- statements -------------------------------------------------------------------------------------------

  @Get('agent-statements')
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agents.listStatements',
    summary: 'List agent statements',
    description: 'By month, agent, kind or status; `status=draft` is Finance’s queue (D-420).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentStatementDto, { example: ADMIN_STATEMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async listStatements(@Query() q: StatementListQuery) {
    const [rows, total] = await this.statements.list(
      {
        ...(q.agentId && { agent: { publicId: q.agentId } }),
        ...(q.kind && { agent: { kind: q.kind, ...(q.agentId && { publicId: q.agentId }) } }),
        ...(q.status && { status: q.status }),
        ...(q.period && { periodStart: dateOnly(periodBounds(q.period).start) }),
      },
      q.page,
      q.perPage,
    );
    return {
      data: rows.map((r) => this.statementView(r)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('agent-statements/:statementId')
  @Can('agents.read')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEtag()
  @ApiEndpoint({
    id: 'admin.agents.getStatement',
    summary: 'Get an agent statement',
    description: 'With its entries, the bill it became and what was withheld and paid (D-420, D-421).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Statement',
    type: AdminAgentStatementDetailDto,
    example: ADMIN_STATEMENT_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getStatement(
    @Param('statementId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAgentStatementDetailDto> {
    const row = await this.statements.get(id);
    return {
      ...this.statementView(row, res),
      entries: (await this.statements.entries(row.id)).map(adminCommissionDto),
    };
  }

  @Post('agent-statements/actions/generate')
  @HttpCode(200)
  @Can('agent_statements.approve')
  @ApiEndpoint({
    id: 'admin.agents.generateStatements',
    summary: 'Generate statements for a month',
    description:
      'What the 1st-of-month job does, for a closed month: one draft per agent with earned entries up to its ' +
      'end; agents whose net is zero or less are carried forward; existing statements are left alone (D-420).',
    implements: DECISIONS,
  })
  @ApiBody({ type: MonthDto, examples: { default: { value: { period: '2026-10' } } } })
  @ApiSuccess(200, {
    description: 'Outcome',
    type: AgentStatementsGeneratedDto,
    example: { created: 4, carriedForward: 1 },
  })
  @ApiStandardErrors(...WRITE, 'agents.period_open')
  generate(@CurrentActor() actor: Actor, @Body() body: MonthDto): Promise<AgentStatementsGeneratedDto> {
    staff(actor);
    return this.statements.generate(body.period);
  }

  @Post('agent-statements/:statementId/actions/approve')
  @HttpCode(200)
  @Can('agent_statements.approve')
  @Idempotent()
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'admin.agents.approveStatement',
    summary: 'Approve an agent statement',
    description:
      'Freelance: records the agent vendor’s bill (account 6160; withholding: commission ภ.ง.ด.1 for an ' +
      'individual, service ภ.ง.ด.53 for a juristic person; VAT when VAT registered) for payout runs to pay. ' +
      'Employee: accrued for payroll. Guarded by `If-Match`; requires `Idempotency-Key` (D-420, D-421).',
    implements: [...DECISIONS, 'D-421'],
  })
  @ApiSuccess(200, {
    description: 'Statement',
    type: AdminAgentStatementDto,
    example: ADMIN_STATEMENT_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'validation.failed',
    'agents.statement_invalid_status',
    'payables.invoice_duplicate',
  )
  async approveStatement(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAgentStatementDto> {
    return this.statementView(await this.statements.approve(staff(actor), id, ifMatch), res);
  }

  @Post('agent-statements/:statementId/actions/void')
  @HttpCode(200)
  @Can('agent_statements.approve')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.voidStatement',
    summary: 'Void a draft statement',
    description: 'Its entries go back to earned for the next statement (D-420).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Statement',
    type: AdminAgentStatementDto,
    example: { ...ADMIN_STATEMENT_EXAMPLE, status: 'voided' },
  })
  @ApiStandardErrors(...WRITE, 'agents.statement_invalid_status')
  async voidStatement(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ): Promise<AdminAgentStatementDto> {
    return this.statementView(await this.statements.void(staff(actor), id, body.reason));
  }

  @Post('agent-statements/actions/export-payroll')
  @HttpCode(200)
  @Can('agent_statements.approve')
  @ApiEndpoint({
    id: 'admin.agents.exportPayroll',
    summary: 'Export employee commission for payroll',
    description:
      'A CSV of the month’s approved (or already exported) employee statements — employee code, name, agent ' +
      'code, statement number, amount — and marks them exported (D-420, D-332).',
    implements: DECISIONS,
  })
  @ApiBody({ type: MonthDto, examples: { default: { value: { period: '2026-10' } } } })
  @ApiSuccess(200, {
    description: 'The file',
    type: AgentPayrollExportDto,
    example: {
      fileId: AGENT_IDS.file,
      url: 'https://getpack-files.s3.example.com/…',
      expiresAt: '2026-11-02T10:05:00+07:00',
      statements: 3,
    },
  })
  @ApiStandardErrors(...WRITE, 'agents.nothing_to_export')
  async exportPayroll(@CurrentActor() actor: Actor, @Body() body: MonthDto): Promise<AgentPayrollExportDto> {
    const out = await this.statements.exportPayroll(staff(actor), body.period);
    return {
      fileId: out.fileId,
      url: out.url,
      expiresAt: out.expiresAt.toISOString(),
      statements: out.statements,
    };
  }

  @Post('agent-statements/:statementId/actions/mark-paid')
  @HttpCode(200)
  @Can('agent_statements.approve')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agents.markStatementPaid',
    summary: 'Record payroll payment of an employee statement',
    description: 'For exported employee statements; freelance statements are paid by payout runs (D-420).',
    implements: DECISIONS,
  })
  @ApiBody({ type: AgentMarkPaidDto, examples: { default: { value: { paidOn: '2026-11-25' } } } })
  @ApiSuccess(200, {
    description: 'Statement',
    type: AdminAgentStatementDto,
    example: { ...ADMIN_STATEMENT_EXAMPLE, status: 'paid' },
  })
  @ApiStandardErrors(...WRITE, 'agents.statement_invalid_status', 'agents.statement_paid_by_payout')
  async markPaid(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) id: string,
    @Body() body: AgentMarkPaidDto,
  ): Promise<AdminAgentStatementDto> {
    return this.statementView(await this.statements.markPaid(staff(actor), id, body.paidOn));
  }
}

@ApiSurface('admin', 'agentPlans')
@Controller('agent-plans')
export class AdminAgentPlansController {
  constructor(private readonly agents: AgentsService) {}

  private async planView(row: PlanRow): Promise<AgentPlanDto> {
    return planDto(row, await this.agents.planPeople([row]));
  }

  @Get()
  @Can('agents.read')
  @ApiEndpoint({
    id: 'admin.agentPlans.list',
    summary: 'List commission plans',
    description: 'Every plan with its versions, the terms in force and its active agents (D-418).',
    implements: ['D-418'],
  })
  @ApiSuccess(200, { description: 'Plans', type: [AgentPlanDto], example: [PLAN_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async list(): Promise<AgentPlanDto[]> {
    const rows = await this.agents.plans();
    const people = await this.agents.planPeople(rows);
    return rows.map((p) => planDto(p, people));
  }

  @Get(':planId')
  @Can('agents.read')
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agentPlans.get',
    summary: 'Get a commission plan',
    description: 'With its versions (D-418).',
    implements: ['D-418'],
  })
  @ApiSuccess(200, { description: 'Plan', type: AgentPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('planId', ParseUUIDPipe) id: string): Promise<AgentPlanDto> {
    return this.planView(await this.agents.plan(id));
  }

  @Post()
  @Can('agent_plans.manage')
  @ApiEndpoint({
    id: 'admin.agentPlans.create',
    summary: 'Create a commission plan',
    description: 'With its first version as a draft for someone else to approve (D-418).',
    implements: ['D-418'],
  })
  @ApiBody({
    type: CreateAgentPlanDto,
    examples: {
      default: {
        value: {
          code: 'freelance_premium',
          nameTh: 'ตัวแทนอิสระ — พรีเมียม',
          agentKind: 'freelance',
          firstOrderPct: '6',
          repeatOrderPct: '4',
          attributionMonths: 18,
          marginCapPct: '35',
          minBaseAmount: '0.00',
          factoryBountyAmount: '3000.00',
          factoryQualifyJobs: 3,
          factoryQualifyDays: 120,
          reason: 'แผนสำหรับตัวแทนที่ขายได้ต่อเนื่อง',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Plan', type: AgentPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'agents.plan_code_taken')
  async create(@CurrentActor() actor: Actor, @Body() body: CreateAgentPlanDto): Promise<AgentPlanDto> {
    return this.planView(await this.agents.createPlan(staff(actor), body));
  }

  @Post(':planId/versions')
  @Can('agent_plans.manage')
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agentPlans.draftVersion',
    summary: 'Draft a new plan version',
    description:
      'Dated from now on; one draft at a time; applies to orders placed from its start once approved (D-418).',
    implements: ['D-418'],
  })
  @ApiBody({
    type: DraftAgentPlanVersionDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-11-01T00:00:00+07:00',
          firstOrderPct: '5',
          repeatOrderPct: '3',
          attributionMonths: 12,
          marginCapPct: '30',
          minBaseAmount: '500.00',
          factoryBountyAmount: '3000.00',
          factoryQualifyJobs: 3,
          factoryQualifyDays: 120,
          reason: 'กำหนดยอดขั้นต่ำต่อออเดอร์',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Plan', type: AgentPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'agents.backdated', 'agents.plan_draft_open')
  async draftVersion(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) id: string,
    @Body() body: DraftAgentPlanVersionDto,
  ): Promise<AgentPlanDto> {
    return this.planView(await this.agents.draftVersion(staff(actor), id, body));
  }

  @Post('versions/:versionId/actions/approve')
  @HttpCode(200)
  @Can('agent_plans.approve')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agentPlans.approveVersion',
    summary: 'Approve a plan version',
    description:
      'By someone other than its drafter (maker-checker); approved after its start date it applies from the ' +
      'approval (D-418).',
    implements: ['D-418'],
  })
  @ApiSuccess(200, { description: 'Plan', type: AgentPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'agents.plan_version_decided',
    'agents.maker_checker',
  )
  async approveVersion(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) id: string,
  ): Promise<AgentPlanDto> {
    return this.planView(await this.agents.decideVersion(staff(actor), id, { decision: 'approve' }));
  }

  @Post('versions/:versionId/actions/reject')
  @HttpCode(200)
  @Can('agent_plans.approve')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agentPlans.rejectVersion',
    summary: 'Reject a plan version',
    description: 'By someone other than its drafter, with a reason (D-418).',
    implements: ['D-418'],
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, { description: 'Plan', type: AgentPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'agents.plan_version_decided', 'agents.maker_checker')
  async rejectVersion(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ): Promise<AgentPlanDto> {
    return this.planView(
      await this.agents.decideVersion(staff(actor), id, { decision: 'reject', note: body.reason }),
    );
  }

  @Post(':planId/actions/retire')
  @HttpCode(200)
  @Can('agent_plans.manage')
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.agentPlans.retire',
    summary: 'Retire a commission plan',
    description: 'Only when no agent is on it (D-418).',
    implements: ['D-418'],
  })
  @ApiBody({ type: ReasonDto, examples: REASON_EXAMPLE })
  @ApiSuccess(200, {
    description: 'Plan',
    type: AgentPlanDto,
    example: { ...PLAN_EXAMPLE, retiredAt: '2026-12-01T10:00:00+07:00' },
  })
  @ApiStandardErrors(...WRITE, 'agents.plan_in_use')
  async retire(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) id: string,
    @Body() body: ReasonDto,
  ) {
    return this.planView(await this.agents.retirePlan(staff(actor), id, body.reason));
  }
}
