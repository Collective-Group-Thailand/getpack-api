import { storagePolicy } from '@collective/documents';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { settingValueError } from '@platform/settings/setting-value';

import { SETTINGS } from '../../../prisma/seed/data/settings';
import { storageUsageDto } from './storage.controller';
import { StorageMeteringService } from './storage-metering.service';
import {
  COUNTED_RECORDS,
  DEFAULT_RECORD_BYTES,
  PURPOSE_RETENTION,
  STORAGE_SETTING_SCHEMAS,
} from './storage-settings';

const GIB = 1024n ** 3n;

/** A SettingsService stand-in: `values` by key, version ids 1…n. */
function settingsOf(values: Record<string, unknown>) {
  const keys = Object.keys(values);
  return {
    at: (key: string) =>
      key in values
        ? Promise.resolve({ value: values[key], versionId: BigInt(keys.indexOf(key) + 1) })
        : Promise.reject(new Error(`no ${key}`)),
  };
}

const SEEDED = Object.fromEntries(
  SETTINGS.filter((s) => s.key.startsWith('storage.')).map((s) => [s.key, s.value]),
) as Record<string, unknown>;

function service(options: {
  settings?: Record<string, unknown>;
  snapshots?: { day: string; bytes: bigint }[];
}) {
  const rows = (options.snapshots ?? []).map((s) => ({
    day: new Date(`${s.day}T00:00:00Z`),
    counted_bytes: s.bytes,
  }));
  const prisma = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('ORDER BY day DESC LIMIT 1')) return Promise.resolve(rows.slice(-1));
      if (sql.includes('FROM storage_usage_daily')) return Promise.resolve(rows);
      return Promise.resolve([]);
    }),
  };
  const files = { registerUploadAdmission: jest.fn() };
  const metering = new StorageMeteringService(
    prisma as never,
    settingsOf(options.settings ?? SEEDED) as never,
    { record: jest.fn() } as never,
    files as never,
  );
  return { metering, prisma, files };
}

describe('storage settings (D-436)', () => {
  it('seeds 5 GB free for every account type, no price and no packs, each valid against its schema', () => {
    const storage = SETTINGS.filter((s) => s.key.startsWith('storage.'));
    expect(storage.map((s) => s.key).sort()).toEqual(Object.keys(STORAGE_SETTING_SCHEMAS).sort());
    for (const s of storage) {
      expect(s.ownerRole).toBe('superadmin');
      expect(s.decisions).toContain('D-436');
      expect(settingValueError(s.valueType, s.value, s.valueSchema)).toBeNull();
    }
    expect(SEEDED['storage.free_gb']).toEqual({ factory: '5', partner: '5' });
    expect(SEEDED['storage.price_per_gb_month']).toEqual({ factory: null, partner: null });
    expect(SEEDED['storage.packs']).toEqual([]);
  });

  it('refuses malformed values the admin might type', () => {
    const json = (key: keyof typeof STORAGE_SETTING_SCHEMAS, value: unknown) =>
      settingValueError('json', value, STORAGE_SETTING_SCHEMAS[key]);
    expect(json('storage.free_gb', { factory: '5' })).not.toBeNull(); // partner missing
    expect(json('storage.free_gb', { factory: '5', partner: 5 })).not.toBeNull(); // not a string
    expect(json('storage.free_gb', { factory: '5', partner: '5', landlord: '1' })).not.toBeNull();
    expect(json('storage.price_per_gb_month', { factory: '1.50', partner: null })).toBeNull();
    expect(json('storage.packs', [{ key: 'plus-20', gb: '20', monthlyPrice: '49.00' }])).toBeNull();
    expect(json('storage.packs', [{ key: 'Plus 20', gb: '20', monthlyPrice: '49.00' }])).not.toBeNull();
    expect(json('storage.record_bytes', { sales_invoice: 2048 })).not.toBeNull(); // _default required
    expect(json('storage.notice_at_percent', [])).not.toBeNull();
  });

  it('classifies every upload purpose; only images, avatars and design assets are optional', () => {
    expect(Object.keys(PURPOSE_RETENTION).sort()).toEqual(Object.keys(FILE_PURPOSES).sort());
    const optional = Object.entries(PURPOSE_RETENTION)
      .filter(([, r]) => r === 'optional')
      .map(([p]) => p);
    expect(optional.sort()).toEqual(['avatar', 'design_asset', 'image']);
    expect(PURPOSE_RETENTION.document).toBe('legal');
  });

  it('gives every counted record type a recommended size', () => {
    for (const type of Object.keys(COUNTED_RECORDS)) expect(DEFAULT_RECORD_BYTES).toHaveProperty(type);
  });
});

