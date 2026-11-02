import { REQUIRED_PERMISSIONS } from '@common/auth/can.decorator';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { AGENT_ACCESS, type AgentAccessLevel, agentAccessRefusal, AgentZoneGuard } from './agent-zone.guard';
import { AGENTS_STORE_CONTROLLERS } from './agents.registry';

const NOW = new Date('2027-01-10T03:00:00Z');
const endedOn = (iso: string) => ({ status: 'ended' as const, endedAt: new Date(iso) });

describe('agent zone access rule (D-467)', () => {
  it('lets anyone through the pre-agent handlers', () => {
    expect(agentAccessRefusal('anyone', null, NOW, 5)).toBeNull();
    expect(agentAccessRefusal('anyone', endedOn('2020-01-01T00:00:00Z'), NOW, 5)).toBeNull();
  });

  it('needs an agent elsewhere', () => {
    expect(agentAccessRefusal('agent', null, NOW, 5)).toBe('agents.not_agent');
    expect(agentAccessRefusal('records', null, NOW, 5)).toBe('agents.not_agent');
  });

  it('lets active and suspended agents use everything', () => {
    for (const status of ['active', 'suspended'] as const)
      for (const level of ['agent', 'records'] as const)
        expect(agentAccessRefusal(level, { status, endedAt: null }, NOW, 5)).toBeNull();
  });

  it('keeps statements and 50 ทวิ for the record years after an agent ended, and nothing else', () => {
    const ended = endedOn('2022-01-10T03:00:01Z');
    expect(agentAccessRefusal('agent', ended, NOW, 5)).toBe('agents.ended');
    expect(agentAccessRefusal('records', ended, NOW, 5)).toBeNull();
    expect(agentAccessRefusal('records', endedOn('2022-01-10T03:00:00Z'), NOW, 5)).toBe('agents.ended');
    expect(agentAccessRefusal('records', endedOn('2021-06-01T00:00:00Z'), NOW, 5)).toBe('agents.ended');
    expect(agentAccessRefusal('records', endedOn('2021-06-01T00:00:00Z'), NOW, 6)).toBeNull();
    expect(agentAccessRefusal('records', { status: 'ended', endedAt: null }, NOW, 5)).toBe('agents.ended');
  });
});

/** Every `/v1/store/agent/*` handler is behind the guard, and only the listed ones are open to non-agents. */
describe('store agent controllers declare their access (D-467)', () => {
  const ANYONE = new Set([
    'programme',
    'application',
    'apply',
    'withdraw',
    'claim',
    'publicProgramme',
    'commissionExample',
    'requestPhoneOtp',
    'confirmPhone',
  ]);
  const RECORDS = new Set(['myStatements', 'myStatement', 'certificate']);

  const handlers = AGENTS_STORE_CONTROLLERS.flatMap((controller) => {
    const proto = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .map((name) => ({ controller, name, fn: proto[name] as object }))
      .filter(({ fn }) => Reflect.getMetadata(PATH_METADATA, fn) !== undefined);
  });

  it('applies the guard on every store agent controller', () => {
    for (const controller of AGENTS_STORE_CONTROLLERS) {
      expect(Reflect.getMetadata(PATH_METADATA, controller)).toMatch(/^agent/);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]).toContain(AgentZoneGuard);
    }
    expect(handlers.length).toBeGreaterThan(20);
  });

  it('opens to non-agents only the pre-agent handlers, and to ended agents only their records', () => {
    for (const { name, fn } of handlers) {
      const level = (Reflect.getMetadata(AGENT_ACCESS, fn) as AgentAccessLevel | undefined) ?? 'agent';
      const expected: AgentAccessLevel = ANYONE.has(name)
        ? 'anyone'
        : RECORDS.has(name)
          ? 'records'
          : 'agent';
      expect({ name, level }).toEqual({ name, level: expected });
      const permissions = (Reflect.getMetadata(REQUIRED_PERMISSIONS, fn) as string[] | undefined) ?? [];
      if (permissions.includes('agent.self')) expect({ name, level }).not.toEqual({ name, level: 'anyone' });
    }
  });
});
