import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { addCalendarDays, bangkokDate, startOfBangkokDay as startOfDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Company, type KycDocType, Prisma } from '@generated/prisma/client';
import { isValidThaiTaxId } from '@modules/customers/thai-tax-id';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

import { type CompanySpendDto } from './companies.dto';

export const COMPANY_ROLES = [
  'company_admin',
  'company_buyer',
  'company_approver',
  'company_accountant',
] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_INCLUDE = {
  branches: {
    where: { deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { branchCode: 'asc' }],
    include: {
      province: { select: { publicId: true, nameTh: true, nameEn: true } },
      subdistrict: {
        select: { nameTh: true, nameEn: true, district: { select: { nameTh: true, nameEn: true } } },
      },
    },
  },
  discount: {
    include: {
      versions: {
        where: { status: 'approved' },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        include: { discountMemo: { select: { publicId: true } } },
      },
    },
  },
  members: {
    where: { status: { not: 'removed' } },
    include: { user: { select: { publicId: true, displayName: true, phone: true, email: true } } },
    orderBy: { id: 'asc' },
  },
  kycDocuments: {
    include: { fileObject: true, verifiedBy: { select: { publicId: true, displayName: true } } },
    orderBy: { id: 'asc' },
  },
} as const satisfies Prisma.CompanyInclude;
export type CompanyRow = Prisma.CompanyGetPayload<{ include: typeof COMPANY_INCLUDE }>;

