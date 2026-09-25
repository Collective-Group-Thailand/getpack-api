import { type Tx } from '@database/prisma.service';

import { CATALOG_CODE, CATALOG_STATUSES, SLUG } from '../crud/dto-fields';
import { FINISH_KINDS, INK_COLOUR_KINDS, MATERIAL_KINDS } from '../materials/materials.dto';
import { PRODUCT_UNITS, STOCK_ATTRIBUTES } from '../stock/stock.dto';
import {
  type ColumnSpec,
  type ImportKind,
  type KeyedTable,
  type ParsedRow,
  type SheetSpec,
} from './import-engine';
import { byColumn, tableSheet } from './table-sheet';

type Row = Record<string, unknown>;
const table = (pick: (db: Tx) => unknown) => pick as (db: Tx) => never;
const keyed = (pick: (db: Tx) => unknown) => pick as (db: Tx) => KeyedTable;

// --- column helpers --------------------------------------------------------------------------
const code = (header = 'code', pattern: RegExp = CATALOG_CODE, field = 'code'): ColumnSpec => ({
  header,
  field,
  type: 'text',
  required: true,
  max: 64,
  pattern,
});
const text = (header: string, field: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({
  header,
  field,
  type: 'text',
  max: 200,
  ...o,
});
const nameTh = text('name_th', 'nameTh', { required: true });
const nameEn = text('name_en', 'nameEn', { required: true });
const status: ColumnSpec = { header: 'status', field: 'status', type: 'enum', values: CATALOG_STATUSES };
const sort: ColumnSpec = { header: 'sort', field: 'sort', type: 'int' };
const bool = (header: string, field: string): ColumnSpec => ({ header, field, type: 'bool' });
const decimal = (header: string, field: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({
  header,
  field,
  type: 'decimal',
  scale: 2,
  nullable: true,
  ...o,
});

// ------------------------------------------------------------------------------------------------
// Geography (D-161 / D-170: admin-maintained, imported with preview → confirm)
// ------------------------------------------------------------------------------------------------

export const geographyImport: ImportKind = {
  key: 'geography',
  label: 'Provinces, districts and subdistricts with postcodes',
  sheets: [
    tableSheet({
      name: 'provinces',
      table: table((db) => db.geoProvince),
      columns: [
        code('code', /^[0-9A-Za-z]+$/),
        nameTh,
        nameEn,
        text('region', 'region', { nullable: true, max: 64 }),
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
    tableSheet({
      name: 'districts',
      table: table((db) => db.geoDistrict),
      columns: [
        code('code', /^[0-9A-Za-z]+$/),
        {
          header: 'province_code',
          field: 'provinceId',
          type: 'ref',
          required: true,
          ref: { table: keyed((db) => db.geoProvince), by: 'code', relation: 'province', sheet: 'provinces' },
        },
        nameTh,
        nameEn,
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
    tableSheet({
      name: 'subdistricts',
      table: table((db) => db.geoSubdistrict),
      columns: [
        code('code', /^[0-9A-Za-z]+$/),
        {
          header: 'district_code',
          field: 'districtId',
          type: 'ref',
          required: true,
          ref: { table: keyed((db) => db.geoDistrict), by: 'code', relation: 'district', sheet: 'districts' },
        },
        nameTh,
        nameEn,
        text('postcode', 'postcode', { required: true, pattern: /^[0-9]{5}$/, max: 5 }),
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
  ],
};

// ------------------------------------------------------------------------------------------------
// Materials, finishes, ink colours
// ------------------------------------------------------------------------------------------------

export const materialsImport: ImportKind = {
  key: 'materials',
  label: 'Materials (paper, board, film, foil …)',
  sheets: [
    tableSheet({
      name: 'materials',
      table: table((db) => db.material),
      columns: [
        code(),
        { header: 'kind', field: 'kind', type: 'enum', values: MATERIAL_KINDS, required: true },
        {
          header: 'family_code',
          field: 'familyId',
          type: 'ref',
          nullable: true,
          ref: { table: keyed((db) => db.materialFamily), by: 'code', relation: 'family' },
        },
        nameTh,
        nameEn,
        decimal('gsm', 'gsm'),
        decimal('micron', 'micron'),
        {
          header: 'flute_code',
          field: 'fluteTypeId',
          type: 'ref',
          nullable: true,
          ref: { table: keyed((db) => db.fluteType), by: 'code', relation: 'fluteType' },
        },
        text('paper_group', 'paperGroup', { nullable: true, max: 64 }),
        text('inside_colour', 'insideColour', { nullable: true, max: 64 }),
        text('outside_colour', 'outsideColour', { nullable: true, max: 64 }),
        text('strength', 'strength', { nullable: true, max: 64 }),
        bool('is_food_grade', 'isFoodGrade'),
        status,
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
  ],
};

export const finishesImport: ImportKind = {
  key: 'finishes',
  label: 'Finishes (coating, lamination, foil, emboss …)',
  sheets: [
    tableSheet({
      name: 'finishes',
      table: table((db) => db.finish),
      columns: [
        code(),
        {
          header: 'group_code',
          field: 'groupId',
          type: 'ref',
          nullable: true,
          ref: { table: keyed((db) => db.finishGroup), by: 'code', relation: 'group' },
        },
        nameTh,
        nameEn,
        { header: 'finish_kind', field: 'finishKind', type: 'enum', values: FINISH_KINDS, required: true },
        bool('is_special', 'isSpecial'),
        bool('requires_amount', 'requiresAmount'),
        bool('requires_width', 'requiresWidth'),
        bool('requires_length', 'requiresLength'),
        status,
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
  ],
};

export const inkColoursImport: ImportKind = {
  key: 'ink_colours',
  label: 'Ink colours',
  sheets: [
    tableSheet({
      name: 'ink_colours',
      table: table((db) => db.inkColour),
      columns: [
        code(),
        {
          header: 'group_code',
          field: 'groupId',
          type: 'ref',
          nullable: true,
          ref: { table: keyed((db) => db.inkColourGroup), by: 'code', relation: 'group' },
        },
        text('name', 'name', { required: true }),
        {
          header: 'colour_kind',
          field: 'colourKind',
          type: 'enum',
          values: INK_COLOUR_KINDS,
          required: true,
        },
        status,
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
  ],
};

// ------------------------------------------------------------------------------------------------
// Patterns + sub-patterns, standard sizes
// ------------------------------------------------------------------------------------------------

const splitKey = (rows: ParsedRow[]) => rows.map((r) => r.key.split('|') as [string, string]);

export const patternsImport: ImportKind = {
  key: 'patterns',
  label: 'Patterns with their sub-patterns (geometry indicative until B2.3)',
  sheets: [
    tableSheet({
      name: 'patterns',
      table: table((db) => db.pattern),
      columns: [
        code(),
        {
          header: 'product_type_code',
          field: 'productTypeId',
          type: 'ref',
          required: true,
          ref: { table: keyed((db) => db.productType), by: 'code', relation: 'productType' },
        },
        text('name', 'name', { required: true }),
        text('technical_name', 'technicalName', { nullable: true }),
        { header: 'pattern_kind', field: 'patternKind', type: 'int', nullable: true },
        { header: 'constraints', field: 'constraints', type: 'json' },
        text('dieline_key', 'dielineKey', { nullable: true, max: 64 }),
        status,
      ],
      key: ['code'],
      where: byColumn('code'),
      keyOf: (row: Row) => row['code'] as string,
      orderBy: { code: 'asc' },
    }),
    tableSheet({
      name: 'sub_patterns',
      table: table((db) => db.subPattern),
      columns: [
        {
          header: 'pattern_code',
          field: 'patternId',
          type: 'ref',
          required: true,
          ref: { table: keyed((db) => db.pattern), by: 'code', relation: 'pattern', sheet: 'patterns' },
        },
        { header: 'seq', field: 'seq', type: 'int', required: true },
        text('name', 'name', { required: true }),
        ...(['dl', 'dw', 'dh', 'nl', 'nw', 'nh'] as const).map((f) => decimal(f, f, { scale: 4 })),
        { header: 'conditions', field: 'conditions', type: 'json', nullable: true },
      ],
      key: ['pattern_code', 'seq'],
      where: (rows) => ({ pattern: { code: { in: splitKey(rows).map(([pattern]) => pattern) } } }),
      keyOf: (row: Row) => `${(row['pattern'] as Row)['code'] as string}|${row['seq'] as number}`,
      orderBy: [{ patternId: 'asc' }, { seq: 'asc' }],
    }),
  ],
};

export const standardSizesImport: ImportKind = {
  key: 'standard_sizes',
  label: 'Standard sizes of catalogue products',
  sheets: [
    tableSheet({
      name: 'standard_sizes',
      table: table((db) => db.standardSize),
      columns: [
        {
          header: 'product_slug',
          field: 'catalogProductId',
          type: 'ref',
          required: true,
          pattern: SLUG,
          ref: { table: keyed((db) => db.catalogProduct), by: 'slug', relation: 'catalogProduct' },
        },
        code(),
        text('name', 'name', { required: true }),
        decimal('length_mm', 'lengthMm', { required: true, nullable: false }),
        decimal('width_mm', 'widthMm', { required: true, nullable: false }),
        decimal('height_mm', 'heightMm', { required: true, nullable: false }),
        decimal('calc_length_mm', 'calcLengthMm'),
        decimal('calc_width_mm', 'calcWidthMm'),
        decimal('calc_height_mm', 'calcHeightMm'),
        sort,
        status,
      ],
      key: ['product_slug', 'code'],
      where: (rows) => ({ catalogProduct: { slug: { in: splitKey(rows).map(([slug]) => slug) } } }),
      keyOf: (row: Row) => `${(row['catalogProduct'] as Row)['slug'] as string}|${row['code'] as string}`,
      orderBy: [{ catalogProductId: 'asc' }, { code: 'asc' }],
    }),
  ],
};

// ------------------------------------------------------------------------------------------------
// Stock attribute values, stock products (+ one column per attribute)
// ------------------------------------------------------------------------------------------------

export const stockAttributeValuesImport: ImportKind = {
  key: 'stock_attribute_values',
  label: 'Stock-product attribute values',
  sheets: [
    tableSheet({
      name: 'stock_attribute_values',
      table: table((db) => db.stockAttributeValue),
      columns: [
        { header: 'attribute', field: 'attribute', type: 'enum', values: STOCK_ATTRIBUTES, required: true },
        code(),
        nameTh,
        nameEn,
        sort,
        status,
      ],
      key: ['attribute', 'code'],
      where: (rows) => ({
        OR: splitKey(rows).map(([attribute, value]) => ({ attribute, code: value })),
      }),
      keyOf: (row: Row) => `${row['attribute'] as string}|${row['code'] as string}`,
      orderBy: [{ attribute: 'asc' }, { code: 'asc' }],
    }),
  ],
};

/** Attribute columns of the stock-product sheet: one per attribute, holding the value code. */
const ATTRIBUTE_COLUMNS: ColumnSpec[] = STOCK_ATTRIBUTES.map((attribute) => ({
  header: `attr_${attribute}`,
  field: `attr_${attribute}`,
  type: 'ref',
  nullable: true,
  ref: {
    table: keyed((db) => db.stockAttributeValue),
    by: 'code',
    relation: `attr_${attribute}`,
    where: { attribute },
  },
}));

const stockSheet = tableSheet({
  name: 'stock_products',
  table: table((db) => db.stockProduct),
  columns: [
    code('sku', CATALOG_CODE, 'sku'),
    {
      header: 'product_type_code',
      field: 'productTypeId',
      type: 'ref',
      required: true,
      ref: { table: keyed((db) => db.productType), by: 'code', relation: 'productType' },
    },
    nameTh,
    nameEn,
    text('description', 'description', { nullable: true, max: 5000 }),
    { header: 'unit', field: 'unit', type: 'enum', values: PRODUCT_UNITS, required: true },
    decimal('capacity_ml', 'capacityMl'),
    decimal('length_mm', 'lengthMm'),
    decimal('width_mm', 'widthMm'),
    decimal('height_mm', 'heightMm'),
    decimal('weight_g', 'weightG'),
    { header: 'min_order_qty', field: 'minOrderQty', type: 'int' },
    bool('is_food_grade', 'isFoodGrade'),
    status,
  ],
  key: ['sku'],
  where: (rows) => ({ sku: { in: rows.map((r) => r.key) } }),
  keyOf: (row: Row) => row['sku'] as string,
  orderBy: { sku: 'asc' },
});

/**
 * Stock products with their attributes: the product columns go to `stock_products`, the
 * `attr_*` columns replace the product's attribute set (one value per attribute).
 */
const stockProductsSheet: SheetSpec = {
  ...stockSheet,
  columns: [...stockSheet.columns, ...ATTRIBUTE_COLUMNS],
  compare: [...stockSheet.columns.map((c) => c.field), ...ATTRIBUTE_COLUMNS.map((c) => c.field)],
  async existing(db, rows) {
    const map = await stockSheet.existing(db, rows);
    const ids = [...map.values()].map((e) => e.id!);
    const attributes = await db.stockProductAttribute.findMany({ where: { stockProductId: { in: ids } } });
    for (const existing of map.values()) {
      for (const attribute of STOCK_ATTRIBUTES) existing.values[`attr_${attribute}`] = null;
      for (const a of attributes.filter((x) => x.stockProductId === existing.id)) {
        existing.values[`attr_${a.attribute}`] = a.valueId;
      }
    }
    return map;
  },
  async apply(db, rows, actorUserId) {
    const split = (data: Row) => {
      const product: Row = {};
      const attrs: Row = {};
      for (const [k, v] of Object.entries(data)) (k.startsWith('attr_') ? attrs : product)[k] = v;
      return { product, attrs };
    };
    await stockSheet.apply(
      db,
      rows.map((r) => ({ ...r, data: split(r.data).product })),
      actorUserId,
    );
    const stored = await db.stockProduct.findMany({
      where: { sku: { in: rows.map((r) => r.key) } },
      select: { id: true, sku: true },
    });
    const idOf = new Map(stored.map((s) => [s.sku, s.id]));
    for (const row of rows) {
      const stockProductId = idOf.get(row.key)!;
      const { attrs } = split(row.data);
      await db.stockProductAttribute.deleteMany({ where: { stockProductId } });
      const data = Object.entries(attrs)
        .filter(([, valueId]) => valueId !== null && valueId !== undefined)
        .map(([field, valueId]) => ({
          stockProductId,
          attribute: field.slice('attr_'.length) as (typeof STOCK_ATTRIBUTES)[number],
          valueId: valueId as bigint,
          createdById: actorUserId,
        }));
      if (data.length) await db.stockProductAttribute.createMany({ data });
    }
  },
  async exportRows(db) {
    const base = await stockSheet.exportRows(db);
    const values = await db.stockProductAttribute.findMany({
      include: { stockProduct: { select: { sku: true } }, value: { select: { code: true } } },
    });
    const bySku = new Map<string, Row>();
    for (const v of values) {
      const row = bySku.get(v.stockProduct.sku) ?? {};
      row[`attr_${v.attribute}`] = v.value.code;
      bySku.set(v.stockProduct.sku, row);
    }
    return base.map((row) => ({
      ...Object.fromEntries(STOCK_ATTRIBUTES.map((a) => [`attr_${a}`, null])),
      ...row,
      ...(bySku.get(row['sku'] as string) as Record<string, string> | undefined),
    }));
  },
};

export const stockProductsImport: ImportKind = {
  key: 'stock_products',
  label: 'Stock products with their attributes',
  sheets: [stockProductsSheet],
};

export const IMPORT_KINDS: readonly ImportKind[] = [
  geographyImport,
  materialsImport,
  finishesImport,
  inkColoursImport,
  patternsImport,
  standardSizesImport,
  stockAttributeValuesImport,
  stockProductsImport,
];
export const IMPORT_KIND_KEYS = IMPORT_KINDS.map((k) => k.key);
