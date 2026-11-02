import { type PrismaService, type Tx } from '@database/prisma.service';
import { type AuditService } from '@platform/audit/audit.service';
import { type SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';

import { SessionService } from './session.service';

const LIFETIMES = { customer: { absoluteHours: 720, idleHours: 168 } };

/** D-467: a customer session records its surface; rotation keeps it, so agent-zone sessions stay apart. */
describe('SessionService client (D-467)', () => {
  function build(current?: Record<string, unknown>) {
    const created: Record<string, unknown>[] = [];
    const tx = {
      authSession: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: BigInt(created.length) });
        }),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
    };
    const prisma = {
      authSession: { findUnique: jest.fn(() => Promise.resolve(current ?? null)) },
      withTx: async <T>(fn: (t: Tx) => Promise<T>) => fn(tx as unknown as Tx),
    } as unknown as PrismaService;
    const settings = { value: jest.fn(() => Promise.resolve(LIFETIMES)) } as unknown as SettingsService;
    const service = new SessionService(prisma, settings, {} as AuditService, {} as Redis);
    return { service, tx: tx as unknown as Tx, created };
  }

  it('defaults to the storefront and records the agent zone when asked', async () => {
    const { service, tx, created } = build();
    await service.create(tx, { userId: 1n, audience: 'customer', loginMethod: 'line' });
    await service.create(tx, { userId: 1n, audience: 'customer', loginMethod: 'line', client: 'agent' });
    expect(created.map((c) => c['client'])).toEqual(['storefront', 'agent']);
    expect(created[0]!['familyId']).not.toBe(created[1]!['familyId']);
  });

  it('carries the client through rotation', async () => {
    const now = Date.now();
    const { service, created } = build({
      id: 7n,
      userId: 1n,
      audience: 'customer',
      familyId: '0192f3a0-7c1e-7d2a-9b1f-00000000a5e5',
      loginMethod: 'phone_otp',
      client: 'agent',
      deviceId: null,
      revokedAt: null,
      rotatedAt: null,
      expiresAt: new Date(now + 3_600_000),
      idleExpiresAt: new Date(now + 3_600_000),
      user: { status: 'active' },
    });
    const result = await service.rotate('rt_example');
    expect(result.ok).toBe(true);
    expect(created[0]).toMatchObject({ client: 'agent', familyId: '0192f3a0-7c1e-7d2a-9b1f-00000000a5e5' });
  });
});
