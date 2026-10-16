import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import {
  CatalogExportDto,
  ConfirmImportDto,
  IMPORT_FILE_ID,
  ImportFileDto,
  PREVIEW_SHA,
} from '@modules/catalog/imports/imports.dto';
import { ReasonBodyDto } from '@modules/partners/factories/factories.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  CARD_EXAMPLE,
  CreateCustomerRateVersionDto,
  CustomerRateCardDto,
  CustomerRateVersionDto,
  CustomerRateVersionSummaryDto,
  DRAFT_EXAMPLE,
  PREVIEW_EXAMPLE,
  RATE_INPUT_EXAMPLE,
  RATE_QUOTE_EXAMPLE,
  RateImportPreviewDto,
  ReplaceCustomerRatesDto,
  ShippingRateQuoteDto,
  ShippingRateQuoteRequestDto,
  VERSION_EXAMPLE,
  VERSION_SUMMARY_EXAMPLE,
} from './customer-rates.dto';
import { CustomerRatesService } from './customer-rates.service';
import { ShippingRatesResolver } from './shipping-rates.resolver';

const DECISIONS = ['D-013', 'D-063'];
const EXPORT_EXAMPLE = {
  fileId: '0192f3a0-7c1e-7d2a-9b1f-00000000f002',
  url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
  rows: 12,
  expiresAt: '2026-10-01T10:05:00+07:00',
};

@ApiSurface('admin', 'customerShippingRates')
@Controller('shipping/customer-rate-card')
export class CustomerShippingRatesController {
  constructor(
    private readonly service: CustomerRatesService,
    private readonly resolver: ShippingRatesResolver,
  ) {}

