import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { type PermissionKey } from '@modules/iam/permissions.catalog';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  type Type,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { staffOrPartner } from '../partner-actor';
import {
  CreateFactoryAddressDto,
  CreateFactoryContactDto,
  CreateKycDocumentDto,
  FACTORY_IDS,
  FactoryAddressDto,
  FactoryContactDto,
  KycDocumentDto,
  OnboardingStepDto,
  UpdateFactoryAddressDto,
  UpdateFactoryContactDto,
} from './factories.dto';
import { addressDto, contactDto, kycDto, stepDto } from './factories.mapper';
import { FactoriesService } from './factories.service';

const WRITE_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
] as const;

const ADDRESS: FactoryAddressDto = {
  id: FACTORY_IDS.address,
  kind: 'plant',
  line1: '99/9 ถนนตัวอย่าง',
  line2: 'นิคมอุตสาหกรรมตัวอย่าง',
  subdistrictId: FACTORY_IDS.subdistrict,
  postcode: '10200',
  lat: 13.75,
  lng: 100.5,
};
const CONTACT: FactoryContactDto = {
  id: FACTORY_IDS.contact,
  name: 'ผู้ติดต่อ ทดสอบ',
  roleTitle: 'ผู้จัดการฝ่ายผลิต',
  phone: '+66810001234',
  email: 'contact@factory.example',
  isPrimary: true,
};
const KYC: KycDocumentDto = {
  id: FACTORY_IDS.kyc,
  docType: 'company_certificate',
  fileId: FACTORY_IDS.file,
  issuedOn: '2026-08-01',
  expiresOn: null,
  status: 'pending',
  verifiedAt: null,
  note: null,
};
const STEP: OnboardingStepDto = {
  step: 'kyc',
  status: 'submitted',
  enteredByStaff: false,
  completedAt: null,
  factorySignedOffAt: null,
  notes: null,
};

/**
 * Onboarding steps, addresses, contacts and KYC documents of a factory, for the admin surface (Partner
 * team) and the partner surface (own factory only, D-044; edits only before the trial starts).
 */
