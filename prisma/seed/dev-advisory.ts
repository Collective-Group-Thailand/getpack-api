import { type Prisma } from '../../src/generated/prisma/client';
import { type AdvisoryRuleSet } from '../../src/platform/settings/setting-keys';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

/**
 * The literature-based rule-set **proposal** of `docs/advisory-validation.md` (D-237) — the same values as
 * `test/golden/advisory/golden.json`. Only the dev seed and the tests set it: production keeps `advisory.rule_set`
 * unset until the Partner Manager and Prepress sign the golden cases (D-189).
 */
export const DEV_ADVISORY_RULE_SET: AdvisoryRuleSet = {
  mckeeConstant: '5.87',
  uncertaintyPct: '15',
  formulas: ['rsc', 'full_overlap'],
  thinMarginPct: '10',
  factors: {
    humidity: { dry: '1', normal: '0.8', humid: '0.6', very_humid: '0.5' },
    storage: { up_to_10_days: '0.63', up_to_30_days: '0.6', up_to_90_days: '0.55', over_90_days: '0.5' },
    palletPattern: { none: '0.85', column: '0.9', interlocked: '0.55' },
    palletOverhang: { none: '1', overhang: '0.7' },
    transport: { pickup: '1', parcel_domestic: '0.7', pallet_domestic: '0.85', sea_export: '0.75' },
    fragility: { low: '1', medium: '0.9', high: '0.8' },
  },
};

export interface DevAdvisory {
  /** Board public id → its sheet public id (KI230 has none: excluded for missing data, D-188). */
  sheets: Record<string, string>;
}

/**
 * Obviously fake Structure Advisor data for `pnpm dev` and the tests (U2.2, D-005): the rule-set proposal as an
 * approved `advisory.rule_set` version, and made-up signed board sheets of the dev factory F9001 for the KA125 and
 * KA185 dev boards. The flag `advisory.structure_advisor` stays off. Idempotent. Needs `seedDevCorrugate`.
 */
export async function seedDevAdvisory(tx: Tx): Promise<{ created: boolean; fixture: DevAdvisory }> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  const setting = await tx.setting.findFirstOrThrow({
    where: { key: 'advisory.rule_set', scopeType: 'platform' },
  });
  const boards = await tx.material.findMany({
    where: { code: { in: ['dev-ka125-b', 'dev-ka185-b'] } },
    orderBy: { code: 'asc' },
  });
  const describe = async (): Promise<DevAdvisory> => {
    const sheets = await tx.boardStrengthSheet.findMany({
      where: { factoryId: factory.id },
      include: { material: { select: { publicId: true } } },
    });
    return { sheets: Object.fromEntries(sheets.map((s) => [s.material.publicId, s.publicId])) };
  };
  if ((await tx.settingVersion.count({ where: { settingId: setting.id } })) > 0) {
    return { created: false, fixture: await describe() };
  }
  await tx.settingVersion.create({
    data: {
      settingId: setting.id,
      versionNo: 1,
      effectiveFrom: DEV_EFFECTIVE_FROM,
      status: 'approved',
      value: DEV_ADVISORY_RULE_SET as unknown as Prisma.InputJsonValue,
      reason: 'dev seed: the unsigned proposal of docs/advisory-validation.md (fake)',
      decidedAt: new Date(),
    },
  });
  const values: Record<string, { ect: number; caliper: number; gsm: number }> = {
    'dev-ka125-b': { ect: 5, caliper: 3, gsm: 450 },
    'dev-ka185-b': { ect: 6.8, caliper: 3.1, gsm: 560 },
  };
  for (const board of boards) {
    const v = values[board.code]!;
    const file = await tx.fileObject.create({
      data: {
        bucket: 'dev',
        storageKey: `dev/advisory/${board.code}-sheet.pdf`,
        originalName: `[DEV] ${board.code} board data sheet.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        retentionClass: 'financial_record',
        ownerFactoryId: factory.id,
      },
    });
    await tx.boardStrengthSheet.create({
      data: {
        factoryId: factory.id,
        materialId: board.id,
        versionNo: 1,
        ectKnPerM: v.ect,
        caliperMm: v.caliper,
        grammageGsm: v.gsm,
        testMethod: '[DEV] ISO 3037',
        dataSheetFileId: file.id,
        signedOn: new Date('2026-01-01'),
        effectiveFrom: DEV_EFFECTIVE_FROM,
        note: '[DEV] made-up values',
      },
    });
  }
  return { created: true, fixture: await describe() };
}
