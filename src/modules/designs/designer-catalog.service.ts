import { type Readable } from 'node:stream';

import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { sizeRulesOf } from '@modules/catalog/store/size-rules';
import { imageUrl } from '@modules/catalog/store/store-catalog.service';
import { Inject, Injectable } from '@nestjs/common';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { SettingsService } from '@platform/settings/settings.service';

import {
  type DesignerCatalogDto,
  type DesignerRulesDto,
  type DesignerTemplateDetailDto,
  type DesignerTemplateDto,
} from './designer-catalog.dto';

const ACTIVE = 'active' as const;
const num = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());

const TEMPLATE_INCLUDE = {
  semiDesign: {
    include: {
      colours: { orderBy: { sort: 'asc' } },
      catalogProduct: {
        select: {
          publicId: true,
          slug: true,
          nameTh: true,
          nameEn: true,
          productType: { select: { code: true } },
        },
      },
    },
  },
  standardSize: true,
  thumbnailFile: { select: { publicId: true } },
  fonts: { where: { font: { status: ACTIVE } }, include: { font: { select: { publicId: true } } } },
  designVersion: { select: { schemaVersion: true, document: true } },
} satisfies Prisma.SemiDesignTemplateInclude;
type TemplateRow = Prisma.SemiDesignTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

export interface FontFile {
  stream: Readable;
  mimeType: string;
  sizeBytes: bigint;
  etag: string;
}

/**
 * The online designer's catalogue (U-B0.1, D-070, D-152): the box styles of a product with dieline keys and size
 * rules, its materials with caliper and flute allowances, the semi-design templates, the fonts and the artwork
 * rules. Public and cacheable: catalogue data only, never prices or factories (D-050).
 */
@Injectable()
export class DesignerCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async catalog(slug: string): Promise<DesignerCatalogDto> {
    const p = await this.prisma.catalogProduct.findFirst({
      where: { slug, status: ACTIVE, productType: { status: ACTIVE } },
      include: {
        productType: { select: { code: true } },
        patterns: {
          where: { pattern: { status: ACTIVE } },
          include: {
            pattern: { include: { fluteTypes: { include: { fluteType: { select: { publicId: true } } } } } },
          },
          orderBy: { sort: 'asc' },
        },
        options: { where: { optionKind: 'material' }, orderBy: { sort: 'asc' } },
      },
    });
    if (!p) throw new DomainException('http.not_found');
    const materialOrder = p.options.map((o) => o.optionId);
    const [materials, templates, fonts, rules] = await Promise.all([
      this.prisma.material.findMany({
        where: { id: { in: materialOrder }, status: ACTIVE },
        include: { fluteType: true },
      }),
      this.prisma.semiDesignTemplate.findMany({
        where: { status: ACTIVE, semiDesign: { catalogProductId: p.id, status: ACTIVE } },
        include: TEMPLATE_INCLUDE,
        orderBy: [{ semiDesign: { name: 'asc' } }, { standardSize: { sort: 'asc' } }],
      }),
      this.prisma.designFont.findMany({ where: { status: ACTIVE }, orderBy: { name: 'asc' } }),
      this.rules(),
    ]);
    materials.sort((a, b) => materialOrder.indexOf(a.id) - materialOrder.indexOf(b.id));
    return {
      product: {
        id: p.publicId,
        slug: p.slug,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        productTypeCode: p.productType.code,
      },
      patterns: p.patterns.map(({ pattern }) => ({
        id: pattern.publicId,
        code: pattern.code,
        name: pattern.name,
        dielineKey: pattern.dielineKey,
        fluteTypeIds: pattern.fluteTypes.map((f) => f.fluteType.publicId),
        rules: sizeRulesOf(pattern.constraints),
      })),
      materials: materials.map((m) => ({
        id: m.publicId,
        code: m.code,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        kind: m.kind,
        micron: num(m.micron),
        flute:
          m.fluteType && m.fluteType.status === ACTIVE
            ? {
                id: m.fluteType.publicId,
                code: m.fluteType.code,
                name: m.fluteType.name,
                layers: m.fluteType.layers,
                allowanceAMm: num(m.fluteType.colA),
                allowanceCMm: num(m.fluteType.colC),
                allowanceDdMm: num(m.fluteType.colDd),
              }
            : null,
      })),
      templates: templates.map((t) => this.templateDto(t)),
      fonts: fonts.map((f) => ({
        id: f.publicId,
        name: f.name,
        url: `/v1/store/designer/fonts/${f.publicId}`,
      })),
      rules,
    };
  }

  /** One active semi-design template with the designer document customers start from. */
  async template(publicId: string): Promise<DesignerTemplateDetailDto> {
    const t = await this.prisma.semiDesignTemplate.findFirst({
      where: {
        publicId,
        status: ACTIVE,
        semiDesign: { status: ACTIVE, catalogProduct: { status: ACTIVE } },
      },
      include: TEMPLATE_INCLUDE,
    });
    if (!t) throw new DomainException('http.not_found');
    const product = t.semiDesign.catalogProduct;
    return {
      ...this.templateDto(t),
      product: {
        id: product.publicId,
        slug: product.slug,
        nameTh: product.nameTh,
        nameEn: product.nameEn,
        productTypeCode: product.productType.code,
      },
      schemaVersion: t.designVersion?.schemaVersion ?? null,
      document: (t.designVersion?.document as Record<string, unknown> | undefined) ?? null,
    };
  }

  /** The file of an active design font, once scanned clean; anything else is 404. */
  async font(publicId: string): Promise<FontFile> {
    const font = await this.prisma.designFont.findFirst({
      where: { publicId, status: ACTIVE },
      include: { fileObject: true },
    });
    const file = font?.fileObject;
    if (!file || file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean' || file.purgedAt)
      throw new DomainException('http.not_found');
    return {
      stream: await this.storage.getStream(file.storageKey),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      etag: `"${file.sha256 ? Buffer.from(file.sha256).toString('hex') : file.publicId}"`,
    };
  }

  private templateDto(t: TemplateRow): DesignerTemplateDto {
    return {
      id: t.publicId,
      semiDesignId: t.semiDesign.publicId,
      name: t.semiDesign.name,
      sizeCode: t.standardSize.code,
      lengthMm: t.standardSize.lengthMm.toNumber(),
      widthMm: t.standardSize.widthMm.toNumber(),
      heightMm: t.standardSize.heightMm.toNumber(),
      thumbnailUrl: imageUrl(t.thumbnailFile.publicId),
      colours: t.semiDesign.colours.map((c) => c.hex),
      fontIds: t.fonts.map((f) => f.font.publicId),
      hasDesign: t.designVersion !== null,
    };
  }

  private async rules(): Promise<DesignerRulesDto> {
    const rules = (await this.settings.at('artwork.preflight_rules')).value;
    const purpose = FILE_PURPOSES.design_asset;
    return {
      bleedMm: rules.bleedMm,
      safeZoneMm: rules.safeZoneMm,
      minEffectivePpi: rules.minEffectivePpi,
      colourMode: 'cmyk',
      assetPurpose: 'design_asset',
      assetAccept: [...purpose.mimeTypes],
      assetMaxBytes: purpose.maxBytes,
    };
  }
}
