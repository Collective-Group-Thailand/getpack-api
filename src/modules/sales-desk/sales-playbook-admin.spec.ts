import { PLAYBOOK_CARDS } from '../../../prisma/seed/data/playbook';
import { agentSafeProblems } from './sales-playbook-admin';

/** D-470 item 8: every card PROMPT item 8 / PLAYBOOK.md names is seeded, and cards agents see stay customer-safe. */
describe('sales playbook (D-470)', () => {
  it('seeds every card of the prompt pack once', () => {
    const keys = PLAYBOOK_CARDS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of [
      'pricing-principle',
      'give-get-menu',
      'like-for-like', // competitor cheaper: like-for-like spec check and its replies
      'one-round',
      'walk-away',
      'short-validity',
      'cash-vs-credit',
      'big-deal',
      'follow-up',
      'first-contact',
      'lead-lost-price',
    ])
      expect(keys).toContain(key);
    expect(PLAYBOOK_CARDS.find((c) => c.key === 'like-for-like')!.contexts).toContain('competitor_cheaper');
  });

  it('keeps every seeded agent card free of cost, margin, factory or profit wording', () => {
    for (const card of PLAYBOOK_CARDS) expect([card.key, agentSafeProblems(card)]).toEqual([card.key, []]);
  });

  it('refuses margin wording in a card agents see, allows it for managers', () => {
    const card = { audiences: ['agent'], titleTh: 'x', bodyTh: 'กำไรของเรา' };
    expect(agentSafeProblems(card)).toEqual(['agent_unsafe_wording']);
    expect(agentSafeProblems({ ...card, audiences: ['manager'] })).toEqual([]);
  });
});
