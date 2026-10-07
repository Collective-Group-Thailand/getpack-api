import { STUDIO_PRINT_RULES } from '../../../prisma/seed/data/studio';
import { summariseIssues, UNCHECKED, WORDED_PRINT_RULES } from './design-issues';

describe('design issues (UX r2 A4, D-278)', () => {
  const f = (ruleId: string, severity: string, elementId = '') => ({ ruleId, severity, elementId });

  it('counts blocks and unacknowledged warnings, per rule, blocks first', () => {
    const issues = summariseIssues(
      [
        f('image_resolution', 'warn', 'img-1'),
        f('image_resolution', 'warn', 'img-2'),
        f('safe_zone', 'warn', 'txt-1'),
        f('bleed', 'block', 'bg'),
        f('min_text_size', 'info', 'txt-2'),
      ],
      new Set(['safe_zone|txt-1']),
    );
    expect(issues.issueCount).toBe(3);
    expect(issues.hasIssues).toBe(true);
    expect(issues.issueSummary.map((i) => [i.code, i.severity, i.count])).toEqual([
      ['bleed', 'block', 1],
      ['image_resolution', 'warn', 2],
    ]);
    expect(issues.issueSummary[1]!.messageTh).toBe('รูปความละเอียดต่ำ อาจพิมพ์ไม่คม');
  });

  it('says zero for a clean check and unknown for none', () => {
    expect(summariseIssues([], new Set())).toEqual({ issueCount: 0, hasIssues: false, issueSummary: [] });
    expect(UNCHECKED).toEqual({ issueCount: null, hasIssues: null, issueSummary: [] });
  });

  it('has words for every seeded print rule', () => {
    expect(
      STUDIO_PRINT_RULES.rules.map((r) => r.id).filter((id) => !WORDED_PRINT_RULES.includes(id)),
    ).toEqual([]);
  });
});
