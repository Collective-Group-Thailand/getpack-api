import { periodKey, renderNumber } from './document-numbering.service';

describe('document numbering (schema-design §2.7)', () => {
  // 2026-12-31 23:30 UTC is already 2027-01-01 in Asia/Bangkok.
  const newYearBangkok = new Date('2026-12-31T23:30:00Z');

  it('keys periods by the Bangkok date', () => {
    expect(periodKey('never', newYearBangkok)).toBe('all');
    expect(periodKey('yearly', newYearBangkok)).toBe('2027');
    expect(periodKey('monthly', newYearBangkok)).toBe('2027-01');
  });

  it('renders prefix, dates and the zero-padded sequence', () => {
    expect(renderNumber('{prefix}-{yyyy}-{seq:6}', 'QT', newYearBangkok, 42n)).toBe('QT-2027-000042');
    expect(renderNumber('{prefix}-{yy}{mm}-{seq:5}', 'RFQ', newYearBangkok, 7n)).toBe('RFQ-2701-00007');
    expect(renderNumber('{prefix}{seq:2}', 'X', newYearBangkok, 1234n)).toBe('X1234');
  });
});
