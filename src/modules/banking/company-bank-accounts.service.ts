import { type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type BankAccountPurpose, type CompanyBankAccount, type Prisma } from '@generated/prisma/client';
import { BANK_FILE_ADAPTERS } from '@integrations/bank-files/bank-files';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';

const POLICY = 'company_bank_account_change';
const HASH_PURPOSE = 'company_bank_account';

export const COMPANY_ACCOUNT_INCLUDE = {
  glAccount: { select: { code: true, nameTh: true } },
  approvalRequest: { select: { publicId: true, status: true } },
} as const satisfies Prisma.CompanyBankAccountInclude;
export type CompanyAccountRow = Prisma.CompanyBankAccountGetPayload<{
  include: typeof COMPANY_ACCOUNT_INCLUDE;
}>;

export interface CompanyBankAccountInput {
  bankCode: string;
  branchName?: string | null;
  accountName: string;
  accountNo: string;
  glAccountCode: string;
  purpose: BankAccountPurpose;
  defaultBulkFormat?: string;
}

/**
 * The entity's bank accounts (D-093): each is tied to its own postable cash GL account (112x) and becomes
 * usable only after two different people approve it (`company_bank_account_change`: Finance, then Finance
 * Manager — §8). Numbers are stored encrypted with a keyed hash; only the last 4 digits ever leave the API.
 */
@Injectable()
export class CompanyBankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly approvals: ApprovalsService,
    private readonly encryption: FieldEncryption,
    private readonly hasher: LookupHasher,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(): Promise<CompanyAccountRow[]> {
    return this.prisma.companyBankAccount.findMany({
      include: COMPANY_ACCOUNT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<CompanyAccountRow> {
    const row = await db.companyBankAccount.findUnique({
      where: { publicId },
      include: COMPANY_ACCOUNT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async active(publicId: string, db: Tx = this.prisma): Promise<CompanyAccountRow> {
    const row = await this.get(publicId, db);
    if (row.status !== 'active') throw new DomainException('payouts.bank_account_missing');
    return row;
  }

  /** The account refunds and other payouts leave from by default (purpose payout / both). */
  async defaultPayoutAccount(db: Tx = this.prisma) {
    return db.companyBankAccount.findFirst({
      where: { status: 'active', purpose: { in: ['payout', 'both'] } },
      include: { glAccount: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async propose(actor: UserActor, input: CompanyBankAccountInput): Promise<CompanyAccountRow> {
    if (input.defaultBulkFormat && !BANK_FILE_ADAPTERS[input.defaultBulkFormat])
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'defaultBulkFormat', code: 'enum', message: Object.keys(BANK_FILE_ADAPTERS).join(', ') },
        ],
      });
    const entityId = await this.entities.defaultEntityId();
    const accountNo = input.accountNo.replace(/[^0-9]/g, '');
    const id = await this.prisma.withTx(async (tx) => {
      const gl = await tx.account.findUnique({
        where: { entityId_code: { entityId, code: input.glAccountCode } },
      });
      const taken = gl
        ? await tx.companyBankAccount.count({
            where: { glAccountId: gl.id, status: { in: ['active', 'pending_approval'] } },
          })
        : 0;
      if (
        !gl ||
        gl.status !== 'active' ||
        !gl.isPostable ||
        gl.cashFlowClass !== 'cash' ||
        gl.isControl ||
        taken > 0 ||
        ['1131', '1132', '1133', '1140'].includes(gl.code)
      )
        throw new DomainException('banking.gl_account_invalid', { params: { code: input.glAccountCode } });
      const row = await tx.companyBankAccount.create({
        data: {
          entityId,
          bankCode: input.bankCode,
          branchName: input.branchName ?? null,
          accountName: input.accountName,
          accountNoEnc: this.encryption.encrypt(accountNo),
          accountNoLast4: accountNo.slice(-4),
          accountNoHash: this.hasher.hash(accountNo, HASH_PURPOSE),
          glAccountId: gl.id,
          purpose: input.purpose,
          defaultBulkFormat: input.defaultBulkFormat ?? 'generic_csv',
          createdById: actor.userId,
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'company_bank_account', id: row.id, publicId: row.publicId },
        requester: actor,
        entityId,
        payload: {
          bankCode: input.bankCode,
          accountName: input.accountName,
          accountNoLast4: row.accountNoLast4,
          glAccount: gl.code,
          purpose: input.purpose,
        },
      });
      await tx.companyBankAccount.update({ where: { id: row.id }, data: { approvalRequestId: request.id } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'company_bank_account.proposed',
        actor,
        resourceType: 'company_bank_account',
        resourcePublicId: row.publicId,
        entityId,
        data: { bankCode: input.bankCode, last4: row.accountNoLast4, glAccount: gl.code },
      });
      return row.publicId;
    });
    return this.get(id);
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'banking.company_accounts',
  })
  async onApproval(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const row = await tx.companyBankAccount.findUnique({ where: { id: request.subjectId } });
    if (!row || row.status !== 'pending_approval') return;
    const approved = event.type === 'approval.approved';
    const updated: CompanyBankAccount = await tx.companyBankAccount.update({
      where: { id: row.id },
      data: { status: approved ? 'active' : 'rejected', decidedAt: new Date() },
    });
    await this.events.record(tx, {
      type: approved ? 'company_bank_account.activated' : 'company_bank_account.rejected',
      aggregateType: 'company_bank_account',
      aggregateId: updated.publicId,
      entityId: updated.entityId,
      payload: { companyBankAccountId: updated.publicId, last4: updated.accountNoLast4 },
    });
  }

  /** The decrypted number, only to write a bank file (never logged). */
  accountNo(row: { accountNoEnc: Uint8Array }): string {
    return this.encryption.decrypt(Buffer.from(row.accountNoEnc));
  }
}
