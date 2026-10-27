import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';

import { PRICE_SETTING_KEYS, PriceHintsService } from './price-hints.service';

/** C0: the "starting from" price follows price and print-config changes (D-220, D-441). */
describe('PriceHintsService refresh triggers', () => {
  const service = () => {
    const s = new PriceHintsService({} as never, {} as never, {} as never);
    const refresh = jest.spyOn(s, 'refresh').mockResolvedValue({ priced: 0, cleared: 0 });
    return { s, refresh };
  };
  const event = (key: unknown) => ({ payload: { key } }) as unknown as DomainEventEnvelope;

  it('refreshes every hint when the print limits change', async () => {
    const { s, refresh } = service();
    await s.onSettingChanged(event('catalog.print_limits'));
    expect(refresh).toHaveBeenCalledWith();
  });

  it('ignores settings that do not move a store price', async () => {
    const { s, refresh } = service();
    await s.onSettingChanged(event('quotes.validity_days'));
    await s.onSettingChanged(event(undefined));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on product-type and catalogue-import changes', async () => {
    const { s, refresh } = service();
    await s.onConfigChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('lists the price-moving settings', () => {
    expect([...PRICE_SETTING_KEYS].sort()).toEqual([
      'catalog.print_limits',
      'pricing.margin_floor_pct',
      'tax.rounding_mode',
    ]);
  });
});
