import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type ProductUnit } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { loadSellSnapshot } from '../shared/sell-snapshot';
import { type StandardProductOption } from './standard-product-calculator';

/**
 * Loads what the standard-product calculator reads (U-B6 standard product): the stock product of the configuration and,
 * per factory price-list version, one option per print type that has price lines for it (`pl_stock_product_prices`,
 * line order) with Packio's `standard_product` sell side. Every version id used is returned.
 */

/** A standard-product configuration as the API receives it: a stock product's public id and quantities. */
export interface StandardProductConfiguration {
  stockProductId: string;
  quantities: readonly number[];
  design?: { graphic: boolean; structure?: boolean };
}

export interface ResolvedStandardProduct {
  productTypeId: bigint;
  catalogProductId: null;
  stockProductId: bigint;
  stockProductPublicId: string;
  unit: ProductUnit;
  weightG: number | null;
  minOrderQty: number;
}

export interface LoadedStandardProductOption {
  option: StandardProductOption;
  optionKey: string;
  factoryId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
  priceListVersionPublicId: string;
  sellMarginVersionIds: bigint[];
  vatRateVersionId: bigint;
}

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d.toString()));

@Injectable()
export class StandardProductSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(cfg: StandardProductConfiguration, db: Tx = this.prisma): Promise<ResolvedStandardProduct> {
    const product = await db.stockProduct.findFirst({
      where: {
        publicId: cfg.stockProductId,
        status: 'active',
        productType: { calculatorKey: 'standard_product' },
      },
    });
    if (!product) {
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'stockProductId', code: 'invalid', message: 'no active standard product with this id' },
        ],
      });
    }
    return {
      productTypeId: product.productTypeId,
      catalogProductId: null,
      stockProductId: product.id,
      stockProductPublicId: product.publicId,
      unit: product.unit,
      weightG: num(product.weightG),
      minOrderQty: product.minOrderQty,
    };
  }

  /** One option per print type the factory's price-list version has lines for the stock product. */
  async options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: ResolvedStandardProduct,
    at: Date,
    db: Tx = this.prisma,
  ): Promise<LoadedStandardProductOption[]> {
    const rows = await db.plStockProductPrice.findMany({
      where: { priceListVersionId, stockProductId: resolved.stockProductId },
      include: {
        printType: { select: { publicId: true } },
        priceListVersion: { select: { publicId: true } },
      },
      orderBy: { id: 'asc' },
    });
    const printTypes = [...new Set(rows.map((r) => r.printTypeId))];
    const loaded: LoadedStandardProductOption[] = [];
    for (const pt of printTypes) {
      const lines = rows.filter((r) => r.printTypeId === pt);
      const first = lines[0]!;
      const sell = await loadSellSnapshot(db, resolved.productTypeId, pt, at);
      // Delivery is priced on the shipment's weight (D-013): a stock product without a weight cannot be shipped.
      const unavailable =
        resolved.weightG === null && resolved.unit !== 'pouch' ? ['stock_products.weight_g'] : [];
      const option: StandardProductOption = {
        optionKey: `${factory.publicId}:${first.printType.publicId}`,
        factoryId: factory.publicId,
        printTypeId: pt.toString(),
        rows: lines.map((r) => ({
          minQty: r.minQty,
          maxQty: r.maxQty,
          unitBuyPrice: Number(r.unitBuyPrice.toString()),
          leadTimeDays: num(r.leadTimeDays),
        })),
        sell: sell.snapshot,
        ...(unavailable.length ? { unavailable } : {}),
      };
      loaded.push({
        option,
        optionKey: option.optionKey,
        factoryId: factory.publicId,
        printTypePublicId: first.printType.publicId,
        priceListVersionId,
        priceListVersionPublicId: first.priceListVersion.publicId,
        sellMarginVersionIds: sell.versionIds,
        vatRateVersionId: sell.vatRateVersionId,
      });
    }
    return loaded;
  }
}
