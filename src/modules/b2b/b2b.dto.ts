import { RefField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** D-291 scopes of a company API client (`orders:read`, `orders:write`, `documents:read`, `webhooks:manage`). */
export const B2B_SCOPES = [
  'b2b_orders.read',
  'b2b_orders.write',
  'b2b_documents.read',
  'b2b_webhooks.manage',
] as const;
export type B2bScope = (typeof B2B_SCOPES)[number];
export const WEBHOOK_EVENT_TYPES = [
  'order.placed',
  'order.updated',
  'shipment.shipped',
  'shipment.delivered',
  'document.issued',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const B2B_IDS = {
  client: '0192f3a0-7c1e-7d2a-9b1f-0000000e7401',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000e7402',
  owner: '0192f3a0-7c1e-7d2a-9b1f-0000000e7403',
  subscription: '0192f3a0-7c1e-7d2a-9b1f-0000000e7404',
  delivery: '0192f3a0-7c1e-7d2a-9b1f-0000000e7405',
  event: '0192f3a0-7c1e-7d2a-9b1f-0000000e7406',
  quote: '0192f3a0-7c1e-7d2a-9b1f-0000000e7407',
  option: '0192f3a0-7c1e-7d2a-9b1f-0000000e7408',
  address: '0192f3a0-7c1e-7d2a-9b1f-0000000e7409',
} as const;

const SCOPE_DESCRIPTION =
  '`b2b_orders.read` (orders:read), `b2b_orders.write` (orders:write), `b2b_documents.read` (documents:read), ' +
  '`b2b_webhooks.manage` (webhooks:manage) — D-291';

// --- company API clients (Company Admin, store) -------------------------------------------------------------------

export class CompanyApiClientDto {
  @ApiProperty({ format: 'uuid', example: B2B_IDS.client })
  id!: string;

  @ApiProperty({
    example: 'pc_5f1c0a9e2b7d4c3a8e6f1d20',
    description: 'The `client_id` of the token request',
  })
  clientId!: string;

  @ApiProperty({ example: 'ERP connector' })
  name!: string;

  @ApiProperty({ enum: B2B_SCOPES, enumName: 'B2bScope', isArray: true, description: SCOPE_DESCRIPTION })
  scopes!: B2bScope[];

  @ApiProperty({ enum: ['active', 'suspended', 'revoked'], enumName: 'ApiClientStatus', example: 'active' })
  status!: string;

  @ApiProperty({
    type: UserRefDto,
    description: 'The Company Admin who issued it: orders it places are theirs',
  })
  owner!: UserRefDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-03T16:00:00+07:00' })
  lastUsedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T15:00:00+07:00' })
  createdAt!: string;
}

export class IssuedCompanyApiClientDto extends CompanyApiClientDto {
  @ApiProperty({
    example: 'example-client-secret',
    description:
      'Shown once: only its hash is kept. Exchange it at `POST /v1/auth/oauth/token` (client_credentials).',
  })
  clientSecret!: string;
}

export const API_CLIENT_EXAMPLE: CompanyApiClientDto = {
  id: B2B_IDS.client,
  clientId: 'pc_5f1c0a9e2b7d4c3a8e6f1d20',
  name: 'ERP connector',
  scopes: ['b2b_orders.read', 'b2b_documents.read'],
  status: 'active',
  owner: { id: B2B_IDS.owner, displayName: 'ผู้ดูแล ทดสอบ' },
  lastUsedAt: null,
  createdAt: '2026-10-03T15:00:00+07:00',
};

export class IssueApiClientDto {
  @TextField({ example: 'ERP connector', max: 100 })
  name!: string;

  @ApiProperty({ enum: B2B_SCOPES, enumName: 'B2bScope', isArray: true, description: SCOPE_DESCRIPTION })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(B2B_SCOPES.length)
  @IsIn(B2B_SCOPES, { each: true })
  scopes!: B2bScope[];
}

// --- the client itself (b2b surface) -----------------------------------------------------------------------------

export class B2bCompanyDto {
  @ApiProperty({ format: 'uuid', example: B2B_IDS.company })
  id!: string;

  @ApiProperty({ example: 'บริษัท ทดสอบ จำกัด' })
  legalName!: string;
}

export class B2bMeDto {
  @ApiProperty({ format: 'uuid', example: B2B_IDS.client })
  clientId!: string;

  @ApiProperty({ example: 'ERP connector' })
  name!: string;

  @ApiProperty({ enum: B2B_SCOPES, enumName: 'B2bScope', isArray: true })
  scopes!: B2bScope[];

  @ApiProperty({ type: B2bCompanyDto })
  company!: B2bCompanyDto;
}

export const B2B_ME_EXAMPLE: B2bMeDto = {
  clientId: B2B_IDS.client,
  name: 'ERP connector',
  scopes: ['b2b_orders.read', 'b2b_orders.write'],
  company: { id: B2B_IDS.company, legalName: 'บริษัท ทดสอบ จำกัด' },
};

export class B2bDestinationDto {
  @RefField({ example: B2B_IDS.address, description: 'An address of the client’s owner' })
  addressId!: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  quantity!: number;
}

export class PlaceB2bOrderDto {
  @RefField({ example: B2B_IDS.quote, description: 'A saved quotation of the client’s owner, still valid' })
  quoteId!: string;

  @RefField({ example: B2B_IDS.option })
  quoteOptionId!: string;

  @ApiPropertyOptional({
    type: [B2bDestinationDto],
    description: 'Where the quantity goes; default: the owner’s default address, all of it',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => B2bDestinationDto)
  destinations?: B2bDestinationDto[];

  @ApiPropertyOptional({
    example: 'PO-2026-0042',
    description: 'The company’s PO number (its PO policy applies)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  poNumber?: string;

  @ApiPropertyOptional({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c1002' })
  @IsOptional()
  @IsUUID()
  companyBranchId?: string;

  @ApiPropertyOptional({
    example: '13508.40',
    description: 'Refused (409) when the order total differs — the client confirms the price it saw',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}\.\d{2}$/)
  expectedGrossAmount?: string;
}

// --- webhooks -----------------------------------------------------------------------------------------------------

export class WebhookSubscriptionDto {
  @ApiProperty({ format: 'uuid', example: B2B_IDS.subscription })
  id!: string;

  @ApiProperty({ example: 'https://erp.example.com/packio/webhooks' })
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, enumName: 'WebhookEventType', isArray: true })
  eventTypes!: WebhookEventType[];

  @ApiProperty({ enum: ['active', 'disabled'], enumName: 'WebhookSubscriptionStatus', example: 'active' })
  status!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T15:00:00+07:00' })
  createdAt!: string;
}

export class CreatedWebhookSubscriptionDto extends WebhookSubscriptionDto {
  @ApiProperty({
    example: 'whsec_example',
    description:
      'Shown once. Every delivery carries `Packio-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`',
  })
  secret!: string;
}

export const SUBSCRIPTION_EXAMPLE: WebhookSubscriptionDto = {
  id: B2B_IDS.subscription,
  url: 'https://erp.example.com/packio/webhooks',
  eventTypes: ['order.placed', 'shipment.delivered'],
  status: 'active',
  createdAt: '2026-10-03T15:00:00+07:00',
};

export class CreateWebhookSubscriptionDto {
  @ApiProperty({ example: 'https://erp.example.com/packio/webhooks', description: 'HTTPS only' })
  @IsString()
  @MaxLength(2000)
  @Matches(/^https:\/\/[^\s/$.?#][^\s]*$/)
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, enumName: 'WebhookEventType', isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  eventTypes!: WebhookEventType[];
}

export class WebhookDeliveryDto {
  @ApiProperty({ format: 'uuid', example: B2B_IDS.delivery, description: 'Sent as `Packio-Delivery`' })
  id!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, enumName: 'WebhookEventType', example: 'order.placed' })
  eventType!: WebhookEventType;

  @ApiProperty({
    enum: ['pending', 'delivered', 'failed'],
    enumName: 'WebhookDeliveryStatus',
    example: 'delivered',
  })
  status!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  attempts!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Back-off after a failure: 1, 5, 30 min, 2 h, 12 h, then `failed`',
  })
  nextAttemptAt!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 200 })
  lastStatusCode!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  lastError!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-03T15:00:05+07:00' })
  deliveredAt!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      event: { id: B2B_IDS.event, type: 'order.placed', occurredAt: '2026-10-03T15:00:00+07:00' },
      data: { orderGroupId: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001', groupCode: 'PK-2610-0001' },
    },
    description: 'The body sent: ids, codes and statuses only',
  })
  body!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T15:00:00+07:00' })
  createdAt!: string;
}

export const DELIVERY_EXAMPLE: WebhookDeliveryDto = {
  id: B2B_IDS.delivery,
  eventType: 'order.placed',
  status: 'delivered',
  attempts: 1,
  nextAttemptAt: null,
  lastStatusCode: 200,
  lastError: null,
  deliveredAt: '2026-10-03T15:00:05+07:00',
  body: {
    event: { id: B2B_IDS.event, type: 'order.placed', occurredAt: '2026-10-03T15:00:00+07:00' },
    data: { orderGroupId: '0192f3a0-7c1e-7d2a-9b1f-0000000f1001', groupCode: 'PK-2610-0001' },
  },
  createdAt: '2026-10-03T15:00:00+07:00',
};
