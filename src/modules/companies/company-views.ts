import { formatMoney } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { type FilesService } from '@platform/files/files.service';

import { type AdminCompanyDto, type CompanyDto, type CompanyInvitationDto } from './companies.dto';
import {
  type CompaniesService,
  type CompanyMembership,
  type CompanyRow,
  requiredKyc,
} from './companies.service';
import { type CreditService } from './credit.service';

/** The company discount version in force now (D-124). */
function discountPct(c: CompanyRow, now = new Date()): string | null {
  const v = c.discount?.versions.find(
    (x) => x.effectiveFrom <= now && (x.validTo === null || x.validTo > now),
  );
  return v ? v.discountPct.toFixed(4) : null;
}

export function companyDto(c: CompanyRow, me?: CompanyMembership): CompanyDto {
  const have = new Set(c.kycDocuments.filter((d) => d.status !== 'rejected').map((d) => d.docType));
  const may = (p: string) => me?.permissions.has(p) ?? false;
  return {
    id: c.publicId,
    companyCode: c.companyCode,
    legalName: c.legalName,
    tradeName: c.tradeName,
    taxId: c.taxId,
    isVatRegistered: c.isVatRegistered,
    withholdsTax: c.withholdsTax,
    documentEmail: c.documentEmail,
    status: c.status,
    statusReason: c.statusReason,
    creditStatus: c.creditStatus,
    poNumberPolicy: c.poNumberPolicy,
    orderApprovalThreshold: c.orderApprovalThreshold?.toFixed(2) ?? null,
    signatory:
      c.signatoryName && c.signatoryPosition
        ? { name: c.signatoryName, position: c.signatoryPosition }
        : null,
    contactPhone: c.contactPhone,
    discountPct: discountPct(c),
    myRoles: me?.roles ?? [],
    can: {
      manageMembers: may('company_members.manage'),
      manageSettings: may('company_profile.manage'),
      manageAssets: may('company_assets.manage'),
      approveOrders: may('company_orders.approve'),
      viewFinance: may('company_documents.read'),
      order: may('company_orders.place'),
    },
    branches: c.branches.map((b) => ({
      id: b.publicId,
      branchType: b.branchType,
      branchCode: b.branchCode,
      name: b.name,
      line1: b.line1,
      line2: b.line2,
      postcode: b.postcode,
      provinceId: b.province.publicId,
      provinceNameTh: b.province.nameTh,
      provinceNameEn: b.province.nameEn,
      subdistrictNameTh: b.subdistrict?.nameTh ?? null,
      subdistrictNameEn: b.subdistrict?.nameEn ?? null,
      districtNameTh: b.subdistrict?.district.nameTh ?? null,
      districtNameEn: b.subdistrict?.district.nameEn ?? null,
      isDefault: b.isDefault,
    })),
    members: c.members.map((m) => ({
      id: m.publicId,
      user: { id: m.user.publicId, displayName: m.user.displayName },
      status: m.status,
      roles: m.roleKeys,
      joinedAt: m.joinedAt ? toBangkokIso(m.joinedAt) : null,
    })),
    kycDocuments: c.kycDocuments.map((d) => ({
      id: d.publicId,
      docType: d.docType,
      fileId: d.fileObject.publicId,
      issuedOn: d.issuedOn ? d.issuedOn.toISOString().slice(0, 10) : null,
      status: d.status,
      note: d.note,
    })),
    missingKyc: requiredKyc(c.isVatRegistered).filter((t) => !have.has(t)),
    createdAt: toBangkokIso(c.createdAt),
  };
}

/** The staff view (D-120…D-125): member contacts, KYC files with who reviewed them, discount and receivables. */
export async function adminCompanyDto(
  c: CompanyRow,
  deps: { files: FilesService; credit: CreditService },
): Promise<AdminCompanyDto> {
  const now = new Date();
  const base = companyDto(c);
  const discount = c.discount?.versions.find(
    (x) => x.effectiveFrom <= now && (x.validTo === null || x.validTo > now),
  );
  const [owed, kycDocuments] = await Promise.all([
    deps.credit.owed(c.id, now),
    Promise.all(
      c.kycDocuments.map(async (d, i) => ({
        ...base.kycDocuments[i]!,
        fileName: d.fileObject.originalName,
        fileUrl: (await deps.files.signedUrl(d.fileObject))?.url ?? null,
        uploadedAt: toBangkokIso(d.createdAt),
        reviewedAt: d.verifiedAt ? toBangkokIso(d.verifiedAt) : null,
        reviewedBy: d.verifiedBy
          ? { id: d.verifiedBy.publicId, displayName: d.verifiedBy.displayName }
          : null,
      })),
    ),
  ]);
  return {
    ...base,
    members: c.members.map((m, i) => ({
      ...base.members[i]!,
      user: {
        id: m.user.publicId,
        displayName: m.user.displayName,
        email: m.user.email,
        phone: m.user.phone,
      },
    })),
    kycDocuments,
    paidOrdersCount: c.paidOrdersCount,
    kycApprovedAt: c.kycApprovedAt ? toBangkokIso(c.kycApprovedAt) : null,
    membersCount: c.members.length,
    discount: discount
      ? {
          pct: discount.discountPct.toFixed(4),
          effectiveFrom: toBangkokIso(discount.effectiveFrom),
          validTo: discount.validTo ? toBangkokIso(discount.validTo) : null,
          discountMemoId: discount.discountMemo.publicId,
        }
      : null,
    receivables: {
      openAmount: formatMoney(owed.open),
      overdueAmount: formatMoney(owed.overdue),
      oldestOverdueDays: owed.oldestOverdueDays,
      nextDueAt: owed.nextDueAt ? toBangkokIso(owed.nextDueAt) : null,
      creditOrdersBlocked: owed.creditOrdersBlocked,
      currency: 'THB',
    },
  };
}

export function invitationDto(
  m: Awaited<ReturnType<CompaniesService['invitations']>>[number],
): CompanyInvitationDto {
  return {
    id: m.publicId,
    companyId: m.company.publicId,
    companyName: m.company.legalName,
    roles: m.roleKeys,
    invitedBy: m.invitedBy ? { id: m.invitedBy.publicId, displayName: m.invitedBy.displayName } : null,
    invitedAt: toBangkokIso(m.invitedAt),
  };
}
