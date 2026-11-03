import { expectedDates, firstOfNextMonth } from './agent-forecast.service';

const NOW = new Date('2026-11-03T03:00:00Z'); // 10:00 Bangkok
const base = {
  agentKind: 'freelance' as const,
  availableAt: null,
  earnedAt: null,
  groupFullyPaid: true,
  statement: null,
  paymentTermsDays: 15,
  now: NOW,
};

describe('commission forecast dates (D-468 F47, D-466 §5 — not "the 5th")', () => {
  it('rolls to the 1st of the next month', () => {
    expect(firstOfNextMonth('2026-11-30')).toBe('2026-12-01');
    expect(firstOfNextMonth('2026-12-31')).toBe('2027-01-01');
  });

  it('pending: earned after the claim window, statement on the 1st, paid within the terms', () => {
    const d = expectedDates({ ...base, status: 'pending', availableAt: new Date('2026-11-10T05:00:00Z') });
    expect(d).toEqual({
      earnableOn: '2026-11-10',
      statementOn: '2026-12-01',
      expectedPayableOn: '2026-12-16',
      waitingFor: 'claim_window',
    });
    // The window already passed but the group still owes money: waits for payment, earliest today.
    const unpaid = expectedDates({
      ...base,
      status: 'pending',
      availableAt: new Date('2026-10-01T05:00:00Z'),
      groupFullyPaid: false,
    });
    expect(unpaid).toMatchObject({
      earnableOn: '2026-11-03',
      statementOn: '2026-12-01',
      waitingFor: 'payment',
    });
  });

  it('earned / statemented / paid follow the statement', () => {
    expect(
      expectedDates({ ...base, status: 'earned', earnedAt: new Date('2026-10-20T05:00:00Z') }),
    ).toMatchObject({ statementOn: '2026-11-01', expectedPayableOn: '2026-11-16', waitingFor: 'statement' });
    expect(
      expectedDates({
        ...base,
        status: 'statemented',
        statement: {
          status: 'approved',
          periodEnd: new Date('2026-10-31T00:00:00Z'),
          approvedAt: new Date('2026-11-02T03:00:00Z'),
          paidAt: null,
        },
      }),
    ).toMatchObject({ statementOn: '2026-11-02', expectedPayableOn: '2026-11-17', waitingFor: 'payout' });
    expect(
      expectedDates({
        ...base,
        status: 'statemented',
        statement: {
          status: 'draft',
          periodEnd: new Date('2026-10-31T00:00:00Z'),
          approvedAt: null,
          paidAt: null,
        },
      }),
    ).toMatchObject({ statementOn: '2026-11-03', expectedPayableOn: '2026-11-18', waitingFor: 'approval' });
    expect(
      expectedDates({
        ...base,
        status: 'paid',
        statement: {
          status: 'paid',
          periodEnd: new Date('2026-09-30T00:00:00Z'),
          approvedAt: new Date('2026-10-01T03:00:00Z'),
          paidAt: new Date('2026-10-14T03:00:00Z'),
        },
      }),
    ).toMatchObject({ expectedPayableOn: '2026-10-14', waitingFor: null });
  });

  it('employees are paid with payroll on approval; held entries have no date', () => {
    expect(
      expectedDates({
        ...base,
        agentKind: 'employee',
        status: 'earned',
        earnedAt: new Date('2026-10-20T05:00:00Z'),
      }),
    ).toMatchObject({ statementOn: '2026-11-01', expectedPayableOn: '2026-11-01' });
    expect(expectedDates({ ...base, status: 'held' })).toEqual({
      earnableOn: null,
      statementOn: null,
      expectedPayableOn: null,
      waitingFor: 'review',
    });
  });
});
