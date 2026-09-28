import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { LedgerConfigService } from './ledger-config.service';
import { ManualJournalsService } from './manual-journals.service';
import { RecurringJournalsService } from './recurring-journals.service';

const POLICIES = ['manual_journal', 'recurring_journal', 'coa_change', 'posting_rule_change', 'tax_setting_change'];

/**
 * Applies the outcome of the ledger's maker-checker approvals (accounting-design §8, D-169) in the approval
 * event's consumer transaction: manual / recurring journals post or are rejected; account changes, rule
 * versions and tax-rate versions apply or are declined.
 */
@Injectable()
export class LedgerApprovalsSubscriber {
  constructor(
    private readonly journals: ManualJournalsService,
    private readonly recurring: RecurringJournalsService,
    private readonly config: LedgerConfigService,
  ) {}

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'ledger.approvals',
  })
  async onOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const policyKey = event.payload['policyKey'];
    if (typeof policyKey !== 'string' || !POLICIES.includes(policyKey)) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const approved = event.type === 'approval.approved';
    const reason = `approval ${event.type.split('.')[1]}`;
    switch (request.subjectType) {
      case 'journal_entry':
        return this.journals.onDecided(tx, request, approved, reason);
      case 'recurring_journal':
        return this.recurring.onDecided(tx, request, approved);
      case 'account_change':
        return this.config.onAccountChangeDecided(tx, request, approved);
      case 'posting_rule_version':
        return this.config.onRuleVersionDecided(tx, request, approved);
      case 'tax_rate_version':
        return this.config.onTaxRateDecided(tx, request, approved);
    }
  }
}
