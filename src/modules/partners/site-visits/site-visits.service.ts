import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type Prisma, type SiteVisitResult } from '@generated/prisma/client';
import { RefResolver } from '@modules/catalog/crud/ref-resolver';
import { Injectable } from '@nestjs/common';

import { FactoriesService } from '../factories/factories.service';
import { FactoryAccess } from '../factories/factory-access';

export const SITE_VISIT_INCLUDE = {
  recordedBy: { select: { publicId: true, displayName: true } },
  inspectors: { include: { user: { select: { publicId: true, displayName: true } } } },
} satisfies Prisma.SiteVisitInclude;
export type SiteVisitRow = Prisma.SiteVisitGetPayload<{ include: typeof SITE_VISIT_INCLUDE }>;

/**
 * Site visits (D-041): at least one `pass` visit is required before a factory in trial can be
 * activated. Recorded by the Partner team with the checklist, inspectors and photos (attachments,
 * subject `site_visit`). A pass approves the `site_visit` onboarding step.
 */
@Injectable()
export class SiteVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
  ) {}

  async list(actor: Actor, factoryPublicId: string) {
    const factory = await this.access.factory(actor, factoryPublicId);
    const visits = await this.prisma.siteVisit.findMany({
      where: { factoryId: factory.id },
      include: SITE_VISIT_INCLUDE,
      orderBy: { visitedOn: 'desc' },
    });
    const photos = await this.prisma.attachment.findMany({
      where: { subjectType: 'site_visit', subjectId: { in: visits.map((v) => v.id) } },
      include: { fileObject: { select: { publicId: true } } },
      orderBy: { sort: 'asc' },
    });
    return visits.map((v) => ({
      visit: v,
      photoIds: photos.filter((p) => p.subjectId === v.id).map((p) => p.fileObject.publicId),
    }));
  }

  async record(
    actor: UserActor,
    factoryPublicId: string,
    input: {
      visitedOn: Date;
      checklistVersion: string;
      checklist: Record<string, unknown>;
      result: SiteVisitResult;
      notes?: string | null;
      inspectorIds: string[];
      photoFileIds?: string[];
    },
  ) {
    const factory = await this.access.factory(actor, factoryPublicId);
    if (input.visitedOn.getTime() > Date.now()) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'visitedOn', code: 'past', message: 'visitedOn cannot be in the future' }],
      });
    }
    return this.prisma.withTx(async (tx) => {
      const refs = new RefResolver(tx);
      const inspectors: bigint[] = [];
      for (const [index, publicId] of input.inspectorIds.entries()) {
        const user = await tx.user.findFirst({ where: { publicId, kind: 'staff' }, select: { id: true } });
        if (!user) {
          throw new DomainException('validation.failed', {
            errors: [
              { path: `inspectorIds[${index}]`, code: 'exists', message: 'no staff user with this id' },
            ],
          });
        }
        inspectors.push(user.id);
      }
      const visit = await tx.siteVisit.create({
        data: {
          factoryId: factory.id,
          visitedOn: input.visitedOn,
          checklistVersion: input.checklistVersion,
          checklist: input.checklist as Prisma.InputJsonValue,
          result: input.result,
          notes: input.notes ?? null,
          recordedById: actor.userId,
          inspectors: { create: [...new Set(inspectors)].map((userId) => ({ userId })) },
        },
        include: SITE_VISIT_INCLUDE,
      });
      const photoIds: string[] = [];
      for (const [index, fileId] of (input.photoFileIds ?? []).entries()) {
        await tx.attachment.create({
          data: {
            fileObjectId: await refs.file(fileId, `photoFileIds[${index}]`),
            subjectType: 'site_visit',
            subjectId: visit.id,
            role: 'photo',
            sort: index,
            createdById: actor.userId,
          },
        });
        photoIds.push(fileId);
      }
      if (input.result === 'pass') {
        await this.factories.markStep(tx, factory.id, 'site_visit', 'approved', actor.userId);
      } else {
        await this.factories.markStep(tx, factory.id, 'site_visit', 'in_progress', actor.userId);
      }
      await this.factories.record(tx, factory.publicId, 'factory.site_visit_recorded', {
        siteVisitId: visit.publicId,
        result: input.result,
      });
      return { visit, photoIds };
    });
  }
}
