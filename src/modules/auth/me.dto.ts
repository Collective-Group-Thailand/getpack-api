import { EnumField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty } from '@nestjs/swagger';

export const LOCALES = ['th', 'en'] as const;
/** D-183: the unit the web shows sizes in; every size in the API is millimetres. */
export const DISPLAY_UNITS = ['mm', 'cm', 'in'] as const;
export const IDENTITY_PROVIDERS = ['phone_otp', 'firebase_google', 'firebase_apple', 'line'] as const;

const USER_ID = '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b';

class MeBaseDto {
  @ApiProperty({ format: 'uuid', example: USER_ID })
  id!: string;

  @ApiProperty({ example: 'ผู้ใช้ ทดสอบ' })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'user.one@example.com' })
  email!: string | null;

  @ApiProperty({ enum: LOCALES, enumName: 'LocaleCode', example: 'th' })
  locale!: (typeof LOCALES)[number];

  @ApiProperty({
    enum: DISPLAY_UNITS,
    enumName: 'DisplayUnit',
    example: 'mm',
    description: 'The unit the web shows sizes in (D-183); every size in the API is millimetres',
  })
  displayUnit!: (typeof DISPLAY_UNITS)[number];

  @ApiProperty({ type: [String], example: [] })
  roles!: string[];

  @ApiProperty({ type: [String], example: [] })
  permissions!: string[];
}

export class LinkedIdentityDto {
  @ApiProperty({ enum: IDENTITY_PROVIDERS, enumName: 'IdentityProvider', example: 'line' })
  provider!: (typeof IDENTITY_PROVIDERS)[number];

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  linkedAt!: string;
}

export class StoreMeDto extends MeBaseDto {
  @ApiProperty({ type: String, nullable: true, example: '+66810001234', description: 'E.164' })
  phone!: string | null;

  @ApiProperty({
    type: [String],
    example: [],
    description: 'Company scopes (`company:<uuid>`) of B2B members',
  })
  scopes!: string[];

  @ApiProperty({ type: [LinkedIdentityDto] })
  identities!: LinkedIdentityDto[];
}

export class MenuEntryDto {
  @ApiProperty({ example: 'approvals', description: 'Stable key; the frontend owns the label' })
  key!: string;

  @ApiProperty({ example: '/admin/approvals' })
  path!: string;
}

export class AdminMeDto extends MeBaseDto {
  @ApiProperty({ type: [MenuEntryDto], description: 'Admin-zone menu entries this user may open' })
  menu!: MenuEntryDto[];

  @ApiProperty({ type: [String], example: [], description: 'Feature flags enabled for this user' })
  featureFlags!: string[];
}

/** The factory-scoped roles (D-140, D-171): the owner is invited by Packio, the others by the owner. */
export const FACTORY_ROLES = [
  'factory_owner',
  'factory_planner',
  'factory_operator',
  'factory_qc',
  'factory_shipping',
  'factory_accountant',
  'factory_storekeeper',
  'factory_purchaser',
] as const;

export class FactoryAccessDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-000000000f01' })
  factoryId!: string;

  @ApiProperty({ example: 'F-0001' })
  code!: string;

  @ApiProperty({ example: 'โรงงาน ทดสอบ', description: 'Trade name, else the legal name' })
  name!: string;

  @ApiProperty({ enum: FACTORY_ROLES, enumName: 'FactoryRole', isArray: true, example: ['factory_owner'] })
  roles!: string[];
}

export class PartnerMeDto extends MeBaseDto {
  @ApiProperty({ type: [FactoryAccessDto], description: 'Factories this user acts for (token scopes)' })
  factories!: FactoryAccessDto[];
}

export const STORE_ME_EXAMPLE: StoreMeDto = {
  id: USER_ID,
  displayName: 'ลูกค้า ทดสอบ',
  email: 'customer.one@example.com',
  phone: '+66810001234',
  locale: 'th',
  displayUnit: 'mm',
  roles: [],
  permissions: [],
  scopes: [],
  identities: [{ provider: 'phone_otp', linkedAt: '2026-09-23T14:05:00+07:00' }],
};

export const ADMIN_ME_EXAMPLE: AdminMeDto = {
  id: USER_ID,
  displayName: 'การเงิน ทดสอบ',
  email: 'finance.one@example.com',
  locale: 'th',
  displayUnit: 'mm',
  roles: ['finance'],
  permissions: ['approvals.act', 'approvals.read', 'audit_logs.read'],
  menu: [
    { key: 'dashboard', path: '/admin' },
    { key: 'approvals', path: '/admin/approvals' },
    { key: 'audit_logs', path: '/admin/audit-logs' },
  ],
  featureFlags: [],
};

export const PARTNER_ME_EXAMPLE: PartnerMeDto = {
  id: USER_ID,
  displayName: 'โรงงาน ทดสอบ',
  email: 'planner@factory.example',
  locale: 'th',
  displayUnit: 'mm',
  roles: ['factory_planner'],
  permissions: ['factory_profile.read'],
  factories: [
    {
      factoryId: '0192f3a0-7c1e-7d2a-9b1f-000000000f01',
      code: 'F-0001',
      name: 'โรงงาน ทดสอบ',
      roles: ['factory_planner'],
    },
  ],
};

export class UpdatePreferencesDto {
  @EnumField(DISPLAY_UNITS, 'DisplayUnit', {
    example: 'cm',
    description: 'The unit the web shows sizes in (D-183); sizes are still sent and stored in millimetres',
  })
  displayUnit!: (typeof DISPLAY_UNITS)[number];
}
