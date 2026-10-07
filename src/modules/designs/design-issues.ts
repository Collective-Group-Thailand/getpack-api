/**
 * What still needs checking on a design (UX round 2 Phase 4 §A4, D-278): the current version's latest stored print
 * check — blocks, plus warnings the customer has not acknowledged — counted and summarised per rule, in the studio's
 * own words (packio-web `designer.json` `checks.rule`, without the per-element figures).
 */
const RULE_WORDS: Record<string, { th: string; en: string }> = {
  image_resolution: { th: 'รูปความละเอียดต่ำ อาจพิมพ์ไม่คม', en: 'Low-resolution image: it may print soft' },
  bleed: { th: 'ยังไม่เผื่อตัดตกที่ขอบตัด', en: 'No bleed past a cut edge' },
  safe_zone: { th: 'อยู่ใกล้ขอบตัดหรือรอยพับเกินไป', en: 'Too close to a cut or a fold' },
  min_text_size: { th: 'ตัวอักษรเล็กเกินไป อาจพิมพ์ไม่ชัด', en: 'Text too small to print clearly' },
  hairline: { th: 'เส้นบางเกินไป อาจพิมพ์ขาด', en: 'Line too thin: it may break up' },
  rich_black_small_text: {
    th: 'ตัวอักษรเล็กใช้ดำผสมหลายสี อาจพิมพ์เหลื่อม',
    en: 'Small text in a rich black',
  },
  rgb_out_of_gamut: { th: 'สีสดเกินกว่าที่หมึก CMYK พิมพ์ได้', en: 'Colour brighter than CMYK inks print' },
  spot_colour_count: { th: 'จำนวนสีเกินกว่าที่พิมพ์ได้', en: 'More colours than the press prints' },
  crosses_crease: { th: 'ข้อความหรือรูปคร่อมรอยพับ', en: 'Across a fold' },
  crosses_glue: { th: 'อยู่บนแถบกาว จะถูกปิดทับ', en: 'On the glue flap' },
  barcode_across_fold: { th: 'บาร์โค้ดคร่อมรอยพับ จะสแกนไม่ได้', en: 'Barcode across a fold' },
  barcode_invalid: { th: 'บาร์โค้ดใช้ไม่ได้', en: 'Barcode cannot be used' },
  white_ink_needed: { th: 'ต้องพิมพ์หมึกขาวรองพื้นบนวัสดุนี้', en: 'Needs a white ink underlay' },
  finish_min_feature: { th: 'งานตกแต่งเล็กเกินกว่าที่ทำได้', en: 'Finish detail too small to make' },
  element_right_missing: {
    th: 'ยังไม่ได้ยืนยันสิทธิ์ใช้เครื่องหมาย',
    en: 'Right to use a mark not declared',
  },
  off_sheet: { th: 'อยู่นอกแผ่นคลี่ จะไม่ถูกพิมพ์', en: 'Off the sheet: it will not be printed' },
};

export const WORDED_PRINT_RULES = Object.keys(RULE_WORDS);

export interface IssueFinding {
  ruleId: string;
  severity: string;
  elementId: string;
}

export interface IssueSummaryItem {
  code: string;
  severity: 'block' | 'warn';
  count: number;
  messageTh: string;
  messageEn: string;
}

export interface DesignIssues {
  issueCount: number | null;
  hasIssues: boolean | null;
  issueSummary: IssueSummaryItem[];
}

/** Never checked: unknown, not "no issues". */
export const UNCHECKED: DesignIssues = { issueCount: null, hasIssues: null, issueSummary: [] };

/**
 * Blocks and unacknowledged warnings of one run, per rule (blocks first, then by count); info findings are not issues.
 * `acknowledged` holds `ruleId|elementId` of the warnings the customer accepted (D-278).
 */
export function summariseIssues(findings: IssueFinding[], acknowledged: ReadonlySet<string>): DesignIssues {
  const open = findings.filter(
    (f) =>
      f.severity === 'block' || (f.severity === 'warn' && !acknowledged.has(`${f.ruleId}|${f.elementId}`)),
  );
  const byRule = new Map<string, IssueSummaryItem>();
  for (const f of open) {
    const severity = f.severity as 'block' | 'warn';
    const item = byRule.get(f.ruleId);
    if (item) {
      item.count += 1;
      if (severity === 'block') item.severity = 'block';
      continue;
    }
    const words = RULE_WORDS[f.ruleId] ?? { th: 'ควรตรวจก่อนพิมพ์', en: 'Check before printing' };
    byRule.set(f.ruleId, { code: f.ruleId, severity, count: 1, messageTh: words.th, messageEn: words.en });
  }
  const issueSummary = [...byRule.values()].sort(
    (a, b) =>
      (a.severity === 'block' ? 0 : 1) - (b.severity === 'block' ? 0 : 1) ||
      b.count - a.count ||
      a.code.localeCompare(b.code),
  );
  return { issueCount: open.length, hasIssues: open.length > 0, issueSummary };
}
