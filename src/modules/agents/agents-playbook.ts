import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PrismaService } from '@database/prisma.service';
import { IdField } from '@modules/catalog/crud/dto-fields';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { AgentZoneGuard } from './agent-zone.guard';
import { P3_IDS } from './agents-pipeline.dto';
import { PLAYBOOK_CONTEXTS } from './playbook-parser';

/** D-468 (PLAN A-13): the sales playbook as agents read it — published cards for audience `agent`, read-only. */

export class AgentPlaybookQuery {
  @ApiPropertyOptional({
    enum: PLAYBOOK_CONTEXTS,
    enumName: 'AgentPlaybookContext',
    description: 'Cards for one context (with the cards for every context); omitted = all published cards',
  })
  @IsOptional()
  @IsIn(PLAYBOOK_CONTEXTS)
  context?: (typeof PLAYBOOK_CONTEXTS)[number];
}

export class AgentPlaybookReplyDto {
  @ApiProperty({ example: 'ถ้าสะดวกชำระภายใน 7 วัน เรามีส่วนลดเงินสดให้ค่ะ/ครับ' })
  th!: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Null until Marketing writes it' })
  en!: string | null;
}

export class AgentPlaybookCardDto {
  @IdField(P3_IDS.playbookCard)
  id!: string;

  @ApiProperty({ example: 'give-get-menu' })
  key!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  version!: number;

  @ApiProperty({
    type: [String],
    example: ['discount_request', 'competitor_cheaper'],
    description: '`all` = every context',
  })
  contexts!: string[];

  @ApiProperty({ example: 'เมนูแลกเปลี่ยน: ให้ส่วนลด เมื่อได้อะไรกลับมา' })
  titleTh!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  titleEn!: string | null;

  @ApiProperty({ example: 'ถามก่อนว่าลูกค้าให้อะไรกลับมาได้บ้าง …', description: 'Markdown' })
  bodyTh!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  bodyEn!: string | null;

  @ApiProperty({ type: [AgentPlaybookReplyDto], description: 'Replies to copy to LINE' })
  suggestedReplies!: AgentPlaybookReplyDto[];
}

export class AgentPlaybookDto {
  @ApiProperty({ type: [AgentPlaybookCardDto] })
  data!: AgentPlaybookCardDto[];
}

const PLAYBOOK_EXAMPLE: AgentPlaybookDto = {
  data: [
    {
      id: P3_IDS.playbookCard,
      key: 'give-get-menu',
      version: 1,
      contexts: ['discount_request', 'competitor_cheaper'],
      titleTh: 'เมนูแลกเปลี่ยน: ให้ส่วนลด เมื่อได้อะไรกลับมา',
      titleEn: null,
      bodyTh: 'ถามก่อนว่าลูกค้าให้อะไรกลับมาได้บ้าง …',
      bodyEn: null,
      suggestedReplies: [{ th: 'ถ้าสะดวกชำระภายใน 7 วัน เรามีส่วนลดเงินสดให้ค่ะ/ครับ', en: null }],
    },
  ],
};

@Injectable()
export class AgentPlaybookService {
  constructor(private readonly prisma: PrismaService) {}

  async cards(context?: string): Promise<AgentPlaybookCardDto[]> {
    const rows = await this.prisma.salesPlaybookCard.findMany({
      where: {
        status: 'published',
        audiences: { has: 'agent' },
        ...(context && { contexts: { hasSome: [context, 'all'] } }),
      },
      orderBy: [{ sort: 'asc' }, { key: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.publicId,
      key: r.key,
      version: r.version,
      contexts: r.contexts,
      titleTh: r.titleTh,
      titleEn: r.titleEn,
      bodyTh: r.bodyTh,
      bodyEn: r.bodyEn,
      suggestedReplies: Array.isArray(r.suggestedReplies)
        ? (r.suggestedReplies as { th: string; en?: string | null }[]).map((x) => ({
            th: x.th,
            en: x.en ?? null,
          }))
        : [],
    }));
  }
}

@ApiSurface('store', 'agent')
@Controller('agent')
@UseGuards(AgentZoneGuard)
export class StoreAgentPlaybookController {
  constructor(private readonly cards: AgentPlaybookService) {}

  @Get('playbook')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentPlaybook.get',
    summary: 'Read the sales playbook',
    description:
      'Published guidance cards for agents — all of them (the "คู่มือการขาย" tab) or those for one context (lead ' +
      'lost to price, competitor cheaper, discount request, big deal, follow-up, first contact), with replies to ' +
      'copy to LINE. Read-only; Sales manages versions (D-468, PLAN A-13).',
    implements: ['D-468'],
  })
  @ApiSuccess(200, { description: 'Cards', type: AgentPlaybookDto, example: PLAYBOOK_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
  async playbook(@CurrentActor() actor: Actor, @Query() q: AgentPlaybookQuery): Promise<AgentPlaybookDto> {
    if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
    return { data: await this.cards.cards(q.context) };
  }
}
