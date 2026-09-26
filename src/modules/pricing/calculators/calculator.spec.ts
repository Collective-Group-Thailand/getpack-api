import { type Calculator, CalculatorRegistry } from './calculator';

const echo: Calculator<number, number, number> = {
  key: 'folding',
  version: '0.0.0',
  calculate: (input, snapshot) => input + snapshot,
};

describe('CalculatorRegistry', () => {
  it('resolves a registered calculator by key', () => {
    const registry = new CalculatorRegistry();
    registry.register(echo);
    expect(registry.has('folding')).toBe(true);
    expect(registry.get('folding').calculate(1, 2)).toBe(3);
  });

  it('refuses a second calculator for the same key and unknown keys', () => {
    const registry = new CalculatorRegistry();
    registry.register(echo);
    expect(() => registry.register(echo)).toThrow('already registered');
    expect(registry.has('label')).toBe(false);
    expect(() => registry.get('label')).toThrow('No calculator registered for label');
  });
});
