import { normaliseProperties, sanitisePagePath, sanitiseUtm } from './event-schemas';

describe('analytics event schemas (B6.1, PDPA)', () => {
  it('bands exact quantities and keeps only the declared properties', () => {
    const shown = normaliseProperties(
      'quote_shown',
      { quantity: 1200, instant: true, leadTimeDays: 12, unitPrice: '4.250000' },
      'p',
    );
    expect(shown).toEqual({
      value: { quantityBand: '1000-4999', instant: true, leadTimeDays: 12, unitPrice: '4.250000' },
      errors: [],
    });
    expect(normaliseProperties('add_to_cart', { quantity: 99 }, 'p').value).toEqual({ quantityBand: '0-99' });
    expect(normaliseProperties('page_view', undefined, 'p')).toEqual({ value: {}, errors: [] });
  });

  it('refuses free text, unknown keys and personal data carriers', () => {
    expect(
      normaliseProperties('page_view', { email: 'someone@example.invalid' }, 'events[0].properties').errors,
    ).toEqual([expect.objectContaining({ path: 'events[0].properties', code: 'additionalProperties' })]);
    expect(normaliseProperties('configurator_step', { step: 'Paper Type!' }, 'p').errors[0]?.code).toBe(
      'pattern',
    );
    expect(normaliseProperties('quote_shown', { quantity: 10 }, 'p').errors[0]?.code).toBe('required');
    expect(
      normaliseProperties('quote_shown', { quantity: 10, instant: true, unitPrice: 'cheap' }, 'p').errors[0]
        ?.code,
    ).toBe('pattern');
  });

  it('links only the placed checkout step to its order group', () => {
    const group = '0192f3a0-7c1e-7d2a-9b1f-000000310001';
    expect(normaliseProperties('checkout_step', { step: 'placed', orderGroupId: group }, 'p').errors).toEqual(
      [],
    );
    expect(normaliseProperties('checkout_step', { step: 'placed' }, 'p').errors).not.toEqual([]);
    expect(
      normaliseProperties('checkout_step', { step: 'address', orderGroupId: group }, 'p').errors,
    ).not.toEqual([]);
    expect(normaliseProperties('checkout_step', { step: 'address' }, 'p').errors).toEqual([]);
  });

  it('keeps page paths without query strings or identifier-like segments', () => {
    expect(sanitisePagePath('/configure/folding_carton?utm_source=x&phone=0812345678#top')).toBe(
      '/configure/folding_carton',
    );
    expect(sanitisePagePath('https://packio.example/orders/0192f3a0-7c1e-7d2a-9b1f-000000310001')).toBe(
      '/orders/:id',
    );
    expect(sanitisePagePath('/track/ORD2610000123')).toBe('/track/:id');
    expect(sanitisePagePath('/q/s/aB3dE5fG7hJ9kL1mN3pQ5rS7tU9')).toBe('/q/s/:id');
    expect(sanitisePagePath('/account/someone%40example.invalid')).toBe('/account/:id');
    expect(sanitisePagePath('/bad/%E0%A4%A')).toBe('/bad/:id');
    expect(sanitisePagePath('orders')).toBeNull();
    expect(sanitisePagePath('')).toBeNull();
    expect(sanitisePagePath('/')).toBe('/');
  });

  it('keeps campaign parameters, drops values that could carry personal data', () => {
    expect(sanitiseUtm({ source: 'Facebook', medium: 'cpc', campaign: 'launch_2026' })).toEqual({
      source: 'facebook',
      medium: 'cpc',
      campaign: 'launch_2026',
    });
    expect(
      sanitiseUtm({ source: 'newsletter', term: 'someone@example.invalid', content: '0812345678' }),
    ).toEqual({ source: 'newsletter' });
    expect(sanitiseUtm({ term: 'x'.repeat(101) })).toBeNull();
    expect(sanitiseUtm(undefined)).toBeNull();
  });
});
