import { toBangkokIso } from '@common/time/bangkok';

import {
  type AddressDto,
  type AdminCustomerDto,
  type CustomerProfileDto,
  type GeoRefDto,
  type TaxProfileDto,
} from './customers.dto';
import { type AddressRow, type CustomerRow, type TaxProfileRow } from './customers.service';

const geo = (row: { publicId: string; nameTh: string; nameEn: string }): GeoRefDto => ({
  id: row.publicId,
  nameTh: row.nameTh,
  nameEn: row.nameEn,
});

export function addressDto(row: AddressRow): AddressDto {
  return {
    id: row.publicId,
    kind: row.kind,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    subdistrict: row.subdistrict ? geo(row.subdistrict) : null,
    province: geo(row.province),
    postcode: row.postcode,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    isDefault: row.isDefault,
    updatedAt: toBangkokIso(row.updatedAt),
  };
}

export function taxProfileDto(row: TaxProfileRow): TaxProfileDto {
  return {
    id: row.publicId,
    taxType: row.taxType,
    name: row.name,
    taxId: row.taxId,
    branchType: row.branchType,
    branchCode: row.branchCode,
    line1: row.line1,
    line2: row.line2,
    subdistrict: row.subdistrict ? geo(row.subdistrict) : null,
    province: geo(row.province),
    postcode: row.postcode,
    withholdsTax: row.withholdsTax,
    documentEmail: row.documentEmail,
    isDefault: row.isDefault,
    updatedAt: toBangkokIso(row.updatedAt),
  };
}

export function customerProfileDto(row: CustomerRow): CustomerProfileDto {
  return {
    id: row.publicId,
    customerCode: row.customerProfile?.customerCode ?? null,
    customerType: row.customerProfile?.customerType ?? 'individual',
    displayName: row.displayName,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    createdVia: row.customerProfile?.createdVia ?? 'self',
    profileCompletedAt: row.customerProfile?.profileCompletedAt
      ? toBangkokIso(row.customerProfile.profileCompletedAt)
      : null,
    createdAt: toBangkokIso(row.createdAt),
  };
}

export interface CustomerStats {
  ordersCount: number;
  lastOrderAt: Date | null;
  companyName: string | null;
}

export function adminCustomerDto(row: CustomerRow, stats?: CustomerStats): AdminCustomerDto {
  return {
    ...customerProfileDto(row),
    status: row.status,
    lastLoginAt: row.lastLoginAt ? toBangkokIso(row.lastLoginAt) : null,
    companyName: stats?.companyName ?? null,
    ordersCount: stats?.ordersCount ?? 0,
    lastOrderAt: stats?.lastOrderAt ? toBangkokIso(stats.lastOrderAt) : null,
    referralCode: row.customerProfile?.referralCode ?? null,
  };
}
