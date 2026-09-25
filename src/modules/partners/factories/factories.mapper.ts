import { toBangkokIso } from '@common/time/bangkok';
import {
  type FactoryAddress,
  type FactoryContact,
  type FactoryKycDocument,
  type FactoryOnboardingStep,
} from '@generated/prisma/client';

import {
  type FactoryAddressDto,
  type FactoryContactDto,
  type FactoryDto,
  type KycDocumentDto,
  type OnboardingStepDto,
} from './factories.dto';
import { type FactoryRow } from './factories.service';

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export const factoryDto = (f: FactoryRow): FactoryDto => ({
  id: f.publicId,
  code: f.code,
  legalName: f.legalName,
  tradeName: f.tradeName,
  juristicType: f.juristicType,
  taxId: f.taxId,
  branchCode: f.branchCode,
  isVatRegistered: f.isVatRegistered,
  vatRegisteredOn: day(f.vatRegisteredOn),
  status: f.status,
  statusChangedAt: toBangkokIso(f.statusChangedAt),
  onboardingMode: f.onboardingMode,
  lineGroupId: f.lineGroupId,
  trialJobsCompleted: f.trialJobsCompleted,
  activatedAt: iso(f.activatedAt),
  offboardedAt: iso(f.offboardedAt),
  onboarding: {
    done: f.onboardingSteps.filter((s) => s.status === 'approved' || s.status === 'waived').length,
    total: f.onboardingSteps.length,
  },
  updatedAt: toBangkokIso(f.updatedAt),
});

export const stepDto = (s: FactoryOnboardingStep): OnboardingStepDto => ({
  step: s.step,
  status: s.status,
  enteredByStaff: s.enteredByStaff,
  completedAt: iso(s.completedAt),
  factorySignedOffAt: iso(s.factorySignedOffAt),
  notes: s.notes,
});

export const addressDto = (
  a: FactoryAddress & { subdistrict: { publicId: string } | null },
): FactoryAddressDto => ({
  id: a.publicId,
  kind: a.kind,
  line1: a.line1,
  line2: a.line2,
  subdistrictId: a.subdistrict?.publicId ?? null,
  postcode: a.postcode,
  lat: a.lat?.toNumber() ?? null,
  lng: a.lng?.toNumber() ?? null,
});

export const contactDto = (c: FactoryContact): FactoryContactDto => ({
  id: c.publicId,
  name: c.name,
  roleTitle: c.roleTitle,
  phone: c.phone,
  email: c.email,
  isPrimary: c.isPrimary,
});

export const kycDto = (k: FactoryKycDocument & { fileObject: { publicId: string } }): KycDocumentDto => ({
  id: k.publicId,
  docType: k.docType,
  fileId: k.fileObject.publicId,
  issuedOn: day(k.issuedOn),
  expiresOn: day(k.expiresOn),
  status: k.status,
  verifiedAt: iso(k.verifiedAt),
  note: k.note,
});