export function factorySubresourcesController(
  surface: 'admin' | 'partner',
  permissions: { read: PermissionKey; manage: PermissionKey },
): Type<unknown> {
  const decisions = ['D-011', 'D-171'];
  const scopeNote =
    surface === 'partner'
      ? ' Own factory only; the factory edits its data only while `applied` or `under_review`.'
      : ' Staff may edit at any status (assisted onboarding, D-100 note).';
  const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });

  @ApiSurface(surface, 'factories')
  @Controller('factories/:factoryId')
  class FactorySubresourcesController {
    constructor(readonly factories: FactoriesService) {}

    @Get('onboarding-steps')
    @Can(permissions.read)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.listOnboardingSteps`,
      summary: 'List the onboarding steps of a factory',
      description: `The 13 steps of D-011 in order, with staff entry and factory sign-off (D-100 note).${scopeNote}`,
      implements: [...decisions, 'D-100'],
    })
    @ApiSuccess(200, { description: 'Steps', type: [OnboardingStepDto], example: [STEP] })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async steps(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
      return (await this.factories.steps(actor, factoryId)).map(stepDto);
    }

    @Get('addresses')
    @Can(permissions.read)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.listAddresses`,
      summary: 'List the addresses of a factory',
      description: `Registered, plant and pickup addresses.${scopeNote}`,
      implements: decisions,
    })
    @ApiSuccess(200, { description: 'Addresses', type: [FactoryAddressDto], example: [ADDRESS] })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async addresses(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
      return (await this.factories.addresses(actor, factoryId)).map(addressDto);
    }

    @Post('addresses')
    @Can(permissions.manage)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.addAddress`,
      summary: 'Add an address to a factory',
      description: `Audited and published as \`factory.address_added\`.${scopeNote}`,
      implements: decisions,
    })
    @ApiBody({
      type: CreateFactoryAddressDto,
      examples: { default: { value: { kind: 'plant', line1: '99/9 ถนนตัวอย่าง', postcode: '10200' } } },
    })
    @ApiSuccess(201, { description: 'Added', type: FactoryAddressDto, example: ADDRESS })
    @ApiStandardErrors(...WRITE_ERRORS, 'partners.profile_locked')
    async addAddress(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Body() body: CreateFactoryAddressDto,
    ) {
      return addressDto(await this.factories.saveAddress(staffOrPartner(actor), factoryId, body));
    }

    @Patch('addresses/:addressId')
    @Can(permissions.manage)
    @factoryParam
    @ApiParam({ name: 'addressId', format: 'uuid' })
    @ApiEndpoint({
      id: `${surface}.factories.updateAddress`,
      summary: 'Update a factory address',
      description: `Partial update.${scopeNote}`,
      implements: decisions,
    })
    @ApiBody({ type: UpdateFactoryAddressDto, examples: { default: { value: { line2: 'อาคาร 2' } } } })
    @ApiSuccess(200, { description: 'Updated', type: FactoryAddressDto, example: ADDRESS })
    @ApiStandardErrors(...WRITE_ERRORS, 'partners.profile_locked')
    async updateAddress(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Param('addressId', ParseUUIDPipe) addressId: string,
      @Body() body: UpdateFactoryAddressDto,
    ) {
      return addressDto(await this.factories.saveAddress(staffOrPartner(actor), factoryId, body, addressId));
    }

    @Get('contacts')
    @Can(permissions.read)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.listContacts`,
      summary: 'List the contacts of a factory',
      description: `Contact persons (personal data: never logged, PDPA).${scopeNote}`,
      implements: decisions,
    })
    @ApiSuccess(200, { description: 'Contacts', type: [FactoryContactDto], example: [CONTACT] })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async contacts(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
      return (await this.factories.contacts(actor, factoryId)).map(contactDto);
    }

    @Post('contacts')
    @Can(permissions.manage)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.addContact`,
      summary: 'Add a contact to a factory',
      description: `One contact may be primary; setting another as primary moves the flag.${scopeNote}`,
      implements: decisions,
    })
    @ApiBody({
      type: CreateFactoryContactDto,
      examples: { default: { value: { name: 'ผู้ติดต่อ ทดสอบ', phone: '+66810001234', isPrimary: true } } },
    })
    @ApiSuccess(201, { description: 'Added', type: FactoryContactDto, example: CONTACT })
    @ApiStandardErrors(...WRITE_ERRORS, 'partners.profile_locked')
    async addContact(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Body() body: CreateFactoryContactDto,
    ) {
      return contactDto(await this.factories.saveContact(staffOrPartner(actor), factoryId, body));
    }

    @Patch('contacts/:contactId')
    @Can(permissions.manage)
    @factoryParam
    @ApiParam({ name: 'contactId', format: 'uuid' })
    @ApiEndpoint({
      id: `${surface}.factories.updateContact`,
      summary: 'Update a factory contact',
      description: `Partial update.${scopeNote}`,
      implements: decisions,
    })
    @ApiBody({
      type: UpdateFactoryContactDto,
      examples: { default: { value: { roleTitle: 'เจ้าของกิจการ' } } },
    })
    @ApiSuccess(200, { description: 'Updated', type: FactoryContactDto, example: CONTACT })
    @ApiStandardErrors(...WRITE_ERRORS, 'partners.profile_locked')
    async updateContact(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Param('contactId', ParseUUIDPipe) contactId: string,
      @Body() body: UpdateFactoryContactDto,
    ) {
      return contactDto(await this.factories.saveContact(staffOrPartner(actor), factoryId, body, contactId));
    }

    @Get('kyc-documents')
    @Can(permissions.read)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.listKycDocuments`,
      summary: 'List the KYC documents of a factory',
      description: `Documents with their review status and expiry.${scopeNote}`,
      implements: decisions,
    })
    @ApiSuccess(200, { description: 'Documents', type: [KycDocumentDto], example: [KYC] })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async kyc(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
      return (await this.factories.kycDocuments(actor, factoryId)).map(kycDto);
    }

    @Post('kyc-documents')
    @HttpCode(201)
    @Can(permissions.manage)
    @factoryParam
    @ApiEndpoint({
      id: `${surface}.factories.addKycDocument`,
      summary: 'Add a KYC document',
      description:
        `References an uploaded file (presign → PUT → complete); the file then belongs to the factory. ` +
        `The \`kyc\` step becomes submitted.${scopeNote}`,
      implements: decisions,
    })
    @ApiBody({
      type: CreateKycDocumentDto,
      examples: {
        default: {
          value: { docType: 'company_certificate', fileId: FACTORY_IDS.file, issuedOn: '2026-08-01' },
        },
      },
    })
    @ApiSuccess(201, { description: 'Added', type: KycDocumentDto, example: KYC })
    @ApiStandardErrors(...WRITE_ERRORS, 'partners.profile_locked')
    async addKyc(
      @CurrentActor() actor: Actor,
      @Param('factoryId', ParseUUIDPipe) factoryId: string,
      @Body() body: CreateKycDocumentDto,
    ) {
      return kycDto(await this.factories.addKycDocument(staffOrPartner(actor), factoryId, body));
    }
  }
  Object.defineProperty(FactorySubresourcesController, 'name', {
    value: `${surface === 'admin' ? 'Admin' : 'Partner'}FactorySubresourcesController`,
  });
  return FactorySubresourcesController;
}
