import { type Tx } from '@database/prisma.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { type DomainEventEnvelope } from './domain-event';
import { type DomainEventSubscription, ON_DOMAIN_EVENT } from './on-domain-event.decorator';

export type DomainEventHandler = (event: DomainEventEnvelope, tx: Tx) => Promise<void>;

export interface RegisteredSubscriber extends DomainEventSubscription {
  handle: DomainEventHandler;
}

/** Collects every `@OnDomainEvent` method of the providers in this process. */
@Injectable()
export class SubscriberRegistry implements OnModuleInit {
  private readonly subscribers = new Map<string, RegisteredSubscriber>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || !wrapper.isDependencyTreeStatic()) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const method = instance[name];
        if (typeof method !== 'function') continue;
        const subscription = this.reflector.get<DomainEventSubscription | undefined>(ON_DOMAIN_EVENT, method);
        if (subscription)
          this.register({ ...subscription, handle: (method as DomainEventHandler).bind(instance) });
      }
    }
  }

  register(subscriber: RegisteredSubscriber): void {
    if (this.subscribers.has(subscriber.consumer)) {
      throw new Error(`Duplicate domain-event consumer name: ${subscriber.consumer}`);
    }
    this.subscribers.set(subscriber.consumer, subscriber);
  }

  forType(type: string): RegisteredSubscriber[] {
    return [...this.subscribers.values()].filter((s) => s.types.includes('*') || s.types.includes(type));
  }

  get(consumer: string): RegisteredSubscriber | undefined {
    return this.subscribers.get(consumer);
  }
}