const APPROVAL_INCLUDE = {
  requester: { select: { publicId: true, displayName: true } },
  actions: {
    where: { action: { in: ['approve', 'reject'] } },
    include: { actor: { select: { publicId: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.ApprovalRequestInclude;
type ApprovalRow = Prisma.ApprovalRequestGetPayload<{ include: typeof APPROVAL_INCLUDE }>;
export type CompanyApprovalRow = Awaited<ReturnType<CompaniesService['approvalsOf']>>[number];

export const companyEtag = (c: { publicId: string; rowVersion: number }) => etagOf(c.publicId, c.rowVersion);

export interface BranchInput {
  branchType: 'head_office' | 'branch';
  branchCode: string;
  name: string;
  line1: string;
  line2?: string | null;
  subdistrictId?: string | null;
  postcode: string;
  provinceId: string;
  isDefault?: boolean;
}

export interface ApplyInput {
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  isVatRegistered: boolean;
  withholdsTax?: boolean;
  documentEmail?: string | null;
  headOffice: Omit<BranchInput, 'branchType' | 'branchCode'>;
  signatory?: { name: string; position: string };
  contactPhone?: string;
}

/** My roles in a company and what they allow (the store's `myRoles` / `can`). */
export interface CompanyMembership {
  roles: string[];
  permissions: Set<string>;
}

export interface SettingsInput {
  tradeName?: string | null;
  documentEmail?: string | null;
  withholdsTax?: boolean;
  poNumberPolicy?: 'required' | 'optional' | 'none';
  orderApprovalThreshold?: string | null;
  signatory?: { name: string; position: string };
  contactPhone?: string | null;
}

/** KYC documents a company must provide before review (D-120). */
export function requiredKyc(isVatRegistered: boolean): KycDocType[] {
  return [
    'company_certificate',
    'signatory_id',
    ...(isVatRegistered ? (['vat_registration_pp20'] as KycDocType[]) : []),
  ];
}

function invalid(path: string, message: string, code = 'invalid'): never {
  throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
}

/**
 * B2B companies (D-120…D-125). A customer applies for a company and becomes its Company Admin; members
 * are invited by phone or e-mail and accept, receiving company roles as `user_roles` in the company's
 * scope. KYC documents are reviewed by staff (certificate ≤ `b2b.kyc_certificate_max_age_months`) and
 * approval activates the company with its code. Settings — PO policy, approval threshold (audited,
 * D-123), withholding — belong to the Company Admin.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly settings: SettingsService,
    private readonly numbering: DocumentNumberingService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- access ------------------------------------------------------------------------------------------

  /** The company when the customer is an active member whose company roles grant `permission`. */
  async forMember(
    actor: UserActor,
    publicId: string,
    permission?: string,
    db: Tx = this.prisma,
  ): Promise<CompanyRow> {
    const company = await db.company.findUnique({ where: { publicId }, include: COMPANY_INCLUDE });
    if (!company || company.status === 'closed') throw new DomainException('http.not_found');
    const member = company.members.find((m) => m.userId === actor.userId && m.status === 'active');
    if (!member) throw new DomainException('http.not_found');
    if (permission && !(await this.hasCompanyPermission(actor.userId, company.id, permission)))
      throw new DomainException('auth.forbidden');
    return company;
  }

  /** The active company a customer may order for (`company_orders.place` in its scope). */
  async orderingCompany(db: Tx, customerUserId: bigint, publicId: string): Promise<CompanyRow> {
    const company = await db.company.findUnique({ where: { publicId }, include: COMPANY_INCLUDE });
    if (!company || !company.members.some((m) => m.userId === customerUserId && m.status === 'active'))
      throw new DomainException('http.not_found');
    if (company.status !== 'active')
      throw new DomainException('companies.invalid_status', { params: { status: company.status } });
    if (!(await this.hasCompanyPermission(customerUserId, company.id, 'company_orders.place')))
      throw new DomainException('auth.forbidden');
    return company;
  }

  /** My company roles (active membership) and the permissions they grant in the company's scope. */
  async membership(userId: bigint, company: CompanyRow): Promise<CompanyMembership> {
    const member = company.members.find((m) => m.userId === userId && m.status === 'active');
    if (!member) return { roles: [], permissions: new Set() };
    const access = await this.permissions.forUser(userId);
    const keys = access.roles
      .filter((r) => r.scopeType === 'company' && r.scopeId === company.id)
      .map((r) => r.key);
    const rows = keys.length
      ? await this.prisma.rolePermission.findMany({
          where: { role: { key: { in: keys } } },
          select: { permission: { select: { key: true } } },
        })
      : [];
    return { roles: member.roleKeys, permissions: new Set(rows.map((r) => r.permission.key)) };
  }

  async hasCompanyPermission(userId: bigint, companyId: bigint, permission: string): Promise<boolean> {
    const access = await this.permissions.forUser(userId);
    const keys = access.roles
      .filter((r) => r.scopeType === 'company' && r.scopeId === companyId)
      .map((r) => r.key);
    if (keys.length === 0) return false;
    const n = await this.prisma.rolePermission.count({
      where: { role: { key: { in: keys } }, permission: { key: permission } },
    });
    return n > 0;
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<CompanyRow> {
    const row = await db.company.findUnique({ where: { publicId }, include: COMPANY_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  mine(userId: bigint) {
    return this.prisma.company.findMany({
      where: { status: { not: 'closed' }, members: { some: { userId, status: 'active' } } },
      include: COMPANY_INCLUDE,
      orderBy: { legalName: 'asc' },
    });
  }

  list(where: Prisma.CompanyWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.company.findMany({
        where,
        include: COMPANY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.company.count({ where }),
    ]);
  }

  // --- apply --------------------------------------------------------------------------------------------

  async apply(actor: UserActor, input: ApplyInput): Promise<CompanyRow> {
    if (!isValidThaiTaxId(input.taxId)) invalid('taxId', 'not a valid Thai tax id', 'taxId');
    const created = await this.prisma.withTx(async (tx) => {
      if (await tx.company.findFirst({ where: { taxId: input.taxId, status: { not: 'closed' } } }))
        throw new DomainException('companies.tax_id_taken');
      const company = await tx.company.create({
        data: {
          entityId: await this.entities.defaultEntityId(),
          legalName: input.legalName.trim(),
          tradeName: input.tradeName?.trim() || null,
          taxId: input.taxId,
          isVatRegistered: input.isVatRegistered,
          withholdsTax: input.withholdsTax ?? false,
          documentEmail: input.documentEmail?.toLowerCase() ?? null,
          signatoryName: input.signatory?.name.trim() ?? null,
          signatoryPosition: input.signatory?.position.trim() ?? null,
          contactPhone: input.contactPhone ?? null,
          appliedById: actor.userId,
        },
      });
      await this.createBranch(
        tx,
        company.id,
        { ...input.headOffice, branchType: 'head_office', branchCode: '00000', isDefault: true },
        actor.userId,
      );
      await tx.companyMember.create({
        data: {
          companyId: company.id,
          userId: actor.userId,
          status: 'active',
          roleKeys: ['company_admin'],
          joinedAt: new Date(),
        },
      });
      await this.grantRoles(
        tx,
        actor.userId,
        company.id,
        ['company_admin'],
        actor.userId,
        'Applied for the company',
      );
      await this.record(tx, company, 'company.applied', { legalName: company.legalName }, actor);
      return company;
    });
    await this.permissions.invalidate(actor.userId);
    return this.get(created.publicId);
  }

  // --- settings (Company Admin) ----------------------------------------------------------------------

  async updateSettings(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: SettingsInput,
  ): Promise<CompanyRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_profile.manage', tx);
      assertIfMatch(ifMatch, companyEtag(company));
      const row = await tx.company.update({
        where: { id: company.id },
        data: {
          ...(input.tradeName !== undefined && { tradeName: input.tradeName?.trim() || null }),
          ...(input.documentEmail !== undefined && {
            documentEmail: input.documentEmail?.toLowerCase() ?? null,
          }),
          ...(input.withholdsTax !== undefined && { withholdsTax: input.withholdsTax }),
          ...(input.poNumberPolicy !== undefined && { poNumberPolicy: input.poNumberPolicy }),
          ...(input.orderApprovalThreshold !== undefined && {
            orderApprovalThreshold: input.orderApprovalThreshold,
          }),
          ...(input.signatory !== undefined && {
            signatoryName: input.signatory.name.trim(),
            signatoryPosition: input.signatory.position.trim(),
          }),
          ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (
        input.orderApprovalThreshold !== undefined &&
        String(company.orderApprovalThreshold?.toFixed(2) ?? null) !== String(input.orderApprovalThreshold)
      ) {
        // D-123: the company's own approval threshold is audited.
        await this.audit.record(tx, {
          category: 'config',
          action: 'company.approval_threshold_changed',
          actor,
          resourceType: 'company',
          resourcePublicId: company.publicId,
          data: {
            from: company.orderApprovalThreshold?.toFixed(2) ?? null,
            to: input.orderApprovalThreshold,
          },
        });
      }
      await this.record(tx, row, 'company.settings_updated', { fields: Object.keys(input) }, actor);
      return this.get(publicId, tx);
    });
  }

  // --- branches -------------------------------------------------------------------------------------------

  async addBranch(actor: UserActor, publicId: string, input: BranchInput): Promise<CompanyRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_profile.manage', tx);
      if (input.branchType === 'head_office') invalid('branchType', 'the head office exists already');
      if (company.branches.some((b) => b.branchCode === input.branchCode))
        throw new DomainException('companies.branch_exists');
      await this.createBranch(tx, company.id, input, actor.userId);
      await this.touch(tx, company.id);
      await this.record(tx, company, 'company.branch_added', { branchCode: input.branchCode }, actor);
      return this.get(publicId, tx);
    });
  }

  async removeBranch(actor: UserActor, publicId: string, branchPublicId: string): Promise<CompanyRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_profile.manage', tx);
      const branch = company.branches.find((b) => b.publicId === branchPublicId);
      if (!branch) throw new DomainException('http.not_found');
      if (branch.branchType === 'head_office') throw new DomainException('companies.head_office_required');
      await tx.companyBranch.update({
        where: { id: branch.id },
        data: { deletedAt: new Date(), isDefault: false, rowVersion: { increment: 1 } },
      });
      if (branch.isDefault) {
        const head = company.branches.find((b) => b.branchType === 'head_office')!;
        await tx.companyBranch.update({ where: { id: head.id }, data: { isDefault: true } });
      }
      await this.touch(tx, company.id);
      await this.record(tx, company, 'company.branch_removed', { branchCode: branch.branchCode }, actor);
      return this.get(publicId, tx);
    });
  }

  private async createBranch(tx: Tx, companyId: bigint, input: BranchInput, createdById: bigint) {
    const province = await tx.geoProvince.findUnique({ where: { publicId: input.provinceId } });
    if (!province) invalid('provinceId', 'unknown province', 'exists');
    const subdistrict = input.subdistrictId
      ? await tx.geoSubdistrict.findUnique({ where: { publicId: input.subdistrictId } })
      : null;
    if (input.subdistrictId && !subdistrict) invalid('subdistrictId', 'unknown subdistrict', 'exists');
    if (input.isDefault)
      await tx.companyBranch.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    return tx.companyBranch.create({
      data: {
        companyId,
        branchType: input.branchType,
        branchCode: input.branchCode,
        name: input.name.trim(),
        line1: input.line1.trim(),
        line2: input.line2?.trim() || null,
        subdistrictId: subdistrict?.id ?? null,
        postcode: input.postcode,
        provinceId: province.id,
        isDefault: input.isDefault ?? false,
        createdById,
      },
    });
  }

  // --- KYC (D-120) -----------------------------------------------------------------------------------

  async addKycDocument(
    actor: UserActor,
    publicId: string,
    input: { docType: KycDocType; fileId: string; issuedOn?: string | null },
  ) {
    return this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_profile.manage', tx);
      if (!['applied', 'kyc_review', 'active'].includes(company.status))
        throw new DomainException('companies.invalid_status', { params: { status: company.status } });
      const file = await tx.fileObject.findUnique({ where: { publicId: input.fileId } });
      if (
        !file ||
        file.ownerUserId !== actor.userId ||
        file.uploadStatus !== 'uploaded' ||
        file.scanStatus === 'infected'
      )
        invalid('fileId', 'not an uploaded file of yours', 'fileReady');
      await tx.companyKycDocument.create({
        data: {
          companyId: company.id,
          docType: input.docType,
          fileObjectId: file.id,
          issuedOn: input.issuedOn ? new Date(`${input.issuedOn}T00:00:00Z`) : null,
          createdById: actor.userId,
        },
      });
      // The file belongs to the company from now on (company-scoped downloads).
      await tx.fileObject.update({ where: { id: file.id }, data: { ownerCompanyId: company.id } });
      await this.touch(tx, company.id);
      await this.record(tx, company, 'company.kyc_document_added', { docType: input.docType }, actor);
      return this.get(publicId, tx);
    });
  }

  /** The Company Admin sends the application for review once the required documents are in (D-120). */
  async submitKyc(actor: UserActor, publicId: string): Promise<CompanyRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_profile.manage', tx);
      if (company.status !== 'applied')
        throw new DomainException('companies.invalid_status', { params: { status: company.status } });
      const have = new Set(company.kycDocuments.filter((d) => d.status !== 'rejected').map((d) => d.docType));
      const missing: string[] = requiredKyc(company.isVatRegistered).filter((t) => !have.has(t));
      // D-120: the authorised signatory's name and position come with the application.
      if (!company.signatoryName) missing.push('signatory details');
      if (missing.length)
        throw new DomainException('companies.kyc_incomplete', { params: { missing: missing.join(', ') } });
      const row = await tx.company.update({
        where: { id: company.id },
        data: { status: 'kyc_review', rowVersion: { increment: 1 } },
      });
      await this.record(tx, row, 'company.kyc_submitted', {}, actor);
      return this.get(publicId, tx);
    });
  }

  /** Staff verify or reject one document; a certificate older than the setting cannot be verified. */
  async reviewKycDocument(
    actor: UserActor,
    publicId: string,
    documentId: string,
    outcome: 'verified' | 'rejected',
    note: string | null,
    ifMatch?: string,
  ) {
    return this.prisma.withTx(async (tx) => {
      const company = await this.get(publicId, tx);
      assertIfMatch(ifMatch, companyEtag(company), { required: false });
      const doc = company.kycDocuments.find((d) => d.publicId === documentId);
      if (!doc) throw new DomainException('http.not_found');
      if (outcome === 'verified' && doc.docType === 'company_certificate') {
        const months = (await this.settings.at('b2b.kyc_certificate_max_age_months', { tx })).value;
        const oldest = addCalendarDays(bangkokDate(new Date()), -Math.round(Number(months) * 30.4375));
        if (!doc.issuedOn || doc.issuedOn.toISOString().slice(0, 10) < oldest)
          throw new DomainException('companies.certificate_too_old', { params: { months: Number(months) } });
      }
      await tx.companyKycDocument.update({
        where: { id: doc.id },
        data: {
          status: outcome,
          verifiedById: actor.userId,
          verifiedAt: new Date(),
          note,
          rowVersion: { increment: 1 },
        },
      });
      await this.touch(tx, company.id);
      await this.record(
        tx,
        company,
        'company.kyc_document_reviewed',
        { docType: doc.docType, outcome },
        actor,
      );
      return this.get(publicId, tx);
    });
  }

  /** Staff decide the application: approve (every required document verified) activates the company. */
  async decideKyc(
    actor: UserActor,
    publicId: string,
    approve: boolean,
    reason: string | null,
    ifMatch?: string,
  ): Promise<CompanyRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.get(publicId, tx);
      assertIfMatch(ifMatch, companyEtag(company), { required: false });
      if (company.status !== 'kyc_review')
        throw new DomainException('companies.invalid_status', { params: { status: company.status } });
      if (!approve) {
        const row = await tx.company.update({
          where: { id: company.id },
          data: {
            status: 'applied',
            statusReason: reason,
            kycReviewedById: actor.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.record(tx, row, 'company.kyc_rejected', { reason }, actor);
        return this.get(publicId, tx);
      }
      const verified = new Set(
        company.kycDocuments.filter((d) => d.status === 'verified').map((d) => d.docType),
      );
      const missing = requiredKyc(company.isVatRegistered).filter((t) => !verified.has(t));
      if (missing.length)
        throw new DomainException('companies.kyc_incomplete', { params: { missing: missing.join(', ') } });
      const code = company.companyCode ?? (await this.numbering.next(tx, 'company'));
      const row = await tx.company.update({
        where: { id: company.id },
        data: {
          status: 'active',
          companyCode: code,
          kycApprovedAt: new Date(),
          kycReviewedById: actor.userId,
          statusReason: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, row, 'company.activated', { companyCode: code }, actor);
      return this.get(publicId, tx);
    });
  }

  /** Staff suspend, reactivate or close a company (with a reason). */
  async setStatus(
    actor: UserActor,
    publicId: string,
    action: 'suspend' | 'reactivate' | 'close',
    reason: string,
    ifMatch?: string,
  ): Promise<CompanyRow> {
    const allowed: Record<typeof action, [string[], 'suspended' | 'active' | 'closed']> = {
      suspend: [['active'], 'suspended'],
      reactivate: [['suspended'], 'active'],
      close: [['applied', 'kyc_review', 'active', 'suspended'], 'closed'],
    };
    const [from, to] = allowed[action];
    return this.prisma.withTx(async (tx) => {
      const company = await this.get(publicId, tx);
      assertIfMatch(ifMatch, companyEtag(company), { required: false });
      if (!from.includes(company.status))
        throw new DomainException('companies.invalid_status', { params: { status: company.status } });
      const row = await tx.company.update({
        where: { id: company.id },
        data: {
          status: to,
          statusReason: reason,
          ...(to === 'closed' && { creditStatus: 'prepaid' }),
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, row, `company.${to}`, { from: company.status, reason }, actor);
      return this.get(publicId, tx);
    });
  }

  // --- members ------------------------------------------------------------------------------------------

  /** Invites an existing customer account (by phone or e-mail) with company roles. */
  async invite(
    actor: UserActor,
    publicId: string,
    input: { phone?: string; email?: string; roles: CompanyRole[] },
  ): Promise<CompanyRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_members.manage', tx);
      if (!input.phone && !input.email) invalid('phone', 'phone or email is required', 'required');
      const user = await tx.user.findFirst({
        where: {
          kind: 'customer',
          status: 'active',
          ...(input.phone
            ? { phone: input.phone }
            : { email: { equals: input.email!, mode: 'insensitive' } }),
        },
      });
      if (!user) throw new DomainException('companies.account_not_found');
      const existing = await tx.companyMember.findUnique({
        where: { companyId_userId: { companyId: company.id, userId: user.id } },
      });
      if (existing && existing.status !== 'removed') throw new DomainException('companies.already_member');
      const data = {
        status: 'invited' as const,
        roleKeys: [...new Set(input.roles)],
        invitedById: actor.userId,
        invitedAt: new Date(),
        joinedAt: null,
        removedAt: null,
      };
      if (existing)
        await tx.companyMember.update({
          where: { id: existing.id },
          data: { ...data, rowVersion: { increment: 1 } },
        });
      else await tx.companyMember.create({ data: { companyId: company.id, userId: user.id, ...data } });
      await this.touch(tx, company.id);
      await this.record(
        tx,
        company,
        'company.member_invited',
        { userId: user.publicId, roles: data.roleKeys, customerId: user.publicId },
        actor,
      );
      return this.get(publicId, tx);
    });
  }

  invitations(userId: bigint) {
    return this.prisma.companyMember.findMany({
      where: { userId, status: 'invited', company: { status: { not: 'closed' } } },
      include: { company: true, invitedBy: { select: { publicId: true, displayName: true } } },
      orderBy: { invitedAt: 'desc' },
    });
  }

  async accept(actor: UserActor, memberPublicId: string): Promise<CompanyRow> {
    const company = await this.prisma.withTx(async (tx) => {
      const member = await tx.companyMember.findUnique({
        where: { publicId: memberPublicId },
        include: { company: true },
      });
      if (!member || member.userId !== actor.userId || member.status !== 'invited')
        throw new DomainException('http.not_found');
      await tx.companyMember.update({
        where: { id: member.id },
        data: { status: 'active', joinedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await this.grantRoles(
        tx,
        actor.userId,
        member.companyId,
        member.roleKeys as CompanyRole[],
        member.invitedById,
        'Accepted the company invitation',
      );
      await this.record(
        tx,
        member.company,
        'company.member_joined',
        { userId: actor.publicId, roles: member.roleKeys },
        actor,
      );
      return member.company;
    });
    await this.permissions.invalidate(actor.userId);
    return this.get(company.publicId);
  }

  async removeMember(actor: UserActor, publicId: string, memberPublicId: string): Promise<CompanyRow> {
    let removedUser: bigint | null = null;
    const row = await this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_members.manage', tx);
      const member = company.members.find((m) => m.publicId === memberPublicId);
      if (!member) throw new DomainException('http.not_found');
      if (member.userId === actor.userId) throw new DomainException('companies.cannot_remove_self');
      await tx.companyMember.update({
        where: { id: member.id },
        data: { status: 'removed', removedAt: new Date(), rowVersion: { increment: 1 } },
      });
      await tx.userRole.updateMany({
        where: { userId: member.userId, scopeType: 'company', scopeId: company.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actor.userId },
      });
      removedUser = member.userId;
      await this.touch(tx, company.id);
      await this.record(tx, company, 'company.member_removed', { userId: member.user.publicId }, actor);
      return this.get(publicId, tx);
    });
    if (removedUser) await this.permissions.invalidate(removedUser);
    return row;
  }

  /**
   * Company Admin changes a member's company roles (D-123, D-140): granted and revoked in the company's scope for
   * an active member (an invited one gets them on accepting); the last active Company Admin cannot lose the role.
   */
  async changeRoles(
    actor: UserActor,
    publicId: string,
    memberPublicId: string,
    roles: CompanyRole[],
  ): Promise<CompanyRow> {
    let changedUser: bigint | null = null;
    const row = await this.prisma.withTx(async (tx) => {
      const company = await this.forMember(actor, publicId, 'company_members.manage', tx);
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${company.id} FOR UPDATE`;
      const member = company.members.find((m) => m.publicId === memberPublicId);
      if (!member) throw new DomainException('http.not_found');
      const next = [...new Set(roles)];
      const before = member.roleKeys as CompanyRole[];
      const admins = company.members.filter(
        (m) => m.status === 'active' && m.roleKeys.includes('company_admin'),
      );
      if (
        member.status === 'active' &&
        before.includes('company_admin') &&
        !next.includes('company_admin') &&
        admins.length === 1
      )
        throw new DomainException('companies.last_admin');
      await tx.companyMember.update({
        where: { id: member.id },
        data: { roleKeys: next, rowVersion: { increment: 1 } },
      });
      if (member.status === 'active') {
        const removed = before.filter((r) => !next.includes(r));
        if (removed.length) {
          const roleRows = await tx.role.findMany({ where: { key: { in: removed }, scopeType: 'company' } });
          await tx.userRole.updateMany({
            where: {
              userId: member.userId,
              scopeType: 'company',
              scopeId: company.id,
              roleId: { in: roleRows.map((r) => r.id) },
              revokedAt: null,
            },
            data: { revokedAt: new Date(), revokedById: actor.userId },
          });
          for (const role of roleRows)
            await this.audit.record(tx, {
              category: 'iam',
              action: 'iam.role_revoked',
              actor,
              resourceType: 'user',
              resourcePublicId: member.user.publicId,
              data: {
                role: role.key,
                scope: { type: 'company', id: company.publicId },
                reason: 'Company roles changed',
              },
            });
        }
        await this.grantRoles(
          tx,
          member.userId,
          company.id,
          next.filter((r) => !before.includes(r)),
          actor.userId,
          'Company roles changed',
        );
        changedUser = member.userId;
      }
      await this.touch(tx, company.id);
      await this.record(
        tx,
        company,
        'company.member_roles_changed',
        { userId: member.user.publicId, from: before, to: next },
        actor,
      );
      return this.get(publicId, tx);
    });
    if (changedUser) await this.permissions.invalidate(changedUser);
    return row;
  }

  private async grantRoles(
    tx: Tx,
    userId: bigint,
    companyId: bigint,
    roles: CompanyRole[],
    grantedById: bigint | null,
    reason: string,
  ) {
    const rows = await tx.role.findMany({ where: { key: { in: roles }, scopeType: 'company' } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } });
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { publicId: true },
    });
    for (const role of rows) {
      try {
        await tx.userRole.create({
          data: { userId, roleId: role.id, scopeType: 'company', scopeId: companyId, grantedById, reason },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
      await this.audit.record(tx, {
        category: 'iam',
        action: 'iam.role_granted',
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { role: role.key, scope: { type: 'company', id: company.publicId }, reason },
      });
    }
  }

  // --- company order approvals (D-123) --------------------------------------------------------------

  /**
   * The company's order approvals (D-123): waiting ones for its approvers (oldest first), or the decided history
   * (newest first), with the decision, the threshold and the invoice branch.
   */
  async approvalsOf(
    actor: UserActor,
    publicId: string,
    q: { status?: 'pending' | 'decided' | 'all'; limit?: number; offset?: number } = {},
  ) {
    const company = await this.forMember(actor, publicId, 'company_orders.approve');
    const status = q.status ?? 'pending';
    // The company approvals are the ones its order groups point at.
    const groups = await this.prisma.orderGroup.findMany({
      where: { companyId: company.id, companyApprovalRequestId: { not: null } },
      select: { companyApprovalRequestId: true },
    });
    const requests = await this.prisma.approvalRequest.findMany({
      where: {
        id: { in: groups.map((g) => g.companyApprovalRequestId!) },
        ...(status === 'pending' && { status: 'pending' }),
        ...(status === 'decided' && { status: { not: 'pending' } }),
      },
      include: APPROVAL_INCLUDE,
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      skip: q.offset ?? 0,
      take: q.limit ?? 100,
    });
    return this.withGroups(requests);
  }

  private async withGroups(requests: ApprovalRow[]) {
    const groups = await this.prisma.orderGroup.findMany({
      where: { id: { in: requests.map((r) => r.subjectId) } },
      include: { companyBranch: { select: { name: true } }, _count: { select: { orders: true } } },
    });
    return requests.map((request) => ({ request, group: groups.find((g) => g.id === request.subjectId)! }));
  }

  /** The company approver approves or rejects in the store; the approval engine checks the role and SoD. */
  async decideApproval(
    actor: UserActor,
    publicId: string,
    approvalPublicId: string,
    approve: boolean,
    comment: string | null,
  ) {
    const company = await this.forMember(actor, publicId, 'company_orders.approve');
    const group = await this.prisma.orderGroup.findFirst({
      where: { companyId: company.id, companyApprovalRequest: { publicId: approvalPublicId } },
    });
    if (!group) throw new DomainException('http.not_found');
    if (approve) await this.approvals.approve(actor, approvalPublicId, comment ?? undefined);
    else await this.approvals.reject(actor, approvalPublicId, comment ?? 'rejected by the company approver');
    const request = await this.prisma.approvalRequest.findUniqueOrThrow({
      where: { publicId: approvalPublicId },
      include: APPROVAL_INCLUDE,
    });
    return (await this.withGroups([request]))[0]!;
  }

  // --- spend (D-125) ----------------------------------------------------------------------------------------

  /**
   * The company's placed orders over the last `months` calendar months (Bangkok) summed with decimal.js — net
   * (before VAT, shipping included), VAT and gross — by month, member, invoice branch and product type. Cancelled
   * orders and groups still waiting for the company approver are left out.
   */
  async spend(actor: UserActor, publicId: string, months: number): Promise<CompanySpendDto> {
    const company = await this.forMember(actor, publicId, 'company_documents.read');
    const today = bangkokDate(new Date());
    const firstMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - months, 1));
    const from = firstMonth.toISOString().slice(0, 10);
    const endMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
    const to = endMonth.toISOString().slice(0, 10);
    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: 'cancelled' },
        orderGroup: {
          companyId: company.id,
          status: { notIn: ['cancelled', 'pending_company_approval'] },
          placedAt: { gte: startOfDay(from), lt: startOfDay(addCalendarDays(to, 1)) },
        },
      },
      include: {
        productType: { select: { code: true } },
        orderGroup: {
          select: {
            placedAt: true,
            placedBy: { select: { publicId: true, displayName: true } },
            companyBranch: { select: { publicId: true, branchCode: true, name: true } },
          },
        },
      },
    });
    type Sum = { orders: number; net: Prisma.Decimal; vat: Prisma.Decimal; gross: Prisma.Decimal };
    const zero = (): Sum => ({
      orders: 0,
      net: new Prisma.Decimal(0),
      vat: new Prisma.Decimal(0),
      gross: new Prisma.Decimal(0),
    });
    const add = (m: Map<string, Sum>, key: string, o: (typeof orders)[number]) => {
      const sum = m.get(key) ?? zero();
      sum.orders += 1;
      sum.net = sum.net.add(o.netAmount);
      sum.vat = sum.vat.add(o.vatAmount);
      sum.gross = sum.gross.add(o.grossAmount);
      m.set(key, sum);
    };
    const total = new Map<string, Sum>();
    const byMonth = new Map<string, Sum>();
    const byMember = new Map<string, Sum>();
    const byBranch = new Map<string, Sum>();
    const byType = new Map<string, Sum>();
    const members = new Map<string, { publicId: string; displayName: string }>();
    const branches = new Map<string, { publicId: string; branchCode: string; name: string } | null>();
    for (const o of orders) {
      add(total, 'all', o);
      add(byMonth, bangkokDate(o.orderGroup.placedAt).slice(0, 7), o);
      add(byMember, o.orderGroup.placedBy.publicId, o);
      members.set(o.orderGroup.placedBy.publicId, o.orderGroup.placedBy);
      const branchKey = o.orderGroup.companyBranch?.publicId ?? '-';
      add(byBranch, branchKey, o);
      branches.set(branchKey, o.orderGroup.companyBranch);
      add(byType, o.productType.code, o);
    }
    const amounts = (sum: Sum) => ({
      orders: sum.orders,
      netAmount: sum.net.toFixed(2),
      vatAmount: sum.vat.toFixed(2),
      grossAmount: sum.gross.toFixed(2),
    });
    const monthKeys = Array.from({ length: months }, (_, i) =>
      new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1))
        .toISOString()
        .slice(0, 7),
    );
    const byGross = <T extends { grossAmount: string }>(a: T, b: T) =>
      new Prisma.Decimal(b.grossAmount).comparedTo(a.grossAmount);
    return {
      from,
      to,
      total: amounts(total.get('all') ?? zero()),
      byMonth: monthKeys.map((month) => ({ month, ...amounts(byMonth.get(month) ?? zero()) })),
      byMember: [...byMember]
        .map(([id, sum]) => ({ user: { id, displayName: members.get(id)!.displayName }, ...amounts(sum) }))
        .sort(byGross),
      byBranch: [...byBranch]
        .map(([key, sum]) => {
          const b = branches.get(key) ?? null;
          return {
            branchId: b?.publicId ?? null,
            branchCode: b?.branchCode ?? null,
            name: b?.name ?? null,
            ...amounts(sum),
          };
        })
        .sort(byGross),
      byProductType: [...byType]
        .map(([productTypeCode, sum]) => ({ productTypeCode, ...amounts(sum) }))
        .sort(byGross),
      currency: 'THB',
    };
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async touch(tx: Tx, companyId: bigint) {
    await tx.company.update({ where: { id: companyId }, data: { rowVersion: { increment: 1 } } });
  }

  async record(tx: Tx, company: Company, type: string, data: Record<string, unknown>, actor: Actor) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'company',
        aggregateId: company.publicId,
        payload: { companyId: company.publicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'company',
      aggregatePublicId: company.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}
