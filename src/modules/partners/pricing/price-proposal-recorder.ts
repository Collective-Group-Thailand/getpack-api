import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

/**
 * Audit + domain event + activity for price governance, in the caller's transaction. Payloads carry
 * statuses, counts and version numbers only — never prices (D-044: activity is visible to the factory
 * and events fan out to notifications).
 */
@Injectable()
export class PriceProposalRecorder {
  constructor(
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async proposal(
    tx: Tx,
    factory: { publicId: string },
    proposal: { publicId: string },
    type: string,
    data: Record<string, unknown>,
    internal = false,
  ): Promise<void> {
    await this.write(
      tx,
      factory.publicId,
      'price_proposal',
      proposal.publicId,
      type,
      { proposalId: proposal.publicId, ...data },
      internal,
    );
  }

  async versionApproved(
    tx: Tx,
    factory: { publicId: string },
    version: { publicId: string; versionNo: number; effectiveFrom: Date; origin: string; lineCount: number },
    productTypeCode: string,
  ): Promise<void> {
    await this.write(
      tx,
      factory.publicId,
      'price_list_version',
      version.publicId,
      'price_list.version_approved',
      {
        versionId: version.publicId,
        versionNo: version.versionNo,
        productType: productTypeCode,
        origin: version.origin,
        lineCount: version.lineCount,
        effectiveFrom: version.effectiveFrom.toISOString(),
      },
    );
  }

  private async write(
    tx: Tx,
    factoryPublicId: string,
    resourceType: string,
    resourcePublicId: string,
    type: string,
    data: Record<string, unknown>,
    internal = false,
  ): Promise<void> {
    await this.audit.record(tx, { category: 'config', action: type, resourceType, resourcePublicId, data });
    const event = await this.events.record(tx, {
      type,
      aggregateType: resourceType,
      aggregateId: resourcePublicId,
      payload: { factoryId: factoryPublicId, ...data },
    });
    await this.activity.record(tx, {
      aggregateType: 'factory',
      aggregatePublicId: factoryPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: internal ? ['internal'] : ['internal', 'partner'],
      domainEventId: event.id,
    });
  }
}
