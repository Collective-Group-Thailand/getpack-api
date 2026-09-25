import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import { num } from '../crud/dto-fields';
import {
  CreateStockAttributeValueDto,
  CreateStockProductDto,
  STOCK_IDS,
  StockAttributeValueDto,
  StockAttributeValueListQuery,
  StockProductDto,
  StockProductListQuery,
  UpdateStockAttributeValueDto,
  UpdateStockProductDto,
} from './stock.dto';

const TS = '2026-09-25T10:00:00+07:00';

type ValueRow = Prisma.StockAttributeValueGetPayload<object>;

export const stockAttributeValues = defineResource({
  key: 'stock_attribute_value',
  path: 'stock-attribute-values',
  operation: 'catalogStockAttributeValues',
  area: 'catalog',
  label: 'stock attribute value',
  labelPlural: 'stock attribute values',
  implements: ['D-100', 'D-005'],
  note: 'Values of the stock-product attributes (material, type, shape, shoulder, neck, colour, size, cap type).',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.stockAttributeValue,
  dto: StockAttributeValueDto,
  createDto: CreateStockAttributeValueDto,
  updateDto: UpdateStockAttributeValueDto,
  queryDto: StockAttributeValueListQuery,
  example: {
    id: STOCK_IDS.value,
    attribute: 'colour',
    code: 'clear',
    nameTh: 'ใส',
    nameEn: 'Clear',
    sort: 10,
    status: 'active',
    updatedAt: TS,
  },
  createExample: { attribute: 'colour', code: 'clear', nameTh: 'ใส', nameEn: 'Clear' },
  updateExample: { nameEn: 'Transparent' },
  toDto: (row: ValueRow): StockAttributeValueDto => ({
    id: row.publicId,
    attribute: row.attribute,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    sort: row.sort,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateStockAttributeValueDto) => ({ ...input }),
  updateData: (input: UpdateStockAttributeValueDto) => compact({ ...input }),
  where: (q: StockAttributeValueListQuery) => compact({ attribute: q.attribute, status: q.status }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { sort: 'sort', code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

export const STOCK_PRODUCT_INCLUDE = {
  productType: { select: { publicId: true } },
  seoPage: { select: { publicId: true } },
  attributes: {
    include: { value: { select: { publicId: true, code: true } } },
    orderBy: { attribute: 'asc' },
  },
  images: { include: { fileObject: { select: { publicId: true } } }, orderBy: { sort: 'asc' } },
} satisfies Prisma.StockProductInclude;
export type StockProductRow = Prisma.StockProductGetPayload<{ include: typeof STOCK_PRODUCT_INCLUDE }>;

export const stockProductDto = (row: StockProductRow): StockProductDto => ({
  id: row.publicId,
  productTypeId: row.productType.publicId,
  sku: row.sku,
  nameTh: row.nameTh,
  nameEn: row.nameEn,
  description: row.description,
  unit: row.unit,
  capacityMl: num(row.capacityMl),
  lengthMm: num(row.lengthMm),
  widthMm: num(row.widthMm),
  heightMm: num(row.heightMm),
  weightG: num(row.weightG),
  minOrderQty: row.minOrderQty,
  isFoodGrade: row.isFoodGrade,
  seoPageId: row.seoPage?.publicId ?? null,
  status: row.status,
  attributes: row.attributes.map((a) => ({
    attribute: a.attribute,
    valueId: a.value.publicId,
    valueCode: a.value.code,
  })),
  images: row.images.map((i) => ({ id: i.publicId, fileId: i.fileObject.publicId, sort: i.sort })),
  updatedAt: toBangkokIso(row.updatedAt),
});

export const STOCK_PRODUCT_EXAMPLE: StockProductDto = {
  id: STOCK_IDS.product,
  productTypeId: STOCK_IDS.productType,
  sku: 'PKO-BTL-0250',
  nameTh: 'ขวด PET 250 มล.',
  nameEn: 'PET bottle 250 ml',
  description: 'ขวดใส ฝาเกลียว 28 มม.',
  unit: 'piece',
  capacityMl: 250,
  lengthMm: 60,
  widthMm: 60,
  heightMm: 150,
  weightG: 22.5,
  minOrderQty: 100,
  isFoodGrade: true,
  seoPageId: null,
  status: 'active',
  attributes: [{ attribute: 'colour', valueId: STOCK_IDS.value, valueCode: 'clear' }],
  images: [{ id: STOCK_IDS.image, fileId: STOCK_IDS.file, sort: 0 }],
  updatedAt: TS,
};

export const stockProducts = defineResource({
  key: 'stock_product',
  path: 'stock-products',
  operation: 'catalogStockProducts',
  area: 'catalog',
  label: 'stock product',
  labelPlural: 'stock products',
  implements: ['D-100', 'D-005', 'D-044'],
  note:
    'Ready-made products. No prices here: buy prices are factory price-list lines and stock is held ' +
    'per factory (schema-design §3.3). Attributes and images are edited through their sub-resources.',
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.stockProduct,
  include: STOCK_PRODUCT_INCLUDE,
  dto: StockProductDto,
  createDto: CreateStockProductDto,
  updateDto: UpdateStockProductDto,
  queryDto: StockProductListQuery,
  example: STOCK_PRODUCT_EXAMPLE,
  createExample: {
    productTypeId: STOCK_IDS.productType,
    sku: 'PKO-BTL-0250',
    nameTh: 'ขวด PET 250 มล.',
    nameEn: 'PET bottle 250 ml',
    unit: 'piece',
    capacityMl: 250,
    minOrderQty: 100,
  },
  updateExample: { minOrderQty: 200 },
  toDto: stockProductDto,
  createData: async (input: CreateStockProductDto, refs) => ({
    ...input,
    productTypeId: await refs.id('productType', input.productTypeId, 'productTypeId'),
    seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
  }),
  updateData: async (input: UpdateStockProductDto, refs) =>
    compact({
      ...input,
      productTypeId:
        input.productTypeId === undefined
          ? undefined
          : await refs.id('productType', input.productTypeId, 'productTypeId'),
      seoPageId: await refs.optional('seoPage', input.seoPageId, 'seoPageId'),
    }),
  where: (q: StockProductListQuery) =>
    compact({
      status: q.status,
      productType: q.productTypeId ? { publicId: q.productTypeId } : undefined,
      attributes: q.attributeValueId ? { some: { value: { publicId: q.attributeValueId } } } : undefined,
    }),
  search: ['sku', 'nameTh', 'nameEn'],
  sort: { sku: 'sku', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
