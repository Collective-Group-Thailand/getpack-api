import {
  csvCell,
  e164,
  inQuietHours,
  leadsCsv,
  localPhone,
  parseCsv,
  parseFollowUp,
  parseImport,
  stageMoveRefusal,
  systemStageAfter,
} from './agent-lead-rules';
import { decodeLeadCursor, leadListWhere } from './agent-leads.service';

const QUIET = { from: '21:00', to: '08:00' };
/** A Bangkok wall-clock time on 2026-11-03 as an instant. */
const bkk = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00+07:00`);

describe('lead stages (D-468, PLAN A-06)', () => {
  it('lets an agent move an open lead between the working stages and to lost', () => {
    for (const to of ['new', 'contacted', 'quoted', 'negotiating', 'lost'] as const)
      expect(stageMoveRefusal({ stage: 'contacted', status: 'registered' }, to)).toBeNull();
    expect(stageMoveRefusal({ stage: 'quoted', status: 'converted' }, 'lost')).toBeNull();
  });

  it('keeps won and lost final and closed leads closed', () => {
    expect(stageMoveRefusal({ stage: 'won', status: 'converted' }, 'negotiating')).toBe(
      'agents.lead_stage_final',
    );
    expect(stageMoveRefusal({ stage: 'lost', status: 'withdrawn' }, 'new')).toBe('agents.lead_closed');
    expect(stageMoveRefusal({ stage: 'lost', status: 'converted' }, 'new')).toBe('agents.lead_stage_final');
    expect(stageMoveRefusal({ stage: 'new', status: 'expired' }, 'contacted')).toBe('agents.lead_closed');
  });

  it('moves forward only when the system sends a quote or a discount is asked', () => {
    expect(systemStageAfter('new', 'quote_sent')).toBe('quoted');
    expect(systemStageAfter('contacted', 'quote_sent')).toBe('quoted');
    expect(systemStageAfter('quoted', 'quote_sent')).toBeNull();
    expect(systemStageAfter('negotiating', 'quote_sent')).toBeNull();
    expect(systemStageAfter('quoted', 'discount_requested')).toBe('negotiating');
    expect(systemStageAfter('won', 'discount_requested')).toBeNull();
    expect(systemStageAfter('lost', 'quote_sent')).toBeNull();
  });
});

describe('follow-up quiet hours 21:00–08:00 Bangkok (D-468)', () => {
  it('is quiet late in the evening and early in the morning', () => {
    expect(inQuietHours(bkk('21:00'), QUIET)).toBe(true);
    expect(inQuietHours(bkk('23:59'), QUIET)).toBe(true);
    expect(inQuietHours(bkk('03:00'), QUIET)).toBe(true);
    expect(inQuietHours(bkk('07:59'), QUIET)).toBe(true);
  });

  it('sends during the day', () => {
    expect(inQuietHours(bkk('08:00'), QUIET)).toBe(false);
    expect(inQuietHours(bkk('12:30'), QUIET)).toBe(false);
    expect(inQuietHours(bkk('20:59'), QUIET)).toBe(false);
  });

  it('handles a window inside one day and an empty one', () => {
    expect(inQuietHours(bkk('13:00'), { from: '12:00', to: '14:00' })).toBe(true);
    expect(inQuietHours(bkk('14:00'), { from: '12:00', to: '14:00' })).toBe(false);
    expect(inQuietHours(bkk('13:00'), { from: '00:00', to: '00:00' })).toBe(false);
  });
});

describe('lead CSV (D-468)', () => {
  it('neutralises formulas and quotes every cell', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1+2')).toBe(`"'+1+2"`);
    expect(csvCell('-3')).toBe(`"'-3"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('ร้านกาแฟ, บ้านสวน')).toBe('"ร้านกาแฟ, บ้านสวน"');
    expect(csvCell(null)).toBe('""');
  });

  it('writes Thai mobiles locally so they need no prefix', () => {
    expect(localPhone('+66890001234')).toBe('0890001234');
    expect(localPhone('+6521234567')).toBe('+6521234567');
    expect(localPhone(null)).toBe('');
  });

  it('exports with a BOM, a header and CRLF', () => {
    const csv = leadsCsv([
      {
        contactName: '=cmd',
        organisationName: 'ร้านกาแฟบ้านสวน',
        phone: '+66890001234',
        email: 'manee@example.invalid',
        taxId: null,
        lineId: null,
        industry: null,
        tags: ['a', 'b'],
        stage: 'new',
        source: 'manual',
        expectedValue: { toFixed: () => '45000.00' },
        nextFollowUpAt: null,
        status: 'registered',
        protectedUntil: new Date('2026-12-15T03:00:00Z'),
        createdAt: new Date('2026-10-16T03:00:00Z'),
      },
    ]);
    expect(csv.startsWith('\uFEFFcontact_name,organisation_name,phone')).toBe(true);
    expect(csv).toContain(`"'=cmd","ร้านกาแฟบ้านสวน","0890001234"`);
    expect(csv).toContain('"a|b"');
    expect(csv).toContain('"2026-12-15T10:00:00+07:00"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('parses quoted cells, doubled quotes and CRLF', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('normalises phones and follow-up dates', () => {
    expect(e164('089-000-1234')).toBe('+66890001234');
    expect(e164('66890001234')).toBe('+66890001234');
    expect(e164('+6521234567')).toBe('+6521234567');
    expect(e164('12')).toBeNull();
    expect(parseFollowUp('2026-11-05')).toBe('2026-11-05T03:00:00.000Z');
    expect(parseFollowUp('2026-11-05 14:30')).toBe('2026-11-05T07:30:00.000Z');
    expect(parseFollowUp('5/11/2026')).toBeNull();
  });

  it('reports field errors per row and duplicates within the file', () => {
    const { headerOk, rows } = parseImport(
      [
        'ชื่อ,เบอร์โทร,email,tax_id,expected_value,next_follow_up_at,tags',
        'คุณมานี ใจดี,0890001234,,,"45,000",2026-11-05,เบเกอรี่|รายเดือน',
        'ก,abc,not-mail,123,ten,soon,',
        'คุณสมศรี ตัวอย่าง,089 000 1234,,,,,',
        'Mr. Test Example,,test@example.invalid,,,,',
        'ไม่มีช่องทาง,,,,,,',
      ].join('\n'),
    );
    expect(headerOk).toBe(true);
    expect(rows.map((r) => r.rowNo)).toEqual([2, 3, 4, 5, 6]);
    expect(rows[0]).toMatchObject({
      contactName: 'คุณมานี ใจดี',
      phone: '+66890001234',
      expectedValue: '45000',
      nextFollowUpAt: '2026-11-05T03:00:00.000Z',
      tags: ['เบเกอรี่', 'รายเดือน'],
      errors: [],
    });
    expect(rows[1]!.errors.map((e) => e.code).sort()).toEqual(
      [
        'invalid_amount',
        'invalid_date',
        'invalid_email',
        'invalid_phone',
        'invalid_tax_id',
        'required',
      ].sort(),
    );
    expect(rows[2]!.errors).toEqual([{ field: 'phone', code: 'duplicate_in_file' }]);
    expect(rows[3]).toMatchObject({ email: 'test@example.invalid', errors: [] });
    expect(rows[4]!.errors).toEqual([{ field: 'phone', code: 'contact_missing' }]);
  });

  it('refuses a file without a name column and strips our own formula guard', () => {
    expect(parseImport('phone\n0890001234').headerOk).toBe(false);
    const { rows } = parseImport(`contact_name,phone\n"'=Name",'+66890001234`);
    expect(rows[0]).toMatchObject({ contactName: '=Name', phone: '+66890001234' });
  });
});

