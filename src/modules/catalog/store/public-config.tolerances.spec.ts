import { SettingNotFoundError } from '@platform/settings/settings.service';

import { PublicConfigService } from './public-config';

/** D-460 (C12): the default tolerances of "how we work" come from the settings, nothing of the storefront's own. */
describe('public config tolerances (D-460)', () => {
  const service = (values: Record<string, unknown>) =>
    new PublicConfigService(
      {} as never,
      {
        at: (key: string) => {
          if (!(key in values)) return Promise.reject(new SettingNotFoundError(key, new Date()));
          return Promise.resolve({ value: values[key] });
        },
      } as never,
      {} as never,
      {} as never,
    ) as unknown as { tolerances(): Promise<Record<string, string | null>> };

  it('states the seeded defaults: quantity, the size range over product kinds and both colour figures', async () => {
    await expect(
      service({
        'fulfilment.tolerance_default_pct': '5',
        'fulfilment.dimensional_tolerance_mm': { folding: '1', tag_sleeve: '1', corrugate: '3' },
        'fulfilment.colour_tolerance_delta_e': { standard: '3', flexo: '5' },
      }).tolerances(),
    ).resolves.toEqual({
      quantityPct: '5.00',
      sizeMmMin: '1.00',
      sizeMmMax: '3.00',
      colourDeltaE: '3',
      colourDeltaEFlexo: '5',
    });
  });

  it('leaves each figure null while its setting is missing', async () => {
    await expect(service({}).tolerances()).resolves.toEqual({
      quantityPct: null,
      sizeMmMin: null,
      sizeMmMax: null,
      colourDeltaE: null,
      colourDeltaEFlexo: null,
    });
  });
});
