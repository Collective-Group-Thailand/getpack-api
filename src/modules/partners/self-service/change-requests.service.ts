import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type FactoryChangeRequestStatus,
  type FactoryChangeRequestTopic,
  type Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { FactoryAccess } from '../factories/factory-access';
import { type FactoryChangeRequestDto } from './self-service.dto';

const USER_REF = { select: { publicId: true, displayName: true } } as const;
const INCLUDE = {
  factory: { select: { publicId: true, code: true } },
  respondedBy: USER_REF,
  createdBy: USER_REF,
} satisfies Prisma.FactoryChangeRequestInclude;
type Row = Prisma.FactoryChangeRequestGetPayload<{ include: typeof INCLUDE }>;

const day = (d: Date) => d.toISOString().slice(0, 10);
const CLOSED: FactoryChangeRequestStatus[] = ['done', 'declined'];

export const changeRequestDto = (r: Row): FactoryChangeRequestDto => ({
  id: r.publicId,
  factoryId: r.factory.publicId,
  factoryCode: r.factory.code,
  topic: r.topic,
  message: r.message,
  preferredDates: r.preferredDates.map(day),
  status: r.status,
  response: r.response,
  respondedAt: r.respondedAt ? toBangkokIso(r.respondedAt) : null,
  respondedBy: r.respondedBy ? { id: r.respondedBy.publicId, displayName: r.respondedBy.displayName } : null,
  createdBy: { id: r.createdBy.publicId, displayName: r.createdBy.displayName },
  createdAt: toBangkokIso(r.createdAt),
});

/**
 * Factory change requests (U-B0.3; topics touch D-021, D-041, D-043, D-167, D-173, D-022): a factory asks the
 * Partner team for a change only staff may make, or a site visit; staff answer it. The request changes no business
 * value — staff make the change through the governed endpoints. Every change: one transaction, audit row, activity
 * on the factory and a domain event (the Partner team and the factory hear it through the notification matrix).
 */
@Injectable()
export class FactoryChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async list(
    actor: Actor,
    factoryPublicId: string,
    q: { page: number; perPage: number; status?: FactoryChangeRequestStatus },
  ) {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.page({ factoryId: factory.id, ...(q.status && { status: q.status }) }, q);
  }

  async adminList(q: {
    page: number;
    perPage: number;
    status?: FactoryChangeRequestStatus;
    topic?: FactoryChangeRequestTopic;
    factoryId?: string;
  }) {
    return this.page(
      {
        ...(q.status && { status: q.status }),
        ...(q.topic && { topic: q.topic }),
        ...(q.factoryId && { factory: { publicId: q.factoryId } }),
      },
      q,
    );
  }

  private async page(where: Prisma.FactoryChangeRequestWhereInput, q: { page: number; perPage: number }) {
    const [rows, total] = await Promise.all([
      this.prisma.factoryChangeRequest.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.factoryChangeRequest.count({ where }),
    ]);
    return { rows, total };
  }

  async create(
    actor: UserActor,
    factoryPublicId: string,
    input: { topic: FactoryChangeRequestTopic; message: string; preferredDates?: string[] },
  ): Promise<Row> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const dates = [...new Set(input.preferredDates ?? [])].sort();
    if (dates.some((d) => Number.isNaN(new Date(`${d}T00:00:00Z`).getTime())))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'preferredDates', code: 'date', message: 'YYYY-MM-DD' }],
      });
    const today = bangkokDate(new Date());
    if (input.topic === 'site_visit' && !dates.some((d) => d > today))
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'preferredDates', code: 'future_date', message: 'a site visit needs a day after today' },
        ],
      });
    const message = input.message.trim();
    if (message.length < 3)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'message', code: 'too_short', message: 'at least 3 characters' }],
      });
    return this.prisma.withTx(async (tx) => {
      const row = await tx.factoryChangeRequest.create({
        data: {
          factoryId: factory.id,
          topic: input.topic,
          message,
          preferredDates: dates.map((d) => new Date(`${d}T00:00:00Z`)),
          createdById: actor.userId,
        },
        include: INCLUDE,
      });
      await this.record(tx, actor, row, 'factory_change_request.created', {
        topic: row.topic,
        preferredDates: dates,
      });
      return row;
    });
  }

  /** The Partner team works on or closes a request; closing (done / declined) needs a response. */
  async answer(
    actor: UserActor,
    publicId: string,
    input: { status: 'in_progress' | 'done' | 'declined'; response?: string },
  ): Promise<Row> {
    const response = input.response?.trim() || null;
    const closing = CLOSED.includes(input.status);
    if (closing && !response)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'response', code: 'required', message: 'closing a request needs a response' }],
      });
    return this.prisma.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM factory_change_requests WHERE public_id = ${publicId}::uuid FOR UPDATE`;
      const current = await tx.factoryChangeRequest.findUnique({ where: { publicId } });
      if (!current) throw new DomainException('http.not_found');
      if (CLOSED.includes(current.status))
        throw new DomainException('partners.invalid_transition', {
          params: { from: current.status, to: input.status },
        });
      const row = await tx.factoryChangeRequest.update({
        where: { id: current.id },
        data: {
          status: input.status,
          ...(response && { response, respondedAt: new Date(), respondedById: actor.userId }),
          rowVersion: { increment: 1 },
        },
        include: INCLUDE,
      });
      await this.record(tx, actor, row, 'factory_change_request.answered', {
        topic: row.topic,
        status: row.status,
      });
      return row;
    });
  }

  private async record(tx: Tx, actor: UserActor, row: Row, type: string, data: Record<string, unknown>) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'factory_change_request',
      resourcePublicId: row.publicId,
      data,
    });
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'factory_change_request',
        aggregateId: row.publicId,
        payload: {
          changeRequestId: row.publicId,
          factoryId: row.factory.publicId,
          factoryCode: row.factory.code,
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'factory',
      aggregatePublicId: row.factory.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'partner'],
      domainEventId: event.id,
    });
  }
}
