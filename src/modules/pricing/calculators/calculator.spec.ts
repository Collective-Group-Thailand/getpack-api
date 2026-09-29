import { type AnyCalculatorAdapter } from './adapter';
import { CalculatorRegistry } from './calculator';

const adapter = { key: 'folding', version: '0.0.0' } as AnyCalculatorAdapter;

describe('CalculatorRegistry', () => {
  it('resolves a registered adapter by key', () => {
    const registry = new CalculatorRegistry();
    registry.register(adapter);
    expect(registry.has('folding')).toBe(true);
    expect(registry.get('folding')).toBe(adapter);
  });

  it('refuses a second adapter for the same key and unknown keys', () => {
    const registry = new CalculatorRegistry();
    registry.register(adapter);
    expect(() => registry.register(adapter)).toThrow('already registered');
    expect(registry.has('label')).toBe(false);
    expect(() => registry.get('label')).toThrow('No calculator registered for label');
  });
});
