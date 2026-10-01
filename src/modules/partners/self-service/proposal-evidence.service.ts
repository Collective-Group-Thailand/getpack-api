import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type ProposalStatus } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { FactoryAccess } from '../factories/factory-access';
import { PriceProposalRecorder } from '../pricing/price-proposal-recorder';
import { type ProposalEvidenceDto } from './self-service.dto';

const ROLE = 'price_proposal.evidence';
const OPEN: ProposalStatus[] = ['draft', 'submitted', 'under_review', 'countered'];

/**
 * Evidence a factory attaches to its own price proposal (U-B0.3, D-040): supplier quotations, invoices, index
 * prints — files it uploaded, with a short note, while the proposal is open. Staff read them on the review.
 * Never prices of another factory (D-044): the proposal is the factory's own.
 */
@Injectable()
export class ProposalEvidenceService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly scoping: ScopingService,
    private readonly files: FilesService,
    private readonly recorder: PriceProposalRecorder,
  ) {}

  onModuleInit(): void {
    this.files.registerAttachmentPolicy('price_proposal', async (actor, proposalId) => {
      const proposal = await this.prisma.priceProposal.findUnique({
        where: { id: proposalId },
        include: { priceList: { select: { factoryId: true } } },
      });
      if (!proposal) return false;
      const scope = await this.scoping.scopeOf(actor, 'factory');
      return scope === 'all' || scope.includes(proposal.priceList.factoryId);
    });
  }

  private async proposal(actor: Actor, publicId: string, factoryPublicId?: string) {
    const proposal = await this.prisma.priceProposal.findUnique({
      where: { publicId },
      include: { priceList: { include: { factory: { select: { id: true, publicId: true } } } } },
    });
    if (!proposal) throw new DomainException('http.not_found');
    if (factoryPublicId !== undefined) {
      if (proposal.priceList.factory.publicId !== factoryPublicId)
        throw new DomainException('http.not_found');
      await this.access.factory(actor, factoryPublicId);
    }
    return proposal;
  }

  async list(
    actor: Actor,
    proposalPublicId: string,
    factoryPublicId?: string,
  ): Promise<ProposalEvidenceDto[]> {
    const proposal = await this.proposal(actor, proposalPublicId, factoryPublicId);
    const rows = await this.prisma.attachment.findMany({
      where: { subjectType: 'price_proposal', subjectId: proposal.id, role: ROLE },
      include: {
        fileObject: { select: { publicId: true, originalName: true, mimeType: true } },
        createdBy: { select: { publicId: true, displayName: true } },
      },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return rows.map((a) => ({
      fileId: a.fileObject.publicId,
      fileName: a.fileObject.originalName,
      mimeType: a.fileObject.mimeType,
      note: a.note,
      addedBy: a.createdBy ? { id: a.createdBy.publicId, displayName: a.createdBy.displayName } : null,
      addedAt: toBangkokIso(a.createdAt),
    }));
  }

  async add(
    actor: UserActor,
    factoryPublicId: string,
    proposalPublicId: string,
    input: { fileId: string; note?: string },
  ): Promise<ProposalEvidenceDto[]> {
    const proposal = await this.proposal(actor, proposalPublicId, factoryPublicId);
    const note = input.note?.trim() || null;
    await this.prisma.withTx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM price_proposals WHERE id = ${proposal.id} FOR UPDATE`;
      const current = await tx.priceProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      if (!OPEN.includes(current.status)) throw new DomainException('partners.proposal_closed');
      const file = await tx.fileObject.findUnique({ where: { publicId: input.fileId } });
      if (
        !file ||
        file.ownerUserId !== actor.userId ||
        file.uploadStatus !== 'uploaded' ||
        file.scanStatus === 'infected'
      )
        throw new DomainException('artwork.file_not_usable', { params: { fileId: input.fileId } });
      const where = { subjectType: 'price_proposal' as const, subjectId: proposal.id, role: ROLE };
      if (await tx.attachment.count({ where: { ...where, fileObjectId: file.id } }))
        throw new DomainException('http.conflict');
      await tx.attachment.create({
        data: {
          ...where,
          fileObjectId: file.id,
          note,
          sort: await tx.attachment.count({ where }),
          createdById: actor.userId,
        },
      });
      await this.recorder.proposal(
        tx,
        proposal.priceList.factory,
        proposal,
        'price_proposal.evidence_added',
        {
          fileId: file.publicId,
        },
      );
    });
    return this.list(actor, proposalPublicId, factoryPublicId);
  }
}
