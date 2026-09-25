import { createHash } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { RefResolver } from '@modules/catalog/crud/ref-resolver';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { FactoriesService } from '../factories/factories.service';
import { FactoryAccess } from '../factories/factory-access';

const BACKDATE_SLACK_MS = 60_000;

export interface AgreementStatusDto {
  key: string;
  name: string;
  versionNo: number | null;
  effectiveFrom: string | null;
  textTh: string | null;
  textEn: string | null;
  accepted: boolean;
  acceptedAt: string | null;
  method: 'e_acceptance' | 'signed_upload' | null;
}

/**
 * Partner agreements (D-011; confidentiality in both directions, D-044): versioned texts published by
 * the Partner team (ADR-0005), accepted per version by the factory in the partner zone (e-acceptance:
 * the evidence is a SHA-256 over the text version, factory, user, time, IP and user agent) or recorded
 * by staff from a signed copy. The `agreement` step is approved once every agreement in force is accepted.
 */
@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async templates() {
    const rows = await this.prisma.agreementTemplate.findMany({
      include: { versions: { orderBy: { versionNo: 'desc' } } },
      orderBy: { key: 'asc' },
    });
    return rows;
  }

  async publish(
    actor: UserActor,
    key: string,
    input: {
      textTh: string;
      textEn?: string | null;
      pdfFileId?: string | null;
      effectiveFrom?: Date;
      reason: string;
    },
  ) {
    const effectiveFrom = input.effectiveFrom ?? new Date();
    if (effectiveFrom.getTime() < Date.now() - BACKDATE_SLACK_MS)
      throw new DomainException('partners.backdated');
    return this.prisma.withTx(async (tx) => {
      const template = await tx.agreementTemplate.findUnique({ where: { key } });
      if (!template) throw new DomainException('http.not_found');
      const last = await tx.agreementTemplateVersion.findFirst({
        where: { templateId: template.id },
        orderBy: { versionNo: 'desc' },
      });
      const text = `${input.textTh}\n---\n${input.textEn ?? ''}`;
      const version = await tx.agreementTemplateVersion.create({
        data: {
          templateId: template.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom,
          status: 'approved',
          textTh: input.textTh,
          textEn: input.textEn ?? null,
          textSha256: sha256(text),
          pdfFileId: await new RefResolver(tx).optionalFile(input.pdfFileId, 'pdfFileId'),
          reason: input.reason,
          createdById: actor.userId,
          decidedAt: new Date(),
          decidedById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'agreement.version_published',
        resourceType: 'agreement_template',
        resourcePublicId: template.publicId,
        data: { key, versionNo: version.versionNo, effectiveFrom: effectiveFrom.toISOString() },
      });
      await this.events.record(tx, {
        type: 'agreement.version_published',
        aggregateType: 'agreement_template',
        aggregateId: template.publicId,
        payload: { key, versionNo: version.versionNo },
      });
      return version;
    });
  }

  /** The agreements in force for a factory and whether it accepted each version. */
  async status(actor: Actor, factoryPublicId: string, at = new Date()): Promise<AgreementStatusDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.statusOf(this.prisma, factory.id, at);
  }

  async accept(
    actor: UserActor,
    factoryPublicId: string,
    key: string,
    evidence: { ip: string | null; userAgent: string | null; signedFileId?: string },
  ): Promise<AgreementStatusDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const version = await this.inForce(tx, key);
      if (!version) throw new DomainException('partners.agreement_not_published');
      const acceptedAt = new Date();
      const method = evidence.signedFileId ? 'signed_upload' : 'e_acceptance';
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            textSha256: Buffer.from(version.textSha256).toString('hex'),
            factory: factory.publicId,
            user: actor.publicId,
            acceptedAt: acceptedAt.toISOString(),
            ip: evidence.ip,
            userAgent: evidence.userAgent,
          }),
        )
        .digest();
      try {
        await tx.agreementAcceptance.create({
          data: {
            factoryId: factory.id,
            templateVersionId: version.id,
            acceptedByUserId: actor.userId,
            acceptedAt,
            method,
            ip: evidence.ip,
            userAgent: evidence.userAgent?.slice(0, 500) ?? null,
            evidenceSha256: new Uint8Array(digest),
            signedFileId: evidence.signedFileId
              ? await new RefResolver(tx).file(evidence.signedFileId, 'signedFileId')
              : null,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('partners.agreement_already_accepted', { cause: error });
        }
        throw error;
      }
      const status = await this.statusOf(tx, factory.id, acceptedAt);
      if (status.every((a) => a.accepted)) {
        await this.factories.markStep(tx, factory.id, 'agreement', 'approved', actor.userId);
      }
      await this.factories.record(tx, factory.publicId, 'factory.agreement_accepted', {
        key,
        versionNo: version.versionNo,
        method,
      });
      return status;
    });
  }

  private async inForce(db: Tx, key: string, at = new Date()) {
    return db.agreementTemplateVersion.findFirst({
      where: { template: { key }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
  }

  private async statusOf(db: Tx, factoryId: bigint, at: Date): Promise<AgreementStatusDto[]> {
    const templates = await db.agreementTemplate.findMany({ orderBy: { key: 'asc' } });
    const out: AgreementStatusDto[] = [];
    for (const template of templates) {
      const version = await this.inForce(db, template.key, at);
      const acceptance = version
        ? await db.agreementAcceptance.findUnique({
            where: { factoryId_templateVersionId: { factoryId, templateVersionId: version.id } },
          })
        : null;
      out.push({
        key: template.key,
        name: template.name,
        versionNo: version?.versionNo ?? null,
        effectiveFrom: version ? toBangkokIso(version.effectiveFrom) : null,
        textTh: version?.textTh ?? null,
        textEn: version?.textEn ?? null,
        // Nothing published yet → nothing to accept.
        accepted: version ? acceptance !== null : false,
        acceptedAt: acceptance ? toBangkokIso(acceptance.acceptedAt) : null,
        method: acceptance?.method ?? null,
      });
    }
    return out;
  }
}
