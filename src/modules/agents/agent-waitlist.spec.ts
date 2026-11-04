import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';

import { AgentWaitlistService, waitlistContact, waitlistCsv } from './agent-waitlist.service';
import { AgentsService } from './agents.service';

/** P7 pilot switch: who may apply, and the public waiting list. */
describe('pilot switch — applyOpen (D-466, P7)', () => {
  const pilotUser: UserActor = {
    type: 'user',
    userId: 1n,
    publicId: 'pilot-1',
    audience: 'customer',
    scopes: [],
  };
  const other: UserActor = { ...pilotUser, userId: 2n, publicId: 'someone' };
  const staff: UserActor = { ...pilotUser, audience: 'staff' };

  function service(flagOn: boolean, pilot: { enabled: boolean; userIds: string[] }) {
    const flags = { isEnabled: jest.fn().mockResolvedValue(flagOn) };
    const settings = { value: jest.fn().mockResolvedValue(pilot) };
    const s = new AgentsService(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      flags as never,
      {} as never,
    );
    return { s, settings };
  }

  it('is closed for everyone by default', async () => {
    const { s } = service(false, { enabled: false, userIds: [] });
    expect(await s.applyOpenFor(pilotUser)).toBe(false);
    expect(await s.applyOpenFor(undefined)).toBe(false);
  });

  it('opens for listed customer accounts only while the pilot is enabled', async () => {
    const { s } = service(false, { enabled: true, userIds: ['pilot-1'] });
    expect(await s.applyOpenFor(pilotUser)).toBe(true);
    expect(await s.applyOpenFor(other)).toBe(false);
    expect(await s.applyOpenFor(staff)).toBe(false);
  });

  it('never reads the pilot list for an anonymous visitor (public landing)', async () => {
    const { s, settings } = service(false, { enabled: true, userIds: ['pilot-1'] });
    expect(await s.applyOpenFor(undefined)).toBe(false);
    expect(settings.value).not.toHaveBeenCalled();
  });

  it('a listed account with the pilot disabled is closed; the flag fully on opens it for all', async () => {
    expect(await service(false, { enabled: false, userIds: ['pilot-1'] }).s.applyOpenFor(pilotUser)).toBe(
      false,
    );
    expect(await service(true, { enabled: false, userIds: [] }).s.applyOpenFor(other)).toBe(true);
  });
});

describe('waiting list (P7)', () => {
  it('normalises the contact', () => {
    expect(waitlistContact({ phone: '081 000 5678', email: ' A@Example.Invalid ' })).toEqual({
      phone: '+66810005678',
      email: 'a@example.invalid',
    });
    expect(waitlistContact({ phone: '', email: null })).toEqual({ phone: null, email: null });
  });

  it('writes a formula-safe CSV with local phones', () => {
    const csv = waitlistCsv([
      {
        name: '=HYPERLINK("x")',
        phone: '+66810005678',
        email: null,
        salesChannel: 'line_groups',
        createdAt: new Date('2026-11-04T03:00:00Z'),
        lastJoinedAt: new Date('2026-11-04T03:00:00Z'),
        joinCount: 2,
      },
    ]);
    expect(csv.startsWith('﻿"name","phone"')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")","0810005678","","line_groups","2026-11-04","2026-11-04","2"`);
  });

  function setUp(opts: {
    consent: { id: bigint; purposeId: bigint; versionNo: number } | null;
    existing?: object;
  }) {
    const tx = {
      consentPurposeVersion: { findFirst: jest.fn().mockResolvedValue(opts.consent) },
      consentRecord: { create: jest.fn().mockResolvedValue({ id: 90n }) },
      salesAgentWaitlistEntry: {
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ publicId: 'new' }),
        update: jest.fn().mockResolvedValue({ publicId: 'old' }),
      },
    };
    const events = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const activity = { record: jest.fn() };
    const prisma = { withTx: (fn: (t: unknown) => unknown) => fn(tx) };
    const service = new AgentWaitlistService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      events as never,
      activity,
    );
    return { service, tx, events };
  }
  const consent = { id: 7n, purposeId: 3n, versionNo: 2 };
  const evidence = { ip: '192.0.2.1', userAgent: 'test' };

  it('records the consent and creates the row; the event carries ids only', async () => {
    const { service, tx, events } = setUp({ consent });
    await service.join({ name: ' สมชาย ', phone: '0810005678', consentVersionNo: 2 }, evidence);
    expect(tx.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purposeVersionId: 7n,
        granted: true,
        source: 'web',
        ip: '192.0.2.1',
      }) as unknown,
    });
    expect(tx.salesAgentWaitlistEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'สมชาย', phone: '+66810005678', email: null }) as unknown,
    });
    const payload = JSON.stringify((events.record.mock.calls[0] as unknown[])[1]);
    expect(payload).not.toContain('0810005678');
    expect(payload).not.toContain('สมชาย');
  });

  it('a repeat sign-up refreshes the row and answers the same (neutral)', async () => {
    const { service, tx } = setUp({ consent, existing: { id: 5n, phone: '+66810005678', email: null } });
    await expect(
      service.join({ name: 'สมชาย', phone: '+66810005678', consentVersionNo: 2 }, evidence),
    ).resolves.toBeUndefined();
    expect(tx.salesAgentWaitlistEntry.create).not.toHaveBeenCalled();
    expect(tx.salesAgentWaitlistEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ joinCount: { increment: 1 } }) as unknown }),
    );
  });

  it('needs a phone or an e-mail, a published consent text and its current version', async () => {
    const code = (p: Promise<unknown>) => p.catch((e: unknown) => (e as DomainException).code);
    expect(await code(setUp({ consent }).service.join({ name: 'x', consentVersionNo: 2 }, evidence))).toBe(
      'validation.failed',
    );
    expect(
      await code(
        setUp({ consent: null }).service.join(
          { name: 'x', email: 'a@b.invalid', consentVersionNo: 1 },
          evidence,
        ),
      ),
    ).toBe('agents.waitlist_closed');
    expect(
      await code(
        setUp({ consent }).service.join({ name: 'x', email: 'a@b.invalid', consentVersionNo: 1 }, evidence),
      ),
    ).toBe('agents.waitlist_consent_outdated');
  });
});
