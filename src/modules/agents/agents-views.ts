import { toBangkokIso } from '@common/time/bangkok';

import { type FactoryLinkRow, type LeadRow, type LinkRow } from './agent-attribution.service';
import { type CommissionRow } from './agent-commissions.service';
import { type PayoutProfileRow } from './agent-payout-profiles.service';
import { agentRef, D, maskName, storeTermsOf, termsOf, userRef } from './agent-shared';
import { type StatementRow } from './agent-statements.service';
import { type TaxDeclarationRow } from './agent-tax-declarations.service';
import {
  type AdminAgentApplicationDto,
  type AdminAgentCommissionDto,
  type AdminAgentDto,
  type AdminAgentLeadDto,
  type AdminAgentLinkDto,
  type AdminAgentPayoutProfileDto,
  type AdminAgentStatementDto,
  type AdminAgentTaxDeclarationDto,
  type AdminAgentTotalsDto,
  type AgentApplicationDto,
  type AgentCommissionDto,
  type AgentDto,
  type AgentFactoryLinkDto,
  type AgentLeadDto,
  type AgentLinkDto,
  type AgentPayoutProfileDto,
  type AgentPlanDto,
  type AgentPlanVersionDto,
  type AgentStatementDto,
  type AgentTaxDeclarationDto,
  type AgentTotalsDto,
} from './agents.dto';
import { type AgentRow, type ApplicationRow, type PlanRow } from './agents.service';

const iso = (d: Date | null | undefined) => (d ? toBangkokIso(d) : null);
const day = (d: Date) => d.toISOString().slice(0, 10);

export function applicationDto(r: ApplicationRow): AgentApplicationDto {
  return {
    id: r.publicId,
    status: r.status,
    juristicType: r.juristicType,
    legalName: r.legalName,
    taxId: r.taxId,
    branchCode: r.branchCode,
    isVatRegistered: r.isVatRegistered,
    address: r.address,
    postcode: r.postcode,
    phone: r.phone,
    email: r.email,
    lineId: r.lineId,
    salesChannels: r.salesChannels,
    pitch: r.pitch,
    bankCode: r.bankCode,
    bankBranchName: r.bankBranchName,
    bankAccountName: r.bankAccountName,
    bankAccountNoLast4: r.bankAccountNoLast4,
    idDocument: r.idDocumentFile
      ? { id: r.idDocumentFile.publicId, originalName: r.idDocumentFile.originalName }
      : null,
    bankBook: r.bankBookFile
      ? { id: r.bankBookFile.publicId, originalName: r.bankBookFile.originalName }
      : null,
    agreementVersionNo: r.agreementVersion.versionNo,
    agreementAcceptedAt: toBangkokIso(r.agreementAcceptedAt),
    submittedAt: toBangkokIso(r.submittedAt),
    decidedAt: iso(r.decidedAt),
    decisionReason: r.decisionReason,
  };
}

export function adminApplicationDto(r: ApplicationRow, checks: string[]): AdminAgentApplicationDto {
  return {
    ...applicationDto(r),
    user: { id: r.user.publicId, displayName: r.user.displayName },
    // Before D-466 an application carried no contact of its own: the account's.
    phone: r.phone ?? r.user.phone,
    email: r.email ?? r.user.email,
    decidedBy: userRef(r.decidedBy),
    agentId: r.agent?.publicId ?? null,
    checks,
  };
}

export function agentDto(
  r: AgentRow,
  link: string,
  terms: ReturnType<typeof storeTermsOf>,
  all: AdminAgentTotalsDto,
): AgentDto {
  // D-435: the factory count stays with staff (adminAgentDto); an agent never learns about factories.
  const totals: AgentTotalsDto = {
    pending: all.pending,
    held: all.held,
    earned: all.earned,
    statemented: all.statemented,
    paidThisYear: all.paidThisYear,
    activeLinks: all.activeLinks,
    openLeads: all.openLeads,
  };
  return {
    id: r.publicId,
    kind: r.kind,
    status: r.status,
    code: r.code,
    link,
    legalName: r.legalName,
    plan: { id: r.plan.publicId, code: r.plan.code, nameTh: r.plan.nameTh },
    terms,
    joinedAt: toBangkokIso(r.joinedAt),
    statusReason: r.statusReason,
    totals,
  };
}

