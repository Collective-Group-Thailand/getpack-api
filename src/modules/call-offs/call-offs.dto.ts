import { CodeNameRefDto } from '@common/dto/code-name-ref.dto';
import { CodedRefDto } from '@common/dto/factory-ref.dto';
import { storeEnum } from '@common/labels/store-words';
import { PageQuery } from '@common/pagination/pagination.dto';
import { OrderRefDto } from '@modules/carts/carts.dto';
import { EnumField, IntField, RefField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty } from '@nestjs/swagger';

export const CALL_OFF_STATUSES = ['pending_factory', 'active', 'declined', 'cancelled', 'expired'] as const;
export const RELEASE_STATUSES = ['quoted', 'ordered', 'lapsed'] as const;

export const CALL_OFF_IDS = {
  agreement: '0192f3a0-7c1e-7d2a-9b1f-0000000e7301',
  release: '0192f3a0-7c1e-7d2a-9b1f-0000000e7302',
  quote: '0192f3a0-7c1e-7d2a-9b1f-0000000e7303',
  option: '0192f3a0-7c1e-7d2a-9b1f-0000000e7304',
  releaseQuote: '0192f3a0-7c1e-7d2a-9b1f-0000000e7305',
  productType: '0192f3a0-7c1e-7d2a-9b1f-0000000e7306',
  factory: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
} as const;

export class CallOffReleaseDto {
  @ApiProperty({ format: 'uuid', example: CALL_OFF_IDS.release })
  id!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  seq!: number;

  @ApiProperty({ type: 'integer', example: 2000 })
  quantity!: number;

  @ApiProperty({
    enum: RELEASE_STATUSES,
    enumName: 'CallOffReleaseStatus',
    example: 'ordered',
    description:
      '`quoted`: its quotation is in the cart; `lapsed`: it expired unordered and its quantity is free',
  })
  status!: (typeof RELEASE_STATUSES)[number];

  @ApiProperty({ format: 'uuid', example: CALL_OFF_IDS.releaseQuote, description: 'The release’s quotation' })
  quoteId!: string;

  @ApiProperty({ type: OrderRefDto, nullable: true })
  order!: OrderRefDto | null;

  @ApiProperty({
    example: true,
    description: 'The first release carries the quotation’s design fees, plates and die blocks once',
  })
  includesOneOffs!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-05T10:00:00+07:00' })
  createdAt!: string;
}

/**
 * D-290 a call-off agreement: a quotation option's unit price locked for its quantity, released in parts — the
 * customer's view. No factory and no buy price: the field does not exist on the storefront (D-050, D-435).
 */
export class StoreCallOffAgreementDto {
  @ApiProperty({ format: 'uuid', example: CALL_OFF_IDS.agreement })
  id!: string;

  @ApiProperty({
    enum: storeEnum(CALL_OFF_STATUSES),
    enumName: 'StoreCallOffStatus',
    example: 'active',
    description: '`pending_confirmation`: waiting for production to confirm the agreement (D-440)',
  })
  status!: string;

  @ApiProperty({ format: 'uuid', example: CALL_OFF_IDS.quote })
  quoteId!: string;

  @ApiProperty({ format: 'uuid', example: CALL_OFF_IDS.option })
  quoteOptionId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'QT-2610-00012' })
  quoteCode!: string | null;

  @ApiProperty({ type: CodeNameRefDto })
  productType!: CodeNameRefDto;

  @ApiProperty({ example: 'piece' })
  unit!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '13.38',
    description: 'The locked unit price, VAT included (product only); null for the factory (D-044)',
  })
  unitPrice!: string | null;

  @ApiProperty({ type: 'integer', example: 10000, description: 'The quotation option’s quantity' })
  committedQuantity!: number;

  @ApiProperty({ type: 'integer', example: 2000, description: 'Quoted or ordered releases' })
  releasedQuantity!: number;

  @ApiProperty({ type: 'integer', example: 8000, description: '0 unless active' })
  remainingQuantity!: number;

  @ApiProperty({ type: 'integer', example: 1000, description: 'The smallest release, fixed when asked' })
  minReleaseQuantity!: number;

  @ApiProperty({ type: 'integer', example: 6 })
  months!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2026-10-04T09:00:00+07:00' })
  startsAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: '2027-04-04T09:00:00+07:00' })
  expiresAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  declineReason!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: null,
    description: 'At expiry: the quantity not released, without charge',
  })
  lapsedQuantity!: number | null;

  @ApiProperty({ type: [CallOffReleaseDto] })
  releases!: CallOffReleaseDto[];

  @ApiProperty({ format: 'date-time', example: '2026-10-03T15:00:00+07:00' })
  createdAt!: string;
}

