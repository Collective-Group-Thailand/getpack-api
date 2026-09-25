import { type PriceComponentDescriptor } from '@modules/partners/pricing/price-component.registry';

/**
 * Test-only price component (B2.2 plan): the `pl_*` tables arrive with the calculator ports (B2.3),
 * so the governance tests create this stand-in, shaped like a group-1 material price by quantity
 * band, and register it under the `material_prices` component.
 */
export const PL_TEST_PRICES_SQL = [
  `CREATE TABLE IF NOT EXISTS pl_test_prices (
     id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     price_list_version_id BIGINT NOT NULL REFERENCES price_list_versions (id) ON DELETE CASCADE,
     line_key TEXT NOT NULL,
     material_id BIGINT NOT NULL REFERENCES materials (id),
     qty_from INTEGER NOT NULL,
     qty_to INTEGER,
     rate NUMERIC(18, 6) NOT NULL,
     CONSTRAINT ux_pl_test_prices__version__line_key UNIQUE (price_list_version_id, line_key),
     CONSTRAINT ck_pl_test_prices__band CHECK (qty_to IS NULL OR qty_from <= qty_to)
   )`,
  `DROP TRIGGER IF EXISTS tg_pl_test_prices__version_frozen ON pl_test_prices`,
  `CREATE TRIGGER tg_pl_test_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_test_prices
     FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change()`,
];

export const PL_TEST_PRICES: PriceComponentDescriptor = {
  component: 'material_prices',
  table: 'pl_test_prices',
  group: 'materials',
  dimensions: [
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'qtyFrom', type: 'integer', min: 1 },
    { key: 'qtyTo', type: 'integer', nullable: true, min: 1 },
  ],
  values: [{ key: 'rate', type: 'decimal', scale: 6 }],
  validate: (values) =>
    values['qtyTo'] !== null && Number(values['qtyTo']) < Number(values['qtyFrom'])
      ? [{ path: 'qtyTo', code: 'min', message: 'qtyTo must not be below qtyFrom' }]
      : [],
};
