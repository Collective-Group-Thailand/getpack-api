import { type Actor, actorColumns } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { dateOnly } from '@common/ledger-core/dates';
import { type DimensionKey } from '@common/ledger-core/template';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import {
  type Account,
  type JournalEntry,
  type JournalKind,
  type LedgerDimension,
  Prisma,
  type SalesChannel,
  type TaxCode,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { PeriodsService } from './periods.service';

const SALES_CHANNELS: readonly string[] = ['web', 'cs', 'line', 'b2b'];

/** Template dimension key → ledger dimension enum → journal-line column. */
const DIMENSIONS: Record<DimensionKey, { dim: LedgerDimension; column: keyof LineDimensionColumns }> = {
  order: { dim: 'order', column: 'orderId' },
  orderGroup: { dim: 'order_group', column: 'orderGroupId' },
  customer: { dim: 'customer', column: 'customerUserId' },
  company: { dim: 'company', column: 'companyId' },
  factory: { dim: 'factory', column: 'factoryId' },
  vendor: { dim: 'vendor', column: 'vendorId' },
  productType: { dim: 'product_type', column: 'productTypeId' },
  channel: { dim: 'channel', column: 'channel' },
  campaign: { dim: 'campaign', column: 'campaignId' },
  promotion: { dim: 'promotion', column: 'promotionId' },
  costCentre: { dim: 'cost_centre', column: 'costCentreId' },
};

export interface LineDimensionColumns {
  orderId?: bigint | null;
  orderGroupId?: bigint | null;
  customerUserId?: bigint | null;
  companyId?: bigint | null;
  factoryId?: bigint | null;
  vendorId?: bigint | null;
  productTypeId?: bigint | null;
  channel?: SalesChannel | null;
  campaignId?: bigint | null;
  promotionId?: bigint | null;
  costCentreId?: bigint | null;
}

export interface JournalDraftLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: MoneyValue | string;
  description?: string | null;
  /** Public ids (a sales channel for `channel`, a code for `costCentre`). */
  dimensions?: Partial<Record<DimensionKey, string>>;
  taxCode?: TaxCode | null;
  taxBase?: MoneyValue | string | null;
}

export interface JournalDraft {
  entityId: bigint;
  kind: JournalKind;
  /** `YYYY-MM-DD` (Bangkok): the document date; the entry date follows the period rule (§1.4). */
  documentDate: string;
  description: string;
  lines: JournalDraftLine[];
  source?: { type: string; publicId: string; number?: string | null } | null;
  domainEventId?: string | null;
  postingRuleId?: bigint | null;
  postingRuleVersionId?: bigint | null;
  reversesEntryId?: bigint | null;
  recurringJournalId?: bigint | null;
  autoReverseOn?: string | null;
  jvNumber?: string | null;
  approvalRequestId?: bigint | null;
  createdById?: bigint | null;
  approvedById?: bigint | null;
  /**
   * `strict` (manual journals): a dimension the account does not allow is an error. Otherwise (the engine)
   * it is dropped, so one set of rule-level dimensions can serve every line.
   */
  strictDimensions?: boolean;
  /** The poster holds `ledger.post_soft_closed` (accounting-design §1.4). */
  allowSoftClosed?: boolean;
}

export interface ValidatedLine {
  account: Account;
  debit: string;
  credit: string;
  description: string | null;
  dims: LineDimensionColumns;
  taxCode: TaxCode | null;
  taxBase: string | null;
}

/**
 * The only writer of journal lines (accounting-design §1, ADR-0007): validates a draft against the chart of
 * accounts (active, postable, control accounts for sub-ledger entries only, required / allowed dimensions),
 * checks the balance, picks the period (the next open one when the document's period is not open), numbers
 * the entry and posts it — the database re-checks balance, period and account rules at commit.
 */
@Injectable()
export class JournalPostingService {
  constructor(private readonly periods: PeriodsService) {}

