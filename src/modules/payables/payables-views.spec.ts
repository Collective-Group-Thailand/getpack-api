import { MoneyDecimal } from '@common/money/money';
import { DECORATORS } from '@nestjs/swagger';

import {
  ADMIN_BS_EXAMPLE,
  ADMIN_PO_EXAMPLE,
  AdminBillingStatementDto,
  AdminPurchaseOrderDto,
  BillingStatementDto,
  PurchaseOrderDto,
} from './payables.dto';
import { type BsRow, type PoRow } from './payables-query.service';
import { adminBsDto, adminPoDto, factoryLabel, poDto } from './payables-views';

const fields = (cls: abstract new () => unknown): string[] =>
  (
    (Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, cls.prototype) as string[] | undefined) ?? []
  ).map((k) => k.replace(/^:/, ''));

const factory = {
  publicId: '0192f3a0-7c1e-7d2a-9b1f-000000000009',
  code: 'F9001',
  legalName: 'บริษัท โรงพิมพ์ทดสอบ จำกัด',
  tradeName: 'โรงพิมพ์ทดสอบ',
};
const zero = new MoneyDecimal(0);
const po = {
  publicId: 'po-1',
  poNumber: 'DEVPO-26-00001',
  poKind: 'production',
  status: 'issued',
  factory,
  productionJob: { jobNo: 'JOB-1' },
  order: { orderCode: 'PK-1' },
  issuedAt: new Date('2026-10-20T03:00:00Z'),
  netAmount: zero,
  vatAmount: zero,
  grossAmount: zero,
  lines: [],
} as unknown as PoRow;

/** Admin finance names the factory on purchase orders and billing statements (D-463 follow-up, admin only). */
describe('payables views: factory name for staff', () => {
  it('adds the factory name (trade name, else legal name) and code to the admin PO only', () => {
    expect(adminPoDto(po)).toMatchObject({
      factoryId: factory.publicId,
      factoryName: 'โรงพิมพ์ทดสอบ',
      factoryCode: 'F9001',
    });
    expect(poDto(po)).not.toHaveProperty('factoryName');
    expect(poDto(po)).not.toHaveProperty('factoryCode');
    expect(factoryLabel({ legalName: 'บริษัท ก จำกัด', tradeName: null })).toBe('บริษัท ก จำกัด');
    expect(factoryLabel({ legalName: 'บริษัท ก จำกัด', tradeName: '  ' })).toBe('บริษัท ก จำกัด');
  });

  it('adds them to the admin billing statement', () => {
    const base = { id: 'bs-1', factoryId: factory.publicId } as unknown as BillingStatementDto;
    expect(adminBsDto({ factory } as unknown as BsRow, base)).toEqual({
      ...base,
      factoryName: 'โรงพิมพ์ทดสอบ',
      factoryCode: 'F9001',
    });
  });

  it('documents the fields on the admin contracts only', () => {
    for (const cls of [AdminPurchaseOrderDto, AdminBillingStatementDto])
      expect(fields(cls)).toEqual(expect.arrayContaining(['factoryId', 'factoryName', 'factoryCode']));
    for (const cls of [PurchaseOrderDto, BillingStatementDto]) {
      expect(fields(cls)).not.toContain('factoryName');
      expect(fields(cls)).not.toContain('factoryCode');
    }
    expect(ADMIN_PO_EXAMPLE).toHaveProperty('factoryName');
    expect(ADMIN_BS_EXAMPLE).toHaveProperty('factoryCode');
  });
});
