/**
 * Thai wording on customer documents (B5.2): amounts in words (บาทถ้วน / สตางค์) and dates in the Buddhist
 * era, as Thai tax invoices print them.
 */
const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
const MONTHS_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/** Reads a whole number below one million (one "ล้าน" group). */
function group(n: number): string {
  let out = '';
  const digits = String(n).split('').reverse().map(Number);
  for (let place = digits.length - 1; place >= 0; place--) {
    const d = digits[place]!;
    if (d === 0) continue;
    if (place === 0 && d === 1 && digits.length > 1) out += 'เอ็ด';
    else if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else out += DIGITS[d]! + PLACES[place]!;
  }
  return out;
}

/** A whole number of any size (groups of six digits joined by ล้าน). */
export function thaiNumber(value: bigint): string {
  if (value === 0n) return 'ศูนย์';
  const parts: string[] = [];
  let rest = value;
  while (rest > 0n) {
    parts.unshift(String(rest % 1_000_000n));
    rest /= 1_000_000n;
  }
  return parts
    .map((p, i) => {
      const n = Number(p);
      // "เอ็ด" only after a higher digit: 1,000,001 = หนึ่งล้านเอ็ด; a group of exactly 1 after ล้าน reads เอ็ด.
      const words = n === 1 && i > 0 ? 'เอ็ด' : group(n);
      return words + (i < parts.length - 1 ? 'ล้าน' : '');
    })
    .join('');
}

/** `"1234.50"` → `หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์`; whole baht end with `ถ้วน`. */
export function bahtText(amount: string): string {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) throw new RangeError(`Not an amount: ${amount}`);
  const baht = BigInt(match[2]!);
  const satang = Number((match[3] ?? '0').padEnd(2, '0'));
  const sign = match[1] ? 'ลบ' : '';
  if (baht === 0n && satang === 0) return 'ศูนย์บาทถ้วน';
  const bahtPart = baht > 0n ? `${thaiNumber(baht)}บาท` : '';
  const satangPart = satang > 0 ? `${thaiNumber(BigInt(satang))}สตางค์` : 'ถ้วน';
  return sign + bahtPart + satangPart;
}

/** `2026-10-05` → `5 ตุลาคม 2569` (Buddhist era = Gregorian + 543). */
export function thaiDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS_TH[m - 1]} ${y + 543}`;
}

/** `2026-10` → `ตุลาคม 2569`. */
export function thaiMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTHS_TH[m - 1]} ${y + 543}`;
}