export function adminAgentDto(
  r: AgentRow,
  link: string,
  terms: ReturnType<typeof termsOf>,
  totals: AdminAgentTotalsDto,
): AdminAgentDto {
  const accounts = r.vendor?.bankAccounts ?? [];
  return {
    ...agentDto(r, link, null, totals),
    terms: terms ? { ...storeTermsFromFull(terms) } : null,
    planTerms: terms,
    totals,
    user: { id: r.user.publicId, displayName: r.user.displayName },
    phone: r.user.phone,
    juristicType: r.juristicType,
    taxId: r.taxId,
    employeeCode: r.employeeCode,
    staffUser: userRef(r.staffUser),
    vendorId: r.vendor?.publicId ?? null,
    bankAccount: accounts.some((a) => a.status === 'active')
      ? 'active'
      : accounts.some((a) => a.status === 'pending_approval')
        ? 'pending_approval'
        : 'none',
    applicationId: r.application?.publicId ?? null,
    note: r.note,
    rowVersion: r.rowVersion,
  };
}

function linkTotals(r: LinkRow) {
  const live = r.commissions.filter((c) => c.status !== 'cancelled');
  return {
    orders: live.filter((c) => c.kind === 'order').length,
    commission: live.reduce((a, c) => a.add(c.amount.toString()), D(0)).toFixed(2),
  };
}

function linkName(r: LinkRow, forAgent: boolean): string {
  if (r.company) return r.company.tradeName ?? r.company.legalName;
  const name = r.customerUser?.displayName ?? null;
  // D-422: a person who came through the link shows masked to the agent; one they registered shows by name.
  return forAgent && r.source !== 'lead' && r.source !== 'staff' ? maskName(name) : (name ?? '—');
}

export function agentLinkDto(r: LinkRow, forAgent = true): AgentLinkDto {
  return {
    id: r.publicId,
    source: r.source,
    status: r.status,
    subject: r.companyId ? 'company' : 'customer',
    name: linkName(r, forAgent),
    attributedAt: toBangkokIso(r.attributedAt),
    endsAt: toBangkokIso(r.endsAt),
    endedAt: iso(r.endedAt),
    ...linkTotals(r),
  };
}

export function adminAgentLinkDto(r: LinkRow): AdminAgentLinkDto {
  return {
    ...agentLinkDto(r, false),
    agent: agentRef(r.agent),
    customer: userRef(r.customerUser),
    companyId: r.company?.publicId ?? null,
    companyName: r.company ? (r.company.tradeName ?? r.company.legalName) : null,
    reason: r.reason,
    endedReason: r.endedReason,
  };
}

export function leadDto(r: LeadRow): AgentLeadDto {
  return {
    id: r.publicId,
    kind: r.kind,
    status: r.status,
    contactName: r.contactName,
    organisationName: r.organisationName,
    phone: r.phone,
    email: r.email,
    taxId: r.taxId,
    note: r.note,
    protectedUntil: toBangkokIso(r.protectedUntil),
    convertedAt: iso(r.convertedAt),
    closedReason: r.closedReason,
    createdAt: toBangkokIso(r.createdAt),
  };
}

export function adminLeadDto(r: LeadRow): AdminAgentLeadDto {
  return {
    ...leadDto(r),
    agent: agentRef(r.agent),
    convertedCustomerId: r.convertedUser?.publicId ?? null,
    convertedCompanyId: r.convertedCompany?.publicId ?? null,
    convertedFactoryId: r.convertedFactory?.publicId ?? null,
  };
}