describe('StorageMeteringService (D-436)', () => {
  it('registers its admission check with the files service', () => {
    const { metering, files } = service({});
    metering.onModuleInit();
    expect(files.registerUploadAdmission).toHaveBeenCalledTimes(1);
  });

  it('reads the policy of an account type with the version ids used', async () => {
    const { metering } = service({});
    const policy = await metering.policyAt('factory', new Date());
    expect(policy.freeGb).toBe('5');
    expect(policy.pricePerGbMonth).toBeNull();
    expect(policy.policy?.freeBytes).toBe(5n * GIB);
    expect(policy.settingVersionIds).toHaveLength(5);
  });

  it('without an allowance there is no policy, and every upload is accepted', async () => {
    const { metering } = service({
      settings: { ...SEEDED, 'storage.free_gb': { factory: null, partner: '5' } },
    });
    expect((await metering.policyAt('factory', new Date())).policy).toBeNull();
    await expect(metering.admitUpload(1n, 'image', 10)).resolves.toEqual({ accepted: true, overage: false });
  });

  it('never holds legal or operational files, even far over the allowance', async () => {
    const { metering } = service({ snapshots: [{ day: '2026-10-24', bytes: 50n * GIB }] });
    for (const purpose of ['document', 'slip', 'artwork', 'proof', 'evidence'] as const) {
      await expect(metering.admitUpload(1n, purpose, 1_000_000)).resolves.toMatchObject({ accepted: true });
    }
  });

  it('holds an optional upload that would go over while overage is not sold, and accepts it once it is', async () => {
    const over = [{ day: '2026-10-24', bytes: 5n * GIB - 10n }];
    const held = service({ snapshots: over }).metering;
    await expect(held.admitUpload(1n, 'image', 100)).resolves.toEqual({
      accepted: false,
      reason: 'storage.allowance_exceeded',
    });
    await expect(held.admitUpload(1n, 'image', 5)).resolves.toEqual({ accepted: true, overage: false });
    const sold = service({
      settings: { ...SEEDED, 'storage.price_per_gb_month': { factory: '2.00', partner: null } },
      snapshots: over,
    }).metering;
    await expect(sold.admitUpload(1n, 'image', 100)).resolves.toEqual({ accepted: true, overage: true });
  });

  it('charges a month like a cloud drive: the daily average above the allowance, per GB-month', async () => {
    // 10 GB from the 16th of a 30-day month (nothing stored before the first snapshot), 2 THB / GB-month:
    // 5 GB over for 15 of 30 days = 2.5 GB-months.
    const snapshots = [{ day: '2026-11-16', bytes: 10n * GIB }];
    const { metering } = service({
      settings: { ...SEEDED, 'storage.price_per_gb_month': { factory: '2.00', partner: null } },
      snapshots,
    });
    const charge = await metering.monthlyCharge(1n, '2026-11');
    expect(charge).toMatchObject({ month: '2026-11', days: 30, overageGbMonths: '2.500', total: '5.00' });
  });

  it('has no charge for a month without snapshots, or while no allowance is set', async () => {
    await expect(service({}).metering.monthlyCharge(1n, '2026-11')).resolves.toBeNull();
    const unset = service({
      settings: { ...SEEDED, 'storage.free_gb': { factory: null, partner: null } },
      snapshots: [{ day: '2026-11-01', bytes: GIB }],
    }).metering;
    await expect(unset.monthlyCharge(1n, '2026-11')).resolves.toBeNull();
  });
});

describe('storageUsageDto', () => {
  const policy = storagePolicy({
    freeGb: '5',
    pricePerGbMonth: null,
    packs: [{ key: 'plus-20', gb: '20', monthlyPrice: '49.00' }],
    recordBytes: { sales_invoice: 2048 },
    defaultRecordBytes: 1024,
    noticeAtPercent: [80, 100],
  });

  it('reports files, records at their counted size, the allowance and the level', () => {
    const dto = storageUsageDto(
      {
        accountType: 'factory',
        usage: { fileBytes: 4n * GIB, records: { sales_invoice: 1000, item: 10 } },
        state: {
          usedBytes: 4n * GIB + 2_058_240n,
          allowanceBytes: 5n * GIB,
          usedBasisPoints: 8003,
          level: 'warning',
        },
        policy: { policy, freeGb: '5', pricePerGbMonth: null, settingVersionIds: [] },
      },
      new Date('2026-10-25T02:30:00Z'),
    );
    expect(dto).toMatchObject({
      usedPct: '80.0',
      level: 'warning',
      recordBytes: 2_058_240,
      allowanceBytes: Number(5n * GIB),
      packs: [{ key: 'plus-20', gb: '20', monthlyPrice: '49.00' }],
      asOf: '2026-10-25T09:30:00+07:00',
    });
    expect(dto.records[0]).toEqual({ type: 'sales_invoice', count: 1000, bytesEach: 2048 });
  });
});
