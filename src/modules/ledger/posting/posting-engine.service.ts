import { systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { businessDay } from '@common/ledger-core/dates';
import {
  type PostingTemplate,
  type RenderedJournal,
  renderJournal,
  ruleApplies,
  TemplateError,
} from '@common/ledger-core/template';
import { formatMoney } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import { type JournalEntry, type PostingRule, type PostingRuleVersion } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';

import { JournalPostingService } from '../journal-posting.service';

const TYPES_TTL_MS = 30_000;

export interface RuleWithVersion {
  rule: PostingRule;
  version: PostingRuleVersion;
}

/**
 * The posting engine (ADR-0007): one idempotent subscriber (`ledger.posting`, exactly once per domain
 * event through `event_consumptions`) that renders every applicable rule version — the approved version in
 * force when the event happened — into a balanced automatic journal. The partial unique key
 * (domain_event_id, posting_rule_id) makes a second posting of the same event and rule impossible.
 * A rule that renders an unbalanced journal fails the event (it is retried, then dead-lettered for Finance);
 * a difference is never plugged.
 */
@Injectable()
export class PostingEngine {
  private eventTypes: { types: Set<string>; loadedAt: number } | null = null;

  constructor(
    private readonly posting: JournalPostingService,
    private readonly entities: EntitiesService,
  ) {}

  invalidate(): void {
    this.eventTypes = null;
  }

  @OnDomainEvent('*', { consumer: 'ledger.posting' })
  async onEvent(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (!(await this.hasRules(tx, event.type))) return;
    await this.postEvent(tx, event);
  }

  /** Posts every applicable rule of the event; returns the entries written. */
  async postEvent(tx: Tx, event: DomainEventEnvelope): Promise<JournalEntry[]> {
    const posted: JournalEntry[] = [];
    for (const { rule, version } of await this.rulesFor(tx, event.type, new Date(event.occurredAt))) {
      if (!ruleApplies(version.conditions, event.payload)) continue;
      const journal = this.render(rule, version, event.payload);
      if (journal.lines.length === 0) continue; // memo rules (P13, P24) and nothing to post
      if (!journal.totalDebit.eq(journal.totalCredit))
        throw new DomainException('ledger.unbalanced', {
          params: { debit: formatMoney(journal.totalDebit), credit: formatMoney(journal.totalCredit) },
        });
      const entityId = event.entityId ? BigInt(event.entityId) : await this.entities.defaultEntityId();
      posted.push(
        await this.posting.post(
          tx,
          {
            entityId,
            kind: 'auto',
            documentDate: businessDay(journal.documentDate ?? event.occurredAt),
            description: journal.description,
            source: journal.source,
            domainEventId: event.id,
            postingRuleId: rule.id,
            postingRuleVersionId: version.id,
            lines: journal.lines.map((l) => ({
              accountCode: l.accountCode,
              side: l.side,
              amount: l.amount,
              description: l.description,
              dimensions: l.dimensions,
              taxCode: l.taxCode,
              taxBase: l.taxBase,
            })),
          },
          systemActor('ledger.posting'),
        ),
      );
    }
    return posted;
  }

  /** Dry run of one rule version on a payload (rule editing, B5.1). */
  render(
    rule: Pick<PostingRule, 'key'>,
    version: Pick<PostingRuleVersion, 'template'>,
    payload: Record<string, unknown>,
  ): RenderedJournal {
    try {
      return renderJournal(version.template as unknown as PostingTemplate, payload);
    } catch (error) {
      if (error instanceof TemplateError)
        throw new DomainException('ledger.rule_invalid', {
          params: { reason: `${rule.key}: ${error.message}` },
        });
      throw error;
    }
  }

  /** The approved version in force at `at` of every rule listening to `eventType`. */
  async rulesFor(tx: Tx, eventType: string, at: Date): Promise<RuleWithVersion[]> {
    const rules = await tx.postingRule.findMany({
      where: { eventType },
      include: {
        versions: {
          where: { status: 'approved', effectiveFrom: { lte: at } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
        },
      },
      orderBy: { key: 'asc' },
    });
    return rules
      .filter((r) => r.versions[0])
      .map(({ versions, ...rule }) => ({ rule, version: versions[0]! }));
  }

  private async hasRules(tx: Tx, type: string): Promise<boolean> {
    if (!this.eventTypes || Date.now() - this.eventTypes.loadedAt > TYPES_TTL_MS) {
      const rows = await tx.postingRule.findMany({ select: { eventType: true }, distinct: ['eventType'] });
      this.eventTypes = { types: new Set(rows.map((r) => r.eventType)), loadedAt: Date.now() };
    }
    return this.eventTypes.types.has(type);
  }
}
