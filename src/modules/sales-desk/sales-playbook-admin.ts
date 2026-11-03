import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesPlaybookCard } from '@generated/prisma/client';
import { recordAgentEvent } from '@modules/agents/agent-shared';
import { P3_IDS } from '@modules/agents/agents-pipeline.dto';
import { AgentPlaybookReplyDto } from '@modules/agents/agents-playbook';
import { PLAYBOOK_CONTEXTS } from '@modules/agents/playbook-parser';
import { IdField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { staffActor } from './sales-scope';

/**
 * D-470 item 8 (PLAN A-13): the sales playbook admin — versioned cards (key, contexts, audience agent | rep |
 * manager, title / body markdown th + en, suggested replies), drafts edited by the role that owns them (Marketing or
 * the Sales Manager; Superadmin for anyone), submitted for review and published by someone else (maker-checker). One
 * published version per key; publishing retires the previous one. The agent zone keeps reading published cards
 * (`store.agentPlaybook.get`).
 */

const DECISIONS = ['D-470', 'D-468'];
const AUDIENCES = ['agent', 'rep', 'manager'] as const;
const OWNER_ROLES = ['marketing', 'sales_manager'] as const;
const STATUSES = ['draft', 'published', 'retired'] as const;
const CONTEXTS = ['all', ...PLAYBOOK_CONTEXTS] as const;
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

class PlaybookReplyInputDto {
  @ApiProperty({ example: 'ถ้าสะดวกชำระภายใน 7 วัน เรามีส่วนลดเงินสดให้ค่ะ/ครับ', maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  th!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  en?: string | null;
}

export class UpdatePlaybookCardDto {
  @ApiPropertyOptional({ type: [String], enum: CONTEXTS, enumName: 'SalesPlaybookContext', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(CONTEXTS, { each: true })
  contexts?: (typeof CONTEXTS)[number][];

  @ApiPropertyOptional({ type: [String], enum: AUDIENCES, enumName: 'SalesPlaybookAudience', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(AUDIENCES, { each: true })
  audiences?: (typeof AUDIENCES)[number][];

  @ApiPropertyOptional({ example: 'เมนูแลกเปลี่ยน: ให้ส่วนลด เมื่อได้อะไรกลับมา', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleTh?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Give-get menu', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleEn?: string | null;

  @ApiPropertyOptional({
    example: 'ถามก่อนว่าลูกค้าให้อะไรกลับมาได้บ้าง …',
    maxLength: 8000,
    description: 'Markdown',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  bodyTh?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, maxLength: 8000 })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  bodyEn?: string | null;

  @ApiPropertyOptional({ type: [PlaybookReplyInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PlaybookReplyInputDto)
  suggestedReplies?: PlaybookReplyInputDto[];

  @ApiPropertyOptional({ type: 'integer', example: 20, minimum: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sort?: number;

  @ApiPropertyOptional({ example: 'เพิ่มคำตอบเรื่องเครดิต 30 วัน', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  changeNote?: string;
}

export class CreatePlaybookCardDto extends UpdatePlaybookCardDto {
  @ApiProperty({
    example: 'give-get-menu',
    pattern: KEY.source,
    description:
      'An existing key makes its next draft version (from the latest version); a new key starts at 1',
  })
  @Matches(KEY)
  @MaxLength(64)
  key!: string;

  @ApiPropertyOptional({
    enum: OWNER_ROLES,
    enumName: 'SalesPlaybookOwnerRole',
    description: 'New keys only (default: marketing for cards agents see, else sales_manager)',
  })
  @IsOptional()
  @IsIn(OWNER_ROLES)
  ownerRole?: (typeof OWNER_ROLES)[number];
}

export class PlaybookCardListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: STATUSES, enumName: 'TemplateVersionStatus' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional({ example: 'give-get-menu', description: 'Every version of one key' })
  @IsOptional()
  @Matches(KEY)
  key?: string;

  @ApiPropertyOptional({ enum: AUDIENCES, enumName: 'SalesPlaybookAudience' })
  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];
}

export class PlaybookCardAdminDto {
  @IdField(P3_IDS.playbookCard) id!: string;
  @ApiProperty({ example: 'give-get-menu' }) key!: string;
  @ApiProperty({ type: 'integer', example: 2 }) version!: number;
  @ApiProperty({ enum: STATUSES, enumName: 'TemplateVersionStatus', example: 'draft' }) status!: string;
  @ApiProperty({ example: false, description: 'A draft submitted for review (waiting for a publisher)' })
  submitted!: boolean;
  @ApiProperty({
    type: [String],
    enum: CONTEXTS,
    enumName: 'SalesPlaybookContext',
    isArray: true,
    example: ['discount_request'],
  })
  contexts!: string[];
  @ApiProperty({
    type: [String],
    enum: AUDIENCES,
    enumName: 'SalesPlaybookAudience',
    isArray: true,
    example: ['agent', 'rep'],
  })
  audiences!: string[];
  @ApiProperty({ enum: OWNER_ROLES, enumName: 'SalesPlaybookOwnerRole', example: 'marketing' })
  ownerRole!: string;
  @ApiProperty({ example: 'เมนูแลกเปลี่ยน: ให้ส่วนลด เมื่อได้อะไรกลับมา' }) titleTh!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) titleEn!: string | null;
  @ApiProperty({ example: 'ถามก่อนว่าลูกค้าให้อะไรกลับมาได้บ้าง …' }) bodyTh!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) bodyEn!: string | null;
  @ApiProperty({ type: [AgentPlaybookReplyDto] }) suggestedReplies!: AgentPlaybookReplyDto[];
  @ApiProperty({ type: 'integer', example: 20 }) sort!: number;
  @ApiProperty({ type: String, nullable: true, example: null }) changeNote!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'docs/design/agent-portal/PLAYBOOK.md v1 (2026-11-01)',
  })
  source!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null }) submittedAt!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null }) publishedAt!:
    string | null;
  @TimestampField('2026-11-03T10:00:00+07:00') updatedAt!: string;
}

const CARD_EXAMPLE: PlaybookCardAdminDto = {
  id: P3_IDS.playbookCard,
  key: 'give-get-menu',
  version: 2,
  status: 'draft',
  submitted: false,
  contexts: ['discount_request', 'competitor_cheaper'],
  audiences: ['agent', 'rep', 'manager'],
  ownerRole: 'marketing',
  titleTh: 'เมนูแลกเปลี่ยน: ให้ส่วนลด เมื่อได้อะไรกลับมา',
  titleEn: null,
  bodyTh: 'ถามก่อนว่าลูกค้าให้อะไรกลับมาได้บ้าง …',
  bodyEn: null,
  suggestedReplies: [{ th: 'ถ้าสะดวกชำระภายใน 7 วัน เรามีส่วนลดเงินสดให้ค่ะ/ครับ', en: null }],
  sort: 20,
  changeNote: null,
  source: null,
  submittedAt: null,
  publishedAt: null,
  updatedAt: '2026-11-03T10:00:00+07:00',
};

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
export function cardDto(c: SalesPlaybookCard): PlaybookCardAdminDto {
  return {
    id: c.publicId,
    key: c.key,
    version: c.version,
    status: c.status,
    submitted: c.status === 'draft' && c.submittedAt !== null,
    contexts: c.contexts,
    audiences: c.audiences,
    ownerRole: c.ownerRole,
    titleTh: c.titleTh,
    titleEn: c.titleEn,
    bodyTh: c.bodyTh,
    bodyEn: c.bodyEn,
    suggestedReplies: (c.suggestedReplies as { th: string; en?: string | null }[]).map((r) => ({
      th: r.th,
      en: r.en ?? null,
    })),
    sort: c.sort,
    changeNote: c.changeNote,
    source: c.source,
    submittedAt: iso(c.submittedAt),
    publishedAt: iso(c.publishedAt),
    updatedAt: toBangkokIso(c.updatedAt),
  };
}

/** Customer-safe copy for cards an agent sees: no cost, margin, factory or profit wording (D-464, D-435). */
export function agentSafeProblems(card: {
  audiences: readonly string[];
  titleTh: string;
  bodyTh: string;
  titleEn?: string | null;
  bodyEn?: string | null;
}): string[] {
  if (!card.audiences.includes('agent')) return [];
  const text = [card.titleTh, card.bodyTh, card.titleEn ?? '', card.bodyEn ?? ''].join('\n');
  return /กำไร|margin|profit|ต้นทุนโรงงาน|โรงงาน|factory/i.test(text) ? ['agent_unsafe_wording'] : [];
}

@Injectable()
export class SalesPlaybookAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolver,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  private async canOwn(actor: UserActor, ownerRole: string): Promise<void> {
    const roles = (await this.resolver.forUser(actor.userId)).roles.map((r) => r.key);
    if (!roles.includes('superadmin') && !roles.includes(ownerRole))
      throw new DomainException('auth.forbidden');
  }

  private async card(publicId: string, db: Tx = this.prisma): Promise<SalesPlaybookCard> {
    const row = await db.salesPlaybookCard.findUnique({ where: { publicId } });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  get = (publicId: string) => this.card(publicId);

  list(q: PlaybookCardListQuery) {
    const where: Prisma.SalesPlaybookCardWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.key && { key: q.key }),
      ...(q.audience && { audiences: { has: q.audience } }),
    };
    return Promise.all([
      this.prisma.salesPlaybookCard.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { key: 'asc' }, { version: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.salesPlaybookCard.count({ where }),
    ]);
  }

  private check(card: {
    audiences: readonly string[];
    titleTh: string;
    bodyTh: string;
    titleEn?: string | null;
    bodyEn?: string | null;
  }) {
    const problems = agentSafeProblems(card);
    if (problems.length)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'bodyTh',
            code: 'agent_unsafe_wording',
            message: 'no cost, margin, factory or profit words in a card agents see',
          },
        ],
      });
  }

  async create(actor: UserActor, body: CreatePlaybookCardDto): Promise<SalesPlaybookCard> {
    const id = await this.prisma.withTx(async (tx) => {
      const latest = await tx.salesPlaybookCard.findFirst({
        where: { key: body.key },
        orderBy: { version: 'desc' },
      });
      if (latest && (await tx.salesPlaybookCard.count({ where: { key: body.key, status: 'draft' } })) > 0)
        throw new DomainException('sales_playbook.not_draft', { params: { reason: 'draft_exists' } });
      const audiences = body.audiences ?? latest?.audiences;
      const ownerRole =
        latest?.ownerRole ?? body.ownerRole ?? (audiences?.includes('agent') ? 'marketing' : 'sales_manager');
      await this.canOwn(actor, ownerRole);
      const data = {
        contexts: body.contexts ?? latest?.contexts,
        audiences,
        titleTh: body.titleTh ?? latest?.titleTh,
        titleEn: body.titleEn !== undefined ? body.titleEn : (latest?.titleEn ?? null),
        bodyTh: body.bodyTh ?? latest?.bodyTh,
        bodyEn: body.bodyEn !== undefined ? body.bodyEn : (latest?.bodyEn ?? null),
        suggestedReplies: (
          body.suggestedReplies ??
          (latest?.suggestedReplies as PlaybookReplyInputDto[] | undefined) ??
          []
        ).map((r) => ({ th: r.th, en: r.en ?? null })),
        sort: body.sort ?? latest?.sort ?? 0,
      };
      if (!data.contexts?.length || !data.audiences?.length || !data.titleTh || !data.bodyTh)
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'titleTh',
              code: 'required',
              message: 'contexts, audiences, title and body for a new key',
            },
          ],
        });
      this.check({ ...data, audiences: data.audiences, titleTh: data.titleTh, bodyTh: data.bodyTh });
      const row = await tx.salesPlaybookCard.create({
        data: {
          key: body.key,
          version: (latest?.version ?? 0) + 1,
          contexts: data.contexts,
          audiences: data.audiences,
          titleTh: data.titleTh,
          titleEn: data.titleEn,
          bodyTh: data.bodyTh,
          bodyEn: data.bodyEn,
          suggestedReplies: data.suggestedReplies,
          sort: data.sort,
          status: 'draft',
          ownerRole,
          changeNote: body.changeNote?.trim() || null,
          createdById: actor.userId,
        },
      });
      await this.record(tx, row, 'sales_playbook_card.drafted', actor);
      return row.publicId;
    });
    return this.card(id);
  }

  async update(actor: UserActor, publicId: string, body: UpdatePlaybookCardDto): Promise<SalesPlaybookCard> {
    await this.prisma.withTx(async (tx) => {
      const card = await this.card(publicId, tx);
      if (card.status !== 'draft') throw new DomainException('sales_playbook.not_draft');
      await this.canOwn(actor, card.ownerRole);
      const next = {
        audiences: body.audiences ?? card.audiences,
        titleTh: body.titleTh ?? card.titleTh,
        bodyTh: body.bodyTh ?? card.bodyTh,
        titleEn: body.titleEn !== undefined ? body.titleEn : card.titleEn,
        bodyEn: body.bodyEn !== undefined ? body.bodyEn : card.bodyEn,
      };
      this.check(next);
      await tx.salesPlaybookCard.update({
        where: { id: card.id },
        data: {
          ...(body.contexts && { contexts: body.contexts }),
          ...(body.audiences && { audiences: body.audiences }),
          titleTh: next.titleTh,
          titleEn: next.titleEn,
          bodyTh: next.bodyTh,
          bodyEn: next.bodyEn,
          ...(body.suggestedReplies && {
            suggestedReplies: body.suggestedReplies.map((r) => ({ th: r.th, en: r.en ?? null })),
          }),
          ...(body.sort !== undefined && { sort: body.sort }),
          ...(body.changeNote !== undefined && { changeNote: body.changeNote.trim() || null }),
          // An edit after submission needs a new submission.
          submittedAt: null,
          submittedById: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, card, 'sales_playbook_card.updated', actor);
    });
    return this.card(publicId);
  }

  async submit(actor: UserActor, publicId: string): Promise<SalesPlaybookCard> {
    await this.prisma.withTx(async (tx) => {
      const card = await this.card(publicId, tx);
      if (card.status !== 'draft') throw new DomainException('sales_playbook.not_draft');
      await this.canOwn(actor, card.ownerRole);
      await tx.salesPlaybookCard.update({
        where: { id: card.id },
        data: { submittedAt: new Date(), submittedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, card, 'sales_playbook_card.submitted', actor);
    });
    return this.card(publicId);
  }

  /** Maker-checker: neither the author nor the submitter publishes; the previous published version retires. */
  async publish(actor: UserActor, publicId: string): Promise<SalesPlaybookCard> {
    await this.prisma.withTx(async (tx) => {
      const card = await this.card(publicId, tx);
      if (card.status !== 'draft') throw new DomainException('sales_playbook.not_draft');
      if (!card.submittedAt) throw new DomainException('sales_playbook.not_submitted');
      if (card.createdById === actor.userId || card.submittedById === actor.userId)
        throw new DomainException('sales_playbook.maker_checker');
      const now = new Date();
      await tx.salesPlaybookCard.updateMany({
        where: { key: card.key, status: 'published' },
        data: { status: 'retired', rowVersion: { increment: 1 } },
      });
      await tx.salesPlaybookCard.update({
        where: { id: card.id },
        data: {
          status: 'published',
          publishedAt: now,
          publishedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'sales_playbook_card.published',
        actor,
        resourceType: 'sales_playbook_card',
        resourcePublicId: card.publicId,
        data: { key: card.key, version: card.version },
      });
      await this.record(tx, card, 'sales_playbook_card.published', actor);
    });
    return this.card(publicId);
  }

  async retire(actor: UserActor, publicId: string): Promise<SalesPlaybookCard> {
    await this.prisma.withTx(async (tx) => {
      const card = await this.card(publicId, tx);
      if (card.status === 'retired') throw new DomainException('sales_playbook.not_draft');
      await this.canOwn(actor, card.ownerRole);
      await tx.salesPlaybookCard.update({
        where: { id: card.id },
        data: { status: 'retired', rowVersion: { increment: 1 } },
      });
      await this.record(tx, card, 'sales_playbook_card.retired', actor);
    });
    return this.card(publicId);
  }

  private record(tx: Tx, card: SalesPlaybookCard, type: string, actor: Actor) {
    return recordAgentEvent(this, tx, {
      type,
      aggregateType: 'sales_playbook_card',
      aggregateId: card.publicId,
      payload: { cardId: card.publicId, key: card.key, version: card.version },
      actor,
    });
  }
}

@ApiSurface('admin', 'salesPlaybook')
@Controller('sales/playbook')
export class AdminSalesPlaybookController {
  constructor(private readonly playbook: SalesPlaybookAdminService) {}

  @Get()
  @Can('sales_playbook.manage')
  @ApiEndpoint({
    id: 'admin.salesPlaybook.list',
    summary: 'List playbook cards',
    description:
      'Every version of every card (filter by status, key, audience), the published one per key first in use by the agent zone (D-470).',
    implements: DECISIONS,
  })
  @ApiPaginated(PlaybookCardAdminDto, { example: CARD_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: PlaybookCardListQuery) {
    const [rows, total] = await this.playbook.list(q);
    return { data: rows.map(cardDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post()
  @Can('sales_playbook.manage')
  @ApiEndpoint({
    id: 'admin.salesPlaybook.create',
    summary: 'Draft a playbook card or its next version',
    description:
      'A new key starts at version 1; an existing key gets its next draft version, copied from the latest and changed ' +
      'by the fields sent (one draft per key at a time). Only the owner role (Marketing / Sales Manager; Superadmin) ' +
      'writes; cards agents see must stay customer-safe (no cost, margin, factory or profit words) (D-470).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreatePlaybookCardDto,
    examples: {
      default: {
        value: {
          key: 'give-get-menu',
          bodyTh: 'ถามก่อนว่าลูกค้าให้อะไรกลับมาได้บ้าง …',
          changeNote: 'ปรับถ้อยคำ',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Draft', type: PlaybookCardAdminDto, example: CARD_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'sales_playbook.not_draft')
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreatePlaybookCardDto,
  ): Promise<PlaybookCardAdminDto> {
    return cardDto(await this.playbook.create(staffActor(actor), body));
  }

  @Get(':cardId')
  @Can('sales_playbook.manage')
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesPlaybook.get',
    summary: 'Get a playbook card version',
    description: 'One version with its status and review state (D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Card', type: PlaybookCardAdminDto, example: CARD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('cardId', ParseUUIDPipe) id: string): Promise<PlaybookCardAdminDto> {
    return cardDto(await this.playbook.get(id));
  }

  @Patch(':cardId')
  @Can('sales_playbook.manage')
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesPlaybook.update',
    summary: 'Edit a draft playbook card',
    description: 'Drafts only; an edit after submission withdraws the submission (D-470).',
    implements: DECISIONS,
  })
  @ApiBody({ type: UpdatePlaybookCardDto, examples: { default: { value: { titleEn: 'Give-get menu' } } } })
  @ApiSuccess(200, { description: 'Draft', type: PlaybookCardAdminDto, example: CARD_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'sales_playbook.not_draft')
  async update(
    @CurrentActor() actor: Actor,
    @Param('cardId', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlaybookCardDto,
  ): Promise<PlaybookCardAdminDto> {
    return cardDto(await this.playbook.update(staffActor(actor), id, body));
  }

  @Post(':cardId/actions/submit')
  @HttpCode(200)
  @Can('sales_playbook.manage')
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesPlaybook.submit',
    summary: 'Submit a draft card for review',
    description: 'Someone else publishes it (maker-checker, D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Submitted',
    type: PlaybookCardAdminDto,
    example: { ...CARD_EXAMPLE, submitted: true, submittedAt: '2026-11-03T11:00:00+07:00' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'sales_playbook.not_draft')
  async submit(
    @CurrentActor() actor: Actor,
    @Param('cardId', ParseUUIDPipe) id: string,
  ): Promise<PlaybookCardAdminDto> {
    return cardDto(await this.playbook.submit(staffActor(actor), id));
  }

  @Post(':cardId/actions/publish')
  @HttpCode(200)
  @Can('sales_playbook.publish')
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesPlaybook.publish',
    summary: 'Publish a submitted card',
    description:
      'Maker-checker: neither its author nor its submitter publishes it (`sales_playbook.maker_checker`). The key’s ' +
      'previous published version retires; the agent zone reads the new one at once (D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Published',
    type: PlaybookCardAdminDto,
    example: { ...CARD_EXAMPLE, status: 'published', publishedAt: '2026-11-03T12:00:00+07:00' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'sales_playbook.not_draft',
    'sales_playbook.not_submitted',
    'sales_playbook.maker_checker',
  )
  async publish(
    @CurrentActor() actor: Actor,
    @Param('cardId', ParseUUIDPipe) id: string,
  ): Promise<PlaybookCardAdminDto> {
    return cardDto(await this.playbook.publish(staffActor(actor), id));
  }

  @Post(':cardId/actions/retire')
  @HttpCode(200)
  @Can('sales_playbook.manage')
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesPlaybook.retire',
    summary: 'Retire a card version',
    description: 'It is no longer shown anywhere (D-470).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Retired',
    type: PlaybookCardAdminDto,
    example: { ...CARD_EXAMPLE, status: 'retired' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'sales_playbook.not_draft')
  async retire(
    @CurrentActor() actor: Actor,
    @Param('cardId', ParseUUIDPipe) id: string,
  ): Promise<PlaybookCardAdminDto> {
    return cardDto(await this.playbook.retire(staffActor(actor), id));
  }
}
