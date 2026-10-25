import { CodeNameRefDto } from '@common/dto/code-name-ref.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export const LAUNCHPAD_IDS = {
  design: '0192f3a0-7c1e-7d2a-9b1f-0000000e7301',
  product: '0192f3a0-7c1e-7d2a-9b1f-0000000e7302',
  order: '0192f3a0-7c1e-7d2a-9b1f-0000000e7303',
  group: '0192f3a0-7c1e-7d2a-9b1f-0000000e7304',
  suggestion: '0192f3a0-7c1e-7d2a-9b1f-0000000e7305',
  productType: '0192f3a0-7c1e-7d2a-9b1f-0000000e7306',
  address: '0192f3a0-7c1e-7d2a-9b1f-0000000e7307',
  taxProfile: '0192f3a0-7c1e-7d2a-9b1f-0000000e7308',
  company: '0192f3a0-7c1e-7d2a-9b1f-0000000e7309',
  material: '0192f3a0-7c1e-7d2a-9b1f-0000000e730a',
  printType: '0192f3a0-7c1e-7d2a-9b1f-0000000e730b',
  file: '0192f3a0-7c1e-7d2a-9b1f-0000000e730c',
  branch: '0192f3a0-7c1e-7d2a-9b1f-0000000e730d',
} as const;

/** D-297 what the customer is asked to do, in the order the launchpad recommends it. */
export const LAUNCHPAD_ACTIONS = ['pay', 'approve_proof', 'upload_artwork', 'confirm_receipt'] as const;
export type LaunchpadAction = (typeof LAUNCHPAD_ACTIONS)[number];
export const NEXT_STEP_KINDS = [
  ...LAUNCHPAD_ACTIONS,
  'reorder',
  'resume_design',
  'start_configuration',
] as const;
export type NextStepKind = (typeof NEXT_STEP_KINDS)[number];
export const LAUNCHPAD_TARGETS = [
  'order',
  'order_group',
  'reorder_suggestion',
  'order_reorder',
  'design',
] as const;

export class LaunchpadDesignDto {
  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.design })
  id!: string;

  @ApiProperty({ example: 'กล่องขนมไหว้พระจันทร์' })
  title!: string;

  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.product })
  catalogProductId!: string;

  @ApiProperty({ example: 'กล่องพับ' })
  catalogProductNameTh!: string;

  @ApiProperty({ example: 'Folding carton' })
  catalogProductNameEn!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: LAUNCHPAD_IDS.file,
    description: 'Preview image (`store.files.get`)',
  })
  thumbnailFileId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://files.example.invalid/thumb.png?sig=…',
    description:
      'Signed URL of the preview image (5 minutes), ready for an `<img>`; null without a preview (show the ' +
      'product placeholder)',
  })
  thumbnailUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The order the current version is locked by (D-276)',
  })
  lockedByOrderCode!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T16:20:00+07:00' })
  updatedAt!: string;
}

export class ReorderCandidateDto {
  @ApiProperty({
    enum: ['suggestion', 'past_order'],
    enumName: 'ReorderCandidateSource',
    example: 'suggestion',
    description:
      '`suggestion` — a D-288 reorder suggestion; `past_order` — a delivered order that can be reordered',
  })
  source!: 'suggestion' | 'past_order';

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: LAUNCHPAD_IDS.suggestion })
  suggestionId!: string | null;

  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.order, description: 'The order to reorder' })
  orderId!: string;

  @ApiProperty({ example: 'PK-2610-0001-01' })
  orderCode!: string;

  @ApiProperty({ type: CodeNameRefDto })
  productType!: CodeNameRefDto;

  @ApiProperty({ type: 'integer', example: 1000, description: 'Quantity of that order' })
  quantity!: number;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-10-15' })
  suggestedOn!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1500 })
  suggestedQuantity!: number | null;

  @ApiProperty({ example: true, description: 'A suggestion whose date has come' })
  due!: boolean;
}

