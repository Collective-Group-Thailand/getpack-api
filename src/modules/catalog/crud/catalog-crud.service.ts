import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { toSkipTake } from '@common/pagination/pagination';
import { type PageQuery, SortOrder } from '@common/pagination/pagination.dto';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { type AnyCatalogResource, type CrudRow } from './catalog-resource';
import { RefResolver } from './ref-resolver';

/** ETag of an editable catalogue row: changes on every update (contract §3 "Concurrency"). */
export const rowEtag = (row: CrudRow): string => etagOf(row.publicId, row.rowVersion);

/** Keys of `input` that were actually sent (PATCH semantics), for the audit trail. */
const sentKeys = (input: object): string[] =>
  Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

/**
 * Generic list / get / create / update / soft-delete over a {@link AnyCatalogResource}.
 * Every write: one transaction with the change, an audit row (`config`) and a domain event
 * `catalog.<key>.created|updated|deleted` (CLAUDE.md "every state change"; schema-design §2.6).
 */
@Injectable()
export class CatalogCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(resource: AnyCatalogResource, query: PageQuery): Promise<{ rows: CrudRow[]; total: number }> {
    const sortField = query.sort ?? Object.keys(resource.sort)[0]!;
    const column = resource.sort[sortField];
    if (!column) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'sort',
            code: 'isIn',
            message: `sort must be one of ${Object.keys(resource.sort).join(', ')}`,
          },
        ],
      });
    }
    const q = query.q?.trim();
    const where = {
      AND: [
        resource.baseWhere ?? {},
        (await resource.where?.(query, this.prisma)) ?? {},
        q && resource.search.length > 0
          ? {
              OR: resource.search.map((field: string) => ({ [field]: { contains: q, mode: 'insensitive' } })),
            }
          : {},
      ],
    };
    const delegate = resource.delegate(this.prisma);
    const order = query.order === SortOrder.Asc ? 'asc' : 'desc';
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        include: resource.include,
        orderBy: [{ [column]: order }, { id: order }],
        ...toSkipTake(query),
      }),
      delegate.count({ where }),
    ]);
    return { rows: rows as CrudRow[], total };
  }

  /** Maps rows to response DTOs, loading the resource's context once for the whole batch. */
  async toDtos(resource: AnyCatalogResource, rows: CrudRow[]): Promise<object[]> {
    const context: unknown = resource.context ? await resource.context(rows, this.prisma) : undefined;
    return rows.map((row) => resource.toDto(row, context as never) as object);
  }

  async get(resource: AnyCatalogResource, publicId: string, tx: Tx = this.prisma): Promise<CrudRow> {
    const row = await resource
      .delegate(tx)
      .findFirst({ where: { AND: [{ publicId }, resource.baseWhere ?? {}] }, include: resource.include });
    if (!row) throw new DomainException('http.not_found');
    return row as CrudRow;
  }

  async create(resource: AnyCatalogResource, actor: UserActor, input: object): Promise<CrudRow> {
    return this.write(resource, async (tx) => {
      const data: object = await resource.createData(input, new RefResolver(tx));
      const row = (await resource.delegate(tx).create({
        data: { ...data, createdById: actor.userId, updatedById: actor.userId },
        include: resource.include,
      })) as CrudRow;
      await this.record(tx, resource, row, 'created', { fields: sentKeys(input) });
      return row;
    });
  }

  async update(
    resource: AnyCatalogResource,
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: object,
  ): Promise<CrudRow> {
    return this.write(resource, async (tx) => {
      const current = await this.get(resource, publicId, tx);
      assertIfMatch(ifMatch, rowEtag(current));
      const data: object = await resource.updateData(input, new RefResolver(tx), current);
      const row = (await resource.delegate(tx).update({
        where: { id: current.id },
        data: { ...data, updatedById: actor.userId, rowVersion: { increment: 1 } },
        include: resource.include,
      })) as CrudRow;
      await this.record(tx, resource, row, 'updated', { fields: sentKeys(input) });
      return row;
    });
  }

  /**
   * Changes child rows of a parent (a collection replace, an image) in one transaction: checks the
   * parent's ETag, runs `work`, bumps the parent's `row_version`, records audit + event with the
   * changed `fields`, and returns the reloaded parent.
   */
  async mutateChildren(
    resource: AnyCatalogResource,
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    fields: string[],
    work: (tx: Tx, parent: CrudRow) => Promise<void>,
  ): Promise<CrudRow> {
    return this.write(resource, async (tx) => {
      const parent = await this.get(resource, publicId, tx);
      assertIfMatch(ifMatch, rowEtag(parent));
      await work(tx, parent);
      await resource.delegate(tx).update({
        where: { id: parent.id },
        data: { updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, resource, parent, 'updated', { fields });
      return this.get(resource, publicId, tx);
    });
  }

  /** Soft delete (§1.6: CMS content only); the row disappears from every read. */
  async remove(
    resource: AnyCatalogResource,
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
  ): Promise<void> {
    if (!resource.softDelete) throw new DomainException('http.method_not_allowed');
    await this.write(resource, async (tx) => {
      const current = await this.get(resource, publicId, tx);
      assertIfMatch(ifMatch, rowEtag(current));
      const row = (await resource.delegate(tx).update({
        where: { id: current.id },
        data: { deletedAt: new Date(), updatedById: actor.userId, rowVersion: { increment: 1 } },
      })) as CrudRow;
      await this.record(tx, resource, row, 'deleted', {});
    });
  }

  private async record(
    tx: Tx,
    resource: AnyCatalogResource,
    row: CrudRow,
    action: 'created' | 'updated' | 'deleted',
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      category: 'config',
      action: `catalog.${resource.key}_${action}`,
      resourceType: resource.key,
      resourcePublicId: row.publicId,
      data,
    });
    await this.events.record(tx, {
      type: `catalog.${resource.key}.${action}`,
      aggregateType: resource.key,
      aggregateId: row.publicId,
      payload: { id: row.publicId, ...data },
    });
  }

  /** One transaction; unique-key violations become the resource's 409 code. */
  private async write<T>(resource: AnyCatalogResource, work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.withTx(work);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException(resource.conflict, { cause: error });
      }
      throw error;
    }
  }
}
