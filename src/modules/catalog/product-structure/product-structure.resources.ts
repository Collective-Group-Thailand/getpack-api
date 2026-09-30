import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { defineResource } from '../crud/catalog-resource';
import { compact, jsonField } from '../crud/compact';
import { num } from '../crud/dto-fields';
import { CONTENT_INCLUDE, contentImage, contentView } from '../crud/option-content';
import { optionKey, type OptionPublicIds, optionPublicIds } from './option-refs';
import {
  CatalogProductDto,
  CatalogProductListQuery,
  CreateCatalogProductDto,
  CreatePatternDto,
  CreatePrintTypeDto,
  CreateProductCategoryDto,
  CreateProductTypeDto,
  CreateStandardSizeDto,
  CreateSubPatternDto,
  EXAMPLE_IDS,
  PatternDto,
  PatternListQuery,
  PrintTypeDto,
  PrintTypeListQuery,
  ProductCategoryDto,
  ProductCategoryListQuery,
  ProductTypeDto,
  ProductTypeListQuery,
  StandardSizeDto,
  StandardSizeListQuery,
  SubPatternDto,
  SubPatternListQuery,
  UpdateCatalogProductDto,
  UpdatePatternDto,
  UpdatePrintTypeDto,
  UpdateProductCategoryDto,
  UpdateProductTypeDto,
  UpdateStandardSizeDto,
  UpdateSubPatternDto,
} from './product-structure.dto';

const TS = '2026-09-25T10:00:00+07:00';
const CATALOG = ['D-100', 'D-005'];

// ------------------------------------------------------------------------------------------------

const CATEGORY_INCLUDE = { parent: { select: { publicId: true } } } satisfies Prisma.ProductCategoryInclude;
type CategoryRow = Prisma.ProductCategoryGetPayload<{ include: typeof CATEGORY_INCLUDE }>;

