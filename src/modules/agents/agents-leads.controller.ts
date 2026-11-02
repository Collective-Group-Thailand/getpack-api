import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
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
import { ApiCursorPaginated } from '@common/pagination/api-paginated.decorator';
import { CursorQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { type SalesAgentLeadActivity } from '@generated/prisma/client';
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
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';
import { type Response } from 'express';

import { type ImportRow } from './agent-lead-rules';
import { AgentLeadsService, leadEtag } from './agent-leads.service';
import { normalisePhone } from './agent-shared';
import { AgentZoneGuard } from './agent-zone.guard';
import { AgentLeadDto, LEAD_EXAMPLE } from './agents.dto';
import { AgentsService } from './agents.service';
import {
  ACTIVITY_EXAMPLE,
  AddAgentLeadActivityDto,
  AgentLeadActivityDto,
  AgentLeadAvailabilityDto,
  AgentLeadImportDto,
  AgentLeadListQuery,
  ChangeAgentLeadStageDto,
  CheckAgentLeadDto,
  IMPORT_EXAMPLE,
  PreviewAgentLeadImportDto,
  UpdateAgentLeadDto,
} from './agents-pipeline.dto';
import { leadDto } from './agents-views';

const DECISIONS = ['D-417', 'D-440', 'D-468'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;
const AGENT_ERRORS = ['agents.not_agent', 'agents.ended'] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

export function activityDto(r: SalesAgentLeadActivity, me: bigint): AgentLeadActivityDto {
  const data = (r.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: r.publicId,
    kind: r.kind,
    body: r.body,
    author: r.createdById === null ? 'system' : r.createdById === me ? 'agent' : 'getpack',
    event: str(data['event']),
    fromStage: str(data['from']),
    toStage: str(data['to']),
    agentQuoteId: str(data['agentQuoteId']),
    occurredAt: toBangkokIso(r.occurredAt),
  };
}

type ResultRow = Partial<ImportRow> & { rowNo: number; errors: ImportRow['errors']; leadId?: string | null };

function importDto(
  row: {
    publicId: string;
    status: string;
    rowCount: number;
    validCount: number;
    createdCount: number | null;
    expiresAt: Date;
  },
  rows: ResultRow[],
): AgentLeadImportDto {
  return {
    id: row.publicId,
    status: row.status,
    rowCount: row.rowCount,
    validCount: row.validCount,
    createdCount: row.createdCount,
    rows: rows.map((r) => ({
      rowNo: r.rowNo,
      contactName: r.contactName ?? null,
      organisationName: r.organisationName ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      taxId: r.taxId ?? null,
      errors: r.errors,
      leadId: r.leadId ?? null,
    })),
    expiresAt: toBangkokIso(row.expiresAt),
  };
}

/**
 * D-468: the agent's lead pipeline in the agent zone — duplicate check, list, detail, edit, stage, timeline, CSV
 * export / import. The agent's own customer leads only (D-422); every handler behind `AgentZoneGuard` (an active or
 * suspended agent, D-467). Refusals are neutral (D-440).
 */
@ApiSurface('store', 'agent')
@Controller('agent')
@UseGuards(AgentZoneGuard)
export class StoreAgentLeadsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly leads: AgentLeadsService,
  ) {}

  @Post('leads/actions/check')
  @HttpCode(200)
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentLeads.check',
    summary: 'Check whether a contact can be my lead',
    description:
      'Before registering (on blur of phone, e-mail or tax id): `available`, or one neutral reason — `own_lead` (my ' +
      'own protected lead, with its id) or `unavailable` (cannot be registered). Never says whether a customer, ' +
      'another agent or a registered deal holds it (D-440, D-468).',
    implements: DECISIONS,
  })
  @ApiBody({ type: CheckAgentLeadDto, examples: { default: { value: { phone: '+66890001234' } } } })
  @ApiSuccess(200, {
    description: 'Availability',
    type: AgentLeadAvailabilityDto,
    example: { available: false, reason: 'unavailable', leadId: null },
  })
  @ApiStandardErrors(...WRITE, ...AGENT_ERRORS)
  async check(
    @CurrentActor() actor: Actor,
    @Body() body: CheckAgentLeadDto,
  ): Promise<AgentLeadAvailabilityDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    return this.leads.check(agent, {
      phone: normalisePhone(body.phone),
      email: body.email?.trim().toLowerCase() || null,
      taxId: body.taxId?.trim() || null,
    });
  }

  @Get('leads/pipeline')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentLeads.list',
    summary: 'List my lead pipeline',
    description:
      'My customer leads with stage, value, next follow-up and protection; views for the agent zone tabs (open, ' +
      'follow-up today, protection ending, closed), filters by stage, source, due and text; sorted with a cursor ' +
      '(D-468).',
    implements: DECISIONS,
  })
  @ApiCursorPaginated(AgentLeadDto, { example: LEAD_EXAMPLE })
  @ApiStandardErrors('validation.failed', ...AGENT_ERRORS)
  async list(@CurrentActor() actor: Actor, @Query() q: AgentLeadListQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const page = await this.leads.list(agent, q);
    return { data: page.data.map(leadDto), meta: page.meta };
  }

  @Get('leads/export')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentLeads.export',
    summary: 'Export my leads as CSV',
    description:
      'All my customer leads as a UTF-8 CSV behind a 5-minute link; cells that could run as a spreadsheet formula ' +
      'are neutralised, Thai mobile numbers are written locally (0812345678). Audited as an export (D-468).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Download link',
    type: DownloadUrlDto,
    example: { url: 'https://getpack-files.s3.example.com/…', expiresAt: '2026-10-18T10:05:00+07:00' },
  })
  @ApiStandardErrors(...AGENT_ERRORS)
  async exportCsv(@CurrentActor() actor: Actor): Promise<DownloadUrlDto> {
    const me = customer(actor);
    const { url, expiresAt } = await this.leads.exportCsv(me, await this.agents.mine(me.userId));
    return { url, expiresAt: toBangkokIso(expiresAt) };
  }

  @Post('leads/imports')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentLeads.importPreview',
    summary: 'Check a CSV of leads (dry run)',
    description:
      'Parses up to 500 rows and puts each through the same checks as a new lead (fields, the neutral duplicate ' +
      'check, the open-leads limit) — nothing is created. The result is kept 24 h for `importCommit`; its contact ' +
      'data is dropped afterwards (PDPA). Requires the agent’s confirmation that every lead agreed to be contacted ' +
      '(D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: PreviewAgentLeadImportDto,
    examples: {
      default: {
        value: {
          csv: 'contact_name,phone,organisation_name\nคุณมานี ใจดี,0890001234,ร้านกาแฟบ้านสวน\n',
          consentConfirmed: true,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Dry run', type: AgentLeadImportDto, example: IMPORT_EXAMPLE })
  @ApiStandardErrors(...WRITE, ...AGENT_ERRORS, 'agents.agent_inactive')
  async previewImport(
    @CurrentActor() actor: Actor,
    @Body() body: PreviewAgentLeadImportDto,
  ): Promise<AgentLeadImportDto> {
    const me = customer(actor);
    const { row, rows } = await this.leads.previewImport(
      me,
      await this.agents.mine(me.userId),
      body.csv,
      body.consentConfirmed,
    );
    return importDto(row, rows);
  }

  @Post('leads/imports/:importId/actions/commit')
  @HttpCode(200)
  @Can('agent.self')
  @Idempotent()
  @ApiParam({ name: 'importId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentLeads.importCommit',
    summary: 'Create the leads of a checked CSV',
    description:
      'Creates the rows of a dry run that had no errors, each checked again now (a contact taken since is skipped ' +
      'with its error). Leads get source `csv_import`. Only row numbers, errors and the created lead ids are kept ' +
      'afterwards (D-468).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Committed',
    type: AgentLeadImportDto,
    example: {
      ...IMPORT_EXAMPLE,
      status: 'committed',
      createdCount: 1,
      rows: IMPORT_EXAMPLE.rows.map((r, i) => ({
        ...r,
        contactName: null,
        organisationName: null,
        phone: null,
        leadId: i === 0 ? '0192f3a0-7c1e-7d2a-9b1f-0000000a6006' : null,
      })),
    },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    ...AGENT_ERRORS,
    'agents.agent_inactive',
    'agents.lead_import_closed',
  )
  async commitImport(
    @CurrentActor() actor: Actor,
    @Param('importId', ParseUUIDPipe) importId: string,
  ): Promise<AgentLeadImportDto> {
    const me = customer(actor);
    const { row, rows } = await this.leads.commitImport(me, await this.agents.mine(me.userId), importId);
    return importDto(
      row,
      rows.map((r) => ({ rowNo: r.rowNo, errors: r.errors, leadId: r.leadId ?? null })),
    );
  }

  @Get('leads/:leadId')
  @Can('agent.self')
  @ApiEtag()
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentLeads.get',
    summary: 'Get one of my leads',
    description: 'With its pipeline fields and protection; `ETag` for `update` (D-468).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Lead', type: AgentLeadDto, example: LEAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', ...AGENT_ERRORS)
  async get(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentLeadDto> {
    const row = await this.leads.mine(await this.agents.mine(customer(actor).userId), leadId);
    res.setHeader('ETag', leadEtag(row));
    return leadDto(row);
  }

  @Patch('leads/:leadId')
  @Can('agent.self')
  @ApiConcurrency()
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentLeads.update',
    summary: 'Edit one of my leads',
    description:
      'Any subset of the fields (`If-Match` required). Phone, e-mail and tax id change only while the lead is ' +
      'registered and go through the same neutral check as a new lead. A new follow-up time re-arms the reminder ' +
      '(D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdateAgentLeadDto,
    examples: {
      default: { value: { expectedValue: '60000.00', nextFollowUpAt: '2026-10-21T10:00:00+07:00' } },
    },
  })
  @ApiSuccess(200, { description: 'Lead', type: AgentLeadDto, example: LEAD_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    ...AGENT_ERRORS,
    'agents.lead_duplicate',
    'agents.lead_unavailable',
  )
  async update(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: UpdateAgentLeadDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentLeadDto> {
    const me = customer(actor);
    const row = await this.leads.update(me, await this.agents.mine(me.userId), leadId, body, ifMatch);
    res.setHeader('ETag', leadEtag(row));
    return leadDto(row);
  }

  @Post('leads/:leadId/actions/change-stage')
  @HttpCode(200)
  @Can('agent.self')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentLeads.changeStage',
    summary: 'Move a lead to another stage',
    description:
      'new, contacted, quoted, negotiating or lost (with a reason). `won` is set only by the system when the ' +
      'converted customer first pays. `lost` releases the protection at once; won and lost are final ' +
      '(`agents.lead_stage_final`). The move is written to the timeline (D-468, PLAN A-06).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ChangeAgentLeadStageDto,
    examples: {
      default: { value: { stage: 'negotiating' } },
      lost: { value: { stage: 'lost', lostReason: 'price', note: 'ได้ราคาจากที่อื่นถูกกว่า 8%' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Lead',
    type: AgentLeadDto,
    example: { ...LEAD_EXAMPLE, stage: 'negotiating' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    ...AGENT_ERRORS,
    'agents.lead_closed',
    'agents.lead_stage_final',
  )
  async changeStage(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: ChangeAgentLeadStageDto,
  ): Promise<AgentLeadDto> {
    const me = customer(actor);
    return leadDto(await this.leads.changeStage(me, await this.agents.mine(me.userId), leadId, body));
  }

  @Post('leads/:leadId/activities')
  @Can('agent.self')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentLeads.addActivity',
    summary: 'Log a contact with a lead',
    description:
      'A call, LINE chat, visit, e-mail or note in the lead’s timeline (append-only), optionally with the next ' +
      'follow-up; the first one moves a new lead to `contacted` (D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AddAgentLeadActivityDto,
    examples: {
      default: {
        value: {
          kind: 'call',
          body: 'โทรคุยเรื่องขนาดกล่อง ขอดูตัวอย่างก่อนสั่ง',
          nextFollowUpAt: '2026-10-21T10:00:00+07:00',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Timeline entry', type: AgentLeadActivityDto, example: ACTIVITY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found', ...AGENT_ERRORS, 'agents.lead_closed')
  async addActivity(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: AddAgentLeadActivityDto,
  ): Promise<AgentLeadActivityDto> {
    const me = customer(actor);
    const row = await this.leads.addActivity(me, await this.agents.mine(me.userId), leadId, body);
    return activityDto(row, me.userId);
  }

  @Get('leads/:leadId/activities')
  @Can('agent.self')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentLeads.listActivities',
    summary: 'Read a lead’s timeline',
    description:
      'Newest first: my calls, LINE chats, visits, e-mails and notes, quotes sent, stage changes and system ' +
      'entries (signed up, quote opened / accepted, deal registered, won) — cursor paged (D-468).',
    implements: DECISIONS,
  })
  @ApiCursorPaginated(AgentLeadActivityDto, { example: ACTIVITY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', ...AGENT_ERRORS)
  async activities(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Query() q: CursorQuery,
  ) {
    const me = customer(actor);
    const page = await this.leads.activities(await this.agents.mine(me.userId), leadId, q.cursor, q.limit);
    return { data: page.data.map((r) => activityDto(r, me.userId)), meta: page.meta };
  }
}