export class LaunchpadActionItemDto {
  @ApiProperty({ enum: LAUNCHPAD_ACTIONS, enumName: 'LaunchpadAction', example: 'approve_proof' })
  action!: LaunchpadAction;

  @ApiProperty({ enum: ['order', 'order_group'], enumName: 'LaunchpadActionSubject', example: 'order' })
  subject!: 'order' | 'order_group';

  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.order })
  id!: string;

  @ApiProperty({ example: 'PK-2610-0003-01', description: 'Order code, or group code for `pay`' })
  code!: string;

  @ApiProperty({ type: CodeNameRefDto, nullable: true, description: 'Null for an order group' })
  productType!: CodeNameRefDto | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      '`pay`: the payment deadline of the unpaid group (D-060; never an automatic cancellation, D-436); ' +
      '`confirm_receipt`: auto-completion is not shown here',
  })
  dueAt!: string | null;

  @ApiProperty({
    example: false,
    description:
      '`pay` past its deadline (D-436): show "เลยกำหนดชำระ" and "ตรวจราคาใหม่และชำระ" (`store.orders.requoteGroup`)',
  })
  overdue!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '12500.00', description: '`pay`: the amount to pay' })
  amount!: string | null;
}

export class NextStepDto {
  @ApiProperty({ enum: NEXT_STEP_KINDS, enumName: 'LaunchpadNextStep', example: 'approve_proof' })
  kind!: NextStepKind;

  @ApiProperty({
    enum: LAUNCHPAD_TARGETS,
    enumName: 'LaunchpadTarget',
    nullable: true,
    example: 'order',
    description: 'What the step opens; null for `start_configuration`',
  })
  target!: (typeof LAUNCHPAD_TARGETS)[number] | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: LAUNCHPAD_IDS.order })
  targetId!: string | null;
}

export class LaunchpadDto {
  @ApiProperty({ type: [LaunchpadDesignDto], description: 'Up to 5, latest change first' })
  designs!: LaunchpadDesignDto[];

  @ApiProperty({
    type: [ReorderCandidateDto],
    description: 'Up to 5: suggestions soonest first, then past orders',
  })
  reorderCandidates!: ReorderCandidateDto[];

  @ApiProperty({
    type: [LaunchpadActionItemDto],
    description: 'Everything waiting for me, in recommendation order',
  })
  needsAction!: LaunchpadActionItemDto[];

  @ApiProperty({ type: NextStepDto })
  nextStep!: NextStepDto;
}

export const LAUNCHPAD_EXAMPLE: LaunchpadDto = {
  designs: [
    {
      id: LAUNCHPAD_IDS.design,
      title: 'กล่องขนมไหว้พระจันทร์',
      catalogProductId: LAUNCHPAD_IDS.product,
      catalogProductNameTh: 'กล่องพับ',
      catalogProductNameEn: 'Folding carton',
      thumbnailFileId: LAUNCHPAD_IDS.file,
      thumbnailUrl: 'https://files.example.invalid/thumb.png?sig=…',
      lockedByOrderCode: null,
      updatedAt: '2026-10-03T16:20:00+07:00',
    },
  ],
  reorderCandidates: [
    {
      source: 'suggestion',
      suggestionId: LAUNCHPAD_IDS.suggestion,
      orderId: LAUNCHPAD_IDS.order,
      orderCode: 'PK-2610-0001-01',
      productType: {
        id: LAUNCHPAD_IDS.productType,
        code: 'folding',
        nameTh: 'กล่องพับ',
        nameEn: 'Folding carton',
      },
      quantity: 1000,
      suggestedOn: '2026-10-15',
      suggestedQuantity: 1500,
      due: false,
    },
  ],
  needsAction: [
    {
      action: 'approve_proof',
      subject: 'order',
      id: LAUNCHPAD_IDS.order,
      code: 'PK-2610-0003-01',
      productType: {
        id: LAUNCHPAD_IDS.productType,
        code: 'folding',
        nameTh: 'กล่องพับ',
        nameEn: 'Folding carton',
      },
      dueAt: null,
      amount: null,
      overdue: false,
    },
  ],
  nextStep: { kind: 'approve_proof', target: 'order', targetId: LAUNCHPAD_IDS.order },
};

