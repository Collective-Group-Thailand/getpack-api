import { MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import {
  type Account,
  type CostCentre,
  type FiscalPeriod,
  type FiscalYear,
  type PostingRule,
  type PostingRuleVersion,
  type Prisma,
  type RecurringJournal,
  type TaxRate,
  type TaxRateVersion,
} from '@generated/prisma/client';

import {
  type AccountChangeDto,
  type AccountDto,
  type AccountFieldsDto,
  type CostCentreDto,
  type FiscalPeriodDto,
  type FiscalYearDto,
  type JournalDto,
  type JournalLineDimensionsDto,
  type ManualJournalLineDto,
  type PostingRuleDto,
  type PostingRuleVersionDto,
  type RecurringJournalDto,
  type TaxRateDto,
} from './ledger.dto';
import { dayOf } from '@common/ledger-core/dates';
import { type JournalRow } from './manual-journals.service';

export const accountDto = (a: Account & { parent: { code: string } | null }): AccountDto => ({
  id: a.publicId,
  code: a.code,
  nameTh: a.nameTh,
  nameEn: a.nameEn,
  accountType: a.accountType,
  normalSide: a.normalSide,
  parentCode: a.parent?.code ?? null,
  isControl: a.isControl,
  isPostable: a.isPostable,
  allowedDimensions: a.allowedDimensions,
  requiredDimensions: a.requiredDimensions,
  cashFlowClass: a.cashFlowClass,
  status: a.status,
});

export const accountChangeDto = (
  c: Prisma.AccountChangeGetPayload<{
    include: { account: { select: { code: true } }; approvalRequest: { select: { publicId: true } } };
  }>,
): AccountChangeDto => ({
  id: c.publicId,
  kind: c.kind,
  accountCode: c.account?.code ?? null,
  proposed: c.proposed as AccountFieldsDto,
  reason: c.reason,
  status: c.status,
  approvalRequestId: c.approvalRequest?.publicId ?? null,
  createdAt: toBangkokIso(c.createdAt),
});

export const costCentreDto = (c: CostCentre): CostCentreDto => ({
  id: c.publicId,
  code: c.code,
  name: c.name,
  status: c.status,
});

export const periodDto = (p: FiscalPeriod): FiscalPeriodDto => ({
  id: p.publicId,
  periodNo: p.periodNo,
  startDate: dayOf(p.startDate),
  endDate: dayOf(p.endDate),
  status: p.status,
  statusChangedAt: p.statusChangedAt ? toBangkokIso(p.statusChangedAt) : null,
});

export const fiscalYearDto = (y: FiscalYear & { periods: FiscalPeriod[] }): FiscalYearDto => ({
  id: y.publicId,
  label: y.label,
  startDate: dayOf(y.startDate),
  endDate: dayOf(y.endDate),
  status: y.status,
  periods: y.periods.map(periodDto),
});

type LineRow = JournalRow['lines'][number];

export function lineDimensions(l: LineRow): JournalLineDimensionsDto {
  return Object.fromEntries(
    Object.entries({
      order: l.order?.publicId,
      orderGroup: l.orderGroup?.publicId,
      customer: l.customer?.publicId,
      company: l.company?.publicId,
      factory: l.factory?.publicId,
      vendor: l.vendor?.publicId,
      productType: l.productType?.publicId,
      channel: l.channel ?? undefined,
      campaign: l.campaign?.publicId,
      promotion: l.promotion?.publicId,
      costCentre: l.costCentre?.code,
    }).filter(([, v]) => v !== undefined && v !== null),
  );
}

export const journalDto = (e: JournalRow): JournalDto => ({
  id: e.publicId,
  entryNo: e.entryNo,
  jvNumber: e.jvNumber,
  kind: e.kind,
  status: e.status,
  entryDate: dayOf(e.entryDate),
  documentDate: dayOf(e.documentDate),
  periodId: e.fiscalPeriod.publicId,
  description: e.description,
  totalDebit: e.status === 'posted' ? e.totalDebit.toFixed(2) : sum(e.lines, 'debit'),
  totalCredit: e.status === 'posted' ? e.totalCredit.toFixed(2) : sum(e.lines, 'credit'),
  currency: 'THB',
  source:
    e.sourceDocumentType && e.sourceDocumentPublicId
      ? { type: e.sourceDocumentType, id: e.sourceDocumentPublicId, number: e.sourceDocumentNo }
      : null,
  domainEventId: e.domainEventId,
  postingRule: e.postingRule?.key ?? null,
  postingRuleVersion: e.postingRuleVersion?.versionNo ?? null,
  reversesId: e.reverses?.publicId ?? null,
  reversedById: e.reversedBy?.publicId ?? null,
  autoReverseOn: e.autoReverseOn ? dayOf(e.autoReverseOn) : null,
  approvalRequestId: e.approvalRequest?.publicId ?? null,
  rejectionReason: e.rejectionReason,
  createdBy: e.createdBy?.publicId ?? null,
  approvedBy: e.approvedBy?.publicId ?? null,
  postedAt: e.postedAt ? toBangkokIso(e.postedAt) : null,
  lines: e.lines.map((l) => ({
    lineNo: l.lineNo,
    accountCode: l.account.code,
    accountName: l.account.nameEn,
    debit: l.debit.toFixed(2),
    credit: l.credit.toFixed(2),
    description: l.description,
    dimensions: lineDimensions(l),
    taxCode: l.taxCode,
    taxBaseAmount: l.taxBaseAmount?.toFixed(2) ?? null,
  })),
});

function sum(lines: LineRow[], side: 'debit' | 'credit'): string {
  return lines.reduce((a, l) => a.add(l[side].toString()), new MoneyDecimal(0)).toFixed(2);
}

export const recurringDto = (
  r: RecurringJournal & { approvalRequest: { publicId: string } | null },
): RecurringJournalDto => ({
  id: r.publicId,
  name: r.name,
  description: r.description,
  dayOfMonth: r.dayOfMonth,
  startOn: dayOf(r.startOn),
  endOn: r.endOn ? dayOf(r.endOn) : null,
  nextRunOn: dayOf(r.nextRunOn),
  autoReverse: r.autoReverse,
  status: r.status,
  lines: (r.template as unknown as { lines: ManualJournalLineDto[] }).lines,
  approvalRequestId: r.approvalRequest?.publicId ?? null,
});

export const ruleVersionDto = (
  v: PostingRuleVersion & { approvalRequest?: { publicId: string } | null },
): PostingRuleVersionDto => ({
  id: v.publicId,
  versionNo: v.versionNo,
  effectiveFrom: toBangkokIso(v.effectiveFrom),
  status: v.status,
  conditions: (v.conditions as Record<string, unknown> | null) ?? null,
  template: v.template as Record<string, unknown>,
  reason: v.reason,
  approvalRequestId: v.approvalRequest?.publicId ?? null,
});

export const ruleDto = (
  r: PostingRule & { versions: (PostingRuleVersion & { approvalRequest?: { publicId: string } | null })[] },
): PostingRuleDto => ({
  id: r.publicId,
  key: r.key,
  eventType: r.eventType,
  name: r.name,
  description: r.description,
  decisionRefs: r.decisionRefs,
  versions: r.versions.map(ruleVersionDto),
});

export const taxRateDto = (t: TaxRate & { versions: TaxRateVersion[] }): TaxRateDto => ({
  id: t.publicId,
  code: t.code,
  nameTh: t.nameTh,
  nameEn: t.nameEn,
  description: t.description,
  versions: t.versions.map((v) => ({
    versionNo: v.versionNo,
    effectiveFrom: toBangkokIso(v.effectiveFrom),
    status: v.status,
    ratePct: v.ratePct.toFixed(4),
    reason: v.reason,
  })),
});
