import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CannedResponse, type Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { type CannedResponseDto, type ConversationStatsDto, type SaveCannedResponseDto } from './threads.dto';

type Row = CannedResponse & {
  createdBy: { publicId: string; displayName: string };
  updatedBy: { publicId: string; displayName: string } | null;
};
const INCLUDE = {
  createdBy: { select: { publicId: true, displayName: true } },
  updatedBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.CannedResponseInclude;

function dto(r: Row): CannedResponseDto {
  const by = r.updatedBy ?? r.createdBy;
  return {
    id: r.publicId,
    title: r.title,
    bodyTh: r.bodyTh,
    bodyEn: r.bodyEn,
    tags: r.tags,
    archived: r.archivedAt !== null,
    updatedBy: { id: by.publicId, displayName: by.displayName },
    updatedAt: toBangkokIso(r.updatedAt),
  };
}

/** D-300 canned responses (CS Lead, `conversations.manage_canned`): edited in place, audited, archived not deleted. */
@Injectable()
export class CannedResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(q: { page: number; perPage: number; q?: string; tag?: string; archived?: boolean }) {
    const where: Prisma.CannedResponseWhereInput = {
      ...(!q.archived && { archivedAt: null }),
      ...(q.tag && { tags: { has: q.tag } }),
      ...(q.q && {
        OR: [
          { title: { contains: q.q, mode: 'insensitive' } },
          { bodyTh: { contains: q.q, mode: 'insensitive' } },
          { bodyEn: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.cannedResponse.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.cannedResponse.count({ where }),
    ]);
    return { data: rows.map(dto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  async create(actor: UserActor, input: SaveCannedResponseDto): Promise<CannedResponseDto> {
    return this.prisma.withTx(async (tx) => {
      const row = await tx.cannedResponse.create({
        data: { ...this.fields(input), createdById: actor.userId },
        include: INCLUDE,
      });
      await this.log(tx, actor, row, 'conversation.canned_response_created');
      return dto(row);
    });
  }

  async update(actor: UserActor, publicId: string, input: SaveCannedResponseDto): Promise<CannedResponseDto> {
    return this.prisma.withTx(async (tx) => {
      const existing = await this.find(tx, publicId);
      const row = await tx.cannedResponse.update({
        where: { id: existing.id },
        data: { ...this.fields(input), updatedById: actor.userId, rowVersion: { increment: 1 } },
        include: INCLUDE,
      });
      await this.log(tx, actor, row, 'conversation.canned_response_updated', {
        before: { title: existing.title, tags: existing.tags },
      });
      return dto(row);
    });
  }

  async setArchived(actor: UserActor, publicId: string, archived: boolean): Promise<CannedResponseDto> {
    return this.prisma.withTx(async (tx) => {
      const existing = await this.find(tx, publicId);
      const row = await tx.cannedResponse.update({
        where: { id: existing.id },
        data: {
          archivedAt: archived ? (existing.archivedAt ?? new Date()) : null,
          updatedById: actor.userId,
        },
        include: INCLUDE,
      });
      await this.log(
        tx,
        actor,
        row,
        archived ? 'conversation.canned_response_archived' : 'conversation.canned_response_restored',
      );
      return dto(row);
    });
  }

  private fields(input: SaveCannedResponseDto) {
    return {
      title: input.title.trim(),
      bodyTh: input.bodyTh.trim(),
      bodyEn: input.bodyEn.trim(),
      tags: [...new Set(input.tags ?? [])],
    };
  }

  private async find(tx: Tx, publicId: string) {
    const row = await tx.cannedResponse.findUnique({ where: { publicId } });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private async log(tx: Tx, actor: UserActor, row: CannedResponse, action: string, extra: object = {}) {
    await this.audit.record(tx, {
      category: 'config',
      action,
      resourceType: 'canned_response',
      resourcePublicId: row.publicId,
      data: { title: row.title, tags: row.tags, ...extra },
    });
    await this.events.record(
      tx,
      {
        type: action,
        aggregateType: 'canned_response',
        aggregateId: row.publicId,
        payload: { cannedResponseId: row.publicId, title: row.title },
      },
      actor,
    );
  }
}

const minutes = (v: unknown) => (v === null || v === undefined ? null : Number(v).toFixed(1));

/**
 * D-300 inbox analytics: first response (first customer message waiting → first answer, against its D-221 due time)
 * and resolution (opened → closed) over a Bangkok-day range; merged LINE threads are counted in the thread they
 * joined.
 */
@Injectable()
export class ConversationStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(from: string, to: string, now = new Date()): Promise<ConversationStatsDto> {
    if (from > to)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'to', code: 'range', message: '`to` is before `from`' }],
      });
    const start = startOfBangkokDay(from);
    const end = startOfBangkokDay(addCalendarDays(to, 1));
    const [counts] = await this.prisma.$queryRaw<{ opened: bigint; closed: bigint; overdue: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS opened,
        count(*) FILTER (WHERE closed_at >= ${start} AND closed_at < ${end}) AS closed,
        count(*) FILTER (WHERE status <> 'closed' AND first_responded_at IS NULL AND first_response_due_at < ${now}) AS overdue
      FROM conversations WHERE merged_into_id IS NULL`;
    // Measured from the thread's first customer message to its first answer.
    const [first] = await this.prisma.$queryRaw<
      { n: bigint; median: number | null; p90: number | null; within: bigint }[]
    >`
      WITH answered AS (
        SELECT c.first_responded_at AS answered_at, c.first_response_due_at AS due_at,
               (SELECT min(m.sent_at) FROM conversation_messages m
                 WHERE m.conversation_id = c.id AND m.direction = 'inbound') AS asked_at
          FROM conversations c
         WHERE c.merged_into_id IS NULL AND c.first_responded_at >= ${start} AND c.first_responded_at < ${end})
      SELECT count(*) AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM answered_at - asked_at) / 60) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM answered_at - asked_at) / 60) AS p90,
             count(*) FILTER (WHERE due_at IS NULL OR answered_at <= due_at) AS within
        FROM answered WHERE asked_at IS NOT NULL AND answered_at >= asked_at`;
    const [resolution] = await this.prisma.$queryRaw<
      { n: bigint; median: number | null; p90: number | null }[]
    >`
      SELECT count(*) AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM closed_at - created_at) / 60) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM closed_at - created_at) / 60) AS p90
        FROM conversations
       WHERE merged_into_id IS NULL AND closed_at >= ${start} AND closed_at < ${end}`;
    const answered = Number(first?.n ?? 0);
    return {
      from,
      to,
      opened: Number(counts?.opened ?? 0),
      closed: Number(counts?.closed ?? 0),
      firstResponse: {
        count: answered,
        medianMinutes: minutes(first?.median),
        p90Minutes: minutes(first?.p90),
        withinTargetPct: answered ? ((Number(first!.within) * 100) / answered).toFixed(2) : null,
      },
      resolution: {
        count: Number(resolution?.n ?? 0),
        medianMinutes: minutes(resolution?.median),
        p90Minutes: minutes(resolution?.p90),
      },
      overdueNow: Number(counts?.overdue ?? 0),
    };
  }
}
