import { DomainException } from '@common/errors/domain.exception';
import { type CarrierBookingRequest } from '@integrations/carriers/carrier-adapter.port';
import { SettingNotFoundError } from '@platform/settings/settings.service';

import { getpackSenderContact } from './carrier-sender';
import { ShipmentsService } from './shipments.service';

/** Obviously fake data (CLAUDE.md). */
const RETURN_ADDRESS = {
  line1: '99/9 Fake Return Rd (fake)',
  district: 'Fake district',
  province: 'Fake province',
  postcode: '10000',
  lat: 13.75,
  lng: 100.5,
};
const ENTITY_SETTINGS: Record<string, unknown> = {
  'entity.display_name': 'getpack (fake display name)',
  'entity.phone': '02-000-0000',
  'entity.return_address': RETURN_ADDRESS,
};
const FACTORY = {
  legalName: 'Fake Factory Co., Ltd. (fake)',
  addresses: [
    {
      kind: 'pickup',
      line1: '1 Fake Factory Rd (fake)',
      line2: null,
      postcode: '20000',
      lat: '13.1',
      lng: '101.1',
    },
  ],
  contacts: [{ isPrimary: true, name: 'Fake Factory Contact', phone: '0899999999' }],
};

describe('carrier booking sender (D-442, GLOBAL-RULES §1)', () => {
  it('is getpack: display name, phone and return address from the settings', () => {
    expect(
      getpackSenderContact('flash_express', {
        displayName: ' getpack ',
        phone: '02-000-0000',
        returnAddress: { ...RETURN_ADDRESS, line2: 'Floor 2', subdistrict: 'Fake subdistrict' },
      }),
    ).toEqual({
      name: 'getpack',
      phone: '02-000-0000',
      addressLine: '99/9 Fake Return Rd (fake) Floor 2 Fake subdistrict',
      postcode: '10000',
      province: 'Fake province',
      district: 'Fake district',
      lat: 13.75,
      lng: 100.5,
    });
  });

  it('refuses the booking (never falls back) when a sender setting is missing', () => {
    let error: unknown;
    try {
      getpackSenderContact('deliveree', { displayName: 'getpack', phone: null, returnAddress: null });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('shipments.carrier_unavailable');
    expect(JSON.stringify((error as DomainException).params)).toContain(
      'entity.phone, entity.return_address',
    );
  });

  /** The service with only what `bookCarrier` touches; the carrier call is captured, then stopped. */
  function service(settings: Record<string, unknown>) {
    const booked: CarrierBookingRequest[] = [];
    const settingReads: { key: string; scope: unknown }[] = [];
    const shipment = {
      id: 7n,
      entityId: 1n,
      shipmentNo: 'SH-FAKE-0001',
      status: 'ready',
      rowVersion: 1,
      carrierId: 1n,
      carrier: { code: 'factory_fleet' },
      factory: FACTORY,
      recipientName: 'Fake Customer',
      phone: '0800000000',
      line1: '5 Fake Customer Rd',
      line2: null,
      postcode: '50000',
      weightG: 2000,
      cartonsCount: 1,
      cartons: [{ weightG: 2000 }],
    };
    const svc = Object.create(ShipmentsService.prototype) as ShipmentsService;
    Object.assign(svc, {
      prisma: {
        shipment: { findUniqueOrThrow: jest.fn().mockResolvedValue(shipment) },
        withTx: jest.fn().mockResolvedValue(undefined),
      },
      settings: {
        at: jest.fn((key: string, opts: { scope: unknown }) => {
          settingReads.push({ key, scope: opts.scope });
          if (!(key in settings)) return Promise.reject(new SettingNotFoundError(key, new Date()));
          return Promise.resolve({ value: settings[key] });
        }),
      },
      carriers: {
        book: jest.fn((_code: string, request: CarrierBookingRequest) => {
          booked.push(request);
          return Promise.reject(new Error('stop after the carrier call'));
        }),
      },
    });
    return { svc, booked, settingReads };
  }

  it.each(['flash_express', 'deliveree'] as const)(
    'sends the %s booking with getpack as the sender and nothing about the factory',
    async (code) => {
      const { svc, booked, settingReads } = service(ENTITY_SETTINGS);
      const actor = { type: 'user', userId: 1n, audience: 'staff' } as never;
      await expect(svc.bookCarrier(actor, 7n, code)).rejects.toThrow('stop after the carrier call');
      expect(booked).toHaveLength(1);
      const request = booked[0]!;
      expect(request.from).toMatchObject({
        name: 'getpack (fake display name)',
        phone: '02-000-0000',
        addressLine: '99/9 Fake Return Rd (fake)',
        postcode: '10000',
        lat: 13.75,
        lng: 100.5,
      });
      expect(request.to).toMatchObject({ name: 'Fake Customer', postcode: '50000' });
      const sent = JSON.stringify(request);
      for (const leak of [
        FACTORY.legalName,
        FACTORY.addresses[0]!.line1,
        FACTORY.addresses[0]!.postcode,
        FACTORY.contacts[0]!.name,
        FACTORY.contacts[0]!.phone,
        '13.1',
        '101.1',
      ])
        expect(sent).not.toContain(leak);
      // Company data comes from the entity's settings, never constants.
      expect(settingReads.map((r) => r.key).sort()).toEqual([
        'entity.display_name',
        'entity.phone',
        'entity.return_address',
      ]);
      for (const read of settingReads) expect(read.scope).toEqual({ type: 'entity', id: 1n });
    },
  );

  it('refuses before calling the carrier when the return address is not set', async () => {
    const { 'entity.return_address': _unset, ...rest } = ENTITY_SETTINGS;
    const { svc, booked } = service(rest);
    const actor = { type: 'user', userId: 1n, audience: 'staff' } as never;
    await expect(svc.bookCarrier(actor, 7n, 'flash_express')).rejects.toMatchObject({
      code: 'shipments.carrier_unavailable',
    });
    expect(booked).toHaveLength(0);
  });
});
