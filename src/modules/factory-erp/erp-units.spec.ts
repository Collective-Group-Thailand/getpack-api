import { ERP_UNITS } from './erp.dto';
import { UNIT_TH } from './erp-documents.render';

describe('Factory ERP units (D-384)', () => {
  it('prints every unit in Thai on the factory documents', () => {
    expect(ERP_UNITS.filter((unit) => !UNIT_TH[unit])).toEqual([]);
  });

  it('offers the packaging and service units', () => {
    expect(ERP_UNITS).toEqual(expect.arrayContaining(['pouch', 'tube', 'job', 'round', 'trip']));
  });
});
