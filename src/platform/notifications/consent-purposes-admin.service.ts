import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

/** Texts of consent purposes, versioned and effective-dated (ADR-0005); entered by legal/admins. */
@Injectable()
export class ConsentPurposesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.consentPurpose.findMany({
      include: { versions: { orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }] } },
      orderBy: { key: 'asc' },
    });
  }

  async publish(
    actor: UserActor,
    key: string,
    input: {
      textTh: string;
      textEn: string;
      summaryTh?: string;
      summaryEn?: string;
      effectiveFrom: Date;
      reason: string;
    },
  ) {
    const purpose = await this.prisma.consentPurpose.findUnique({ where: { key } });
    if (!purpose) throw new DomainException('http.not_found');
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) throw new DomainException('settings.backdated');
    await this.prisma.withTx(async (tx) => {
      const last = await tx.consentPurposeVersion.findFirst({
        where: { purposeId: purpose.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.consentPurposeVersion.create({
        data: {
          purposeId: purpose.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          status: 'approved',
          textTh: input.textTh,
          textEn: input.textEn,
          summaryTh: input.summaryTh ?? null,
          summaryEn: input.summaryEn ?? null,
          reason: input.reason,
          createdById: actor.userId,
          decidedAt: new Date(),
          decidedById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'consent_purpose.version_published',
        resourceType: 'consent_purpose',
        resourcePublicId: purpose.publicId,
        data: { key, versionNo: version.versionNo, effectiveFrom: input.effectiveFrom },
      });
    });
    return (await this.list()).find((p) => p.key === key)!;
  }
}
