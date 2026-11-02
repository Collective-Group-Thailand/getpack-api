import { systemActor, type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgent } from '@generated/prisma/client';
import { BankAccountsService } from '@modules/partners/bank-accounts/bank-accounts.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { invalid, recordAgentEvent } from './agent-shared';
import { sameName } from './agents.service';

export const PAYOUT_PROFILE_INCLUDE = {
  agent: { select: { publicId: true, code: true, legalName: true, kind: true, juristicType: true } },
  idDocumentFile: { select: { publicId: true, originalName: true } },
  bankBookFile: { select: { publicId: true, originalName: true } },
  verifiedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.SalesAgentPayoutProfileInclude;
export type PayoutProfileRow = Prisma.SalesAgentPayoutProfileGetPayload<{ include: typeof PAYOUT_PROFILE_INCLUDE }>;

export const payoutProfileEtag = (p: { publicId: string; rowVersion: number }) => etagOf(p.publicId, p.rowVersion);

/** Thai 13-digit tax id / citizen id check digit (Revenue Department algorithm). */
export function isThaiTaxId(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((a, d, i) => a + d * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === digits[12];
}

export interface PayoutProfileInput {
  legalName?: string | null;
  taxId?: string | null;
  branchCode?: string | null;
  isVatRegistered?: boolean | null;
  address?: string | null;
  postcode?: string | null;
  idDocumentFileId?: string | null;
  bankCode?: string | null;
  bankBranchName?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  bankBookFileId?: string | null;
}

/** The fields a profile needs before it can be submitted (D-466). */
const REQUIRED = [
  'legalName',
  'taxId',
  'address',
  'postcode',
  'idDocumentFileId',
  'bankCode',
  'bankAccountName',
  'bankAccountNoEnc',
] as const;

/**
 * D-466 step 2 — the payout profile of a freelance agent: who they are paid as and where. Drafted and submitted by the
 * agent at any time after approval; Finance verifies it (creating or updating the agent's vendor and proposing the bank
 * account through the existing dual approval, B5.3) or rejects it with a reason. A changed profile goes back to draft
 * and must be verified again. Statements of an agent without a verified profile wait as drafts
 * (`payout_profile_missing`); nothing is lost.
 */
@Injectable()
export class AgentPayoutProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly bankAccounts: BankAccountsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  /** The agent's profile, or null before the first save. */
  forAgent(agentId: bigint, db: Tx = this.prisma): Promise<PayoutProfileRow | null> {
    return db.salesAgentPayoutProfile.findUnique({ where: { agentId }, include: PAYOUT_PROFILE_INCLUDE });
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<PayoutProfileRow> {
    const row = await db.salesAgentPayoutProfile.findUnique({ where: { publicId }, include: PAYOUT_PROFILE_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** Whether commission can be paid to a freelance agent: a vendor, and no profile change waiting (D-466). */
  async payoutReady(agent: Pick<SalesAgent, 'id' | 'kind' | 'vendorId'>, db: Tx = this.prisma): Promise<boolean> {
    if (agent.kind !== 'freelance') return true;
    if (agent.vendorId === null) return false;
    const profile = await db.salesAgentPayoutProfile.findUnique({ where: { agentId: agent.id } });
    return !profile || profile.status === 'verified';
  }

  async upsert(
    actor: UserActor,
    agent: SalesAgent,
    input: PayoutProfileInput,
    ifMatch: string | undefined,
  ): Promise<PayoutProfileRow> {
    if (agent.kind !== 'freelance') throw new DomainException('agents.payout_profile_not_applicable');
    const taxId = input.taxId?.replace(/\D/g, '') || null;
    if (taxId && !isThaiTaxId(taxId)) invalid('taxId', 'a valid 13-digit Thai tax id', 'checksum');
    if (input.postcode && !/^\d{5}$/.test(input.postcode)) invalid('postcode', '5 digits', 'pattern');
    if (input.branchCode && !/^\d{5}$/.test(input.branchCode)) invalid('branchCode', '5 digits', 'pattern');
    if (input.bankCode && !/^\d{3}$/.test(input.bankCode)) invalid('bankCode', '3 digits', 'pattern');
    const accountNo = input.bankAccountNo?.replace(/\D/g, '') || null;
    if (accountNo && (accountNo.length < 6 || accountNo.length > 15))
      invalid('bankAccountNo', '6 to 15 digits', 'pattern');
    const id = await this.prisma.withTx(async (tx) => {
      const current = await tx.salesAgentPayoutProfile.findUnique({ where: { agentId: agent.id } });
      if (current) assertIfMatch(ifMatch, payoutProfileEtag(current), { required: true });
      if (current?.status === 'submitted') throw new DomainException('agents.payout_profile_waiting');
      const file = async (publicId: string | null | undefined, path: string) => {
        if (publicId === undefined) return undefined;
        if (publicId === null) return null;
        const f = await tx.fileObject.findUnique({ where: { publicId } });
        if (!f || f.ownerUserId !== actor.userId || f.uploadStatus !== 'uploaded' || f.scanStatus === 'infected')
          invalid(path, 'an uploaded file of yours', 'fileReady');
        return f.id;
      };
      const data = {
        ...(input.legalName !== undefined && { legalName: input.legalName?.trim() || null }),
        ...(input.taxId !== undefined && { taxId }),
        ...(input.branchCode !== undefined && { branchCode: input.branchCode || '00000' }),
        ...(input.isVatRegistered !== undefined &&
          input.isVatRegistered !== null && {
            // An individual is never VAT registered as an agent here (ภ.พ.20 holders apply as a juristic person).
            isVatRegistered: agent.juristicType === 'individual' ? false : input.isVatRegistered,
          }),
        ...(input.address !== undefined && { address: input.address?.trim() || null }),
        ...(input.postcode !== undefined && { postcode: input.postcode || null }),
        ...(input.bankCode !== undefined && { bankCode: input.bankCode || null }),
        ...(input.bankBranchName !== undefined && { bankBranchName: input.bankBranchName?.trim() || null }),
        ...(input.bankAccountName !== undefined && { bankAccountName: input.bankAccountName?.trim() || null }),
        ...(accountNo && {
          bankAccountNoEnc: this.encryption.encrypt(accountNo),
          bankAccountNoLast4: accountNo.slice(-4),
        }),
        idDocumentFileId: await file(input.idDocumentFileId, 'idDocumentFileId'),
        bankBookFileId: await file(input.bankBookFileId, 'bankBookFileId'),
      };
      const merged = { ...current, ...data };
      if (merged.bankAccountName && merged.legalName && !sameName(merged.bankAccountName, merged.legalName))
        throw new DomainException('agents.bank_name_mismatch');
      const row = current
        ? await tx.salesAgentPayoutProfile.update({
            where: { id: current.id },
            // A change after verification (or a rejection) is a new draft to verify again.
            data: { ...data, status: 'draft', rejectReason: null, rowVersion: { increment: 1 } },
          })
        : await tx.salesAgentPayoutProfile.create({ data: { agentId: agent.id, ...data } });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_payout_profile.saved',
        aggregateType: 'sales_agent_payout_profile',
        aggregateId: row.publicId,
        payload: { payoutProfileId: row.publicId, agentId: agent.publicId, wasVerified: current?.status === 'verified' },
        actor,
      });
      return row.publicId;
    });
    return this.get(id);
  }

  async submit(actor: UserActor, agent: SalesAgent, ifMatch: string | undefined): Promise<PayoutProfileRow> {
    const id = await this.prisma.withTx(async (tx) => {
      const row = await tx.salesAgentPayoutProfile.findUnique({ where: { agentId: agent.id } });
      if (!row) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, payoutProfileEtag(row), { required: true });
      if (row.status === 'submitted') throw new DomainException('agents.payout_profile_waiting');
      if (row.status === 'verified') throw new DomainException('agents.payout_profile_verified');
      const missing = REQUIRED.filter((key) => row[key] === null || row[key] === '');
      if (missing.length)
        throw new DomainException('validation.failed', {
          errors: missing.map((key) => ({
            path: key === 'bankAccountNoEnc' ? 'bankAccountNo' : key,
            code: 'required',
            message: 'required before submitting',
          })),
        });
      await tx.salesAgentPayoutProfile.update({
        where: { id: row.id },
        data: { status: 'submitted', submittedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_payout_profile.submitted',
        aggregateType: 'sales_agent_payout_profile',
        aggregateId: row.publicId,
        payload: { payoutProfileId: row.publicId, agentId: agent.publicId, agentCode: agent.code },
        actor,
      });
      return row.publicId;
    });
    return this.get(id);
  }

  /**
   * Finance verifies (D-466): the agent's vendor is created or updated from the profile, the bank account is proposed
   * through the dual approval (B5.3, §8) and the agent's legal name and tax id follow the profile. Statements held
   * for a missing profile lose the flag.
   */
  async verify(actor: UserActor, publicId: string, ifMatch: string | undefined): Promise<PayoutProfileRow> {
    await this.prisma.withTx(async (tx) => {
      const row = await tx.salesAgentPayoutProfile.findUnique({ where: { publicId }, include: { agent: true } });
      if (!row) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, payoutProfileEtag(row), { required: true });
      if (row.status !== 'submitted')
        throw new DomainException('agents.payout_profile_not_submitted', { params: { status: row.status } });
      const now = new Date();
      const rules = await this.settings.at('agents.rules', { at: now, tx });
      const agent = row.agent;
      const vendorData = {
        legalName: row.legalName!,
        juristicType: agent.juristicType,
        taxId: row.taxId!,
        branchCode: row.branchCode,
        isVatRegistered: row.isVatRegistered,
        addressLine1: row.address,
        postcode: row.postcode,
      };
      const vendor = agent.vendorId
        ? await tx.vendor.update({ where: { id: agent.vendorId }, data: vendorData })
        : await tx.vendor.create({
            data: {
              kind: 'sales_agent',
              ...vendorData,
              defaultWhtCategory: agent.juristicType === 'individual' ? 'commission' : 'service',
              paymentTermsDays: rules.value.paymentTermsDays,
              createdById: actor.userId,
            },
          });
      await this.audit.record(tx, {
        category: 'finance',
        action: agent.vendorId ? 'vendor.updated' : 'vendor.created',
        actor,
        resourceType: 'vendor',
        resourcePublicId: vendor.publicId,
        data: { kind: 'sales_agent', legalName: vendorData.legalName, payoutProfileId: row.publicId },
      });
      const accountNo = this.encryption.decrypt(row.bankAccountNoEnc!);
      const active = await tx.vendorBankAccount.findFirst({
        where: { vendorId: vendor.id, status: { in: ['active', 'pending_approval'] } },
        orderBy: { id: 'desc' },
      });
      if (!active || active.accountNoLast4 !== row.bankAccountNoLast4 || active.bankCode !== row.bankCode)
        await this.bankAccounts.proposeForVendorIn(tx, actor, vendor.id, {
          bankCode: row.bankCode!,
          branchName: row.bankBranchName,
          accountName: row.bankAccountName!,
          accountNo,
        });
      await tx.salesAgent.update({
        where: { id: agent.id },
        data: {
          vendorId: vendor.id,
          legalName: row.legalName!,
          taxId: row.taxId,
          rowVersion: { increment: 1 },
        },
      });
      await tx.salesAgentPayoutProfile.update({
        where: { id: row.id },
        data: { status: 'verified', verifiedAt: now, verifiedById: actor.userId, rowVersion: { increment: 1 } },
      });
      const held = await tx.salesAgentStatement.findMany({
        where: { agentId: agent.id, status: 'draft', flags: { has: 'payout_profile_missing' } },
      });
      for (const s of held)
        await tx.salesAgentStatement.update({
          where: { id: s.id },
          data: { flags: s.flags.filter((f) => f !== 'payout_profile_missing'), rowVersion: { increment: 1 } },
        });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sales_agent_payout_profile.verified',
        actor,
        resourceType: 'sales_agent_payout_profile',
        resourcePublicId: row.publicId,
        data: { agentId: agent.publicId, vendorId: vendor.publicId, released: held.length },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: agent.userId }, select: { publicId: true } });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_payout_profile.verified',
        aggregateType: 'sales_agent_payout_profile',
        aggregateId: row.publicId,
        payload: { payoutProfileId: row.publicId, agentId: agent.publicId, customerId: user.publicId },
        actor,
      });
    });
    return this.get(publicId);
  }

  async reject(actor: UserActor, publicId: string, reason: string): Promise<PayoutProfileRow> {
    await this.prisma.withTx(async (tx) => {
      const row = await tx.salesAgentPayoutProfile.findUnique({ where: { publicId }, include: { agent: true } });
      if (!row) throw new DomainException('http.not_found');
      if (row.status !== 'submitted')
        throw new DomainException('agents.payout_profile_not_submitted', { params: { status: row.status } });
      await tx.salesAgentPayoutProfile.update({
        where: { id: row.id },
        data: { status: 'rejected', rejectReason: reason.trim(), rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sales_agent_payout_profile.rejected',
        actor,
        resourceType: 'sales_agent_payout_profile',
        resourcePublicId: row.publicId,
        data: { reason },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.agent.userId }, select: { publicId: true } });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_payout_profile.rejected',
        aggregateType: 'sales_agent_payout_profile',
        aggregateId: row.publicId,
        payload: { payoutProfileId: row.publicId, reason: reason.trim(), customerId: user.publicId },
        actor,
      });
    });
    return this.get(publicId);
  }

  list(where: Prisma.SalesAgentPayoutProfileWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentPayoutProfile.findMany({
        where,
        include: PAYOUT_PROFILE_INCLUDE,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentPayoutProfile.count({ where }),
    ]);
  }

  /** Flags a freelance statement whose agent cannot be paid yet and tells the agent (D-466). */
  async holdStatement(tx: Tx, statement: { id: bigint; publicId: string; flags: string[] }, agentUserId: bigint) {
    if (statement.flags.includes('payout_profile_missing')) return;
    await tx.salesAgentStatement.update({
      where: { id: statement.id },
      data: { flags: [...statement.flags, 'payout_profile_missing'], rowVersion: { increment: 1 } },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: agentUserId }, select: { publicId: true } });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_statement.payout_profile_needed',
      aggregateType: 'sales_agent_statement',
      aggregateId: statement.publicId,
      payload: { statementId: statement.publicId, customerId: user.publicId },
      actor: systemActor('agents.payout_profile'),
    });
  }
}
