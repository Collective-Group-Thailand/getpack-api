import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { type DocumentType, type SequenceReset } from '@generated/prisma/client';
import { BoolField, EnumField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength } from 'class-validator';

import { DocumentNumberingService } from './document-numbering.service';

export const DOCUMENT_TYPES = [
  'qt',
  'iv',
  'tr',
  'rc',
  'cn',
  'dn',
  'po',
  'gr',
  'bs',
  'pv',
  'wt',
  'jv',
  'order_group',
  'job',
  'claim',
  'shipment',
  'rfq',
  'support_ticket',
] as const;
export const SEQUENCE_RESETS = ['never', 'yearly', 'monthly'] as const;

export class CreateDocumentSeriesDto {
  @EnumField(DOCUMENT_TYPES, 'DocumentType', { example: 'qt' })
  docType!: DocumentType;

  @ApiProperty({ example: 'QT', pattern: '^[A-Z0-9-]{1,10}$' })
  @Matches(/^[A-Z0-9-]{1,10}$/)
  prefix!: string;

  @ApiProperty({
    example: '{prefix}-{yyyy}-{seq:6}',
    description: 'Placeholders `{prefix}`, `{yyyy}`, `{yy}`, `{mm}`, `{seq:N}` (Asia/Bangkok dates)',
  })
  @MaxLength(60)
  @Matches(/\{seq:[1-9]\d?\}/)
  format!: string;

  @EnumField(SEQUENCE_RESETS, 'SequenceReset', { example: 'yearly' })
  resetPeriod!: SequenceReset;

  @BoolField({ example: true, description: 'Statutory documents must be gapless (accounting-design §4)' })
  isGapless!: boolean;

  @TextField({ example: 'Quotations of Collective Group (fake)', max: 300 })
  description!: string;
}

export class DocumentSeriesDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000e501' })
  id!: string;

  @ApiProperty({ example: 'CGT' })
  entityCode!: string;

  @ApiProperty({ enum: DOCUMENT_TYPES, enumName: 'DocumentType', example: 'qt' })
  docType!: string;

  @ApiProperty({ example: 'QT' })
  prefix!: string;

  @ApiProperty({ example: '{prefix}-{yyyy}-{seq:6}' })
  format!: string;

  @ApiProperty({ enum: SEQUENCE_RESETS, enumName: 'SequenceReset', example: 'yearly' })
  resetPeriod!: string;

  @ApiProperty({ example: true })
  isGapless!: boolean;

  @ApiProperty({ example: 'Quotations of Collective Group (fake)' })
  description!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T09:00:00+07:00' })
  createdAt!: string;
}

const EXAMPLE: DocumentSeriesDto = {
  id: '0192f3a0-7c1e-7d2a-9b1f-00000000e501',
  entityCode: 'CGT',
  docType: 'qt',
  prefix: 'QT',
  format: '{prefix}-{yyyy}-{seq:6}',
  resetPeriod: 'yearly',
  isGapless: true,
  description: 'Quotations of Collective Group (fake)',
  createdAt: '2026-10-01T09:00:00+07:00',
};

type Row = Awaited<ReturnType<DocumentNumberingService['list']>>[number];
const dto = (s: Row): DocumentSeriesDto => ({
  id: s.publicId,
  entityCode: s.entity.code,
  docType: s.docType,
  prefix: s.prefix,
  format: s.format,
  resetPeriod: s.resetPeriod,
  isGapless: s.isGapless,
  description: s.description,
  createdAt: toBangkokIso(s.createdAt),
});

@ApiSurface('admin', 'documentSeries')
@Controller('document-series')
export class DocumentSeriesController {
  constructor(private readonly numbering: DocumentNumberingService) {}

  @Get()
  @Can('document_series.read')
  @ApiEndpoint({
    id: 'admin.documentSeries.list',
    summary: 'List document numbering series',
    description: 'One series per entity and document type (schema-design §2.7, accounting-design §4, D-092).',
    implements: ['D-092', 'D-169'],
  })
  @ApiSuccess(200, { description: 'Series', type: [DocumentSeriesDto], example: [EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<DocumentSeriesDto[]> {
    return (await this.numbering.list()).map(dto);
  }

  @Post()
  @Can('document_series.manage')
  @ApiEndpoint({
    id: 'admin.documentSeries.create',
    summary: 'Create a document numbering series',
    description:
      'Formats are not decided (schema-design Q-2): the Finance Manager creates each series once for the ' +
      'default entity (D-169); statutory documents are gapless. Documents that need a number refuse with ' +
      '`numbering.series_missing` until their series exists. Audited.',
    implements: ['D-092', 'D-169'],
  })
  @ApiBody({
    type: CreateDocumentSeriesDto,
    examples: {
      default: {
        value: {
          docType: 'qt',
          prefix: 'QT',
          format: '{prefix}-{yyyy}-{seq:6}',
          resetPeriod: 'yearly',
          isGapless: true,
          description: EXAMPLE.description,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Series', type: DocumentSeriesDto, example: EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'numbering.series_exists',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateDocumentSeriesDto,
  ): Promise<DocumentSeriesDto> {
    return dto(await this.numbering.create(actor as UserActor, body));
  }
}
