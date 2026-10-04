/**
 * D-304 response validation: a fact the assistant states must come from a tool result of the same turn (or the
 * customer's own words). Facts are what a customer could act on — money, dates, strengths and measures, any other
 * number — and policy statements (guarantee, refund, claim, return, delivery terms), which need a help or glossary
 * result. A reply that fails is never shown: the caller replaces it with the safe answer.
 */
export interface FactCheck {
  passed: boolean;
  /** What failed, by kind (`money`, `date`, `number`, `policy`) and the offending text. */
  unsupported: { kind: 'money' | 'date' | 'number' | 'policy'; text: string }[];
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const MONTHS =
  'มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|' +
  'ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.|' +
  'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}\\s*(?:${MONTHS})(?:\\s*\\d{2,4})?`, 'g'),
];
const MONEY = /(?:฿\s*)?\d[\d,]*(?:\.\d+)?\s*(?:บาท|THB|baht|฿)|฿\s*\d[\d,]*(?:\.\d+)?/gi;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
/** Words that make a sentence a policy statement (D-304). */
const POLICY =
  /(รับประกัน|คืนเงิน|ขอคืน|เคลม|เปลี่ยนสินค้า|ยกเลิกคำสั่งซื้อ|ค่าปรับ|นโยบาย|เงื่อนไข|guarantee|warranty|refund|return policy|claim|cancellation)/i;

/** Thai digits as Arabic, thousands separators gone: `๑,๒๐๐.๕๐` → `1200.50`. */
export function normaliseNumber(s: string): string {
  const arabic = [...s].map((c) => (THAI_DIGITS.includes(c) ? String(THAI_DIGITS.indexOf(c)) : c)).join('');
  const n = arabic.replace(/,/g, '').trim();
  return /^\d+(\.\d+)?$/.test(n) ? String(Number(n)) : n;
}

/** Every number a source contains, normalised (`12.50` and `12.5` match). */
function numbersIn(source: string): Set<string> {
  const out = new Set<string>();
  const arabic = [...source]
    .map((c) => (THAI_DIGITS.includes(c) ? String(THAI_DIGITS.indexOf(c)) : c))
    .join('');
  for (const m of arabic.matchAll(NUMBER)) out.add(normaliseNumber(m[0]));
  return out;
}

export function checkFacts(
  reply: string,
  evidence: { toolResults: string[]; userText: string; policyToolUsed: boolean },
): FactCheck {
  const supported = numbersIn([...evidence.toolResults, evidence.userText].join('\n'));
  const text = [...reply].map((c) => (THAI_DIGITS.includes(c) ? String(THAI_DIGITS.indexOf(c)) : c)).join('');
  const unsupported: FactCheck['unsupported'] = [];
  const seen = new Set<string>();
  const flag = (kind: FactCheck['unsupported'][number]['kind'], raw: string, nums: string[]) => {
    if (nums.every((x) => supported.has(x))) return;
    if (seen.has(raw)) return;
    seen.add(raw);
    unsupported.push({ kind, text: raw.trim() });
  };
  const claimed = new Set<number>();
  const mark = (m: RegExpMatchArray) => {
    for (let i = m.index!; i < m.index! + m[0].length; i++) claimed.add(i);
  };
  for (const m of text.matchAll(MONEY)) {
    mark(m);
    flag('money', m[0], [...numbersIn(m[0])]);
  }
  for (const re of DATE_PATTERNS)
    for (const m of text.matchAll(re)) {
      if (claimed.has(m.index)) continue;
      mark(m);
      flag('date', m[0], [...numbersIn(m[0])]);
    }
  for (const m of text.matchAll(NUMBER)) {
    if (claimed.has(m.index)) continue;
    flag('number', m[0], [normaliseNumber(m[0])]);
  }
  if (POLICY.test(text) && !evidence.policyToolUsed) {
    const sentence = text.split(/(?<=[.!?。\n])\s*|\s{2,}/).find((s) => POLICY.test(s)) ?? text;
    unsupported.push({ kind: 'policy', text: sentence.slice(0, 200).trim() });
  }
  return { passed: unsupported.length === 0, unsupported };
}

/** The answer shown instead of a reply that failed the check (D-304): no fact, an offer to reach CS. */
export const SAFE_ANSWER =
  'ขออภัยค่ะ ข้อมูลนี้ต้องให้ทีมบริการลูกค้าตรวจสอบก่อนจึงจะตอบได้ถูกต้อง ' +
  'ต้องการให้ส่งเรื่องให้ทีมบริการลูกค้าติดต่อกลับไหมคะ';
export const REFUSAL_OTHERS =
  'ขออภัยค่ะ ผู้ช่วยดูได้เฉพาะข้อมูลในบัญชีของคุณเท่านั้น หากต้องการความช่วยเหลือเพิ่มเติม ' +
  'สามารถให้ส่งเรื่องให้ทีมบริการลูกค้าได้ค่ะ';
