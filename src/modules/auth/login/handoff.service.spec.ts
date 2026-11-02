import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { type PrismaService } from '@database/prisma.service';
import { type AuditService } from '@platform/audit/audit.service';
import { type DomainEvents } from '@platform/domain-events/domain-events.service';
import { type SettingsService } from '@platform/settings/settings.service';

import { type AuthTokensService } from '../auth-tokens.service';
import { HandoffService, hashHandoffSecret } from './handoff.service';

const FINGERPRINT = 'fp_example_7c1e9b1f3c4d5e6f';
const ACTOR: UserActor = {
  type: 'user',
  userId: 5n,
  publicId: '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b',
  audience: 'customer',
  sessionId: '0192f3a0-7c1e-7d2a-9b1f-00000000a5e5',
  scopes: [],
};
const USER = { id: 5n, publicId: ACTOR.publicId, kind: 'customer', status: 'active', anonymisedAt: null };

type Row = Record<string, unknown> & {
  id: bigint;
  codeHash: Uint8Array;
  consumedAt: Date | null;
  expiresAt: Date;
};

/** D-467: the hand-off code is single use, short-lived, bound to the device and stored only as hashes. */
describe('HandoffService (D-467)', () => {
  function build(user: Record<string, unknown> = USER) {
    const rows: Row[] = [];
    const audits: Record<string, unknown>[] = [];
    const issued: unknown[][] = [];
    const tx = {
      authHandoffCode: {
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = {
            ...data,
            id: BigInt(rows.length + 1),
            publicId: `h${rows.length + 1}`,
            consumedAt: null,
          } as unknown as Row;
          rows.push(row);
          return Promise.resolve(row);
        }),
        findUnique: jest.fn(({ where }: { where: { codeHash: Uint8Array } }) => {
          const row = rows.find((r) => Buffer.from(r.codeHash).equals(Buffer.from(where.codeHash)));
          return Promise.resolve(row ? { ...row, user } : null);
        }),
        updateMany: jest.fn(({ where, data }: { where: { id: bigint }; data: { consumedAt: Date } }) => {
          const row = rows.find((r) => r.id === where.id && r.consumedAt === null);
          if (row) row.consumedAt = data.consumedAt;
          return Promise.resolve({ count: row ? 1 : 0 });
        }),
        update: jest.fn(({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
          Object.assign(
            rows.find((r) => r.id === where.id)!,
            data,
          );
          return Promise.resolve({});
        }),
      },
      user: { update: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      authSession: {
        findFirst: jest.fn(() => Promise.resolve({ loginMethod: 'line', client: 'storefront' })),
      },
      withTx: <T>(fn: (t: unknown) => Promise<T>) => fn(tx),
    } as unknown as PrismaService;
    const tokens = {
      issue: jest.fn((...args: unknown[]) => {
        issued.push(args);
        return Promise.resolve({ accessToken: 'a', sessionFamilyId: 'fam-agent' });
      }),
    } as unknown as AuthTokensService;
    const settings = { value: jest.fn(() => Promise.resolve(60)) } as unknown as SettingsService;
    const audit = {
      record: jest.fn((_tx: unknown, entry: Record<string, unknown>) => {
        audits.push(entry);
        return Promise.resolve();
      }),
      recordStandalone: jest.fn((entry: Record<string, unknown>) => {
        audits.push(entry);
        return Promise.resolve();
      }),
    } as unknown as AuditService;
    const events = { record: jest.fn(() => Promise.resolve({ id: 1n })) } as unknown as DomainEvents;
    return { service: new HandoffService(prisma, tokens, settings, audit, events), rows, audits, issued };
  }

  const refusedWith = async (p: Promise<unknown>) => {
    const error = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('auth.handoff_invalid');
  };

  it('stores only hashes and opens a new agent session with the source sign-in method', async () => {
    const { service, rows, issued, audits } = build();
    const before = Date.now();
    const { code, expiresAt } = await service.create(ACTOR, { target: 'agent', fingerprint: FINGERPRINT });
    expect(code.length).toBeGreaterThanOrEqual(43);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(59_000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(61_000);
    const json = (v: unknown) =>
      JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
    const stored = json(rows);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(FINGERPRINT);
    expect(Buffer.from(rows[0]!.codeHash).equals(Buffer.from(hashHandoffSecret(code)))).toBe(true);
    expect(json(audits)).not.toContain(code);

    const pair = await service.redeem(code, FINGERPRINT);
    expect(pair).toMatchObject({ sessionFamilyId: 'fam-agent' });
    expect(issued[0]).toEqual([expect.anything(), USER, 'customer', 'line', undefined, 'agent']);
    expect(rows[0]).toMatchObject({ redeemedSessionFamilyId: 'fam-agent' });
  });

  it('is single use', async () => {
    const { service } = build();
    const { code } = await service.create(ACTOR, { target: 'agent', fingerprint: FINGERPRINT });
    await service.redeem(code, FINGERPRINT);
    await refusedWith(service.redeem(code, FINGERPRINT));
  });

  it('refuses another device and burns the code', async () => {
    const { service, audits } = build();
    const { code } = await service.create(ACTOR, { target: 'agent', fingerprint: FINGERPRINT });
    await refusedWith(service.redeem(code, 'fp_example_another_device'));
    await refusedWith(service.redeem(code, FINGERPRINT));
    expect(
      audits
        .filter((a) => a['action'] === 'auth.handoff_refused')
        .map((a) => (a['data'] as { reason: string }).reason),
    ).toEqual(['fingerprint', 'used']);
  });

  it('refuses an expired code, an unknown code and an inactive account with the same error', async () => {
    const expired = build();
    const { code } = await expired.service.create(ACTOR, { target: 'agent', fingerprint: FINGERPRINT });
    expired.rows[0]!.expiresAt = new Date(Date.now() - 1);
    await refusedWith(expired.service.redeem(code, FINGERPRINT));
    await refusedWith(expired.service.redeem('hc_unknown', FINGERPRINT));

    const inactive = build({ ...USER, status: 'suspended' });
    const second = await inactive.service.create(ACTOR, { target: 'agent', fingerprint: FINGERPRINT });
    await refusedWith(inactive.service.redeem(second.code, FINGERPRINT));
  });

  it('needs a customer session', async () => {
    const { service } = build();
    await expect(
      service.create({ ...ACTOR, sessionId: undefined }, { target: 'agent', fingerprint: FINGERPRINT }),
    ).rejects.toMatchObject({ code: 'auth.unauthenticated' });
  });
});
