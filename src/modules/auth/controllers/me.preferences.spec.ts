import { DomainException } from '@common/errors/domain.exception';

import { savePreferences } from './me.controllers';

/** D-183 / D-456: the display unit and the Studio editor mode — only what is sent changes, audited and evented. */
describe('savePreferences', () => {
  const me = { type: 'user', userId: 7n, publicId: 'u-1' } as never;
  const setup = () => {
    const update = jest.fn();
    const tx = { user: { update } };
    const prisma = { withTx: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never;
    const record = jest.fn();
    const audit = { record } as never;
    const event = jest.fn();
    const events = { record: event } as never;
    return { prisma, audit, events, update, record, event };
  };

  it('saves the editor mode alone, leaving the unit unchanged', async () => {
    const s = setup();
    await savePreferences(s.prisma, s.audit, s.events, me, { editorMode: 'pro' });
    expect(s.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { editorMode: 'pro' } });
    expect(s.record.mock.calls[0][1]).toMatchObject({
      action: 'user.preferences_updated',
      data: { editorMode: 'pro' },
    });
    expect(s.event.mock.calls[0][1].payload).toEqual({ userId: 'u-1', editorMode: 'pro' });
  });

  it('still saves the display unit as before', async () => {
    const s = setup();
    await savePreferences(s.prisma, s.audit, s.events, me, { displayUnit: 'cm' });
    expect(s.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { displayUnit: 'cm' } });
  });

  it('refuses an empty request', async () => {
    const s = setup();
    await expect(savePreferences(s.prisma, s.audit, s.events, me, {})).rejects.toBeInstanceOf(
      DomainException,
    );
    expect(s.update).not.toHaveBeenCalled();
  });
});
