import { checkFacts, normaliseNumber } from './guardrails';

const ev = (toolResults: string[] = [], userText = '', policyToolUsed = false) => ({
  toolResults,
  userText,
  policyToolUsed,
});

/** D-304: facts only from a tool result of the same turn (or the customer's own words). */
describe('assistant fact check (D-304)', () => {
  it('passes a reply whose price, date and numbers all come from tool results', () => {
    const r = checkFacts(
      'ราคาเริ่มต้น 4.50 บาทต่อชิ้น ที่ 1,000 ชิ้น จัดส่งประมาณวันที่ 2026-11-15',
      ev(['{"startingFromPerPiece":"4.5","basis":{"quantity":1000},"date":"2026-11-15"}']),
    );
    expect(r).toEqual({ passed: true, unsupported: [] });
  });

  it('blocks a price, a date or a strength no tool returned', () => {
    const r = checkFacts(
      'ราคา 3.20 บาท ส่งได้ 20/11/2026 รับน้ำหนัก 25 kg',
      ev(['{"startingFromPerPiece":"4.5"}']),
    );
    expect(r.passed).toBe(false);
    expect(r.unsupported.map((u) => u.kind)).toEqual(['money', 'date', 'number']);
  });

  it('accepts what the customer said themselves, in Thai or Arabic digits', () => {
    expect(checkFacts('สำหรับ ๕๐๐ ชิ้นตามที่ต้องการ', ev([], 'อยากได้ 500 ชิ้น')).passed).toBe(true);
    expect(normaliseNumber('๑,๒๐๐.๕๐')).toBe('1200.5');
  });

  it('requires a help or glossary result for a policy statement', () => {
    expect(checkFacts('สินค้ารับประกันคุณภาพ เคลมได้ภายในเจ็ดวัน', ev()).unsupported[0]).toMatchObject({
      kind: 'policy',
    });
    expect(checkFacts('สินค้ารับประกันคุณภาพ', ev([], '', true)).passed).toBe(true);
  });

  it('passes a reply with no fact at all', () => {
    expect(checkFacts('ยินดีช่วยค่ะ ต้องการกล่องแบบไหนคะ', ev()).passed).toBe(true);
  });
});
