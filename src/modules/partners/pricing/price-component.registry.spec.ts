import {
  lineKeyOf,
  normaliseColumns,
  normaliseValue,
  type PriceComponentDescriptor,
  PriceComponentRegistry,
} from './price-component.registry';

const DESCRIPTOR: PriceComponentDescriptor = {
  component: 'material_prices',
  table: 'pl_material_prices',
  group: 'materials',
  dimensions: [
    { key: 'materialId', type: 'ref', ref: 'materials' },
    { key: 'qtyFrom', type: 'integer', min: 1 },
    { key: 'qtyTo', type: 'integer', nullable: true },
  ],
  values: [{ key: 'rate', type: 'decimal', scale: 6 }],
};
const MATERIAL = '0192F3A0-7C1E-7D2A-9B1F-00000000C010';

describe('price component registry (D-040, A-13)', () => {
  it('derives a stable line key from the canonical dimension values only', () => {
    const a = lineKeyOf(DESCRIPTOR, {
      materialId: MATERIAL.toLowerCase(),
      qtyFrom: 100,
      qtyTo: null,
      rate: '1',
    });
    const b = lineKeyOf(DESCRIPTOR, {
      qtyTo: null,
      qtyFrom: 100,
      materialId: MATERIAL.toLowerCase(),
      rate: '9',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(lineKeyOf(DESCRIPTOR, { materialId: MATERIAL.toLowerCase(), qtyFrom: 101, qtyTo: null })).not.toBe(
      a,
    );
  });

  it('normalises values to their API form and refuses what does not fit a column', () => {
    const { values, errors } = normaliseColumns(
      [...DESCRIPTOR.dimensions, ...DESCRIPTOR.values],
      { materialId: MATERIAL, qtyFrom: '100', qtyTo: null, rate: 12.5 },
      'values',
    );
    expect(errors).toEqual([]);
    expect(values).toEqual({
      materialId: MATERIAL.toLowerCase(),
      qtyFrom: 100,
      qtyTo: null,
      rate: '12.500000',
    });

    const bad = normaliseColumns(DESCRIPTOR.values, { rate: '-1', extra: true }, 'values');
    expect(bad.errors.map((e) => e.path).sort()).toEqual(['values.extra', 'values.rate']);
    expect(normaliseValue({ key: 'rate', type: 'decimal', scale: 2 }, '1.234')).toEqual({
      error: 'rate allows at most 2 decimal places',
    });
    expect(normaliseValue({ key: 'qtyFrom', type: 'integer', min: 1 }, 0)).toEqual({
      error: 'qtyFrom must be at least 1',
    });
    expect(normaliseValue({ key: 'qtyTo', type: 'integer' }, null)).toEqual({ error: 'qtyTo is required' });
  });

  it('accepts only code-defined SQL identifiers and one descriptor per component', () => {
    const registry = new PriceComponentRegistry();
    expect(() => registry.register({ ...DESCRIPTOR, table: 'pl_x; DROP TABLE users' })).toThrow(/identifier/);
    expect(() => registry.register({ ...DESCRIPTOR, table: 'materials' })).toThrow(/pl_\*/);
    registry.register(DESCRIPTOR);
    expect(() => registry.register(DESCRIPTOR)).toThrow(/twice/);
    expect(registry.all().map((d) => d.component)).toEqual(['material_prices']);
  });
});
