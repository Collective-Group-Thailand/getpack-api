import { type Actor, type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type VendorBankAccount } from '@generated/prisma/client';
import { sodPartyKey,SodService } from '@modules/iam/sod.service';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { FactoriesService } from '../factories/factories.service';
import { FactoryAccess } from '../factories/factory-access';
import {
  type BankAccountDto,
  type ProposeBankAccountDto,
  type RecordVerificationCallDto,
} from './bank-accounts.dto';

const SUBJECT = 'vendor_bank_account';
const POLICY = 'vendor_bank_account_change';
const HASH_PURPOSE = 'vendor_bank_account';

interface VerificationCall {
  outcome: 'confirmed' | 'mismatch' | 'unreachable';
  calledAt: string;
  calledNumberMasked: string;
  byUserId: string;
  note: string | null;
}

/** `0812345678` → `08x-xxx-5678`: enough for the log to show which number was called (§8), nothing more. */
export const maskPhone = (value: string): string => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length <= 4 ? 'xxxx' : `${digits.slice(0, 2)}x-xxx-${digits.slice(-4)}`;
};

/**
 * Vendor bank accounts of partner factories (schema-design §3.8, accounting-design.md §8, D-033/D-169).
 * A change is a new row: proposed by the factory or staff, stored encrypted with a keyed hash for
 * duplicate detection, approved by two different people (Finance → Finance Manager) and verified by a
 * logged call. It becomes active only when the approval is approved **and** the call confirmed the
 * account; the previous active account is then superseded. Numbers never appear in logs, events,
 * audit rows or responses (PDPA).
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
    private readonly approvals: ApprovalsService,
    private readonly encryption: FieldEncryption,
    private readonly hasher: LookupHasher,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly sod: SodService,
  ) {}

  async list(actor: Actor, factoryPublicId: string): Promise<BankAccountDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.vendorBankAccount.findMany({
      where: { vendorId: factory.vendorId },
      include: { approvalRequest: { select: { publicId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const staff = actor.type === 'user' && actor.audience === 'staff';
    const duplicates = staff ? await this.duplicateHashes(rows) : new Set<string>();
    return rows.map((row) => this.toDto(row, staff, duplicates));
  }

  async propose(
    actor: UserActor,
    factoryPublicId: string,
    input: ProposeBankAccountDto,
  ): Promise<BankAccountDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    return this.prisma.withTx(async (tx) => {
      const row = await this.proposeIn(tx, actor, factory.vendorId, input, { factory: factory.code, factoryId: factory.id, factoryPublicId: factory.publicId });
      const step = await tx.factoryOnboardingStep.findUniqueOrThrow({
        where: { factoryId_step: { factoryId: factory.id, step: 'bank_account' } },
      });
      if (step.status === 'pending' || step.status === 'rejected') {
        await this.factories.markStep(tx, factory.id, 'bank_account', 'submitted', actor.userId);
      }
      return this.toDto(row, actor.audience === 'staff', await this.duplicateHashes([row], tx));
    });
  }

  /** A carrier, freelancer or service vendor's bank account (B5.3): same dual approval and verification call. */
  async proposeForVendor(actor: UserActor, vendorPublicId: string, input: ProposeBankAccountDto): Promise<BankAccountDto> {
    return this.prisma.withTx(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { publicId: vendorPublicId } });
      if (!vendor || vendor.kind === 'factory') throw new DomainException('http.not_found');
      const row = await this.proposeIn(tx, actor, vendor.id, input, { factory: null, factoryId: null, factoryPublicId: null });
      return this.toDto(row, true, await this.duplicateHashes([row], tx));
    });
  }

  async listForVendor(vendorPublicId: string): Promise<BankAccountDto[]> {
    const vendor = await this.prisma.vendor.findUnique({ where: { publicId: vendorPublicId } });
    if (!vendor) throw new DomainException('http.not_found');
    const rows = await this.prisma.vendorBankAccount.findMany({
      where: { vendorId: vendor.id },
      include: { approvalRequest: { select: { publicId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const duplicates = await this.duplicateHashes(rows);
    return rows.map((row) => this.toDto(row, true, duplicates));
  }

  private async proposeIn(
    tx: Tx,
    actor: UserActor,
    vendorId: bigint,
    input: ProposeBankAccountDto,
    owner: { factory: string | null; factoryId: bigint | null; factoryPublicId: string | null },
  ) {
    const accountNo = input.accountNo.replace(/[^0-9]/g, '');
    if (await tx.vendorBankAccount.count({ where: { vendorId, status: 'pending_approval' } })) {
      throw new DomainException('partners.bank_account_pending');
    }
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    const account = await tx.vendorBankAccount.create({
      data: {
        vendorId,
        bankCode: input.bankCode,
        branchName: input.branchName ?? null,
        accountName: input.accountName,
        accountNoEnc: this.encryption.encrypt(accountNo),
        accountNoLast4: accountNo.slice(-4),
        accountNoHash: this.hasher.hash(accountNo, HASH_PURPOSE),
        createdById: actor.userId,
      },
    });
    // SoD (§8): whoever recorded a bill of this vendor cannot change its bank account.
    if (actor.audience === 'staff') {
      await this.sod.checkAction(tx, {
        actorUserId: actor.userId,
        action: 'vendor_bank_account.change',
        subject: { type: SUBJECT, publicId: account.publicId },
        party: { kind: 'vendor', publicId: vendor.publicId },
      });
    }
    const request = await this.approvals.create(tx, {
      policyKey: POLICY,
      subject: { type: SUBJECT, id: account.id, publicId: account.publicId },
      requester: actor,
      // What approvers see: never the full number (§8, PDPA).
      payload: {
        factory: owner.factory,
        vendor: vendor.legalName,
        bankCode: input.bankCode,
        accountName: input.accountName,
        accountNoLast4: account.accountNoLast4,
      },
      ...(owner.factoryId && { scope: { factoryId: owner.factoryId } }),
    });
    const row = await tx.vendorBankAccount.update({
      where: { id: account.id },
      data: { approvalRequestId: request.id },
      include: { approvalRequest: { select: { publicId: true } } },
    });
    await this.audit.record(tx, {
      category: 'finance',
      action: 'vendor_bank_account.change',
      actor,
      resourceType: SUBJECT,
      resourcePublicId: account.publicId,
      data: { sodParty: sodPartyKey({ kind: 'vendor', publicId: vendor.publicId }) },
    });
    await this.record(tx, account.publicId, owner.factoryPublicId, 'vendor_bank_account.proposed', {
      last4: account.accountNoLast4,
      approvalRequestId: request.publicId,
      vendorId: vendor.publicId,
    });
    return row;
  }

  /** Finance records the verification call (§8); a confirmed call activates an already approved change. */
  async recordVerificationCall(actor: UserActor, accountPublicId: string, input: RecordVerificationCallDto) {
    return this.prisma.withTx(async (tx) => {
      const account = await tx.vendorBankAccount.findUnique({
        where: { publicId: accountPublicId },
        include: { approvalRequest: true },
      });
      if (!account) throw new DomainException('http.not_found');
      if (account.status !== 'pending_approval')
        throw new DomainException('partners.bank_account_not_pending');
      const call: VerificationCall = {
        outcome: input.outcome,
        calledAt: input.calledAt.toISOString(),
        calledNumberMasked: maskPhone(input.calledNumber),
        byUserId: actor.publicId,
        note: input.note ?? null,
      };
      await tx.vendorBankAccount.update({
        where: { id: account.id },
        data: { verificationCall: { ...call } },
      });
      const factory = await tx.factory.findUnique({ where: { vendorId: account.vendorId } });
      await this.record(tx, account.publicId, factory?.publicId ?? null, 'vendor_bank_account.verification_recorded', {
        outcome: call.outcome,
        calledNumberMasked: call.calledNumberMasked,
      });
      if (account.approvalRequest?.status === 'approved' && call.outcome === 'confirmed') {
        await this.activate(tx, account, factory?.publicId ?? null, factory?.id ?? null);
      }
      const row = await tx.vendorBankAccount.findUniqueOrThrow({
        where: { id: account.id },
        include: { approvalRequest: { select: { publicId: true } } },
      });
      return this.toDto(row, true, await this.duplicateHashes([row], tx));
    });
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'partners.vendor-bank-account-change',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const account = await tx.vendorBankAccount.findUnique({ where: { id: request.subjectId } });
    if (!account || account.status !== 'pending_approval') return; // idempotent
    const factory = await tx.factory.findUnique({ where: { vendorId: account.vendorId } });
    if (event.type !== 'approval.approved') {
      await tx.vendorBankAccount.update({
        where: { id: account.id },
        data: { status: 'rejected', decidedAt: new Date() },
      });
      if (factory) await this.factories.markStep(tx, factory.id, 'bank_account', 'rejected', null);
      await this.record(tx, account.publicId, factory?.publicId ?? null, 'vendor_bank_account.rejected', {
        outcome: event.type,
      });
      return;
    }
    const call = account.verificationCall as VerificationCall | null;
    if (call?.outcome === 'confirmed') {
      await this.activate(tx, account, factory?.publicId ?? null, factory?.id ?? null);
    } else {
      // Approved without a confirmed call: stays pending until Finance records one (§8).
      await this.record(
        tx,
        account.publicId,
        factory?.publicId ?? null,
        'vendor_bank_account.awaiting_verification',
        {},
      );
    }
  }

  private async activate(tx: Tx, account: VendorBankAccount, factoryPublicId: string | null, factoryId: bigint | null) {
    const now = new Date();
    await tx.vendorBankAccount.updateMany({
      where: { vendorId: account.vendorId, status: 'active' },
      data: { status: 'superseded' },
    });
    await tx.vendorBankAccount.update({
      where: { id: account.id },
      data: { status: 'active', effectiveFrom: now, decidedAt: now },
    });
    if (factoryId !== null) await this.factories.markStep(tx, factoryId, 'bank_account', 'approved', null);
    await this.record(tx, account.publicId, factoryPublicId, 'vendor_bank_account.activated', {
      last4: account.accountNoLast4,
    });
  }

  /** Hashes of these rows that another vendor also uses (§8 duplicate bank-account exception). */
  private async duplicateHashes(rows: VendorBankAccount[], tx: Tx = this.prisma): Promise<Set<string>> {
    if (rows.length === 0) return new Set();
    const others = await tx.vendorBankAccount.findMany({
      where: {
        accountNoHash: { in: rows.map((r) => r.accountNoHash) },
        vendorId: { notIn: [...new Set(rows.map((r) => r.vendorId))] },
        status: { in: ['active', 'pending_approval'] },
      },
      select: { accountNoHash: true },
    });
    return new Set(others.map((o) => Buffer.from(o.accountNoHash).toString('hex')));
  }

  private toDto(
    row: VendorBankAccount & { approvalRequest: { publicId: string } | null },
    staff: boolean,
    duplicates: Set<string>,
  ): BankAccountDto {
    const call = row.verificationCall as VerificationCall | null;
    return {
      id: row.publicId,
      bankCode: row.bankCode,
      branchName: row.branchName,
      accountName: row.accountName,
      accountNoLast4: row.accountNoLast4,
      status: row.status,
      effectiveFrom: row.effectiveFrom ? toBangkokIso(row.effectiveFrom) : null,
      approvalRequestId: row.approvalRequest?.publicId ?? null,
      verification:
        staff && call
          ? {
              outcome: call.outcome,
              calledAt: toBangkokIso(new Date(call.calledAt)),
              calledNumberMasked: call.calledNumberMasked,
            }
          : null,
      duplicateOfOtherVendor: staff && duplicates.has(Buffer.from(row.accountNoHash).toString('hex')),
      createdAt: toBangkokIso(row.createdAt),
    };
  }

  private async record(
    tx: Tx,
    accountPublicId: string,
    factoryPublicId: string | null,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      category: 'finance',
      action: type,
      resourceType: SUBJECT,
      resourcePublicId: accountPublicId,
      data: { factoryId: factoryPublicId, ...data },
    });
    await this.events.record(tx, {
      type,
      aggregateType: SUBJECT,
      aggregateId: accountPublicId,
      payload: { accountId: accountPublicId, factoryId: factoryPublicId, ...data },
    });
  }
}
