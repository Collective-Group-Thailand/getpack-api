import { scalarOptions } from './scalar-options';

describe('Scalar options (U-B1)', () => {
  it('points "try it" at the local server in development and at the sandbox elsewhere', () => {
    expect(scalarOptions(true).servers).toEqual([
      { url: 'http://localhost:3000', description: 'Local development (docker compose + pnpm dev)' },
    ]);
    expect(scalarOptions(false).servers).toEqual([
      { url: 'https://sandbox.packio.invalid', description: 'Sandbox' },
    ]);
  });

  it('shows only fetch, curl and Node snippets', () => {
    const hidden = scalarOptions(false).hiddenClients;
    expect(hidden.js).toEqual(['axios', 'jquery', 'ofetch', 'xhr']);
    expect(hidden.node).toEqual(['axios', 'ofetch']);
    expect(hidden.shell).toEqual(['httpie', 'wget']);
    for (const [target, value] of Object.entries(hidden)) {
      if (!['js', 'node', 'shell'].includes(target)) expect(value).toBe(true);
    }
  });

  it('follows the system colour scheme', () => {
    const options = scalarOptions(false) as unknown as Record<string, unknown>;
    expect(options.darkMode).toBeUndefined();
    expect(options.forceDarkModeState).toBeUndefined();
  });
});
