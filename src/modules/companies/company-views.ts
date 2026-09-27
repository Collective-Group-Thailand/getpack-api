import { toBangkokIso } from '@common/time/bangkok';

import { type AdminCompanyDto, type CompanyDto, type CompanyInvitationDto } from './companies.dto';
import { type CompaniesService, type CompanyRow, requiredKyc } from './companies.service';

export function companyDto(c: CompanyRow): CompanyDto {
  const have = new Set(c.kycDocuments.filter((d) => d.status !== 'rejected').map((d) => d.docType));
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
    branches: c.branches.map((b) => ({
      id: b.publicId,
      branchType: b.branchType,
      branchCode: b.branchCode,
      name: b.name,
      line1: b.line1,
      line2: b.line2,
      postcode: b.postcode,
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

export function adminCompanyDto(c: CompanyRow): AdminCompanyDto {
  return { ...companyDto(c), paidOrdersCount: c.paidOrdersCount, kycApprovedAt: c.kycApprovedAt ? toBangkokIso(c.kycApprovedAt) : null };
}

export function invitationDto(m: Awaited<ReturnType<CompaniesService['invitations']>>[number]): CompanyInvitationDto {
  return {
    id: m.publicId,
    companyId: m.company.publicId,
    companyName: m.company.legalName,
    roles: m.roleKeys,
    invitedBy: m.invitedBy ? { id: m.invitedBy.publicId, displayName: m.invitedBy.displayName } : null,
    invitedAt: toBangkokIso(m.invitedAt),
  };
}
