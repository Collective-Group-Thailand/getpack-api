import { type AuditRow, toCsv } from './audit-query.service';

const row = (data: Record<string, unknown>, action = 'auth.login_failed'): AuditRow =>
  ({
    occurredAt: new Date('2026-09-23T07:05:00Z'),
    category: 'security',
    action,
    outcome: 'denied',
    actorType: 'system',
    actorUser: null,
    actorApiClient: null,
    onBehalfOf: null,
    resourceType: null,
    resourcePublicId: null,
    requestId: 'req-1',
    data,
  }) as unknown as AuditRow;

describe('audit CSV', () => {
  it('quotes every cell, escapes quotes and uses CRLF', () => {
    const csv = toCsv([row({ note: 'say "hi"' })]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe(
      'occurred_at,category,action,outcome,actor_type,actor_id,actor_name,on_behalf_of,resource_type,resource_id,request_id,data',
    );
    expect(line).toContain('"{""note"":""say \\""hi\\""""}"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    const csv = toCsv([row({}, '=HYPERLINK("http://example.invalid")')]);
    expect(csv).toContain('"\'=HYPERLINK(""http://example.invalid"")"');
  });
});
