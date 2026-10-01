import { type ActionRule, nextActions } from './next-actions';

type Thing = { status: 'open' | 'closed'; locked: boolean };
const RULES: ActionRule<Thing>[] = [
  {
    key: 'thing.close',
    permissions: ['things.manage'],
    irreversible: true,
    when: (t) => t.status === 'open',
  },
  {
    key: 'thing.edit',
    permissions: ['things.manage'],
    when: (t) => (t.locked ? 'thing.locked' : t.status === 'open'),
  },
  { key: 'thing.read_more', when: () => true },
  { key: 'thing.approve', permissions: ['things.manage', 'things.approve'], when: () => true },
];

describe('nextActions', () => {
  it('offers the actions whose state check passes and whose permissions the actor holds (all-of)', () => {
    expect(nextActions({ status: 'open', locked: false }, RULES, new Set(['things.manage']))).toEqual([
      { key: 'thing.close', irreversible: true, disabledReason: null },
      { key: 'thing.edit', irreversible: false, disabledReason: null },
      { key: 'thing.read_more', irreversible: false, disabledReason: null },
    ]);
  });

  it('shows a blocked action with its reason and hides those the state refuses', () => {
    expect(
      nextActions(
        { status: 'closed', locked: true },
        RULES,
        new Set(['things.manage', 'things.approve']),
      ).map((a) => [a.key, a.disabledReason]),
    ).toEqual([
      ['thing.edit', 'thing.locked'],
      ['thing.read_more', null],
      ['thing.approve', null],
    ]);
  });

  it('offers nothing guarded to an actor without the permission', () => {
    expect(nextActions({ status: 'open', locked: false }, RULES, new Set()).map((a) => a.key)).toEqual([
      'thing.read_more',
    ]);
  });
});