export function factoryLinkDto(r: FactoryLinkRow, completedJobs: number): AgentFactoryLinkDto {
  return {
    id: r.publicId,
    status: r.status,
    agent: agentRef(r.agent),
    factoryId: r.factory.publicId,
    factoryCode: r.factory.code,
    factoryName: r.factory.tradeName ?? r.factory.legalName,
    factoryStatus: r.factory.status,
    linkedAt: toBangkokIso(r.linkedAt),
    qualifiedAt: iso(r.qualifiedAt),
    completedJobs,
    reason: r.reason,
  };
}

function customerNameOf(r: CommissionRow, forAgent: boolean): string | null {
  if (!r.link) return null;
  if (r.link.company) return r.link.company.tradeName ?? r.link.company.legalName;
  const name = r.link.customerUser?.displayName ?? null;
  return forAgent && r.link.source !== 'lead' && r.link.source !== 'staff' ? maskName(name) : name;
}

export function commissionDto(r: CommissionRow, forAgent = true): AgentCommissionDto {
  return {
    id: r.publicId,
    kind: r.kind,
    status: r.status,
    orderCode: r.order?.orderCode ?? null,
    customerName: customerNameOf(r, forAgent),
    isFirstOrder: r.isFirstOrder,
    baseAmount: r.baseAmount.toFixed(2),
    ratePct: r.ratePct === null ? null : D(r.ratePct).toString(),
    amount: r.amount.toFixed(2),
    availableAt: iso(r.availableAt),
    earnedAt: iso(r.earnedAt),
    statementNo: r.statement?.statementNo ?? null,
    note: r.note,
    createdAt: toBangkokIso(r.createdAt),
  };
}

export function adminCommissionDto(r: CommissionRow): AdminAgentCommissionDto {
  return {
    ...commissionDto(r, false),
    agent: agentRef(r.agent),
    factoryName: r.factoryLink ? (r.factoryLink.factory.tradeName ?? r.factoryLink.factory.legalName) : null,
    orderId: r.order?.publicId ?? null,
    marginAmount: r.marginAmount?.toFixed(2) ?? null,
    capAmount: r.capAmount?.toFixed(2) ?? null,
    marginAlert: r.marginAlert,
    holdFlags: r.holdFlags,
  };
}

export function statementDto(
  r: StatementRow,
  payment: { wht: string | null; paid: string | null; certificateFileId: bigint | null },
): AgentStatementDto {
  return {
    id: r.publicId,
    statementNo: r.statementNo,
    periodStart: day(r.periodStart),
    periodEnd: day(r.periodEnd),
    status: r.status,
    entryCount: r.entryCount,
    totalAmount: r.totalAmount.toFixed(2),
    // D-465: what the payment withheld once paid; before that what approval decided.
    whtAmount: payment.wht ?? r.whtAmount?.toFixed(2) ?? null,
    whtMethod: r.whtMethod,
    paidAmount: payment.paid,
    approvedAt: iso(r.approvedAt),
    paidAt: iso(r.paidAt),
    hasWhtCertificate: payment.certificateFileId !== null,
  };
}

export function adminStatementDto(
  r: StatementRow,
  payment: { wht: string | null; paid: string | null; certificateFileId: bigint | null },
): AdminAgentStatementDto {
  return {
    ...statementDto(r, payment),
    agent: agentRef(r.agent),
    vendorInvoiceId: r.vendorInvoice?.publicId ?? null,
    approvedBy: userRef(r.approvedBy),
    exportedAt: iso(r.exportedAt),
    voidedAt: iso(r.voidedAt),
    voidReason: r.voidReason,
    whtWorking:
      r.whtMethod === 'progressive_40_2' &&
      r.whtYtdPaid &&
      r.whtProjected &&
      r.whtAllowances &&
      r.whtAnnualTax
        ? {
            ytdPaid: r.whtYtdPaid.toFixed(2),
            projected: r.whtProjected.toFixed(2),
            allowances: r.whtAllowances.toFixed(2),
            annualTax: r.whtAnnualTax.toFixed(2),
          }
        : null,
    taxInvoiceNo: r.taxInvoiceNo,
    hasTaxInvoice: r.taxInvoiceFileId !== null,
    rowVersion: r.rowVersion,
  };
}

