import { type PriceComponentDescriptor } from '@modules/partners/pricing/price-component.registry';

/**
 * Registry descriptor of the standard-product price component (U-B6 standard product, schema-design §3.4, A-74): the
 * factory's buy price per piece of a stock product by quantity band (legacy `standard_product_prices`). No cost-driver
 * series yet (D-040: `driver_not_configured`).
 */

export const PL_STOCK_PRODUCT_PRICES: PriceComponentDescriptor = {
  component: 'stock_product_prices',
  table: 'pl_stock_product_prices',
  group: 'commercial_terms',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'stockProductId', type: 'ref', ref: 'stock_products' },
    { key: 'minQty', type: 'integer', nullable: true },
    { key: 'maxQty', type: 'integer', nullable: true },
  ],
  values: [
    { key: 'unitBuyPrice', type: 'decimal', scale: 6 },
    { key: 'leadTimeDays', type: 'decimal', scale: 2, nullable: true },
  ],
};

export const STANDARD_PRODUCT_PRICE_COMPONENTS: readonly PriceComponentDescriptor[] = [
  PL_STOCK_PRODUCT_PRICES,
];
