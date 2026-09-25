import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import { type RefResolver } from '../crud/ref-resolver';
import {
  CreateDesignFontDto,
  CreateSemiDesignDto,
  CreateSemiDesignTemplateDto,
  CreateShowcaseCategoryDto,
  CreateShowcaseProductDto,
  DesignFontDto,
  DesignFontListQuery,
  SemiDesignDto,
  SemiDesignListQuery,
  SemiDesignTemplateDto,
  SemiDesignTemplateListQuery,
  SHOWCASE_IDS,
  ShowcaseCategoryDto,
  ShowcaseCategoryListQuery,
  ShowcaseProductDto,
  ShowcaseProductListQuery,
  UpdateDesignFontDto,
  UpdateSemiDesignDto,
  UpdateSemiDesignTemplateDto,
  UpdateShowcaseCategoryDto,
  UpdateShowcaseProductDto,
} from './showcase.dto';

const TS = '2026-09-25T10:00:00+07:00';
const SHOWCASE = ['D-005', 'D-100'];

type CategoryRow = Prisma.ShowcaseCategoryGetPayload<object>;

export const showcaseCategories = defineResource({
  key: 'showcase_category',
  path: 'showcase-categories',
  operation: 'catalogShowcaseCategories',
  area: 'catalog',
  label: 'showcase category',
  labelPlural: 'showcase categories',
  implements: SHOWCASE,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.showcaseCategory,
  dto: ShowcaseCategoryDto,
  createDto: CreateShowcaseCategoryDto,
  updateDto: UpdateShowcaseCategoryDto,
  queryDto: ShowcaseCategoryListQuery,
  example: {
    id: SHOWCASE_IDS.category,
    slug: 'cosmetics',
    nameTh: 'บรรจุภัณฑ์เครื่องสำอาง',
    nameEn: 'Cosmetics packaging',
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { slug: 'cosmetics', nameTh: 'บรรจุภัณฑ์เครื่องสำอาง', nameEn: 'Cosmetics packaging' },
  updateExample: { sort: 20 },
  toDto: (row: CategoryRow): ShowcaseCategoryDto => ({
    id: row.publicId,
    slug: row.slug,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateShowcaseCategoryDto) => ({ ...input }),
  updateData: (input: UpdateShowcaseCategoryDto) => compact({ ...input }),
  where: (q: ShowcaseCategoryListQuery) => compact({ status: q.status }),
  search: ['slug', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', slug: 'slug', updatedAt: 'updatedAt' },
  conflict: 'catalog.slug_taken',
});

// ------------------------------------------------------------------------------------------------

export const SHOWCASE_PRODUCT_INCLUDE = {
  category: { select: { publicId: true } },
  catalogProduct: { select: { publicId: true } },
  coverFile: { select: { publicId: true } },
} satisfies Prisma.ShowcaseProductInclude;
export type ShowcaseProductRow = Prisma.ShowcaseProductGetPayload<{
  include: typeof SHOWCASE_PRODUCT_INCLUDE;
}>;

export const showcaseProducts = defineResource({
  key: 'showcase_product',
  path: 'showcase-products',
  operation: 'catalogShowcaseProducts',
  area: 'catalog',
  label: 'showcase product',
  labelPlural: 'showcase products',
  implements: SHOWCASE,
  note: 'Pre-configured products ("Product Groups"): a catalogue product with a pre-filled configuration.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.showcaseProduct,
  include: SHOWCASE_PRODUCT_INCLUDE,
  dto: ShowcaseProductDto,
  createDto: CreateShowcaseProductDto,
  updateDto: UpdateShowcaseProductDto,
  queryDto: ShowcaseProductListQuery,
  example: {
    id: SHOWCASE_IDS.product,
    categoryId: SHOWCASE_IDS.category,
    catalogProductId: SHOWCASE_IDS.catalogProduct,
    slug: 'serum-box-30ml',
    nameTh: 'กล่องเซรั่ม 30 มล.',
    nameEn: 'Serum box 30 ml',
    descriptionTh: 'กล่องฝาเสียบ อาร์ตการ์ด 350 แกรม เคลือบด้าน',
    descriptionEn: null,
    coverFileId: SHOWCASE_IDS.file,
    preset: { lengthMm: 40, widthMm: 40, heightMm: 120 },
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    catalogProductId: SHOWCASE_IDS.catalogProduct,
    slug: 'serum-box-30ml',
    nameTh: 'กล่องเซรั่ม 30 มล.',
    nameEn: 'Serum box 30 ml',
    preset: { lengthMm: 40, widthMm: 40, heightMm: 120 },
  },
  updateExample: { status: 'active' },
  toDto: (row: ShowcaseProductRow): ShowcaseProductDto => ({
    id: row.publicId,
    categoryId: row.category?.publicId ?? null,
    catalogProductId: row.catalogProduct.publicId,
    slug: row.slug,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    descriptionTh: row.descriptionTh,
    descriptionEn: row.descriptionEn,
    coverFileId: row.coverFile?.publicId ?? null,
    preset: row.preset as Record<string, unknown>,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateShowcaseProductDto, refs) => ({
    ...input,
    preset: (input.preset ?? {}) as Prisma.InputJsonValue,
    categoryId: await refs.optional('showcaseCategory', input.categoryId, 'categoryId'),
    catalogProductId: await refs.id('catalogProduct', input.catalogProductId, 'catalogProductId'),
    coverFileId: await refs.optionalFile(input.coverFileId, 'coverFileId'),
  }),
  updateData: async (input: UpdateShowcaseProductDto, refs) =>
    compact({
      ...input,
      preset: input.preset as Prisma.InputJsonValue | undefined,
      categoryId: await refs.optional('showcaseCategory', input.categoryId, 'categoryId'),
      catalogProductId:
        input.catalogProductId === undefined
          ? undefined
          : await refs.id('catalogProduct', input.catalogProductId, 'catalogProductId'),
      coverFileId: await refs.optionalFile(input.coverFileId, 'coverFileId'),
    }),
  where: (q: ShowcaseProductListQuery) =>
    compact({
      status: q.status,
      category: q.categoryId ? { publicId: q.categoryId } : undefined,
      catalogProduct: q.catalogProductId ? { publicId: q.catalogProductId } : undefined,
    }),
  search: ['slug', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', slug: 'slug', updatedAt: 'updatedAt' },
  conflict: 'catalog.slug_taken',
});

// ------------------------------------------------------------------------------------------------

export const SEMI_DESIGN_INCLUDE = {
  catalogProduct: { select: { publicId: true } },
  thumbnailFile: { select: { publicId: true } },
  colours: { orderBy: { sort: 'asc' } },
} satisfies Prisma.SemiDesignInclude;
type SemiDesignRow = Prisma.SemiDesignGetPayload<{ include: typeof SEMI_DESIGN_INCLUDE }>;

export const semiDesigns = defineResource({
  key: 'semi_design',
  path: 'semi-designs',
  operation: 'catalogSemiDesigns',
  area: 'catalog',
  label: 'semi-design',
  labelPlural: 'semi-designs',
  implements: SHOWCASE,
  note: 'Semi-custom designs of a catalogue product; the palette is set through `PUT …/colours`.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.semiDesign,
  include: SEMI_DESIGN_INCLUDE,
  dto: SemiDesignDto,
  createDto: CreateSemiDesignDto,
  updateDto: UpdateSemiDesignDto,
  queryDto: SemiDesignListQuery,
  example: {
    id: SHOWCASE_IDS.semiDesign,
    catalogProductId: SHOWCASE_IDS.catalogProduct,
    name: 'มินิมอล ขาว-ดำ',
    thumbnailFileId: SHOWCASE_IDS.file,
    colours: ['#000000', '#FFFFFF'],
    status: 'active',
    updatedAt: TS,
  },
  createExample: { catalogProductId: SHOWCASE_IDS.catalogProduct, name: 'มินิมอล ขาว-ดำ' },
  updateExample: { status: 'active' },
  toDto: (row: SemiDesignRow): SemiDesignDto => ({
    id: row.publicId,
    catalogProductId: row.catalogProduct.publicId,
    name: row.name,
    thumbnailFileId: row.thumbnailFile?.publicId ?? null,
    colours: row.colours.map((c) => c.hex),
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateSemiDesignDto, refs) => ({
    ...input,
    catalogProductId: await refs.id('catalogProduct', input.catalogProductId, 'catalogProductId'),
    thumbnailFileId: await refs.optionalFile(input.thumbnailFileId, 'thumbnailFileId'),
  }),
  updateData: async (input: UpdateSemiDesignDto, refs) =>
    compact({ ...input, thumbnailFileId: await refs.optionalFile(input.thumbnailFileId, 'thumbnailFileId') }),
  where: (q: SemiDesignListQuery) =>
    compact({
      status: q.status,
      catalogProduct: q.catalogProductId ? { publicId: q.catalogProductId } : undefined,
    }),
  search: ['name'],
  sort: { name: 'name', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

export const TEMPLATE_INCLUDE = {
  semiDesign: { select: { publicId: true, catalogProductId: true } },
  standardSize: { select: { publicId: true } },
  thumbnailFile: { select: { publicId: true } },
  fonts: { include: { font: { select: { publicId: true } } } },
} satisfies Prisma.SemiDesignTemplateInclude;
type TemplateRow = Prisma.SemiDesignTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

/** A template's size must be a standard size of the semi-design's catalogue product. */
async function sizeOfSameProduct(refs: RefResolver, semiDesignId: bigint, standardSizePublicId: string) {
  const [design, size] = await Promise.all([
    refs.db.semiDesign.findUniqueOrThrow({ where: { id: semiDesignId }, select: { catalogProductId: true } }),
    refs.db.standardSize.findUnique({
      where: { publicId: standardSizePublicId },
      select: { id: true, catalogProductId: true },
    }),
  ]);
  if (!size || size.catalogProductId !== design.catalogProductId) {
    throw new DomainException('validation.failed', {
      errors: [
        {
          path: 'standardSizeId',
          code: 'sameProduct',
          message: 'standardSizeId is not a size of this product',
        },
      ],
    });
  }
  return size.id;
}

export const semiDesignTemplates = defineResource({
  key: 'semi_design_template',
  path: 'semi-design-templates',
  operation: 'catalogSemiDesignTemplates',
  area: 'catalog',
  label: 'semi-design template',
  labelPlural: 'semi-design templates',
  implements: SHOWCASE,
  note: 'One template per standard size of the semi-design; fonts are set through `PUT …/fonts`.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.semiDesignTemplate,
  include: TEMPLATE_INCLUDE,
  dto: SemiDesignTemplateDto,
  createDto: CreateSemiDesignTemplateDto,
  updateDto: UpdateSemiDesignTemplateDto,
  queryDto: SemiDesignTemplateListQuery,
  example: {
    id: SHOWCASE_IDS.template,
    semiDesignId: SHOWCASE_IDS.semiDesign,
    standardSizeId: SHOWCASE_IDS.standardSize,
    thumbnailFileId: SHOWCASE_IDS.file,
    fontIds: [SHOWCASE_IDS.font],
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    semiDesignId: SHOWCASE_IDS.semiDesign,
    standardSizeId: SHOWCASE_IDS.standardSize,
    thumbnailFileId: SHOWCASE_IDS.file,
  },
  updateExample: { status: 'active' },
  toDto: (row: TemplateRow): SemiDesignTemplateDto => ({
    id: row.publicId,
    semiDesignId: row.semiDesign.publicId,
    standardSizeId: row.standardSize.publicId,
    thumbnailFileId: row.thumbnailFile.publicId,
    fontIds: row.fonts.map((f) => f.font.publicId),
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateSemiDesignTemplateDto, refs) => {
    const semiDesignId = await refs.id('semiDesign', input.semiDesignId, 'semiDesignId');
    return {
      ...input,
      semiDesignId,
      standardSizeId: await sizeOfSameProduct(refs, semiDesignId, input.standardSizeId),
      thumbnailFileId: await refs.file(input.thumbnailFileId, 'thumbnailFileId'),
    };
  },
  updateData: async (input: UpdateSemiDesignTemplateDto, refs, current: TemplateRow) =>
    compact({
      ...input,
      standardSizeId:
        input.standardSizeId === undefined
          ? undefined
          : await sizeOfSameProduct(refs, current.semiDesignId, input.standardSizeId),
      thumbnailFileId:
        input.thumbnailFileId === undefined
          ? undefined
          : await refs.file(input.thumbnailFileId, 'thumbnailFileId'),
    }),
  where: (q: SemiDesignTemplateListQuery) =>
    compact({ status: q.status, semiDesign: q.semiDesignId ? { publicId: q.semiDesignId } : undefined }),
  search: [],
  sort: { updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

type FontRow = Prisma.DesignFontGetPayload<{ include: { fileObject: { select: { publicId: true } } } }>;

export const designFonts = defineResource({
  key: 'design_font',
  path: 'design-fonts',
  operation: 'catalogDesignFonts',
  area: 'catalog',
  label: 'design font',
  labelPlural: 'design fonts',
  implements: SHOWCASE,
  note: 'Fonts offered by semi-design templates; `licenceNote` records the licence that allows it.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.designFont,
  include: { fileObject: { select: { publicId: true } } },
  dto: DesignFontDto,
  createDto: CreateDesignFontDto,
  updateDto: UpdateDesignFontDto,
  queryDto: DesignFontListQuery,
  example: {
    id: SHOWCASE_IDS.font,
    name: 'Noto Sans Thai',
    fileId: SHOWCASE_IDS.file,
    licenceNote: 'SIL Open Font License 1.1',
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    name: 'Noto Sans Thai',
    fileId: SHOWCASE_IDS.file,
    licenceNote: 'SIL Open Font License 1.1',
  },
  updateExample: { status: 'active' },
  toDto: (row: FontRow): DesignFontDto => ({
    id: row.publicId,
    name: row.name,
    fileId: row.fileObject.publicId,
    licenceNote: row.licenceNote,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateDesignFontDto, refs) => ({
    name: input.name,
    licenceNote: input.licenceNote,
    status: input.status,
    fileObjectId: await refs.file(input.fileId, 'fileId'),
  }),
  updateData: async (input: UpdateDesignFontDto, refs) =>
    compact({
      name: input.name,
      licenceNote: input.licenceNote,
      status: input.status,
      fileObjectId: input.fileId === undefined ? undefined : await refs.file(input.fileId, 'fileId'),
    }),
  where: (q: DesignFontListQuery) => compact({ status: q.status }),
  search: ['name'],
  sort: { name: 'name', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