export function planDto(
  r: PlanRow,
  people: Map<bigint, { publicId: string; displayName: string }> = new Map(),
  now = new Date(),
): AgentPlanDto {
  const person = (id: bigint | null) => (id === null ? null : userRef(people.get(id)));
  const approved = r.versions
    .filter((v) => v.status === 'approved' && v.effectiveFrom <= now)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.versionNo - a.versionNo);
  const inForce = approved[0] ?? null;
  return {
    id: r.publicId,
    code: r.code,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    description: r.description,
    agentKind: r.agentKind,
    retiredAt: iso(r.retiredAt),
    current: termsOf(inForce),
    agentCount: r._count.agents,
    versions: r.versions.map((v): AgentPlanVersionDto => ({
      ...termsOf(v)!,
      id: v.publicId,
      versionNo: v.versionNo,
      effectiveFrom: toBangkokIso(v.effectiveFrom),
      status: v.status,
      reason: v.reason,
      createdBy: person(v.createdById),
      decidedBy: person(v.decidedById),
      decidedAt: iso(v.decidedAt),
      decisionNote: v.decisionNote,
      inForce: inForce?.id === v.id,
    })),
  };
}

function storeTermsFromFull(t: NonNullable<ReturnType<typeof termsOf>>) {
  return {
    firstOrderPct: t.firstOrderPct,
    repeatOrderPct: t.repeatOrderPct,
    attributionMonths: t.attributionMonths,
    minBaseAmount: t.minBaseAmount,
    uncapped: true as const,
  };
}

/** D-465 ล.ย.01 as the agent sees it. */
export function taxDeclarationDto(r: TaxDeclarationRow): AgentTaxDeclarationDto {
  const allowances = (r.allowances ?? {}) as Record<string, string>;
  return {
    id: r.publicId,
    taxYear: r.taxYear,
    allowances,
    allowancesTotal: Object.values(allowances)
      .reduce((a, v) => a.add(v), D(0))
      .toFixed(2),
    evidenceCount: r.evidenceFileIds.length,
    status: r.status,
    submittedAt: toBangkokIso(r.submittedAt),
    decidedAt: iso(r.decidedAt),
    decisionReason: r.decisionReason,
  };
}

export function adminTaxDeclarationDto(r: TaxDeclarationRow): AdminAgentTaxDeclarationDto {
  return { ...taxDeclarationDto(r), agent: agentRef(r.agent), decidedBy: userRef(r.decidedBy) };
}

/** D-466 payout profile as the agent sees it (the account number by its last 4 digits only). */
export function payoutProfileDto(r: PayoutProfileRow): AgentPayoutProfileDto {
  return {
    id: r.publicId,
    status: r.status,
    legalName: r.legalName,
    taxId: r.taxId,
    branchCode: r.branchCode,
    isVatRegistered: r.isVatRegistered,
    address: r.address,
    postcode: r.postcode,
    idDocument: r.idDocumentFile
      ? { id: r.idDocumentFile.publicId, originalName: r.idDocumentFile.originalName }
      : null,
    bankCode: r.bankCode,
    bankBranchName: r.bankBranchName,
    bankAccountName: r.bankAccountName,
    bankAccountNoLast4: r.bankAccountNoLast4,
    bankBook: r.bankBookFile
      ? { id: r.bankBookFile.publicId, originalName: r.bankBookFile.originalName }
      : null,
    submittedAt: iso(r.submittedAt),
    verifiedAt: iso(r.verifiedAt),
    rejectReason: r.rejectReason,
    rowVersion: r.rowVersion,
  };
}

export function adminPayoutProfileDto(r: PayoutProfileRow): AdminAgentPayoutProfileDto {
  return { ...payoutProfileDto(r), agent: agentRef(r.agent), verifiedBy: userRef(r.verifiedBy) };
}
