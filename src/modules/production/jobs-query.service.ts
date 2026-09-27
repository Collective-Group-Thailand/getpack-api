import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { JOB_INCLUDE, type JobRow } from './job-views';

/**
 * Reads of production jobs, scoped (schema-design §2.5): staff see every job; a factory principal only the
 * jobs of its own factories — anything else is "not found" (IDOR-safe, contract §5).
 */
@Injectable()
export class JobsQueryService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoping: ScopingService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    // A factory reads the approved artwork (the locked copy) and the dieline of its own live jobs — never the
    // working files or earlier versions (B4.2 "approved version only").
    this.files.registerFileReader('production', async (actor, file) => {
      if (!(actor.type === 'api_client' || (actor.type === 'user' && actor.audience === 'partner')))
        return false;
      const scope = await this.scoping.scopeOf(actor, 'factory');
      if (scope === 'all' || scope.length === 0) return false;
      const n = await this.prisma.productionJob.count({
        where: {
          factoryId: { in: [...scope] },
          status: { notIn: ['rejected', 'cancelled'] },
          OR: [
            { specSnapshot: { path: ['approvedFileId'], equals: file.publicId } },
            { specSnapshot: { path: ['dielineFileId'], equals: file.publicId } },
          ],
        },
      });
      return n > 0;
    });
  }

  async scopeWhere(actor: Actor): Promise<Prisma.ProductionJobWhereInput> {
    const scope = await this.scoping.scopeOf(actor, 'factory');
    return scope === 'all' ? {} : { factoryId: { in: [...scope] } };
  }

  async get(actor: Actor, publicId: string, db: Tx = this.prisma): Promise<JobRow> {
    const row = await db.productionJob.findFirst({
      where: { publicId, ...(await this.scopeWhere(actor)) },
      include: JOB_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(actor: Actor, where: Prisma.ProductionJobWhereInput, page: number, perPage: number) {
    const scoped = { AND: [where, await this.scopeWhere(actor)] };
    return Promise.all([
      this.prisma.productionJob.findMany({
        where: scoped,
        include: JOB_INCLUDE,
        orderBy: [{ releasedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.productionJob.count({ where: scoped }),
    ]);
  }

  /** Photo evidence per milestone (attachments `milestone.photo`). */
  async photos(rows: JobRow[]): Promise<Map<bigint, string[]>> {
    const ids = rows.flatMap((r) => r.milestones.map((m) => m.id));
    const map = new Map<bigint, string[]>();
    if (ids.length === 0) return map;
    const attachments = await this.prisma.attachment.findMany({
      where: { subjectType: 'job_milestone', subjectId: { in: ids } },
      include: { fileObject: { select: { publicId: true } } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    for (const a of attachments)
      map.set(a.subjectId, [...(map.get(a.subjectId) ?? []), a.fileObject.publicId]);
    return map;
  }
}
