import { type UserActor } from '@common/context/actor';

import { AgentsService } from './agents.service';

/** P7 runbook / review: ending an agent ends its links, expires its leads and its deal registrations at once. */
describe('ending an agent (offboarding, D-416 / D-468)', () => {
  const actor: UserActor = { type: 'user', userId: 1n, publicId: 'staff', audience: 'staff', scopes: [] };

  function setUp() {
    const calls: Record<string, unknown[]> = {};
    const table = (name: string) => ({
      updateMany: jest.fn((arg: unknown) => {
        (calls[name] ??= []).push(arg);
        return Promise.resolve({ count: 1 });
      }),
    });
    const tx = {
      salesAgent: {
        findUnique: jest.fn().mockResolvedValue({ id: 5n, publicId: 'agent', status: 'active' }),
        update: jest.fn().mockResolvedValue({}),
      },
      salesAgentLink: table('links'),
      salesAgentLead: table('leads'),
      salesAgentFactoryLink: table('factoryLinks'),
      salesAgentDealRegistration: table('deals'),
    };
    const prisma = { withTx: (fn: (t: unknown) => unknown) => fn(tx) };
    const service = new AgentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
      { record: jest.fn() },
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'agent').mockResolvedValue({} as never);
    return { service, calls };
  }

  it('expires registered deals with the reason agent_ended', async () => {
    const { service, calls } = setUp();
    await service.setStatus(actor, 'agent', 'ended', 'contract ended');
    expect(calls.deals).toEqual([
      {
        where: { agentId: 5n, status: 'registered' },
        data: expect.objectContaining({ status: 'expired', endedReason: 'agent_ended' }) as unknown,
      },
    ]);
    expect(calls.links).toHaveLength(1);
    expect(calls.leads).toEqual([
      {
        where: { agentId: 5n, status: 'registered' },
        data: { status: 'expired', closedReason: 'agent_ended' },
      },
    ]);
  });

  it('a suspension keeps deals, links and leads', async () => {
    const { service, calls } = setUp();
    await service.setStatus(actor, 'agent', 'suspended', 'review');
    expect(calls.deals).toBeUndefined();
    expect(calls.links).toBeUndefined();
  });
});
