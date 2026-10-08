import { Public } from '@common/auth/auth.decorators';
import { LABELLED_ENUMS, STATUS_LABELS, type StatusLabel } from '@common/labels/status-labels';
import { ApiEndpoint, ApiEtag, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
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

  @ApiProperty({ example: 'รอ Proof จากลูกค้า', description: 'Back-office and factory words ("Proof")' })
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

/** `/v1/store/status-labels`: every labelled status in words (D-313). */
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
      'For each labelled status enum (order, order group, payment, instalment, slip, refund, artwork, submission, ' +
      'Proof, preflight, production job, milestone, shipment, claim, quotation, RFQ, RFQ quotation, sample, design ' +
      'service and round) its values with the customer’s words (`labelTh`: "ตรวจแบบก่อนพิมพ์" / "แบบตัวอย่าง", ' +
      'never a factory — D-050), the back office’s and factories’ words (`labelAdminTh`: "Proof") and English. ' +
      'The same words are on every response next to the status (`statusLabelTh`, `statusLabelAdminTh`); enum ' +
      'values never change (D-313). Anonymous, cacheable 5 minutes; a matching `If-None-Match` gets 304.',
    implements: ['D-313', 'D-050'],
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