  async post(tx: Tx, draft: JournalDraft, actor: Actor): Promise<JournalEntry> {
    const lines = await this.validate(tx, draft);
    const { period, entryDate } = await this.periods.postingPeriod(
      tx,
      draft.entityId,
      draft.documentDate,
      draft.allowSoftClosed ?? false,
    );
    const total = lines.reduce((a, l) => a.add(l.debit), new MoneyDecimal(0));
    const entry = await tx.journalEntry.create({
      data: {
        entityId: draft.entityId,
        fiscalPeriodId: period.id,
        entryDate: dateOnly(entryDate),
        documentDate: dateOnly(draft.documentDate),
        kind: draft.kind,
        status: 'draft',
        sourceDocumentType: draft.source?.type ?? null,
        sourceDocumentPublicId: draft.source?.publicId ?? null,
        sourceDocumentNo: draft.source?.number ?? null,
        domainEventId: draft.domainEventId ?? null,
        postingRuleId: draft.postingRuleId ?? null,
        postingRuleVersionId: draft.postingRuleVersionId ?? null,
        reversesEntryId: draft.reversesEntryId ?? null,
        recurringJournalId: draft.recurringJournalId ?? null,
        autoReverseOn: draft.autoReverseOn ? dateOnly(draft.autoReverseOn) : null,
        jvNumber: draft.jvNumber ?? null,
        description: draft.description.slice(0, 500) || '-',
        approvalRequestId: draft.approvalRequestId ?? null,
        createdById: draft.createdById ?? null,
        approvedById: draft.approvedById ?? null,
        approvedAt: draft.approvedById ? new Date() : null,
        lines: {
          create: lines.map((l, i) => ({
            lineNo: i + 1,
            accountId: l.account.id,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            ...l.dims,
            taxCode: l.taxCode,
            taxBaseAmount: l.taxBase,
            entityId: draft.entityId,
            fiscalPeriodId: period.id,
            entryDate: dateOnly(entryDate),
          })),
        },
      },
    });
    return this.finalise(tx, entry, formatMoney(total), draft.allowSoftClosed ?? false, actor);
  }

  /**
   * Posts an existing draft / pending entry (manual journals after approval): the period is chosen again at
   * posting time, so an approval that arrives after the month closed lands in the next open month.
   */
  async postExisting(
    tx: Tx,
    entryId: bigint,
    actor: Actor,
    extra: { approvedById?: bigint | null; allowSoftClosed?: boolean } = {},
  ) {
    const entry = await tx.journalEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { lines: true },
    });
    if (entry.status === 'posted' || entry.status === 'rejected')
      throw new DomainException('ledger.journal_not_editable', { params: { status: entry.status } });
    const documentDate = entry.documentDate.toISOString().slice(0, 10);
    const { period, entryDate } = await this.periods.postingPeriod(
      tx,
      entry.entityId,
      documentDate,
      extra.allowSoftClosed ?? false,
    );
    const moved = await tx.journalEntry.update({
      where: { id: entry.id },
      data: {
        fiscalPeriodId: period.id,
        entryDate: dateOnly(entryDate),
        approvedById: extra.approvedById ?? entry.approvedById,
        approvedAt: extra.approvedById ? new Date() : entry.approvedAt,
      },
    });
    const total = entry.lines.reduce((a, l) => a.add(l.debit.toString()), new MoneyDecimal(0));
    return this.finalise(tx, moved, formatMoney(total), extra.allowSoftClosed ?? false, actor);
  }

  private async finalise(tx: Tx, entry: JournalEntry, total: string, allowSoftClosed: boolean, actor: Actor) {
    const key = entry.entryDate.toISOString().slice(0, 7);
    const [row] = await tx.$queryRaw<{ value: bigint }[]>`
      INSERT INTO journal_entry_counters (entity_id, period_key, next_value, updated_at)
      VALUES (${entry.entityId}, ${key}, 2, now())
      ON CONFLICT (entity_id, period_key)
      DO UPDATE SET next_value = journal_entry_counters.next_value + 1, updated_at = now()
      RETURNING next_value - 1 AS value`;
    const entryNo = `JE${key.replace('-', '')}-${row!.value.toString().padStart(6, '0')}`;
    if (allowSoftClosed) await tx.$executeRaw`SELECT set_config('getpack.post_soft_closed', 'on', true)`;
    try {
      return await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          status: 'posted',
          entryNo,
          totalDebit: total,
          totalCredit: total,
          postedAt: new Date(),
          postedById: actorColumns(actor).actorUserId,
        },
      });
    } catch (error) {
      if (String(error).includes('ledger.period_closed'))
        throw new DomainException('ledger.period_closed', {
          params: { date: entry.entryDate.toISOString().slice(0, 10), status: 'closed' },
        });
      throw error;
    } finally {
      if (allowSoftClosed) await tx.$executeRaw`SELECT set_config('getpack.post_soft_closed', 'off', true)`;
    }
  }

  /** Validates lines against the chart of accounts and resolves their dimensions. */
  async validate(
    tx: Tx,
    draft: Pick<JournalDraft, 'entityId' | 'kind' | 'lines' | 'strictDimensions' | 'reversesEntryId'>,
  ): Promise<ValidatedLine[]> {
    if (draft.lines.length < 2)
      throw new DomainException('ledger.unbalanced', { params: { debit: '0.00', credit: '0.00' } });
    const codes = [...new Set(draft.lines.map((l) => l.accountCode))];
    const accounts = new Map(
      (await tx.account.findMany({ where: { entityId: draft.entityId, code: { in: codes } } })).map((a) => [
        a.code,
        a,
      ]),
    );
    let fromSubLedger = draft.kind === 'auto';
    if (draft.kind === 'reversal' && draft.reversesEntryId) {
      const original = await tx.journalEntry.findUnique({
        where: { id: draft.reversesEntryId },
        select: { kind: true },
      });
      fromSubLedger = original?.kind === 'auto';
    }
    const resolver = new DimensionResolver(tx, draft.entityId);
    const out: ValidatedLine[] = [];
    let debit = new MoneyDecimal(0);
    let credit = new MoneyDecimal(0);
    for (const line of draft.lines) {
      const account = accounts.get(line.accountCode);
      const invalid = (reason: string) =>
        new DomainException('ledger.account_invalid', { params: { code: line.accountCode, reason } });
      if (!account) throw invalid('not in the chart of accounts');
      if (account.status !== 'active') throw invalid('inactive');
      if (!account.isPostable) throw invalid('a heading account');
      if (account.isControl && !fromSubLedger)
        throw invalid('a control account takes sub-ledger postings only');
      const amount = new MoneyDecimal(line.amount.toString()).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
      if (!amount.gt(0)) throw invalid('amounts must be positive');
      const dims: LineDimensionColumns = {};
      const present = new Set<LedgerDimension>();
      for (const [key, raw] of Object.entries(line.dimensions ?? {}) as [DimensionKey, string][]) {
        const spec = DIMENSIONS[key];
        if (!spec || !raw) continue;
        if (!account.allowedDimensions.includes(spec.dim)) {
          if (draft.strictDimensions) throw invalid(`dimension ${spec.dim} is not allowed`);
          continue;
        }
        const value = await resolver.resolve(key, raw);
        if (value === null) {
          if (draft.strictDimensions) throw invalid(`unknown ${spec.dim} ${raw}`);
          continue;
        }
        (dims as Record<string, unknown>)[spec.column] = value;
        present.add(spec.dim);
      }
      const missing = account.requiredDimensions.filter((d) => !present.has(d));
      if (missing.length > 0) throw invalid(`dimension ${missing.join(', ')} required`);
      if (line.side === 'debit') debit = debit.add(amount);
      else credit = credit.add(amount);
      out.push({
        account,
        debit: line.side === 'debit' ? formatMoney(amount) : '0.00',
        credit: line.side === 'credit' ? formatMoney(amount) : '0.00',
        description: line.description ?? null,
        dims,
        taxCode: line.taxCode ?? null,
        taxBase:
          line.taxCode && line.taxBase !== null && line.taxBase !== undefined
            ? formatMoney(line.taxBase.toString())
            : null,
      });
    }
    if (!debit.eq(credit))
      throw new DomainException('ledger.unbalanced', {
        params: { debit: formatMoney(debit), credit: formatMoney(credit) },
      });
    return out;
  }
}