describe('pipeline list filters (D-468)', () => {
  const NOW = new Date('2026-11-03T05:00:00Z'); // 12:00 Bangkok

  it('scopes to the agent’s customer leads and maps the views', () => {
    const where = leadListWhere(7n, { view: 'follow_up_today' }, NOW) as { AND: object[] };
    expect(where.AND[0]).toEqual({ agentId: 7n, kind: 'customer' });
    expect(where.AND[2]).toEqual({ nextFollowUpAt: { lt: new Date('2026-11-03T17:00:00Z') } });
    const closed = leadListWhere(7n, { view: 'closed' }, NOW) as { AND: object[] };
    expect(JSON.stringify(closed.AND[1])).toContain('won');
  });

  it('combines stage, source, due and text', () => {
    const where = leadListWhere(
      7n,
      { stage: ['quoted', 'negotiating'], source: 'card_scan', due: 'overdue', q: '0890001234' },
      NOW,
    ) as { AND: object[] };
    expect(where.AND).toContainEqual({ stage: { in: ['quoted', 'negotiating'] } });
    expect(where.AND).toContainEqual({ source: 'card_scan' });
    expect(where.AND).toContainEqual({ nextFollowUpAt: { lt: NOW } });
    expect(JSON.stringify(where.AND.at(-1))).toContain('890001234');
  });

  it('accepts only its own opaque cursors', () => {
    const id = '0192f3a0-7c1e-7d2a-9b1f-0000000a6006';
    expect(decodeLeadCursor(Buffer.from(JSON.stringify({ id })).toString('base64url'))).toBe(id);
    expect(() => decodeLeadCursor('nope')).toThrow();
  });
});
