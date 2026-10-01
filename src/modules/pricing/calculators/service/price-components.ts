import { type PriceComponentDescriptor } from '@modules/partners/pricing/price-component.registry';

/**
 * Registry descriptor of the service price component (U-B6 service, schema-design §3.4, A-75): a factory's net buy cost
 * per unit of a service item (a `service` catalogue product). No cost-driver series yet (D-040: `driver_not_configured`).
 */

export const PL_SERVICE_PRICES: PriceComponentDescriptor = {
  component: 'service_prices',
  table: 'pl_service_prices',
  group: 'process_rates',
  dimensions: [
    { key: 'printTypeId', type: 'ref', ref: 'print_types' },
    { key: 'catalogProductId', type: 'ref', ref: 'catalog_products' },
  ],
  values: [
    { key: 'unitCost', type: 'decimal', scale: 6 },
    { key: 'leadTimeDays', type: 'decimal', scale: 2, nullable: true },
  ],
};

export const SERVICE_PRICE_COMPONENTS: readonly PriceComponentDescriptor[] = [PL_SERVICE_PRICES];