  @Get()
  @Can('shipping_rates.read')
  @ApiEndpoint({
    id: 'admin.customerShippingRates.get',
    summary: 'Get the customer shipping rate card',
    description:
      'The version in force, the next scheduled version and the drafts / versions in approval of the ' +
      'customer rate card (D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Card', type: CustomerRateCardDto, example: CARD_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  card(): Promise<CustomerRateCardDto> {
    return this.service.card();
  }

  @Get('versions')
  @Can('shipping_rates.read')
  @ApiEndpoint({
    id: 'admin.customerShippingRates.listVersions',
    summary: 'List the versions of the customer rate card',
    description: 'Every version, newest first, without its rates (effective-dated, ADR-0005, D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Versions',
    type: [CustomerRateVersionSummaryDto],
    example: [VERSION_SUMMARY_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found')
  versions(): Promise<CustomerRateVersionSummaryDto[]> {
    return this.service.versions();
  }

  @Get('versions/:versionId')
  @Can('shipping_rates.read')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.getVersion',
    summary: 'Get a customer rate-card version with its rates',
    description: 'All rates of the version: zone or postcode × weight / volume band, VAT-exclusive (D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Version', type: CustomerRateVersionDto, example: VERSION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  version(@Param('versionId', ParseUUIDPipe) versionId: string): Promise<CustomerRateVersionDto> {
    return this.service.version(versionId);
  }

  @Post('versions')
  @Can('shipping_rates.manage')
  @ApiEndpoint({
    id: 'admin.customerShippingRates.createVersion',
    summary: 'Draft a new version of the customer rate card',
    description:
      'A complete set of rates (copy-on-write): given, copied from another version, or empty to import ' +
      'from Excel. Bands are half-open and may not overlap within a zone or postcode; a postcode row ' +
      'overrides its zone. Not back-dated (ADR-0005, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateCustomerRateVersionDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-10-15T00:00:00+07:00',
          reason: 'Q4 rates (fake)',
          rates: [RATE_INPUT_EXAMPLE],
        },
      },
      copy: {
        value: {
          effectiveFrom: '2026-10-15T00:00:00+07:00',
          reason: 'Q4 rates (fake)',
          copyFromVersionId: VERSION_EXAMPLE.id,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Draft', type: CustomerRateVersionDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'partners.backdated',
  )
  createVersion(
    @CurrentActor() actor: Actor,
    @Body() body: CreateCustomerRateVersionDto,
  ): Promise<CustomerRateVersionDto> {
    return this.service.createVersion(actor as UserActor, body);
  }

  @Put('versions/:versionId/rates')
  @Can('shipping_rates.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.replaceRates',
    summary: 'Replace the rates of a draft',
    description:
      'Only the author edits a draft; submitted and decided versions are frozen (ADR-0005, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ReplaceCustomerRatesDto,
    examples: { default: { value: { rates: [RATE_INPUT_EXAMPLE] } } },
  })
  @ApiSuccess(200, { description: 'Draft', type: CustomerRateVersionDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_draft',
  )
  replaceRates(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: ReplaceCustomerRatesDto,
  ): Promise<CustomerRateVersionDto> {
    return this.service.replaceRates(actor as UserActor, versionId, body.rates);
  }

  @Delete('versions/:versionId')
  @HttpCode(204)
  @Can('shipping_rates.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.deleteDraft',
    summary: 'Delete a draft',
    description: 'Drafts only, by their author; decided versions are kept forever (ADR-0005, D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'shipping.version_not_draft')
  async deleteDraft(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<void> {
    await this.service.deleteDraft(actor as UserActor, versionId);
  }

  @Post('versions/:versionId/actions/submit')
  @HttpCode(200)
  @Can('shipping_rates.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.submitVersion',
    summary: 'Submit a draft for C-Level approval',
    description:
      'The version becomes `proposed` with an approval request (policy `customer_shipping_rate_change`, one ' +
      'C-Level step, chosen at B2.4 planning); on approval it applies from its effective date, or from the ' +
      'decision when that date has passed. One version in approval at a time (D-013, D-063).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'In approval',
    type: CustomerRateVersionDto,
    example: { ...VERSION_EXAMPLE, status: 'proposed', decidedAt: null },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'shipping.version_not_draft',
    'shipping.rates_empty',
    'partners.version_pending',
  )
  submit(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<CustomerRateVersionDto> {
    return this.service.submit(actor as UserActor, versionId);
  }

  @Post('versions/:versionId/actions/withdraw')
  @HttpCode(200)
  @Can('shipping_rates.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.withdrawVersion',
    summary: 'Withdraw a version in approval',
    description: 'The requester withdraws the version and its approval request together (ADR-0006, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ReasonBodyDto,
    examples: { default: { value: { reason: 'Rates need another review (fake)' } } },
  })
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: CustomerRateVersionDto,
    example: { ...VERSION_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_proposed',
    'approval.not_authorised',
  )
  withdraw(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: ReasonBodyDto,
  ): Promise<CustomerRateVersionDto> {
    return this.service.withdraw(actor as UserActor, versionId, body.reason);
  }

  @Post('versions/:versionId/actions/import-preview')
  @HttpCode(200)
  @Can('shipping_rates.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.previewImport',
    summary: 'Preview an Excel file of rates for a draft',
    description:
      'Dry run of an uploaded `.xlsx` (sheet `rates`: zone_code, postcode, weight_min_g, weight_max_g, ' +
      'volume_min_cm3, volume_max_cm3, price_amount, per_extra_kg). Returns row errors and `previewSha256` ' +
      'to confirm exactly this plan (A-14, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ImportFileDto, examples: { default: { value: { fileId: IMPORT_FILE_ID } } } })
  @ApiSuccess(200, { description: 'Preview', type: RateImportPreviewDto, example: PREVIEW_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_draft',
    'file.not_ready',
    'file.infected',
    'catalog.import_unreadable',
    'catalog.import_too_large',
  )
  previewImport(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: ImportFileDto,
  ): Promise<RateImportPreviewDto> {
    return this.service.importPreview(actor as UserActor, versionId, body.fileId);
  }

  @Post('versions/:versionId/actions/import-confirm')
  @HttpCode(200)
  @Can('shipping_rates.manage')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.confirmImport',
    summary: 'Replace a draft’s rates with a previewed Excel file',
    description:
      'Re-reads the file and writes the rates only when the plan still matches `previewSha256` and has no ' +
      'errors (A-14, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ConfirmImportDto,
    examples: { default: { value: { fileId: IMPORT_FILE_ID, previewSha256: PREVIEW_SHA } } },
  })
  @ApiSuccess(200, { description: 'Draft', type: CustomerRateVersionDto, example: DRAFT_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'shipping.version_not_draft',
    'file.not_ready',
    'file.infected',
    'catalog.import_unreadable',
    'catalog.import_too_large',
    'catalog.import_stale',
    'catalog.import_invalid',
  )
  confirmImport(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: ConfirmImportDto,
  ): Promise<CustomerRateVersionDto> {
    return this.service.importConfirm(actor as UserActor, versionId, body.fileId, body.previewSha256);
  }

  @Post('versions/:versionId/actions/export')
  @HttpCode(200)
  @Can('shipping_rates.read')
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.customerShippingRates.exportVersion',
    summary: 'Export a version’s rates to Excel',
    description:
      'The same layout the import reads; a short-lived signed download URL (audited export, D-013).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'File', type: CatalogExportDto, example: EXPORT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async export(
    @CurrentActor() actor: Actor,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<CatalogExportDto> {
    const file = await this.service.export(actor as UserActor, versionId);
    return { ...file, expiresAt: toBangkokIso(file.expiresAt) };
  }

  @Post('actions/quote')
  @HttpCode(200)
  @Can('shipping_rates.read')
  @ApiEndpoint({
    id: 'admin.customerShippingRates.quote',
    summary: 'Price a parcel on the customer rate card',
    description:
      'Resolves the version in force at `at`, the zone of the postcode and the matching band; the amount ' +
      'is VAT-exclusive (VAT is added on the quote line, D-013).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ShippingRateQuoteRequestDto,
    examples: { default: { value: { postcode: '10110', weightG: 3200, volumeCm3: 48000 } } },
  })
  @ApiSuccess(200, { description: 'Rate', type: ShippingRateQuoteDto, example: RATE_QUOTE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async quote(@Body() body: ShippingRateQuoteRequestDto): Promise<ShippingRateQuoteDto> {
    const rate = await this.resolver.customerRate(
      body.postcode,
      { weightG: body.weightG, volumeCm3: body.volumeCm3 ?? null },
      body.at ? new Date(body.at) : new Date(),
    );
    return rate.priced
      ? {
          priced: true,
          reason: null,
          versionId: rate.versionPublicId,
          zoneCode: rate.zoneCode,
          netAmount: rate.net.toFixed(2),
          currency: 'THB',
        }
      : {
          priced: false,
          reason: rate.reason,
          versionId: rate.versionPublicId,
          zoneCode: null,
          netAmount: null,
          currency: 'THB',
        };
  }
}
