import { Public } from '@common/auth/auth.decorators';
import { LABELLED_ENUMS, STATUS_LABELS, type StatusLabel } from '@common/labels/status-labels';
import { STORE_VALUE_ALIASES } from '@common/labels/store-words';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';

export class StatusLabelValueDto {
  @ApiProperty({ example: 'pending_customer', description: 'The enum value, as every response carries it' })
  value!: string;

  @ApiProperty({
    example: 'รอคุณตรวจแบบตัวอย่าง',
    description: 'Customer words (glossary; never a factory, D-050)',
  })
  labelTh!: string;

  @ApiProperty({
    example: 'รอคุณตรวจแบบตัวอย่าง',
    description:
      'Back-office and factory words ("Proof") on `admin.statusLabels.list`; on the store the customer words ' +
      '(same as `labelTh`, D-440)',
  })
  labelAdminTh!: string;

  @ApiProperty({ example: 'Awaiting customer' })
  labelEn!: string;
}

export class StatusLabelEnumDto {
  @ApiProperty({ example: 'ProofStatus', description: 'The OpenAPI enum component the values belong to' })
  enumName!: string;

  @ApiProperty({ type: [StatusLabelValueDto] })
  values!: StatusLabelValueDto[];
}

/** The dictionary, built once: it changes only with a release. */
export const STATUS_LABEL_DICTIONARY: StatusLabelEnumDto[] = LABELLED_ENUMS.map((enumName) => ({
  enumName,
  values: Object.entries(STATUS_LABELS[enumName] as Record<string, StatusLabel>).map(([value, l]) => ({
    value,
    labelTh: l.th,
    labelAdminTh: l.adminTh,
    labelEn: l.en,
  })),
}));

/**
 * The storefront's dictionary (D-440): customer words only (`labelAdminTh` = `labelTh`) and no value a store response
 * never carries (the factory-named values have a store alias, `store-words.ts`).
 */
export const STORE_STATUS_LABEL_DICTIONARY: StatusLabelEnumDto[] = STATUS_LABEL_DICTIONARY.map((e) => ({
  enumName: e.enumName,
  values: e.values
    .filter((v) => !(v.value in STORE_VALUE_ALIASES))
    .map((v) => ({ ...v, labelAdminTh: v.labelTh })),
}));

/** `/v1/store/status-labels`: every labelled status in the customer's words (D-313, D-440). */
@ApiTags('store.catalog')
@Controller('status-labels')
export class StoreStatusLabelsController {
  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEtag()
  @ApiEndpoint({
    id: 'store.statusLabels.list',
    summary: 'List the words for every status',
    description:
      'For each labelled status enum (order, customer order status, order group, payment, instalment, slip, refund, ' +
      'artwork, submission, Proof, preflight, production job, milestone, shipment, claim, quotation, RFQ, RFQ ' +
      'quotation, sample, design service and round) its values with the customer’s words (`labelTh`: ' +
      '"ตรวจแบบก่อนพิมพ์" / "แบบตัวอย่าง", never a factory — D-050) and English. `labelAdminTh` repeats the customer ' +
      'words here (D-440; staff words: `admin.statusLabels.list`), and values only staff see (`factory_review`) are ' +
      'left out. The same words are on every response next to the status (`statusLabelTh`, `statusLabelAdminTh`); ' +
      'enum values never change (D-313). Anonymous, cacheable 5 minutes; a matching `If-None-Match` gets 304.',
    implements: ['D-313', 'D-050', 'D-440'],
  })
  @ApiSuccess(200, {
    description: 'Status words per enum',
    type: [StatusLabelEnumDto],
    example: STORE_STATUS_LABEL_DICTIONARY.filter((e) => e.enumName === 'ProofStatus'),
  })
  @ApiStandardErrors()
  list(): StatusLabelEnumDto[] {
    return STORE_STATUS_LABEL_DICTIONARY;
  }
}

/** `/v1/admin/status-labels`: the same dictionary with the back office's and factories' words (D-313, D-440). */
@ApiSurface('admin', 'statusLabels')
@Controller('status-labels')
export class AdminStatusLabelsController {
  @Get()
  @Header('Cache-Control', 'private, max-age=300')
  @ApiEtag()
  @ApiEndpoint({
    id: 'admin.statusLabels.list',
    summary: 'List the words for every status (staff)',
    description:
      'Every labelled status enum with every value: the customer’s words (`labelTh`), the back office’s and ' +
      'factories’ words (`labelAdminTh`: "Proof", factory steps) and English (D-313). The storefront’s copy ' +
      '(`store.statusLabels.list`) carries customer words only (D-440).',
    implements: ['D-313', 'D-440'],
  })
  @ApiSuccess(200, {
    description: 'Status words per enum',
    type: [StatusLabelEnumDto],
    example: STATUS_LABEL_DICTIONARY.filter((e) => e.enumName === 'ProofStatus'),
  })
  @ApiStandardErrors()
  list(): StatusLabelEnumDto[] {
    return STATUS_LABEL_DICTIONARY;
  }
}