export const productCategories = defineResource({
  key: 'product_category',
  path: 'product-categories',
  operation: 'catalogProductCategories',
  area: 'catalog',
  label: 'product category',
  labelPlural: 'product categories',
  implements: ['D-030', 'D-100'],
  note: 'Packio reporting categories (they replace the legacy PH1–PH6 hierarchy, D-030).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.productCategory,
  include: CATEGORY_INCLUDE,
  dto: ProductCategoryDto,
  createDto: CreateProductCategoryDto,
  updateDto: UpdateProductCategoryDto,
  queryDto: ProductCategoryListQuery,
  example: {
    id: EXAMPLE_IDS.category,
    code: 'folding_carton',
    nameTh: 'กล่องกระดาษแข็ง',
    nameEn: 'Folding cartons',
    parentId: null,
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'folding_carton', nameTh: 'กล่องกระดาษแข็ง', nameEn: 'Folding cartons', sort: 10 },
  updateExample: { nameEn: 'Folding carton boxes' },
  toDto: (row: CategoryRow): ProductCategoryDto => ({
    id: row.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    parentId: row.parent?.publicId ?? null,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateProductCategoryDto, refs) => ({
    code: input.code,
    nameTh: input.nameTh,
    nameEn: input.nameEn,
    parentId: await refs.optional('productCategory', input.parentId, 'parentId'),
    sort: input.sort,
    status: input.status,
  }),
  updateData: async (input: UpdateProductCategoryDto, refs) =>
    compact({
      code: input.code,
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      parentId: await refs.optional('productCategory', input.parentId, 'parentId'),
      sort: input.sort,
      status: input.status,
    }),
  where: (q: ProductCategoryListQuery) => compact({ status: q.status }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

const TYPE_INCLUDE = { category: { select: { publicId: true } } } satisfies Prisma.ProductTypeInclude;
type TypeRow = Prisma.ProductTypeGetPayload<{ include: typeof TYPE_INCLUDE }>;

export const productTypeDto = (row: TypeRow): ProductTypeDto => ({
  id: row.publicId,
  code: row.code,
  categoryId: row.category.publicId,
  nameTh: row.nameTh,
  nameEn: row.nameEn,
  quoteMode: row.quoteMode,
  calculatorKey: row.calculatorKey,
  isFoodContactDefault: row.isFoodContactDefault,
  rfqSpecSchema: (row.rfqSpecSchema as Record<string, unknown> | null) ?? null,
  sort: row.sort,
  status: row.status,
  updatedAt: toBangkokIso(row.updatedAt),
});

export const PRODUCT_TYPE_EXAMPLE: ProductTypeDto = {
  id: EXAMPLE_IDS.productType,
  code: 'folding_carton',
  categoryId: EXAMPLE_IDS.category,
  nameTh: 'กล่องกระดาษแข็ง',
  nameEn: 'Folding carton',
  quoteMode: 'rfq',
  calculatorKey: 'folding',
  isFoodContactDefault: false,
  rfqSpecSchema: null,
  sort: 10,
  status: 'active',
  updatedAt: TS,
};

export const productTypes = defineResource({
  key: 'product_type',
  path: 'product-types',
  operation: 'catalogProductTypes',
  area: 'catalog',
  label: 'product type',
  labelPlural: 'product types',
  implements: ['D-100', 'D-043'],
  note:
    'The 7 instant types and the RFQ categories of D-100. New types start as `rfq`; ' +
    '`quoteMode` changes only through `actions/change-quote-mode`.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.productType,
  include: TYPE_INCLUDE,
  dto: ProductTypeDto,
  createDto: CreateProductTypeDto,
  updateDto: UpdateProductTypeDto,
  queryDto: ProductTypeListQuery,
  example: PRODUCT_TYPE_EXAMPLE,
  createExample: {
    code: 'paper_bag',
    categoryId: EXAMPLE_IDS.category,
    nameTh: 'ถุงกระดาษ',
    nameEn: 'Paper bag',
    calculatorKey: null,
  },
  updateExample: { nameEn: 'Paper bags' },
  toDto: productTypeDto,
  createData: async (input: CreateProductTypeDto, refs) => ({
    code: input.code,
    categoryId: await refs.id('productCategory', input.categoryId, 'categoryId'),
    nameTh: input.nameTh,
    nameEn: input.nameEn,
    quoteMode: 'rfq',
    calculatorKey: input.calculatorKey ?? null,
    isFoodContactDefault: input.isFoodContactDefault,
    rfqSpecSchema: jsonField(input.rfqSpecSchema),
    sort: input.sort,
    status: input.status,
  }),
  updateData: async (input: UpdateProductTypeDto, refs) =>
    compact({
      categoryId:
        input.categoryId === undefined
          ? undefined
          : await refs.id('productCategory', input.categoryId, 'categoryId'),
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      calculatorKey: input.calculatorKey,
      isFoodContactDefault: input.isFoodContactDefault,
      rfqSpecSchema: jsonField(input.rfqSpecSchema),
      sort: input.sort,
      status: input.status,
    }),
  where: (q: ProductTypeListQuery) => compact({ status: q.status, quoteMode: q.quoteMode }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

const PRINT_INCLUDE = { productType: { select: { publicId: true } } } satisfies Prisma.PrintTypeInclude;
type PrintRow = Prisma.PrintTypeGetPayload<{ include: typeof PRINT_INCLUDE }>;

export const printTypes = defineResource({
  key: 'print_type',
  path: 'print-types',
  operation: 'catalogPrintTypes',
  area: 'catalog',
  label: 'print type',
  labelPlural: 'print types',
  implements: CATALOG,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.printType,
  include: PRINT_INCLUDE,
  dto: PrintTypeDto,
  createDto: CreatePrintTypeDto,
  updateDto: UpdatePrintTypeDto,
  queryDto: PrintTypeListQuery,
  example: {
    id: EXAMPLE_IDS.printType,
    code: 'folding_offset',
    productTypeId: EXAMPLE_IDS.productType,
    nameTh: 'ออฟเซ็ท',
    nameEn: 'Offset',
    canChargePlateAndDie: false,
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    code: 'folding_offset',
    productTypeId: EXAMPLE_IDS.productType,
    nameTh: 'ออฟเซ็ท',
    nameEn: 'Offset',
  },
  updateExample: { canChargePlateAndDie: true },
  toDto: (row: PrintRow): PrintTypeDto => ({
    id: row.publicId,
    code: row.code,
    productTypeId: row.productType.publicId,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    canChargePlateAndDie: row.canChargePlateAndDie,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreatePrintTypeDto, refs) => ({
    code: input.code,
    productTypeId: await refs.id('productType', input.productTypeId, 'productTypeId'),
    nameTh: input.nameTh,
    nameEn: input.nameEn,
    canChargePlateAndDie: input.canChargePlateAndDie,
    sort: input.sort,
    status: input.status,
  }),
  updateData: async (input: UpdatePrintTypeDto, refs) =>
    compact({
      code: input.code,
      productTypeId:
        input.productTypeId === undefined
          ? undefined
          : await refs.id('productType', input.productTypeId, 'productTypeId'),
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      canChargePlateAndDie: input.canChargePlateAndDie,
      sort: input.sort,
      status: input.status,
    }),
  where: (q: PrintTypeListQuery) =>
    compact({ status: q.status, productType: q.productTypeId ? { publicId: q.productTypeId } : undefined }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

export const CATALOG_PRODUCT_INCLUDE = {
  productType: { select: { publicId: true } },
  seoPage: { select: { publicId: true } },
  defaultDifficultyLevel: { select: { publicId: true } },
  patterns: { include: { pattern: { select: { publicId: true, code: true } } }, orderBy: { sort: 'asc' } },
  options: { orderBy: [{ sort: 'asc' }, { optionKind: 'asc' }] },
  images: { include: { fileObject: { select: { publicId: true } } }, orderBy: { sort: 'asc' } },
} satisfies Prisma.CatalogProductInclude;
export type CatalogProductRow = Prisma.CatalogProductGetPayload<{ include: typeof CATALOG_PRODUCT_INCLUDE }>;

/** Options reference rows of several tables by internal id; `optionIds` carries their public ids. */
export function catalogProductDto(row: CatalogProductRow, optionIds: OptionPublicIds): CatalogProductDto {
  return {
    id: row.publicId,
    productTypeId: row.productType.publicId,
    slug: row.slug,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    descriptionTh: row.descriptionTh,
    descriptionEn: row.descriptionEn,
    isCombination: row.isCombination,
    templateAvailability: row.templateAvailability,
    videoUrl: row.videoUrl,
    seoPageId: row.seoPage?.publicId ?? null,
    defaultDifficultyLevelId: row.defaultDifficultyLevel?.publicId ?? null,
    quantityMin: row.quantityMin,
    quantityMax: row.quantityMax,
    quantityDefault: row.quantityDefault,
    quantityPresets: [...(row.quantityPresets ?? [])].sort((a, b) => a - b),
    referenceConfiguration: (row.referenceConfiguration as Record<string, unknown> | null) ?? null,
    sort: row.sort,
    status: row.status,
    patterns: row.patterns.map((p) => ({
      patternId: p.pattern.publicId,
      patternCode: p.pattern.code,
      factorNw: num(p.factorNw),
      factorNl: num(p.factorNl),
      factorNd: num(p.factorNd),
      sort: p.sort,
    })),
    options: row.options
      .map((o) => ({
        kind: o.optionKind,
        optionId: optionIds.get(optionKey(o.optionKind, o.optionId)) ?? '',
        isDefault: o.isDefault,
        sort: o.sort,
      }))
      .filter((o) => o.optionId !== ''),
    images: row.images.map((i) => ({
      id: i.publicId,
      fileId: i.fileObject.publicId,
      variant: (i.variant as Record<string, unknown> | null) ?? null,
      sort: i.sort,
    })),
    updatedAt: toBangkokIso(row.updatedAt),
  };
}

export const CATALOG_PRODUCT_EXAMPLE: CatalogProductDto = {
  id: EXAMPLE_IDS.catalogProduct,
  productTypeId: EXAMPLE_IDS.productType,
  slug: 'tuck-end-box',
  nameTh: 'กล่องฝาเสียบ',
  nameEn: 'Tuck-end box',
  descriptionTh: 'กล่องพับฝาเสียบบน-ล่าง',
  descriptionEn: 'Reverse tuck-end folding box',
  isCombination: false,
  templateAvailability: 'drawing',
  videoUrl: null,
  seoPageId: null,
  defaultDifficultyLevelId: null,
  quantityMin: null,
  quantityMax: null,
  quantityDefault: null,
  quantityPresets: [],
  referenceConfiguration: null,
  sort: 10,
  status: 'active',
  patterns: [
    { patternId: EXAMPLE_IDS.pattern, patternCode: 'RTE-01', factorNw: 1, factorNl: 1, factorNd: 1, sort: 0 },
  ],
  options: [{ kind: 'material', optionId: EXAMPLE_IDS.material, isDefault: true, sort: 0 }],
  images: [
    { id: EXAMPLE_IDS.image, fileId: EXAMPLE_IDS.file, variant: { material: 'art-card-350' }, sort: 0 },
  ],
  updatedAt: TS,
};

interface QuantityInput {
  quantityMin?: number | null;
  quantityMax?: number | null;
  quantityDefault?: number | null;
  quantityPresets?: number[];
}

/**
 * The configurator's quantity limits (U-B0.1): min ≤ default ≤ max and presets within them, each once
 * (DB check `ck_catalog_products__quantity_limits` → 422 here, not 500). Returns the columns to write.
 */
function quantityRules(input: QuantityInput, current?: QuantityInput) {
  const pick = <K extends keyof QuantityInput>(k: K) => (input[k] !== undefined ? input[k] : current?.[k]);
  const min = pick('quantityMin') ?? null;
  const max = pick('quantityMax') ?? null;
  const preset = pick('quantityDefault') ?? null;
  const presets = pick('quantityPresets') ?? [];
  const fail = (path: string, message: string): never => {
    throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
  };
  if (min !== null && max !== null && max < min) fail('quantityMax', 'quantityMax must not be below quantityMin');
  const inRange = (n: number) => (min === null || n >= min) && (max === null || n <= max);
  if (preset !== null && !inRange(preset)) fail('quantityDefault', 'quantityDefault must be within min and max');
  if (new Set(presets).size !== presets.length) fail('quantityPresets', 'quantityPresets lists a value twice');
  const outside = presets.findIndex((n) => !inRange(n));
  if (outside >= 0) fail(`quantityPresets[${outside}]`, 'every preset must be within min and max');
  return {
    quantityMin: input.quantityMin,
    quantityMax: input.quantityMax,
    quantityDefault: input.quantityDefault,
    quantityPresets: input.quantityPresets ? [...input.quantityPresets].sort((a, b) => a - b) : undefined,
  };
}

export const catalogProducts = defineResource({
  key: 'catalog_product',
  path: 'catalog-products',
  operation: 'catalogProducts',
  area: 'catalog',
  label: 'catalogue product',
  labelPlural: 'catalogue products',
  implements: CATALOG,
  note: 'The customer-facing product (legacy `mapping_inputs`); patterns, options and images are edited through their sub-resources.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.catalogProduct,
  include: CATALOG_PRODUCT_INCLUDE,
  dto: CatalogProductDto,
  createDto: CreateCatalogProductDto,
  updateDto: UpdateCatalogProductDto,
  queryDto: CatalogProductListQuery,
  example: CATALOG_PRODUCT_EXAMPLE,
  createExample: {
    productTypeId: EXAMPLE_IDS.productType,
    slug: 'tuck-end-box',
    nameTh: 'กล่องฝาเสียบ',
    nameEn: 'Tuck-end box',
    templateAvailability: 'drawing',
  },
  updateExample: { status: 'active' },
  context: (rows: CatalogProductRow[], db) =>
    optionPublicIds(
      db,
      rows.flatMap((row) => row.options),
    ),
  toDto: catalogProductDto,
  createData: async (input: CreateCatalogProductDto, refs) => ({
    ...quantityRules(input),
    productTypeId: await refs.id('productType', input.productTypeId, 'productTypeId'),
    slug: input.slug,
    nameTh: input.nameTh,
    nameEn: input.nameEn,
    descriptionTh: input.descriptionTh ?? null,
    descriptionEn: input.descriptionEn ?? null,
    isCombination: input.isCombination,
    templateAvailability: input.templateAvailability,
    videoUrl: input.videoUrl ?? null,
    seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
    defaultDifficultyLevelId: await refs.optional(
      'difficultyLevel',
      input.defaultDifficultyLevelId,
      'defaultDifficultyLevelId',
    ),
    sort: input.sort,
    status: input.status,
  }),
  updateData: async (input: UpdateCatalogProductDto, refs, current: CatalogProductRow) =>
    compact({
      ...quantityRules(input, current),
      productTypeId:
        input.productTypeId === undefined
          ? undefined
          : await refs.id('productType', input.productTypeId, 'productTypeId'),
      slug: input.slug,
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      descriptionTh: input.descriptionTh,
      descriptionEn: input.descriptionEn,
      isCombination: input.isCombination,
      templateAvailability: input.templateAvailability,
      videoUrl: input.videoUrl,
      seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
      defaultDifficultyLevelId: await refs.optional(
        'difficultyLevel',
        input.defaultDifficultyLevelId,
        'defaultDifficultyLevelId',
      ),
      sort: input.sort,
      status: input.status,
    }),
  where: (q: CatalogProductListQuery) =>
    compact({ status: q.status, productType: q.productTypeId ? { publicId: q.productTypeId } : undefined }),
  search: ['slug', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', slug: 'slug', updatedAt: 'updatedAt' },
  conflict: 'catalog.slug_taken',
});

// ------------------------------------------------------------------------------------------------

const SIZE_INCLUDE = {
  catalogProduct: { select: { publicId: true } },
  calcFluteType: { select: { publicId: true } },
} satisfies Prisma.StandardSizeInclude;
type SizeRow = Prisma.StandardSizeGetPayload<{ include: typeof SIZE_INCLUDE }>;

export const standardSizes = defineResource({
  key: 'standard_size',
  path: 'standard-sizes',
  operation: 'catalogStandardSizes',
  area: 'catalog',
  label: 'standard size',
  labelPlural: 'standard sizes',
  implements: CATALOG,
  note: 'Sizes offered for a catalogue product; `calc*` are the dimensions the calculator uses (legacy `*_for_calculate`).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.standardSize,
  include: SIZE_INCLUDE,
  dto: StandardSizeDto,
  createDto: CreateStandardSizeDto,
  updateDto: UpdateStandardSizeDto,
  queryDto: StandardSizeListQuery,
  example: {
    id: EXAMPLE_IDS.standardSize,
    catalogProductId: EXAMPLE_IDS.catalogProduct,
    code: 'S',
    name: 'ขนาดเล็ก 10×10×5 ซม.',
    lengthMm: 100,
    widthMm: 100,
    heightMm: 50,
    calcLengthMm: null,
    calcWidthMm: null,
    calcHeightMm: null,
    calcFluteTypeId: null,
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    catalogProductId: EXAMPLE_IDS.catalogProduct,
    code: 'S',
    name: 'ขนาดเล็ก 10×10×5 ซม.',
    lengthMm: 100,
    widthMm: 100,
    heightMm: 50,
  },
  updateExample: { heightMm: 60 },
  toDto: (row: SizeRow): StandardSizeDto => ({
    id: row.publicId,
    catalogProductId: row.catalogProduct.publicId,
    code: row.code,
    name: row.name,
    lengthMm: row.lengthMm.toNumber(),
    widthMm: row.widthMm.toNumber(),
    heightMm: row.heightMm.toNumber(),
    calcLengthMm: num(row.calcLengthMm),
    calcWidthMm: num(row.calcWidthMm),
    calcHeightMm: num(row.calcHeightMm),
    calcFluteTypeId: row.calcFluteType?.publicId ?? null,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateStandardSizeDto, refs) => ({
    catalogProductId: await refs.id('catalogProduct', input.catalogProductId, 'catalogProductId'),
    code: input.code,
    name: input.name,
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    calcLengthMm: input.calcLengthMm ?? null,
    calcWidthMm: input.calcWidthMm ?? null,
    calcHeightMm: input.calcHeightMm ?? null,
    calcFluteTypeId: await refs.optional('fluteType', input.calcFluteTypeId, 'calcFluteTypeId'),
    sort: input.sort,
    status: input.status,
  }),
  updateData: async (input: UpdateStandardSizeDto, refs) =>
    compact({
      ...input,
      calcFluteTypeId:
        input.calcFluteTypeId === undefined
          ? undefined
          : await refs.optional('fluteType', input.calcFluteTypeId, 'calcFluteTypeId'),
    }),
  where: (q: StandardSizeListQuery) =>
    compact({
      status: q.status,
      catalogProduct: q.catalogProductId ? { publicId: q.catalogProductId } : undefined,
    }),
  search: ['code', 'name'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

/** A pattern or part is priced by at most one calculator (DB check `ck_*__one_formula`, A-49) → 422, not 500. */
function oneFormula(
  input: { geometryFormula?: unknown; corrugateFormula?: unknown },
  current?: { geometryFormula: unknown; corrugateFormula: unknown },
): void {
  const geometry = input.geometryFormula !== undefined ? input.geometryFormula : current?.geometryFormula;
  const corrugate = input.corrugateFormula !== undefined ? input.corrugateFormula : current?.corrugateFormula;
  if (geometry != null && corrugate != null) {
    throw new DomainException('validation.failed', {
      errors: [
        {
          path: 'corrugateFormula',
          code: 'invalid',
          message: 'set either geometryFormula (folding) or corrugateFormula (corrugate), not both',
        },
      ],
    });
  }
}

const PATTERN_INCLUDE = {
  ...CONTENT_INCLUDE,
  productType: { select: { publicId: true } },
  fluteTypes: { include: { fluteType: { select: { publicId: true } } } },
} satisfies Prisma.PatternInclude;
type PatternRow = Prisma.PatternGetPayload<{ include: typeof PATTERN_INCLUDE }>;

export const patterns = defineResource({
  key: 'pattern',
  path: 'patterns',
  operation: 'catalogPatterns',
  area: 'catalog',
  label: 'pattern',
  labelPlural: 'patterns',
  implements: CATALOG,
  note: 'Box styles; size constraints and geometry are indicative until each calculator is ported (B2.3).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.pattern,
  include: PATTERN_INCLUDE,
  dto: PatternDto,
  createDto: CreatePatternDto,
  updateDto: UpdatePatternDto,
  queryDto: PatternListQuery,
  example: {
    id: EXAMPLE_IDS.pattern,
    descriptionTh: null,
    descriptionEn: null,
    imageFileId: null,
    productTypeId: EXAMPLE_IDS.productType,
    code: 'RTE-01',
    name: 'ฝาเสียบกลับด้าน',
    technicalName: 'Reverse tuck end',
    patternKind: null,
    constraints: { minW: 30, maxW: 500 },
    dielineKey: 'rte',
    geometryFormula: 'tuck_top',
    corrugateFormula: null,
    fluteTypeIds: [EXAMPLE_IDS.fluteType],
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    productTypeId: EXAMPLE_IDS.productType,
    code: 'RTE-01',
    name: 'ฝาเสียบกลับด้าน',
    constraints: { minW: 30, maxW: 500 },
  },
  updateExample: { dielineKey: 'rte' },
  toDto: (row: PatternRow): PatternDto => ({
    id: row.publicId,
    ...contentView(row),
    productTypeId: row.productType.publicId,
    code: row.code,
    name: row.name,
    technicalName: row.technicalName,
    patternKind: row.patternKind,
    constraints: row.constraints as Record<string, unknown>,
    dielineKey: row.dielineKey,
    geometryFormula: row.geometryFormula,
    corrugateFormula: row.corrugateFormula,
    fluteTypeIds: row.fluteTypes.map((f) => f.fluteType.publicId),
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreatePatternDto, refs) => {
    oneFormula(input);
    return {
      productTypeId: await refs.id('productType', input.productTypeId, 'productTypeId'),
      code: input.code,
      name: input.name,
      technicalName: input.technicalName ?? null,
      patternKind: input.patternKind ?? null,
      constraints: (input.constraints ?? {}) as Prisma.InputJsonValue,
      dielineKey: input.dielineKey ?? null,
      geometryFormula: input.geometryFormula ?? null,
      corrugateFormula: input.corrugateFormula ?? null,
      descriptionTh: input.descriptionTh ?? null,
      descriptionEn: input.descriptionEn ?? null,
      ...(await contentImage(refs, input)),
      status: input.status,
    };
  },
  updateData: async (input: UpdatePatternDto, refs, current) => {
    oneFormula(input, current);
    return compact({
      productTypeId:
        input.productTypeId === undefined
          ? undefined
          : await refs.id('productType', input.productTypeId, 'productTypeId'),
      code: input.code,
      name: input.name,
      technicalName: input.technicalName,
      patternKind: input.patternKind,
      constraints: input.constraints as Prisma.InputJsonValue | undefined,
      dielineKey: input.dielineKey,
      geometryFormula: input.geometryFormula,
      corrugateFormula: input.corrugateFormula,
      descriptionTh: input.descriptionTh,
      descriptionEn: input.descriptionEn,
      ...(await contentImage(refs, input)),
      status: input.status,
    });
  },
  where: (q: PatternListQuery) =>
    compact({ status: q.status, productType: q.productTypeId ? { publicId: q.productTypeId } : undefined }),
  search: ['code', 'name', 'technicalName'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

const SUB_PATTERN_INCLUDE = { pattern: { select: { publicId: true } } } satisfies Prisma.SubPatternInclude;
type SubPatternRow = Prisma.SubPatternGetPayload<{ include: typeof SUB_PATTERN_INCLUDE }>;

export const subPatterns = defineResource({
  key: 'sub_pattern',
  path: 'sub-patterns',
  operation: 'catalogSubPatterns',
  area: 'catalog',
  label: 'sub-pattern',
  labelPlural: 'sub-patterns',
  implements: CATALOG,
  note: 'Parts of a pattern (geometry factors indicative, fixed by the calculator ports).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.subPattern,
  include: SUB_PATTERN_INCLUDE,
  dto: SubPatternDto,
  createDto: CreateSubPatternDto,
  updateDto: UpdateSubPatternDto,
  queryDto: SubPatternListQuery,
  example: {
    id: EXAMPLE_IDS.subPattern,
    patternId: EXAMPLE_IDS.pattern,
    seq: 1,
    name: 'ตัวกล่อง',
    dl: 1,
    dw: 1,
    dh: 1,
    nl: 2,
    nw: 2,
    nh: 1,
    conditions: null,
    geometryFormula: null,
    corrugateFormula: 'tele_body',
    swapDimensions: false,
    updatedAt: TS,
  },
  createExample: { patternId: EXAMPLE_IDS.pattern, seq: 1, name: 'ตัวกล่อง', nl: 2, nw: 2, nh: 1 },
  updateExample: { name: 'ตัวกล่องหลัก' },
  toDto: (row: SubPatternRow): SubPatternDto => ({
    id: row.publicId,
    patternId: row.pattern.publicId,
    seq: row.seq,
    name: row.name,
    dl: num(row.dl),
    dw: num(row.dw),
    dh: num(row.dh),
    nl: num(row.nl),
    nw: num(row.nw),
    nh: num(row.nh),
    conditions: (row.conditions as Record<string, unknown> | null) ?? null,
    geometryFormula: row.geometryFormula,
    corrugateFormula: row.corrugateFormula,
    swapDimensions: row.swapDimensions,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateSubPatternDto, refs) => {
    oneFormula(input);
    return {
      patternId: await refs.id('pattern', input.patternId, 'patternId'),
      seq: input.seq,
      name: input.name,
      dl: input.dl ?? null,
      dw: input.dw ?? null,
      dh: input.dh ?? null,
      nl: input.nl ?? null,
      nw: input.nw ?? null,
      nh: input.nh ?? null,
      conditions: jsonField(input.conditions),
      geometryFormula: input.geometryFormula ?? null,
      corrugateFormula: input.corrugateFormula ?? null,
      swapDimensions: input.swapDimensions,
    };
  },
  updateData: (input: UpdateSubPatternDto, _refs, current) => {
    oneFormula(input, current);
    return compact({ ...input, conditions: jsonField(input.conditions) });
  },
  where: (q: SubPatternListQuery) =>
    compact({ pattern: q.patternId ? { publicId: q.patternId } : undefined }),
  search: ['name'],
  sort: { seq: 'seq', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
