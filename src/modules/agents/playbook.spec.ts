import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLAYBOOK_CARDS } from '../../../prisma/seed/data/playbook';
import { parsePlaybook, PLAYBOOK_CONTEXTS } from './playbook-parser';

const MD = readFileSync(
  join(__dirname, '..', '..', '..', 'docs', 'design', 'agent-portal', 'PLAYBOOK.md'),
  'utf8',
);

describe('sales playbook seed (D-468, PLAN A-13)', () => {
  it('is generated from PLAYBOOK.md (no drift)', () => {
    expect(PLAYBOOK_CARDS).toEqual(parsePlaybook(MD));
  });

  it('has every card with a title, body and known audience; agents get a card for every context', () => {
    expect(PLAYBOOK_CARDS.length).toBe(11);
    for (const card of PLAYBOOK_CARDS) {
      expect(card.titleTh.length).toBeGreaterThan(3);
      expect(card.bodyTh.length).toBeGreaterThan(10);
      expect(card.bodyTh).not.toContain('**ตอบลูกค้า');
    }
    const forAgents = PLAYBOOK_CARDS.filter((c) => c.audiences.includes('agent'));
    for (const context of PLAYBOOK_CONTEXTS)
      expect({
        context,
        has: forAgents.some((c) => c.contexts.includes(context) || c.contexts.includes('all')),
      }).toEqual({ context, has: true });
  });

  it('keeps cost, margin and factory words out of what agents read (D-464, D-435)', () => {
    for (const card of PLAYBOOK_CARDS.filter((c) => c.audiences.includes('agent'))) {
      const text = [card.titleTh, card.bodyTh, ...card.suggestedReplies.map((r) => r.th)].join('\n');
      expect({ key: card.key, leak: /กำไร|margin|profit|โรงงาน|factory|เส้นขั้นต่ำ/i.test(text) }).toEqual({
        key: card.key,
        leak: false,
      });
    }
  });

  it('reads the suggested replies (bullets and inline)', () => {
    const giveGet = PLAYBOOK_CARDS.find((c) => c.key === 'give-get-menu')!;
    expect(giveGet.suggestedReplies).toHaveLength(2);
    expect(giveGet.suggestedReplies[0]!.th.startsWith('เราปรับราคาให้ได้')).toBe(true);
    const follow = PLAYBOOK_CARDS.find((c) => c.key === 'follow-up')!;
    expect(follow.suggestedReplies[0]!.th.startsWith('สวัสดีค่ะ/ครับ')).toBe(true);
  });
});
