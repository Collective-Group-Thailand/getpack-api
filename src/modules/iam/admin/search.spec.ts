import { searchKind } from './search.controller';

describe('admin search kind (U-B0.3, PDPA)', () => {
  it('matches e-mails and phone numbers exactly, anything else as a code', () => {
    expect(searchKind('Somchai@Example.com')).toEqual({ kind: 'email', value: 'somchai@example.com' });
    expect(searchKind('080-000-0001')).toEqual({ kind: 'phone', value: '+66800000001' });
    expect(searchKind('2610-00001')).toEqual({ kind: 'code', value: '2610-00001' });
    expect(searchKind('DEV-2610')).toEqual({ kind: 'code', value: 'DEV-2610' });
  });
});
