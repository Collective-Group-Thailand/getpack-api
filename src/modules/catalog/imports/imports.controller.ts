import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { staffActor } from '../crud/catalog-crud.controller';
import { IMPORT_KIND_KEYS, IMPORT_KINDS } from './import-kinds';
import {
  CatalogExportDto,
  ConfirmImportDto,
  IMPORT_FILE_ID,
  ImportFileDto,
  ImportKindDto,
  ImportPreviewDto,
  PREVIEW_SHA,
} from './imports.dto';
import { CatalogImportsService } from './imports.service';

const kindParam = ApiParam({
  name: 'kind',
  enum: IMPORT_KIND_KEYS,
  enumName: 'CatalogImportKind',
  description: 'Which table(s) the workbook holds',
});

const PREVIEW_EXAMPLE: ImportPreviewDto = {
  kind: 'geography',
  fileId: IMPORT_FILE_ID,
  previewSha256: PREVIEW_SHA,
  canConfirm: false,
  totals: { create: 120, update: 8, unchanged: 7_280, invalid: 1 },
  sheets: [
    { name: 'provinces', create: 0, update: 0, unchanged: 77, invalid: 0 },
    { name: 'districts', create: 0, update: 1, unchanged: 927, invalid: 0 },
    { name: 'subdistricts', create: 120, update: 7, unchanged: 6_276, invalid: 1 },
  ],
  errors: [
    {
      sheet: 'subdistricts',
      row: 17,
      column: 'postcode',
      code: 'pattern',
      message: 'postcode has an invalid format',
    },
  ],
  errorsTruncated: false,
};

const FILE_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'file.not_ready',
  'file.infected',
  'catalog.import_unreadable',
  'catalog.import_too_large',
] as const;

@ApiSurface('admin', 'catalogImports')
@Controller('catalog')
export class CatalogImportsController {
  constructor(private readonly imports: CatalogImportsService) {}

  @Get('imports')
  @Can('catalog.import')
  @ApiEndpoint({
    id: 'admin.catalogImports.listKinds',
    summary: 'List the Excel import kinds and their columns',
    description:
      'Each kind is a workbook with one sheet per table (row 1 = headers). References use natural keys ' +
      '(codes, slugs, SKUs) — never internal ids. Export a kind to get a filled template.',
    implements: ['D-005', 'D-170'],
  })
  @ApiSuccess(200, {
    description: 'Import kinds',
    type: [ImportKindDto],
    example: [
      {
        kind: 'geography',
        label: 'Provinces, districts and subdistricts with postcodes',
        sheets: [
          {
            name: 'subdistricts',
            key: ['code'],
            columns: [{ header: 'postcode', type: 'text', required: true, values: null }],
          },
        ],
      },
    ],
  })
  @ApiStandardErrors('validation.failed')
  listKinds(): ImportKindDto[] {
    return IMPORT_KINDS.map((kind) => ({
      kind: kind.key,
      label: kind.label,
      sheets: kind.sheets.map((sheet) => ({
        name: sheet.name,
        key: sheet.key,
        columns: sheet.columns.map((c) => ({
          header: c.header,
          type: c.type,
          required: c.required ?? false,
          values: c.values ? [...c.values] : null,
        })),
      })),
    }));
  }

  @Post('imports/:kind/actions/preview')
  @HttpCode(200)
  @Can('catalog.import')
  @kindParam
  @ApiEndpoint({
    id: 'admin.catalogImports.preview',
    summary: 'Preview an Excel import (dry run)',
    description:
      'Parses and validates the workbook and compares it with the database: counts of rows to create, ' +
      'update or leave unchanged, and row-level errors. Nothing is written. Geography also needs ' +
      '`geography.manage` (D-161, D-170).',
    implements: ['D-005', 'D-170', 'D-161'],
  })
  @ApiBody({ type: ImportFileDto, examples: { default: { value: { fileId: IMPORT_FILE_ID } } } })
  @ApiSuccess(200, { description: 'The plan', type: ImportPreviewDto, example: PREVIEW_EXAMPLE })
  @ApiStandardErrors(...FILE_ERRORS)
  preview(
    @CurrentActor() actor: Actor,
    @Param('kind') kind: string,
    @Body() body: ImportFileDto,
  ): Promise<ImportPreviewDto> {
    return this.imports.preview(staffActor(actor), kind, body.fileId);
  }

  @Post('imports/:kind/actions/confirm')
  @HttpCode(200)
  @Idempotent()
  @Can('catalog.import')
  @kindParam
  @ApiEndpoint({
    id: 'admin.catalogImports.confirm',
    summary: 'Confirm a previewed Excel import',
    description:
      'Re-plans the same file inside one transaction and writes it only if the plan is exactly the one ' +
      'previewed (`previewSha256`) and has no invalid rows; otherwise 409 `catalog.import_stale` or 422 ' +
      '`catalog.import_invalid`. Audited and published as `catalog.import_applied`.',
    implements: ['D-005', 'D-170', 'D-161'],
  })
  @ApiBody({
    type: ConfirmImportDto,
    examples: { default: { value: { fileId: IMPORT_FILE_ID, previewSha256: PREVIEW_SHA } } },
  })
  @ApiSuccess(200, {
    description: 'Imported',
    type: ImportPreviewDto,
    example: {
      ...PREVIEW_EXAMPLE,
      canConfirm: true,
      totals: { ...PREVIEW_EXAMPLE.totals, invalid: 0 },
      errors: [],
    },
  })
  @ApiStandardErrors(...FILE_ERRORS, 'catalog.import_stale', 'catalog.import_invalid')
  confirm(
    @CurrentActor() actor: Actor,
    @Param('kind') kind: string,
    @Body() body: ConfirmImportDto,
  ): Promise<ImportPreviewDto> {
    return this.imports.confirm(staffActor(actor), kind, body.fileId, body.previewSha256);
  }

  @Post('exports/:kind')
  @HttpCode(200)
  @Can('catalog.import')
  @kindParam
  @ApiEndpoint({
    id: 'admin.catalogImports.export',
    summary: 'Export a catalogue table to Excel',
    description:
      'Current rows in the import layout (an empty table gives the template), served by a 5-minute ' +
      'signed URL. The export is audited (`catalog.exported`).',
    implements: ['D-005', 'D-170'],
  })
  @ApiSuccess(200, {
    description: 'Export ready',
    type: CatalogExportDto,
    example: {
      fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f002',
      url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
      rows: 7_408,
      expiresAt: '2026-09-25T10:05:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async export(@CurrentActor() actor: Actor, @Param('kind') kind: string): Promise<CatalogExportDto> {
    const result = await this.imports.export(staffActor(actor), kind);
    return { ...result, expiresAt: toBangkokIso(result.expiresAt) };
  }
}