/** Public ids → internal ids for journal dimensions, cached per posting. */
class DimensionResolver {
  private readonly cache = new Map<string, bigint | string | null>();

  constructor(
    private readonly tx: Tx,
    private readonly entityId: bigint,
  ) {}

  async resolve(key: DimensionKey, raw: string): Promise<bigint | string | null> {
    const cacheKey = `${key}:${raw}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;
    const value = await this.lookup(key, raw);
    this.cache.set(cacheKey, value);
    return value;
  }

  private async lookup(key: DimensionKey, raw: string): Promise<bigint | string | null> {
    if (key === 'channel') return SALES_CHANNELS.includes(raw) ? raw : null;
    if (key === 'costCentre')
      return (
        (
          await this.tx.costCentre.findUnique({
            where: { entityId_code: { entityId: this.entityId, code: raw } },
          })
        )?.id ?? null
      );
    if (!/^[0-9a-f-]{36}$/i.test(raw)) return null;
    const where = { where: { publicId: raw }, select: { id: true } } as const;
    const row = await (async () => {
      switch (key) {
        case 'order':
          return this.tx.order.findUnique(where);
        case 'orderGroup':
          return this.tx.orderGroup.findUnique(where);
        case 'customer':
          return this.tx.user.findUnique(where);
        case 'company':
          return this.tx.company.findUnique(where);
        case 'factory':
          return this.tx.factory.findUnique(where);
        case 'vendor':
          return this.tx.vendor.findUnique(where);
        case 'productType':
          return this.tx.productType.findUnique(where);
        case 'campaign':
          return this.tx.campaign.findUnique(where);
        case 'promotion':
          return this.tx.promotion.findUnique(where);
        default:
          return null;
      }
    })();
    return row?.id ?? null;
  }
}

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
