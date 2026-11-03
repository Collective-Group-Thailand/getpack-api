import { bangkokMinuteOfDay, toBangkokIso } from '@common/time/bangkok';
import {
  type SalesAgentLeadLostReason,
  type SalesAgentLeadStage,
  type SalesAgentLeadStatus,
} from '@generated/prisma/client';

/**
 * D-468 (PLAN A-06): the lead pipeline's pure rules — stage moves an agent may make, quiet hours of the follow-up
 * reminder, and the CSV format of export / import (formula-safe). No I/O; unit-tested.
 */

export const LEAD_STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost'] as const;
/** What an agent may move a lead to: never `won` (the system sets it on the first payment, A-06). */
export const AGENT_STAGE_TARGETS = ['new', 'contacted', 'quoted', 'negotiating', 'lost'] as const;
export const LOST_REASONS = ['price', 'lead_time', 'no_need', 'competitor', 'no_response', 'other'] as const;
export const LEAD_SOURCES = ['manual', 'card_scan', 'csv_import', 'link', 'staff'] as const;
/** Sources an agent sets when registering a lead themselves. */
export const AGENT_LEAD_SOURCES = ['manual', 'card_scan'] as const;
export const ACTIVITY_KINDS = [
  'call',
  'line',
  'visit',
  'email',
  'note',
  'quote_sent',
  'stage_change',
  'system',
] as const;
/** Entries an agent writes; `quote_sent`, `stage_change` and `system` are written by the system. */
export const AGENT_ACTIVITY_KINDS = ['call', 'line', 'visit', 'email', 'note'] as const;
/** Lead statuses whose pipeline is still worked (D-417 status × D-468 stage). */
export const WORKABLE_STATUSES: readonly SalesAgentLeadStatus[] = ['registered', 'converted'];
export const FINAL_STAGES: readonly SalesAgentLeadStage[] = ['won', 'lost'];

export type StageRefusal = 'agents.lead_closed' | 'agents.lead_stage_final' | null;

/** Whether an agent may move a lead from its stage (and status) to `to`; `null` = allowed. */
export function stageMoveRefusal(
  lead: { stage: SalesAgentLeadStage; status: SalesAgentLeadStatus },
  to: (typeof AGENT_STAGE_TARGETS)[number],
): StageRefusal {
  if (!WORKABLE_STATUSES.includes(lead.status)) return 'agents.lead_closed';
  if (FINAL_STAGES.includes(lead.stage) && lead.stage !== to) return 'agents.lead_stage_final';
  return null;
}

/** The system moves a lead forward (a quote sent → quoted; a discount asked → negotiating), never backwards. */
export function systemStageAfter(
  current: SalesAgentLeadStage,
  event: 'quote_sent' | 'discount_requested',
): SalesAgentLeadStage | null {
  const order: SalesAgentLeadStage[] = ['new', 'contacted', 'quoted', 'negotiating'];
  const target: SalesAgentLeadStage = event === 'quote_sent' ? 'quoted' : 'negotiating';
  const from = order.indexOf(current);
  return from >= 0 && from < order.indexOf(target) ? target : null;
}

export interface QuietHours {
  /** Start of the quiet period, HH:mm Bangkok (e.g. 21:00). */
  from: string;
  /** End of the quiet period, HH:mm Bangkok (e.g. 08:00). */
  to: string;
}