/** The factory's and staff's view of a call-off agreement: with the factory and its locked buy price (D-044). */
export class CallOffAgreementDto extends StoreCallOffAgreementDto {
  @ApiProperty({ enum: CALL_OFF_STATUSES, enumName: 'CallOffStatus', example: 'active' })
  declare status: string;

  @ApiProperty({
    type: CodedRefDto,
    description: 'The quotation’s factory, which accepts the lock — staff and the factory only (D-050)',
  })
  factory!: CodedRefDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The factory’s locked buy price per unit, net — the factory and staff only (D-044, D-141)',
  })
  buyUnitPrice!: string | null;
}

export const CALL_OFF_EXAMPLE: StoreCallOffAgreementDto = {
  id: CALL_OFF_IDS.agreement,
  status: 'active',
  quoteId: CALL_OFF_IDS.quote,
  quoteOptionId: CALL_OFF_IDS.option,
  quoteCode: 'QT-2610-00012',
  productType: {
    id: CALL_OFF_IDS.productType,
    code: 'folding_carton',
    nameTh: 'กล่องกระดาษพับ',
    nameEn: 'Folding carton',
  },
  unit: 'piece',
  unitPrice: '13.38',
  committedQuantity: 10000,
  releasedQuantity: 2000,
  remainingQuantity: 8000,
  minReleaseQuantity: 1000,
  months: 6,
  startsAt: '2026-10-04T09:00:00+07:00',
  expiresAt: '2027-04-04T09:00:00+07:00',
  declineReason: null,
  lapsedQuantity: null,
  releases: [
    {
      id: CALL_OFF_IDS.release,
      seq: 1,
      quantity: 2000,
      status: 'ordered',
      quoteId: CALL_OFF_IDS.releaseQuote,
      order: { orderId: CALL_OFF_IDS.order, orderCode: 'PK-2610-0001-01' },
      includesOneOffs: true,
      createdAt: '2026-10-05T10:00:00+07:00',
    },
  ],
  createdAt: '2026-10-03T15:00:00+07:00',
};

export const PARTNER_CALL_OFF_EXAMPLE: CallOffAgreementDto = {
  ...CALL_OFF_EXAMPLE,
  factory: { id: CALL_OFF_IDS.factory, code: 'F0001', name: 'โรงพิมพ์ ทดสอบ' },
  unitPrice: null,
  buyUnitPrice: '10.123450',
};

export const PENDING_EXAMPLE: StoreCallOffAgreementDto = {
  ...CALL_OFF_EXAMPLE,
  status: 'pending_factory',
  releasedQuantity: 0,
  remainingQuantity: 0,
  startsAt: null,
  expiresAt: null,
  releases: [],
};

export class RequestCallOffDto {
  @RefField({ example: CALL_OFF_IDS.quote, description: 'A saved instant quotation of mine, still valid' })
  quoteId!: string;

  @RefField({
    example: CALL_OFF_IDS.option,
    description: 'Its option whose unit price and quantity are locked',
  })
  quoteOptionId!: string;

  @IntField({ example: 6, min: 1, max: 60, description: 'At most `calloff.max_months` (D-290)' })
  months!: number;
}

export class ReleaseCallOffDto {
  @IntField({
    example: 2000,
    min: 1,
    max: 10_000_000,
    description: 'At least the factory’s minimum order, at most what is left',
  })
  quantity!: number;
}

export class CallOffQuery extends PageQuery {
  @EnumField(CALL_OFF_STATUSES, 'CallOffStatus', { example: 'active', optional: true })
  status?: (typeof CALL_OFF_STATUSES)[number];
}
