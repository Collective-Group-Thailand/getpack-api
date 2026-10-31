import { SettingNotFoundError } from '@platform/settings/settings.service';

import { slaState } from './conversation-views';
import { type ConversationRow, ConversationsService } from './conversations.service';

/**
 * D-221 / D-458: a conversation's `sla.state` and the due time it shows agree. The bug: a contact / hand-off ticket
 * set its own `respondBy` (the topic's target) while the conversation's clock ran to the global first-response days
 * from the message — `sla.state` could say overdue while the ticket's due time was still ahead (and a ticket without
 * a message had no clock at all).
 */
describe('conversation first-response SLA', () => {
  const now = new Date('2026-10-31T03:00:00Z');
  const row = (due: Date | null, answered: Date | null = null) =>
    ({ firstResponseDueAt: due, firstRespondedAt: answered }) as unknown as ConversationRow;

  it('is overdue only once the due time has passed', () => {
    expect(slaState(row(new Date(now.getTime() + 60_000)), now)).toBe('waiting');
    expect(slaState(row(now), now)).toBe('waiting');
    expect(slaState(row(new Date(now.getTime() - 60_000)), now)).toBe('overdue');
    expect(slaState(row(new Date(now.getTime() - 60_000), now), now)).toBe('answered');
    expect(slaState(row(null), now)).toBeNull();
  });

  function setup() {
    const conversation = { id: 5n, publicId: 'c-5', status: 'open', firstRespondedAt: null };
    const tx = {
      conversation: {
        create: jest.fn().mockResolvedValue(conversation),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...conversation, firstResponseDueAt: null, firstRespondedAt: null }),
        update: jest.fn().mockResolvedValue(conversation),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ assignedUserId: null }),
      },
      conversationMessage: { create: jest.fn().mockResolvedValue({ id: 1n, publicId: 'm-1' }) },
    };
    const settings = {
      at: jest.fn((key: string) =>
        key === 'conversations.resolution_business_days'
          ? Promise.reject(new SettingNotFoundError(key, now))
          : Promise.resolve({ value: 1 }),
      ),
    };
    const service = new ConversationsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settings as never,
      { calendar: jest.fn() } as never,
      {} as never,
    );
    jest.spyOn(service as never, 'record').mockResolvedValue(undefined as never);
    return { service, tx, settings };
  }

  it('runs the clock a ticket starts to the ticket’s respondBy, so sla and ticket show one due time', async () => {
    const { service, tx, settings } = setup();
    const respondBy = new Date('2026-11-04T05:00:00Z');
    await service.openForTicket(tx as never, null, 'ขอใบเสนอราคากล่อง', respondBy);
    expect(tx.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstResponseDueAt: respondBy }) }),
    );
    // Not recomputed from the global first-response days.
    expect(settings.at).not.toHaveBeenCalledWith('support.first_response_business_days', expect.anything());
    expect(slaState(row(respondBy), now)).toBe('waiting');
  });

  it('starts the clock for a ticket without a message, never over a running or answered one', async () => {
    const { service, tx } = setup();
    const respondBy = new Date('2026-11-04T05:00:00Z');
    await service.openForTicket(tx as never, null, null, respondBy);
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: 5n, firstRespondedAt: null, firstResponseDueAt: null },
      data: { firstResponseDueAt: respondBy },
    });
  });
});
