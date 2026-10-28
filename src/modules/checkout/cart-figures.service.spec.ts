import { MoneyDecimal } from '@common/money/money';
import { type CartRow } from '@modules/carts/carts.service';
import { SettingNotFoundError } from '@platform/settings/settings.service';

import { CartFigures } from './cart-figures.service';

const dec = (v: string) => new MoneyDecimal(v);

/** One instant item: ฿5,178.00 goods (฿17.26 × 300, VAT ฿338.75), no quotation shipping. */
function cart(): CartRow {
  return {
    items: [
      {
        publicId: 'item-1',
        quantity: 300,
        grossAmount: dec('5178.00'),
        shippingAmount: null,
        quote: {
          source: 'instant',
          input: { configuration: { quantities: [300] } },
          configRefs: {},
          deliveryPostcode: null,
          productType: { calculatorKey: 'corrugate' },
        },
        quoteOption: {
          quantity: 300,
          netAmount: dec('4839.25'),
          vatAmount: dec('338.75'),
          grossAmount: dec('5178.00'),
          shippingAmount: null,
          result: {},
          selectedFactoryId: 1n,
          earliestShipDate: null,
          leadTimeDays: 5,
        },
      },
    ],
  } as unknown as CartRow;
}

function figures(shipping: { available: boolean; net?: string }) {
  const prisma = {
    taxRateVersion: { findFirst: jest.fn().mockResolvedValue({ ratePct: dec('7') }), findUnique: jest.fn() },
  };
  const settings = {
    at: jest.fn().mockRejectedValue(new SettingNotFoundError('shipping.transit_days', new Date())),
  };
  const engine = {
    destinationShipping: jest.fn().mockResolvedValue([
      shipping.available
        ? {
            available: true,
            net: dec(shipping.net!),
            zone: { code: 'BKK', nameTh: 'กรุงเทพฯ', nameEn: 'Bangkok' },
          }
        : { available: false, reason: 'no_rate_card' },
    ]),
  };
  const calendars = {
    calendar: jest
      .fn()
      .mockResolvedValue({ addWorkingDays: (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000) }),
  };
  return new CartFigures(prisma as never, settings as never, engine as never, calendars as never);
}

describe('CartFigures.estimateShipping (D-452)', () => {
  it('adds the destination shipping and its VAT to the goods (nothing saved)', async () => {
    const now = new Date('2026-10-28T10:00:00+07:00');
    const out = await figures({ available: true, net: '220.00' }).estimateShipping(cart(), '10110', now);
    expect(out).toMatchObject({
      postcode: '10110',
      available: true,
      shippingGrossAmount: '235.40',
      totalGrossAmount: '5413.40',
      vatAmount: '354.15',
      zone: { th: 'กรุงเทพฯ', en: 'Bangkok' },
      readyDate: '2026-11-02',
      arrival: null,
      unavailableItemIds: [],
    });
  });

  it('names the items that cannot ship there and gives no amounts', async () => {
    const out = await figures({ available: false }).estimateShipping(cart(), '95000');
    expect(out).toMatchObject({
      available: false,
      shippingGrossAmount: null,
      totalGrossAmount: null,
      vatAmount: null,
      unavailableItemIds: ['item-1'],
    });
  });
});