// --- defaults (D-298) ------------------------------------------------------------------------------------------

export class DefaultsQuery {
  @ApiPropertyOptional({
    example: 'folding,corrugate',
    description: 'Product type codes (comma-separated); all types I have quoted when absent',
  })
  @IsOptional()
  @Matches(/^[a-z0-9_]{1,40}(,[a-z0-9_]{1,40}){0,19}$/)
  productTypes?: string;
}

export class DefaultAddressDto {
  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.address })
  id!: string;

  @ApiProperty({ enum: ['default', 'last_used'], enumName: 'DefaultAddressBasis', example: 'default' })
  basis!: 'default' | 'last_used';
}

export class DefaultTaxProfileDto {
  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.taxProfile })
  id!: string;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name!: string;

  @ApiProperty({ example: '0000000000019' })
  taxId!: string;

  @ApiProperty({ example: '00000', description: 'Head office `00000` or the branch number' })
  branchCode!: string;
}

export class CompanyDefaultsDto {
  @ApiProperty({ format: 'uuid', example: LAUNCHPAD_IDS.company })
  id!: string;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  legalName!: string;

  @ApiProperty({ example: '0000000000019' })
  taxId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: LAUNCHPAD_IDS.branch,
    description: 'The branch the tax invoice names by default (D-125)',
  })
  defaultBranchId!: string | null;

  @ApiProperty({ example: false, description: 'The company withholds tax on payments (P03)' })
  withholdsTax!: boolean;

  @ApiProperty({ example: true, description: 'I may place orders for it (`company_orders.place`)' })
  mayOrder!: boolean;

  @ApiProperty({ example: true, description: 'It has an active brand kit (U4)' })
  hasBrandKit!: boolean;
}

export class ProductTypeDefaultsDto {
  @ApiProperty({ example: 'folding' })
  productTypeCode!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: LAUNCHPAD_IDS.material })
  materialId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: LAUNCHPAD_IDS.printType })
  printTypeId!: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-28T10:00:00+07:00',
    description: 'When that quotation was made',
  })
  quotedAt!: string;
}

export class DefaultsDto {
  @ApiProperty({ type: DefaultAddressDto, nullable: true })
  deliveryAddress!: DefaultAddressDto | null;

  @ApiProperty({ type: DefaultTaxProfileDto, nullable: true })
  taxProfile!: DefaultTaxProfileDto | null;

  @ApiProperty({ type: [CompanyDefaultsDto] })
  companies!: CompanyDefaultsDto[];

  @ApiProperty({ type: [ProductTypeDefaultsDto], description: 'Only types I have a quotation of' })
  productTypes!: ProductTypeDefaultsDto[];
}

export const DEFAULTS_EXAMPLE: DefaultsDto = {
  deliveryAddress: { id: LAUNCHPAD_IDS.address, basis: 'default' },
  taxProfile: {
    id: LAUNCHPAD_IDS.taxProfile,
    name: 'บริษัท ตัวอย่าง จำกัด',
    taxId: '0000000000019',
    branchCode: '00000',
  },
  companies: [
    {
      id: LAUNCHPAD_IDS.company,
      legalName: 'บริษัท ตัวอย่าง จำกัด',
      taxId: '0000000000019',
      defaultBranchId: LAUNCHPAD_IDS.branch,
      withholdsTax: false,
      mayOrder: true,
      hasBrandKit: true,
    },
  ],
  productTypes: [
    {
      productTypeCode: 'folding',
      materialId: LAUNCHPAD_IDS.material,
      printTypeId: LAUNCHPAD_IDS.printType,
      quotedAt: '2026-09-28T10:00:00+07:00',
    },
  ],
};
