import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { StudioChecksService } from './studio-checks.service';

/** Events after which a design has a new current version to check. */
export const DESIGN_VERSION_EVENTS = [
  'design.created',
  'design.saved',
  'design.restored',
  'design.duplicated',
  'design.copied_by_staff',
  'design.imported',
] as const;

/**
 * UX r2 A4 (D-278): checks the new current version of a design once it is saved, so `store.designs.list` can say how
 * many issues are left. Idempotent: a version already checked under the rules in force keeps its run.
 */
@Injectable()
export class DesignChecksSubscriber {
  constructor(private readonly checks: StudioChecksService) {}

  @OnDomainEvent(DESIGN_VERSION_EVENTS, { consumer: 'studio.design-checks' })
  async onSaved(event: DomainEventEnvelope): Promise<void> {
    const designId = event.payload['designId'];
    if (typeof designId === 'string') await this.checks.evaluateCurrent(designId);
  }
}