const minutes = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** True inside the quiet hours (`agents.follow_up_quiet_hours`, Asia/Bangkok); the window may cross midnight. */
export function inQuietHours(now: Date, quiet: QuietHours): boolean {
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  const current = bangkokMinuteOfDay(now);
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

// --- CSV ------------------------------------------------------------------------------------------------------------

/**
 * One CSV cell: quoted; a cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` so a spreadsheet never
 * runs it as a formula (CSV injection). Thai mobile numbers are written locally (0812345678) so they need no prefix.
 */
export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** +66812345678 → 0812345678; other numbers unchanged. */
export function localPhone(e164: string | null): string {
  if (!e164) return '';
  return /^\+66\d{8,9}$/.test(e164) ? `0${e164.slice(3)}` : e164;
}

export const EXPORT_COLUMNS = [
  'contact_name',
  'organisation_name',
  'phone',
  'email',
  'tax_id',
  'line_id',
  'industry',
  'tags',
  'stage',
  'source',
  'expected_value',
  'next_follow_up_at',
  'status',
  'protected_until',
  'created_at',
] as const;

export interface ExportLead {
  contactName: string;
  organisationName: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  lineId: string | null;
  industry: string | null;
  tags: string[];
  stage: string;
  source: string;
  expectedValue: { toFixed(dp: number): string } | null;
  nextFollowUpAt: Date | null;
  status: string;
  protectedUntil: Date;
  createdAt: Date;
}

/** The agent's own leads as CSV (UTF-8 with BOM for Excel; CRLF). */
export function leadsCsv(rows: readonly ExportLead[]): string {
  const lines = rows.map((r) =>
    [
      r.contactName,
      r.organisationName,
      localPhone(r.phone),
      r.email,
      r.taxId,
      r.lineId,
      r.industry,
      r.tags.join('|'),
      r.stage,
      r.source,
      r.expectedValue?.toFixed(2) ?? '',
      r.nextFollowUpAt ? toBangkokIso(r.nextFollowUpAt) : '',
      r.status,
      toBangkokIso(r.protectedUntil),
      toBangkokIso(r.createdAt),
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[EXPORT_COLUMNS.join(','), ...lines].join('\r\n')}\r\n`;
}

/** RFC 4180 parser (quotes, doubled quotes, CR/LF, BOM). Returns rows of cells; blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Import columns (header names, case-insensitive; Thai aliases accepted). */
export const IMPORT_COLUMNS: Record<string, readonly string[]> = {
  contactName: ['contact_name', 'name', 'ชื่อ', 'ชื่อผู้ติดต่อ'],
  organisationName: ['organisation_name', 'organization_name', 'company', 'บริษัท', 'ร้าน', 'องค์กร'],
  phone: ['phone', 'mobile', 'โทรศัพท์', 'เบอร์โทร'],
  email: ['email', 'e-mail', 'อีเมล'],
  taxId: ['tax_id', 'เลขประจำตัวผู้เสียภาษี'],
  lineId: ['line_id', 'line'],
  industry: ['industry', 'ประเภทธุรกิจ'],
  tags: ['tags', 'แท็ก'],
  expectedValue: ['expected_value', 'มูลค่าที่คาด'],
  nextFollowUpAt: ['next_follow_up_at', 'follow_up', 'วันติดตาม'],
  note: ['note', 'หมายเหตุ'],
};

export const IMPORT_ERROR_CODES = [
  'required',
  'contact_missing',
  'invalid_phone',
  'invalid_email',
  'invalid_tax_id',
  'invalid_amount',
  'invalid_date',
  'too_long',
  'duplicate_in_file',
  'own_lead',
  'unavailable',
  'too_many_leads',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export interface ImportRow {
  rowNo: number;
  contactName: string;
  organisationName: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  lineId: string | null;
  industry: string | null;
  tags: string[];
  expectedValue: string | null;
  nextFollowUpAt: string | null;
  note: string | null;
  errors: { field: string; code: ImportErrorCode }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAX_ID = /^\d{13}$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/** Removes the `'` our own export adds in front of formula-like cells. */
const unguard = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);

/** A Thai local or E.164 number → E.164, else null. */
export function e164(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  if (/^0\d{8,9}$/.test(digits)) return `+66${digits.slice(1)}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^66\d{8,9}$/.test(digits)) return `+${digits}`;
  return null;
}

/** A date or date-time (Bangkok when no offset) → ISO instant, else null. */
export function parseFollowUp(raw: string): string | null {
  const v = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  const hasOffset = /([+-]\d{2}:?\d{2}|Z)$/.test(v);
  const iso = hasOffset ? v : `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '10'}:${m[5] ?? '00'}:00+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parses an import's CSV into rows with field errors (the availability checks come later). */
export function parseImport(text: string): { headerOk: boolean; rows: ImportRow[] } {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(
    Object.entries(IMPORT_COLUMNS).map(([key, names]) => [key, header.findIndex((h) => names.includes(h))]),
  ) as Record<keyof typeof IMPORT_COLUMNS, number>;
  if (index.contactName === undefined || index.contactName < 0) return { headerOk: false, rows: [] };
  const rows = table.slice(1).map((cells, i): ImportRow => {
    const get = (key: string) => {
      const at = index[key];
      const v = at !== undefined && at >= 0 ? unguard((cells[at] ?? '').trim()) : '';
      return v === '' ? null : v;
    };
    const errors: ImportRow['errors'] = [];
    const contactName = get('contactName') ?? '';
    if (contactName.length < 2) errors.push({ field: 'contactName', code: 'required' });
    const text = (key: string, max: number) => {
      const v = get(key);
      if (v && v.length > max) errors.push({ field: key, code: 'too_long' });
      return v ? v.slice(0, max) : null;
    };
    const rawPhone = get('phone');
    const phone = rawPhone ? e164(rawPhone) : null;
    if (rawPhone && !phone) errors.push({ field: 'phone', code: 'invalid_phone' });
    const email = get('email')?.toLowerCase() ?? null;
    if (email && (!EMAIL.test(email) || email.length > 200))
      errors.push({ field: 'email', code: 'invalid_email' });
    const taxId = get('taxId');
    if (taxId && !TAX_ID.test(taxId)) errors.push({ field: 'taxId', code: 'invalid_tax_id' });
    if (!phone && !email && !taxId && !errors.some((e) => e.field !== 'contactName'))
      errors.push({ field: 'phone', code: 'contact_missing' });
    const expectedValue = get('expectedValue')?.replace(/,/g, '') ?? null;
    if (expectedValue && !AMOUNT.test(expectedValue))
      errors.push({ field: 'expectedValue', code: 'invalid_amount' });
    const rawFollow = get('nextFollowUpAt');
    const nextFollowUpAt = rawFollow ? parseFollowUp(rawFollow) : null;
    if (rawFollow && !nextFollowUpAt) errors.push({ field: 'nextFollowUpAt', code: 'invalid_date' });
    const tags = (get('tags') ?? '')
      .split(/[|;]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((t) => t.slice(0, 32));
    return {
      rowNo: i + 2,
      contactName: contactName.slice(0, 200),
      organisationName: text('organisationName', 200),
      phone,
      email,
      taxId,
      lineId: text('lineId', 64),
      industry: text('industry', 100),
      tags,
      expectedValue,
      nextFollowUpAt,
      note: text('note', 1000),
      errors,
    };
  });
  // The same contact twice in one file: the later rows are refused.
  const seen = new Set<string>();
  for (const row of rows) {
    const keys = [row.phone, row.email, row.taxId].filter((k): k is string => Boolean(k));
    if (keys.some((k) => seen.has(k))) row.errors.push({ field: 'phone', code: 'duplicate_in_file' });
    for (const k of keys) seen.add(k);
  }
  return { headerOk: true, rows };
}

export type LostReason = SalesAgentLeadLostReason;
