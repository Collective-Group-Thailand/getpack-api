import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { type CompanyAssetDto } from './brand-assets.dto';
import { CompaniesService } from './companies.service';

const ASSET_INCLUDE = {
  fileObject: true,
  createdBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.CompanyBrandAssetInclude;
type AssetRow = Prisma.CompanyBrandAssetGetPayload<{ include: typeof ASSET_INCLUDE }>;

/**
 * The company's brand library (D-227): the Company Admin (`company_assets.manage`) adds files they uploaded — for the
 * company or themself — and removes them; every active member lists and downloads them. Removing keeps the file.
 */
@Injectable()
export class BrandAssetsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    // A live brand asset is readable by the company's active members.
    this.files.registerFileReader('company_assets', async (actor, file) => {
      if (actor.type !== 'user' || actor.audience !== 'customer') return false;
      const n = await this.prisma.companyBrandAsset.count({
        where: {
          fileObjectId: file.id,
          removedAt: null,
          company: { members: { some: { userId: actor.userId, status: 'active' } } },
        },
      });
      return n > 0;
    });
  }

  async list(actor: UserActor, companyPublicId: string): Promise<CompanyAssetDto[]> {
    const company = await this.companies.forMember(actor, companyPublicId);
    const rows = await this.prisma.companyBrandAsset.findMany({
      where: { companyId: company.id, removedAt: null },
      include: ASSET_INCLUDE,
      orderBy: [{ kind: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async add(
    actor: UserActor,
    companyPublicId: string,
    input: { fileId: string; kind: AssetRow['kind']; name: string },
  ): Promise<CompanyAssetDto> {
    const row = await this.prisma.withTx(async (tx) => {
      const company = await this.companies.forMember(actor, companyPublicId, 'company_assets.manage', tx);
      const file = await tx.fileObject.findUnique({ where: { publicId: input.fileId } });
      if (
        !file ||
        !(file.ownerUserId === actor.userId || file.ownerCompanyId === company.id) ||
        file.uploadStatus !== 'uploaded' ||
        file.scanStatus === 'infected' ||
        file.purgedAt
      )
        throw new DomainException('artwork.file_not_usable', { params: { fileId: input.fileId } });
      let created: AssetRow;
      try {
        created = await tx.companyBrandAsset.create({
          data: {
            companyId: company.id,
            fileObjectId: file.id,
            kind: input.kind,
            name: input.name.trim(),
            createdById: actor.userId,
          },
          include: ASSET_INCLUDE,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new DomainException('companies.asset_exists');
        throw error;
      }
      await this.companies.record(
        tx,
        company,
        'company.brand_asset_added',
        { assetId: created.publicId, kind: created.kind, name: created.name },
        actor,
      );
      return created;
    });
    return this.view(row);
  }

  async remove(actor: UserActor, companyPublicId: string, assetPublicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const company = await this.companies.forMember(actor, companyPublicId, 'company_assets.manage', tx);
      const asset = await tx.companyBrandAsset.findFirst({
        where: { publicId: assetPublicId, companyId: company.id, removedAt: null },
      });
      if (!asset) throw new DomainException('http.not_found');
      await tx.companyBrandAsset.update({
        where: { id: asset.id },
        data: { removedAt: new Date(), removedById: actor.userId },
      });
      await this.companies.record(
        tx,
        company,
        'company.brand_asset_removed',
        { assetId: asset.publicId, kind: asset.kind, name: asset.name },
        actor,
      );
    });
  }

  private async view(r: AssetRow): Promise<CompanyAssetDto> {
    return {
      id: r.publicId,
      kind: r.kind,
      name: r.name,
      fileId: r.fileObject.publicId,
      fileName: r.fileObject.originalName,
      mimeType: r.fileObject.mimeType,
      sizeBytes: Number(r.fileObject.sizeBytes),
      url: (await this.files.signedUrl(r.fileObject))?.url ?? null,
      addedBy: { id: r.createdBy.publicId, displayName: r.createdBy.displayName },
      addedAt: toBangkokIso(r.createdAt),
    };
  }
}
