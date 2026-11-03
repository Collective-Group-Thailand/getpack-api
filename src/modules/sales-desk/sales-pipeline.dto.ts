import { PageQuery } from '@common/pagination/pagination.dto';
import { AGENT_IDS, AgentRefDto, RegisterAgentLeadDto } from '@modules/agents/agents.dto';
import { AgentLeadListQuery } from '@modules/agents/agents-pipeline.dto';
import { AGENT_QUOTE_STATUSES } from '@modules/agents/agents-quotes.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** D-469: the company sales desk (admin zone). Same lead model and rules as the agent zone (D-468). */

export const P4_IDS = {
  rep: '0192f3a0-7c1e-7d2a-9b1f-0000000a7001',
  inbound: '0192f3a0-7c1e-7d2a-9b1f-0000000a7002',
  approval: '0192f3a0-7c1e-7d2a-9b1f-0000000a7003',
  priceLock: '0192f3a0-7c1e-7d2a-9b1f-0000000a7004',
  view: '0192f3a0-7c1e-7d2a-9b1f-0000000a7005',
  card: '0192f3a0-7c1e-7d2a-9b1f-0000000a7006',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000a7007',
  customer: '0192f3a0-7c1e-7d2a-9b1f-0000000a7008',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000a7009',
  template: '0192f3a0-7c1e-7d2a-9b1f-0000000a7010',
};

export const AGENT_KIND_FILTERS = ['employee', 'freelance'] as const;

export class SalesLeadListQuery extends AgentLeadListQuery {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'One agent’s leads (managers only; a rep always sees their own)',
  })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({
    enum: AGENT_KIND_FILTERS,
    enumName: 'SalesAgentKindFilter',
    default: 'employee',
    description: 'Managers: company reps (`employee`, default) or freelance agents (read-only)',
  })
  @IsOptional()
  @IsIn(AGENT_KIND_FILTERS)
  agentKind?: (typeof AGENT_KIND_FILTERS)[number];
}

export class CreateSalesLeadDto extends RegisterAgentLeadDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: AGENT_IDS.agent,
    description: 'Managers: the rep’s employee agent the lead is for (default: my own)',
  })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class SalesQuoteListQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'One rep’s employee agent (managers only)' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ enum: AGENT_QUOTE_STATUSES, enumName: 'AgentQuoteStatus' })
  @IsOptional()
  @IsIn(AGENT_QUOTE_STATUSES)
  status?: (typeof AGENT_QUOTE_STATUSES)[number];
}

export class SalesRepDto {
  @ApiProperty({ format: 'uuid', example: P4_IDS.rep, description: 'The rep’s staff user id' })
  userId!: string;

  @ApiProperty({ example: 'สมหญิง ขายดี' })
  displayName!: string;

  @ApiProperty({ type: AgentRefDto, nullable: true, description: 'Their employee agent (null: none yet)' })
  agent!: AgentRefDto | null;

  @ApiProperty({ example: true, description: 'Active staff with an active employee agent — can be assigned' })
  assignable!: boolean;

  @ApiProperty({ example: 12, description: 'Open leads (registered or converted, not won / lost)' })
  openLeads!: number;
}

export const SALES_REP_EXAMPLE: SalesRepDto = {
  userId: P4_IDS.rep,
  displayName: 'สมหญิง ขายดี',
  agent: { id: AGENT_IDS.agent, code: 'K7QX2MAP', legalName: 'สมหญิง ขายดี', kind: 'employee' },
  assignable: true,
  openLeads: 12,
};
