import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { AddCompanyAssetDto, COMPANY_ASSET_EXAMPLE, CompanyAssetDto } from './brand-assets.dto';
import { BrandAssetsService } from './brand-assets.service';

const companyParam = ApiParam({ name: 'companyId', format: 'uuid' });

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'companyAssets')
@Controller('companies/:companyId')
export class StoreCompanyAssetsController {
  constructor(private readonly assets: BrandAssetsService) {}

  @Get('brand-assets')
  @companyParam
  @ApiEndpoint({
    id: 'store.companyAssets.list',
    summary: 'List my company’s brand assets',
    description: 'Every member: the logos, guidelines, fonts and approved artwork of the company, with signed URLs (D-227).',
    implements: ['D-227'],
  })
  @ApiSuccess(200, { description: 'Brand assets', type: [CompanyAssetDto], example: [COMPANY_ASSET_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('companyId', ParseUUIDPipe) id: string): Promise<CompanyAssetDto[]> {
    return this.assets.list(customer(actor), id);
  }

  @Post('brand-assets')
  @Idempotent({ optional: true })
  @companyParam
  @ApiEndpoint({
    id: 'store.companyAssets.add',
    summary: 'Add a brand asset',
    description:
      'Company Admin: a file uploaded for the company (presign with `companyId`) or by me, scanned clean; audited ' +
      '(D-227). 409 `companies.asset_exists` when the file is in the library already.',
    implements: ['D-227'],
  })
  @ApiBody({
    type: AddCompanyAssetDto,
    examples: { default: { value: { fileId: COMPANY_ASSET_EXAMPLE.fileId, kind: 'logo', name: 'โลโก้หลัก' } } },
  })
  @ApiSuccess(201, { description: 'Added', type: CompanyAssetDto, example: COMPANY_ASSET_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.file_not_usable',
    'companies.asset_exists',
  )
  add(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: AddCompanyAssetDto,
  ): Promise<CompanyAssetDto> {
    return this.assets.add(customer(actor), id, body);
  }

  @Delete('brand-assets/:assetId')
  @HttpCode(204)
  @companyParam
  @ApiParam({ name: 'assetId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.companyAssets.remove',
    summary: 'Remove a brand asset',
    description: 'Company Admin; the file itself is kept (D-227). Audited.',
    implements: ['D-227'],
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<void> {
    await this.assets.remove(customer(actor), id, assetId);
  }
}
