import { PARTNER_HIDDEN_DESTINATION_FIELDS } from '@common/privacy/partner-destination';
import { DECORATORS } from '@nestjs/swagger';

import { adminJobDto, type JobRow, partnerJobDto } from './job-views';
import {
  ADMIN_JOB_EXAMPLE,
  AdminJobDestinationDto,
  JobDestinationDto,
  PARTNER_JOB_EXAMPLE,
} from './production.dto';

/** Swagger property names declared on a DTO class (its own and inherited). */
const swaggerFields = (cls: abstract new () => unknown): string[] =>
  (
    (Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, cls.prototype) as string[] | undefined) ?? []
  ).map((k) => k.replace(/^:/, ''));

const publicId = (id: bigint) => `0192f3a0-7c1e-7d2a-9b1f-${String(id).padStart(12, '0')}`;
const destination = (id: bigint, sort: number, postcode: string) => ({
  id,
  publicId: publicId(id),
  recipientName: `ผู้รับ ${id}`,
  phone: '+66810001234',
  line1: '1 ถนนทดสอบ',
  line2: 'ชั้น 2',
  postcode,
  sort,
  quantity: 500,
  province: { nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok' },
});

const at = new Date('2026-10-01T03:00:00Z');
const row = {
  publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000100',
  jobNo: 'JOB-2610-00001',
  jobKind: 'production',
  status: 'released',
  releasedAt: at,
  acceptDueAt: at,
  acceptedAt: null,
  plannedStartOn: null,
  plannedFinishOn: null,
  promisedShipDate: null,
  quantityOrdered: 1000,
  quantityGood: null,
  quantityScrap: null,
  lotNo: null,
  specSnapshot: { productTypeNameTh: 'กล่องพับ', unit: 'ชิ้น' },
  routeSnapshot: { steps: [] },
  inspectionRequired: false,
  holdReason: null,
  atRiskSince: null,
  rejectedAt: null,
  rejectReasonCode: null,
  rejectNote: null,
  toleranceDimensionalMm: null,
  toleranceColourDeltaE: null,
  releaseMode: 'auto',
  releaseReason: null,
  escalatedAt: null,
  predictedFinishOn: null,
  inspectionReasons: [],
  buyPriceSnapshot: {},
  order: {
    publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000200',
    orderCode: 'PK-2610-0001-01',
    toleranceShortagePct: null,
    toleranceOveragePct: null,
    productType: { code: 'folding_box' },
    // Already in the stable order JOB_INCLUDE asks for (`sort`, then id).
    destinations: [destination(11n, 0, '10110'), destination(12n, 1, '50200')],
  },
  inspections: [],
  factory: { publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000300', code: 'F9001' },
  milestones: [],
  assignments: [],
} as unknown as JobRow;

describe('job views: no customer identity for the factory (P4-01 / P4-D1)', () => {
  it('gives the factory destination codes, postcode prefixes and provinces only', () => {
    const dto = partnerJobDto(row, new Map(), { shipped: new Map([[12n, 200]]), proofs: new Map() });
    expect(dto.destinations).toEqual([
      {
        id: publicId(11n),
        code: 'D1',
        postcodePrefix: '101',
        provinceNameTh: 'กรุงเทพมหานคร',
        provinceNameEn: 'Bangkok',
        quantity: 500,
        shippedQuantity: 0,
      },
      {
        id: publicId(12n),
        code: 'D2',
        postcodePrefix: '502',
        provinceNameTh: 'กรุงเทพมหานคร',
        provinceNameEn: 'Bangkok',
        quantity: 500,
        shippedQuantity: 200,
      },
    ]);
    const json = JSON.stringify(dto);
    for (const field of PARTNER_HIDDEN_DESTINATION_FIELDS) expect(json).not.toContain(`"${field}"`);
    expect(json).not.toContain('ผู้รับ');
    expect(json).not.toContain('+66810001234');
    expect(json).not.toContain('10110');
  });

  it('keeps the recipient contact for staff, with the same codes', () => {
    const dto = adminJobDto(row, new Map(), { cost: false, margin: false });
    expect(dto.destinations[1]).toMatchObject({
      code: 'D2',
      postcodePrefix: '502',
      recipientName: 'ผู้รับ 12',
      phone: '+66810001234',
      line1: '1 ถนนทดสอบ',
      line2: 'ชั้น 2',
      postcode: '50200',
    });
  });

  it('declares no recipient field on the partner destination contract', () => {
    const fields = swaggerFields(JobDestinationDto);
    expect(fields).toEqual(expect.arrayContaining(['code', 'postcodePrefix', 'provinceNameTh', 'quantity']));
    for (const field of PARTNER_HIDDEN_DESTINATION_FIELDS) expect(fields).not.toContain(field);
    expect(swaggerFields(AdminJobDestinationDto)).toEqual(
      expect.arrayContaining([...PARTNER_HIDDEN_DESTINATION_FIELDS, 'code']),
    );
  });

  it('keeps the recipient out of the partner example and in the admin one', () => {
    for (const d of PARTNER_JOB_EXAMPLE.destinations)
      for (const field of PARTNER_HIDDEN_DESTINATION_FIELDS) expect(d).not.toHaveProperty(field);
    expect(ADMIN_JOB_EXAMPLE.destinations[0]).toHaveProperty('recipientName');
  });
});
