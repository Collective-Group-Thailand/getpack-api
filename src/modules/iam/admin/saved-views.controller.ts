import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';

import { CreateSavedViewDto, SAVED_VIEW_EXAMPLE, SavedViewDto, SavedViewQuery } from './saved-views.dto';

const INCLUDE = { owner: { select: { publicId: true, displayName: true } } } as const;
type Row = Prisma.SavedViewGetPayload<{ include: typeof INCLUDE }>;

const staff = (actor: Actor): UserActor => {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
};

function invalid(path: string, message: string): never {
  throw new DomainException('validation.failed', { errors: [{ path, code: 'saved_view', message }] });
}

const dto = (r: Row): SavedViewDto => ({
  id: r.publicId,
  resource: r.resource,
  name: r.name,
  query: r.query as Record<string, string>,
  columns: r.hasColumns ? r.columns : null,
  shared: r.shared,
  owner: { id: r.owner.publicId, displayName: r.owner.displayName },
  createdAt: toBangkokIso(r.createdAt),
});

@ApiSurface('admin', 'users')
@Controller('saved-views')
export class SavedViewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.savedViews.list',
    summary: 'List my saved views of a list',
    description: 'My own views of `resource` and those shared by colleagues, mine first, then by name.',
    implements: ['D-140'],
  })
  @ApiPaginated(SavedViewDto, { example: SAVED_VIEW_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: SavedViewQuery) {
    const me = staff(actor);
    const where: Prisma.SavedViewWhereInput = {
      resource: q.resource,
      OR: [{ ownerUserId: me.userId }, { shared: true }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.savedView.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.savedView.count({ where }),
    ]);
    const mine = (r: Row) => (r.ownerUserId === me.userId ? 0 : 1);
    return {
      data: [...rows].sort((a, b) => mine(a) - mine(b)).map(dto),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Post()
  @ApiEndpoint({
    id: 'admin.savedViews.create',
    summary: 'Save a view of a list',
    description:
      'The list’s URL parameters (at most 30, values ≤ 500 characters, no money or personal data meant), optional ' +
      'columns, optionally shared with every staff member. Names are unique per list and owner (409). Audited.',
    implements: ['D-140'],
  })
  @ApiBody({
    type: CreateSavedViewDto,
    examples: {
      default: { value: { resource: 'orders', name: 'รอชำระเงิน', query: { status: 'waiting_payment' } } },
    },
  })
  @ApiSuccess(201, { description: 'Saved', type: SavedViewDto, example: SAVED_VIEW_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'http.conflict')
  async create(@CurrentActor() actor: Actor, @Body() body: CreateSavedViewDto): Promise<SavedViewDto> {
    const me = staff(actor);
    const entries = Object.entries(body.query);
    if (entries.length > 30) invalid('query', 'at most 30 parameters');
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_.[\]-]{0,63}$/.test(key)) invalid(`query.${key}`, 'a URL parameter name');
      if (typeof value !== 'string' || value.length > 500)
        invalid(`query.${key}`, 'a string of ≤ 500 characters');
    }
    try {
      const row = await this.prisma.withTx(async (tx) => {
        const created = await tx.savedView.create({
          data: {
            ownerUserId: me.userId,
            resource: body.resource,
            name: body.name.trim(),
            query: body.query,
            columns: body.columns ?? [],
            hasColumns: body.columns !== undefined && body.columns !== null,
            shared: body.shared ?? false,
          },
          include: INCLUDE,
        });
        await this.audit.record(tx, {
          category: 'config',
          action: 'saved_view.created',
          resourceType: 'saved_view',
          resourcePublicId: created.publicId,
          data: { resource: created.resource, shared: created.shared },
        });
        return created;
      });
      return dto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainException('http.conflict');
      throw error;
    }
  }

  @Delete(':viewId')
  @HttpCode(204)
  @ApiParam({ name: 'viewId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.savedViews.delete',
    summary: 'Delete my saved view',
    description: 'Only its owner deletes a view, shared or not (403 for a colleague’s shared view). Audited.',
    implements: ['D-140'],
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async remove(@CurrentActor() actor: Actor, @Param('viewId', ParseUUIDPipe) viewId: string): Promise<void> {
    const me = staff(actor);
    const view = await this.prisma.savedView.findUnique({ where: { publicId: viewId } });
    if (!view || (view.ownerUserId !== me.userId && !view.shared))
      throw new DomainException('http.not_found');
    if (view.ownerUserId !== me.userId) throw new DomainException('auth.forbidden');
    await this.prisma.withTx(async (tx) => {
      await tx.savedView.delete({ where: { id: view.id } });
      await this.audit.record(tx, {
        category: 'config',
        action: 'saved_view.deleted',
        resourceType: 'saved_view',
        resourcePublicId: view.publicId,
        data: { resource: view.resource },
      });
    });
  }
}
