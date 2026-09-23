import { type DiscoveryService, type MetadataScanner, type Reflector } from '@nestjs/core';

import { topicOf } from './domain-event';
import { relayBackoffMs } from './outbox-relay.service';
import { SubscriberRegistry } from './subscriber-registry';

const handle = () => Promise.resolve();
const registry = () => new SubscriberRegistry({} as DiscoveryService, {} as MetadataScanner, {} as Reflector);

describe('SubscriberRegistry', () => {
  it('matches subscribers by type and by wildcard', () => {
    const r = registry();
    r.register({ consumer: 'a', types: ['approval.approved'], handle });
    r.register({ consumer: 'all', types: ['*'], handle });
    expect(r.forType('approval.approved').map((s) => s.consumer)).toEqual(['a', 'all']);
    expect(r.forType('setting.changed').map((s) => s.consumer)).toEqual(['all']);
    expect(r.get('a')?.consumer).toBe('a');
  });

  it('refuses two subscribers with the same consumer name', () => {
    const r = registry();
    r.register({ consumer: 'a', types: ['x'], handle });
    expect(() => r.register({ consumer: 'a', types: ['y'], handle })).toThrow('Duplicate');
  });
});

describe('outbox helpers', () => {
  it('backs off exponentially up to 10 minutes', () => {
    expect([1, 2, 3, 4].map(relayBackoffMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(relayBackoffMs(30)).toBe(600_000);
  });

  it('derives the topic from the event family', () => {
    expect(topicOf('approval.step_approved')).toBe('approval');
  });
});
