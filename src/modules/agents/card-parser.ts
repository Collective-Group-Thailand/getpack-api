import { type OcrLine } from '@integrations/ocr/ocr.port';

/**
 * D-468 (Phase 3 item 6): business-card text (Thai + English OCR lines) → lead fields with a confidence each. Pure
 * code, no I/O; nothing is saved — the agent reviews the fields and registers the lead. Confidence = the OCR line's
 * confidence (0–1) × how sure the rule is about the field.
 */

export interface ParsedField {
  value: string;
  /** 0–1. */
  confidence: number;
}

export interface ParsedCard {
  contactName: ParsedField | null;
  organisationName: ParsedField | null;
  phone: ParsedField | null;
  /** Other phone numbers found (office, fax) after the first mobile. */
  otherPhones: ParsedField[];
  email: ParsedField | null;
  taxId: ParsedField | null;
  lineId: ParsedField | null;
  website: ParsedField | null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL = /\b(?:https?:\/\/)?(?:www\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/\S*)?/i;
const LINE_ID = /(?:line(?:\s*id)?|ไลน์)\s*[:：]?\s*(@?[A-Za-z0-9._-]{3,30})/i;
const TAX_HINT = /(?:เลขประจำตัวผู้เสียภาษี|เลขผู้เสียภาษี|tax\s*id|tax\s*no)/i;
const COMPANY =
  /(บริษัท|บจก\.?|หจก\.?|ห้างหุ้นส่วน|ร้าน|co\.?,?\s*ltd|company|limited|corporation|inc\.?|studio|สตูดิโอ|group)/i;
const TITLE = /^(คุณ|นาย|นางสาว|นาง|น\.ส\.|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s*/i;
const ROLE =
  /(ผู้จัดการ|กรรมการ|เจ้าของ|ฝ่าย|แผนก|ประธาน|manager|director|owner|officer|executive|sales|marketing|purchasing|ceo|cfo|coo)/i;
const ADDRESS =
  /(ถนน|ถ\.|ซอย|ซ\.|แขวง|เขต|ตำบล|ต\.|อำเภอ|อ\.|จังหวัด|จ\.|road|rd\.|soi|district|bangkok|กรุงเทพ|\d{5})/i;
const FAX = /(fax|แฟกซ์|โทรสาร)/i;

const conf = (line: OcrLine, factor: number) =>
  Math.round(Math.min(1, (line.confidence / 100) * factor) * 100) / 100;

/** Thai tax id / citizen id check digit (mod 11). */
export function validThaiTaxId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** Phone candidates of a line → E.164 (Thai numbers), mobiles first. */
export function phonesIn(text: string): { e164: string; mobile: boolean }[] {
  const out: { e164: string; mobile: boolean }[] = [];
  for (const m of text.matchAll(/(?:\+?66[\s-]?|0)(?:\d[\s-]?){8,9}/g)) {
    const digits = m[0].replace(/[^\d+]/g, '');
    const local = digits.startsWith('+66')
      ? `0${digits.slice(3)}`
      : digits.startsWith('66')
        ? `0${digits.slice(2)}`
        : digits;
    if (!/^0\d{8,9}$/.test(local)) continue;
    out.push({ e164: `+66${local.slice(1)}`, mobile: /^0[689]\d{8}$/.test(local) });
  }
  return out;
}

export function parseCard(lines: readonly OcrLine[]): ParsedCard {
  const clean = lines
    .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), confidence: l.confidence }))
    .filter((l) => l.text.length > 0);
  const used = new Set<number>();
  const card: ParsedCard = {
    contactName: null,
    organisationName: null,
    phone: null,
    otherPhones: [],
    email: null,
    taxId: null,
    lineId: null,
    website: null,
  };

  const phones: (ParsedField & { mobile: boolean })[] = [];
  clean.forEach((line, i) => {
    const email = EMAIL.exec(line.text);
    if (email && !card.email) {
      card.email = { value: email[0].toLowerCase(), confidence: conf(line, 1) };
      used.add(i);
    }
    const lineId = LINE_ID.exec(line.text);
    if (lineId && !card.lineId && !EMAIL.test(lineId[1]!)) {
      card.lineId = { value: lineId[1]!, confidence: conf(line, 0.95) };
      used.add(i);
    }
    const digits13 = line.text.replace(/[\s-]/g, '').match(/\d{13}/);
    if (digits13 && !card.taxId) {
      const valid = validThaiTaxId(digits13[0]);
      if (valid || TAX_HINT.test(line.text)) {
        card.taxId = {
          value: digits13[0],
          confidence: conf(line, valid ? (TAX_HINT.test(line.text) ? 1 : 0.8) : 0.4),
        };
        used.add(i);
        return;
      }
    }
    const url = URL.exec(line.text);
    if (url && !card.website && !email) {
      card.website = { value: url[0], confidence: conf(line, 0.9) };
      used.add(i);
    }
    if (!FAX.test(line.text))
      for (const p of phonesIn(line.text)) {
        phones.push({ value: p.e164, confidence: conf(line, p.mobile ? 0.95 : 0.8), mobile: p.mobile });
        used.add(i);
      }
    else if (phonesIn(line.text).length) used.add(i);
  });
  phones.sort((a, b) => Number(b.mobile) - Number(a.mobile));
  const unique = phones.filter((p, i) => phones.findIndex((q) => q.value === p.value) === i);
  if (unique[0]) card.phone = { value: unique[0].value, confidence: unique[0].confidence };
  card.otherPhones = unique.slice(1).map((p) => ({ value: p.value, confidence: p.confidence }));

  // Organisation: a line with a company word.
  const orgAt = clean.findIndex((l, i) => !used.has(i) && COMPANY.test(l.text) && !ADDRESS.test(l.text));
  if (orgAt >= 0) {
    card.organisationName = { value: clean[orgAt]!.text, confidence: conf(clean[orgAt]!, 0.9) };
    used.add(orgAt);
  }

  // Name: a titled line first, else the first short line that is not a role, address or company.
  const candidates = clean
    .map((l, i) => ({ ...l, i }))
    .filter((l) => !used.has(l.i) && !ROLE.test(l.text) && !ADDRESS.test(l.text) && !/\d/.test(l.text));
  const titled = candidates.find((l) => TITLE.test(l.text));
  const pick = titled ?? candidates.find((l) => l.text.split(' ').length <= 4 && l.text.length <= 40);
  if (pick) card.contactName = { value: pick.text, confidence: conf(pick, titled ? 0.95 : 0.6) };
  return card;
}
