import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { SHIPPED_CALCULATORS } from '../product-structure/shipped-calculators';
import { type CatalogReadinessDto, type ReadinessItemDto, type ReadinessListDto } from './readiness.dto';

const LIMIT = 50;

type Row = ReadinessItemDto & { n: bigint };

/** A list from rows numbered by a window function: the first `LIMIT`, and the total from any row. */
const listOf = (rows: Row[]): ReadinessListDto => ({
  count: rows.length ? Number(rows[0]!.n) : 0,
  items: rows.slice(0, LIMIT).map(({ id, key, nameTh, nameEn }) => ({ id, key, nameTh, nameEn })),
});

/**
 * What the catalogue still needs (D-426 photos, A-16 instant pricing, D-243 publishability), read straight from the
 * tables in one pass per list — counts over the whole set, the first fifty rows of each to open.
 */
@Injectable()
export class CatalogReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<CatalogReadinessDto> {
    const [types, products, stock, styles] = await Promise.all([
      this.productTypes(),
      this.products(),
      this.stock(),
      this.styles(),
    ]);
    return { productTypes: types, products, stock, styles };
  }

  private async productTypes() {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        code: string;
        nameTh: string;
        nameEn: string;
        status: string;
        quoteMode: string;
        calculatorKey: string | null;
        activeProducts: bigint;
      }[]
    >`
      SELECT t.public_id AS id, t.code, t.name_th AS "nameTh", t.name_en AS "nameEn", t.status::text AS status,
             t.quote_mode::text AS "quoteMode", t.calculator_key::text AS "calculatorKey",
             (SELECT count(*) FROM catalog_products p WHERE p.product_type_id = t.id AND p.status = 'active')
             + (SELECT count(*) FROM stock_products s WHERE s.product_type_id = t.id AND s.status = 'active')
               AS "activeProducts"
      FROM product_types t
      WHERE t.status = 'active'
      ORDER BY t.sort, t.code`;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      nameTh: r.nameTh,
      nameEn: r.nameEn,
      status: r.status as CatalogReadinessDto['productTypes'][number]['status'],
      quoteMode: r.quoteMode as CatalogReadinessDto['productTypes'][number]['quoteMode'],
      calculatorShipped:
        r.calculatorKey !== null &&
        SHIPPED_CALCULATORS.has(r.calculatorKey as Parameters<typeof SHIPPED_CALCULATORS.has>[0]),
      activeProducts: Number(r.activeProducts),
    }));
  }

  private async products() {
    const [total, noImage, referenceOnly, notActive, quoteOnly] = await Promise.all([
      this.prisma.catalogProduct.count({ where: { status: 'active' } }),
      this.prisma.$queryRaw<Row[]>`
        SELECT p.public_id AS id, p.slug AS key, p.name_th AS "nameTh", p.name_en AS "nameEn", count(*) OVER () AS n
        FROM catalog_products p
        WHERE p.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM catalog_product_images i WHERE i.catalog_product_id = p.id)
        ORDER BY p.slug LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT p.public_id AS id, p.slug AS key, p.name_th AS "nameTh", p.name_en AS "nameEn", count(*) OVER () AS n
        FROM catalog_products p
        WHERE p.status = 'active'
          AND EXISTS (SELECT 1 FROM catalog_product_images i WHERE i.catalog_product_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM catalog_product_images i
                          WHERE i.catalog_product_id = p.id AND coalesce(i.variant->>'source', '') <> 'ai-render')
        ORDER BY p.slug LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT p.public_id AS id, p.slug AS key, p.name_th AS "nameTh", p.name_en AS "nameEn", count(*) OVER () AS n
        FROM catalog_products p
        WHERE p.status IN ('draft', 'inactive')
        ORDER BY p.slug LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT p.public_id AS id, p.slug AS key, p.name_th AS "nameTh", p.name_en AS "nameEn", count(*) OVER () AS n
        FROM catalog_products p JOIN product_types t ON t.id = p.product_type_id
        WHERE p.status = 'active' AND t.quote_mode = 'rfq'
        ORDER BY p.slug LIMIT ${LIMIT}`,
    ]);
    return {
      total,
      noImage: listOf(noImage),
      referenceOnly: listOf(referenceOnly),
      notActive: listOf(notActive),
      quoteOnly: listOf(quoteOnly),
    };
  }

  private async stock() {
    const [total, noImage, referenceOnly, notActive, quoteOnly] = await Promise.all([
      this.prisma.stockProduct.count({ where: { status: 'active' } }),
      this.prisma.$queryRaw<Row[]>`
        SELECT s.public_id AS id, s.sku AS key, s.name_th AS "nameTh", s.name_en AS "nameEn", count(*) OVER () AS n
        FROM stock_products s
        WHERE s.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM stock_product_images i WHERE i.stock_product_id = s.id)
        ORDER BY s.sku LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT s.public_id AS id, s.sku AS key, s.name_th AS "nameTh", s.name_en AS "nameEn", count(*) OVER () AS n
        FROM stock_products s
        WHERE s.status = 'active'
          AND EXISTS (SELECT 1 FROM stock_product_images i WHERE i.stock_product_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM stock_product_images i
                          WHERE i.stock_product_id = s.id AND coalesce(i.variant->>'source', '') <> 'ai-render')
        ORDER BY s.sku LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT s.public_id AS id, s.sku AS key, s.name_th AS "nameTh", s.name_en AS "nameEn", count(*) OVER () AS n
        FROM stock_products s
        WHERE s.status IN ('draft', 'inactive')
        ORDER BY s.sku LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT s.public_id AS id, s.sku AS key, s.name_th AS "nameTh", s.name_en AS "nameEn", count(*) OVER () AS n
        FROM stock_products s JOIN product_types t ON t.id = s.product_type_id
        WHERE s.status = 'active' AND t.quote_mode = 'rfq'
        ORDER BY s.sku LIMIT ${LIMIT}`,
    ]);
    return {
      total,
      noImage: listOf(noImage),
      referenceOnly: listOf(referenceOnly),
      notActive: listOf(notActive),
      quoteOnly: listOf(quoteOnly),
    };
  }

  private async styles() {
    const [total, noPhoto, referenceOnly, notPublishable, hidden] = await Promise.all([
      this.prisma.styleBase.count({ where: { status: 'active' } }),
      this.prisma.$queryRaw<Row[]>`
        SELECT b.public_id AS id, b.code AS key, b.name_th AS "nameTh", b.name_en AS "nameEn", count(*) OVER () AS n
        FROM style_bases b
        WHERE b.status = 'active' AND b.photo_file_id IS NULL
        ORDER BY b.code LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT b.public_id AS id, b.code AS key, b.name_th AS "nameTh", b.name_en AS "nameEn", count(*) OVER () AS n
        FROM style_bases b
        WHERE b.status = 'active' AND b.photo_file_id IS NOT NULL AND b.photo_meta->>'source' = 'ai-render'
        ORDER BY b.code LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT b.public_id AS id, b.code AS key, b.name_th AS "nameTh", b.name_en AS "nameEn", count(*) OVER () AS n
        FROM style_bases b
        WHERE b.status = 'active' AND NOT b.hidden
          AND NOT EXISTS (SELECT 1 FROM style_variants v WHERE v.base_id = b.id AND v.status = 'active' AND v.publishable)
        ORDER BY b.code LIMIT ${LIMIT}`,
      this.prisma.$queryRaw<Row[]>`
        SELECT b.public_id AS id, b.code AS key, b.name_th AS "nameTh", b.name_en AS "nameEn", count(*) OVER () AS n
        FROM style_bases b
        WHERE b.status = 'active' AND b.hidden
        ORDER BY b.code LIMIT ${LIMIT}`,
    ]);
    return {
      total,
      noPhoto: listOf(noPhoto),
      referenceOnly: listOf(referenceOnly),
      notPublishable: listOf(notPublishable),
      hidden: listOf(hidden),
    };
  }
}
