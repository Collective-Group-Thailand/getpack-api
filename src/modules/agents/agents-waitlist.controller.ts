import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';

import { AgentWaitlistService } from './agent-waitlist.service';
import {
  ADMIN_WAITLIST_EXAMPLE,
  AdminAgentWaitlistEntryDto,
  AgentWaitlistExportDto,
} from './agents-waitlist.dto';

const DECISIONS = ['D-466', 'D-144'];

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

/** P7 pilot switch: who asked to hear when agent sign-up opens (Sales Manager, C-Level; PDPA — sensitive). */
@ApiSurface('admin', 'agents')
@Controller()
export class AdminAgentWaitlistController {
  constructor(private readonly waitlist: AgentWaitlistService) {}

  @Get('agent-waitlist')
  @Can('agent_waitlist.read')
  @ApiEndpoint({
    id: 'admin.agentWaitlist.list',
    summary: 'List the agent programme waiting list',
    description:
      'Newest first; `q` searches the name, e-mail and phone. Each row: name, the contact given, how they sell, how ' +
      'many times they signed up and when. Contact them once, through the contact they gave, when sign-up opens ' +
      '(consent purpose `agent_waitlist`, D-144). P7 pilot switch (D-466).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminAgentWaitlistEntryDto, { example: ADMIN_WAITLIST_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: PageQuery) {
    const { rows, total } = await this.waitlist.list({ page: q.page, perPage: q.perPage, q: q.q });
    return {
      data: rows.map((r) => ({
        id: r.publicId,
        name: r.name,
        phone: r.phone,
        email: r.email,
        salesChannel: r.salesChannel,
        joinCount: r.joinCount,
        createdAt: toBangkokIso(r.createdAt),
        lastJoinedAt: toBangkokIso(r.lastJoinedAt),
      })),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Post('agent-waitlist/actions/export')
  @HttpCode(200)
  @Can('agent_waitlist.read')
  @ApiEndpoint({
    id: 'admin.agentWaitlist.export',
    summary: 'Export the agent programme waiting list (CSV)',
    description:
      'Every row as a formula-safe CSV (UTF-8 with BOM; phones written locally, 0XXXXXXXXX) behind a signed link ' +
      'valid 5 minutes; the export is audited (`export.generated`, kind `agent_waitlist`). P7 pilot switch (D-466).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Export link',
    type: AgentWaitlistExportDto,
    example: {
      url: 'https://getpack-files.s3.example.com/…',
      expiresAt: '2026-11-04T10:05:00+07:00',
      rows: 12,
    },
  })
  @ApiStandardErrors()
  async export(@CurrentActor() actor: Actor): Promise<AgentWaitlistExportDto> {
    const out = await this.waitlist.exportCsv(staff(actor));
    return { url: out.url, expiresAt: toBangkokIso(out.expiresAt), rows: out.rows };
  }
}
