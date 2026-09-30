import { ReasonDto } from '@common/dto/reason.dto';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const USER_KINDS = ['customer', 'staff', 'partner'] as const;
export const USER_STATUSES = ['pending_verification', 'active', 'suspended', 'inactive'] as const;
export const ROLE_SCOPE_TYPES = ['platform', 'factory', 'company'] as const;
export const SCOPED_TYPES = ['factory', 'company'] as const;

const USER_ID = '0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b';

export class RoleScopeDto {
  @ApiProperty({ enum: SCOPED_TYPES, enumName: 'ScopedType', example: 'factory' })
  @IsIn(SCOPED_TYPES)
  type!: (typeof SCOPED_TYPES)[number];

  @ApiProperty({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-000000000f01',
    description: 'Factory or company id',
  })
  @IsUUID()
  id!: string;
}

export class RoleGrantDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000a001', description: 'Grant id' })
  id!: string;

  @ApiProperty({ example: 'finance' })
  role!: string;

  @ApiProperty({ enum: ROLE_SCOPE_TYPES, enumName: 'RoleScopeType', example: 'platform' })
  scopeType!: (typeof ROLE_SCOPE_TYPES)[number];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'Factory/company id; null for platform roles',
  })
  scopeId!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-23T14:05:00+07:00' })
  validFrom!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Time-boxed grants (Auditor, §8)',
  })
  validTo!: string | null;

  @ApiProperty({ example: 'Joined the finance team' })
  reason!: string;
}

export class UserAdminDto {
  @ApiProperty({ format: 'uuid', example: USER_ID })
  id!: string;

  @ApiProperty({ enum: USER_KINDS, enumName: 'TokenAudience', example: 'staff' })
  kind!: (typeof USER_KINDS)[number];

  @ApiProperty({ enum: USER_STATUSES, enumName: 'UserStatus', example: 'active' })
  status!: (typeof USER_STATUSES)[number];

  @ApiProperty({ type: String, nullable: true, example: 'finance.one@example.com' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+66810001234' })
  phone!: string | null;

  @ApiProperty({ example: 'การเงิน ทดสอบ' })
  displayName!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-09-23T09:00:00+07:00' })
  lastLoginAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-09-01T09:00:00+07:00' })
  createdAt!: string;

  @ApiProperty({ type: [RoleGrantDto] })
  roles!: RoleGrantDto[];
}

export const USER_ADMIN_EXAMPLE: UserAdminDto = {
  id: USER_ID,
  kind: 'staff',
  status: 'active',
  email: 'finance.one@example.com',
  phone: null,
  displayName: 'การเงิน ทดสอบ',
  lastLoginAt: '2026-09-23T09:00:00+07:00',
  createdAt: '2026-09-01T09:00:00+07:00',
  roles: [
    {
      id: '0192f3a0-7c1e-7d2a-9b1f-00000000a001',
      role: 'finance',
      scopeType: 'platform',
      scopeId: null,
      validFrom: '2026-09-01T09:00:00+07:00',
      validTo: null,
      reason: 'Joined the finance team',
    },
  ],
};

export class UserListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: USER_KINDS, enumName: 'TokenAudience' })
  @IsOptional()
  @IsIn(USER_KINDS)
  kind?: (typeof USER_KINDS)[number];

  @ApiPropertyOptional({ enum: USER_STATUSES, enumName: 'UserStatus' })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

export class CreateUserDto {
  @ApiProperty({ enum: ['staff', 'partner'], enumName: 'ManagedUserKind', example: 'staff' })
  @IsIn(['staff', 'partner'])
  kind!: 'staff' | 'partner';

  @ApiProperty({ example: 'new.staff@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'พนักงาน ทดสอบ', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @ApiProperty({
    example: 'temporary-passphrase-1',
    minLength: 12,
    maxLength: 256,
    format: 'password',
    description: 'Initial password; the user changes it',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  initialPassword!: string;
}

export { ReasonDto };

export class GrantRoleDto extends ReasonDto {
  @ApiProperty({ example: 'finance', pattern: '^[a-z][a-z0-9_]*$' })
  @Matches(/^[a-z][a-z0-9_]*$/)
  role!: string;

  @ApiPropertyOptional({ type: RoleScopeDto, description: 'Required for factory and company roles' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleScopeDto)
  scope?: RoleScopeDto;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-12-31T23:59:59+07:00',
    description: 'End of a time-boxed grant',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;
}

export class RoleDto {
  @ApiProperty({ example: 'finance' })
  key!: string;

  @ApiProperty({
    enum: USER_KINDS,
    enumName: 'TokenAudience',
    example: 'staff',
    description: 'Audience of users who may hold it',
  })
  audience!: (typeof USER_KINDS)[number];

  @ApiProperty({ enum: ROLE_SCOPE_TYPES, enumName: 'RoleScopeType', example: 'platform' })
  scopeType!: (typeof ROLE_SCOPE_TYPES)[number];

  @ApiProperty({ example: 'การเงิน' })
  nameTh!: string;

  @ApiProperty({ example: 'Finance' })
  nameEn!: string;

  @ApiProperty({ type: [String], example: ['approvals.act', 'factory_cost.read'] })
  permissions!: string[];
}
