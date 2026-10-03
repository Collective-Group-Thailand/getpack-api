import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiParam, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { SpecSheetService } from './spec-sheet.service';

export class SpecSheetQuery {
  @ApiPropertyOptional({ enum: ['th', 'en'], enumName: 'LocaleCode', default: 'th', example: 'th' })
  @IsOptional()
  @IsIn(['th', 'en'])
  lang?: 'th' | 'en';
}

export class SpecSheetDto {
  @ApiProperty({
    example: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
    description: 'Signed URL',
  })
  url!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T14:10:00+07:00' })
  expiresAt!: string;

  @ApiProperty({ example: 'spec-sheet-PK-2610-0001-01-th.pdf' })
  fileName!: string;
}

const EXAMPLE: SpecSheetDto = {
  url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
  expiresAt: '2026-10-03T14:10:00+07:00',
  fileName: 'spec-sheet-PK-2610-0001-01-th.pdf',
};
const DESCRIPTION =
  'The packaging spec sheet (PDF, Thai or English) of an order once its artwork is approved — or its sample approved: ' +
  'sizes on every basis, style code and international name (a reference code only when verified, D-211), material ' +
  'and caliper, print and finishing, tolerances, packing, the approved artwork, a QR to the order. Generated from the ' +
  'order’s frozen data; the same content gives the same file (D-287).';
const orderParam = ApiParam({ name: 'orderId', format: 'uuid' });

async function view(
  service: SpecSheetService,
  actor: Actor,
  orderId: string,
  lang = 'th',
): Promise<SpecSheetDto> {
  const sheet = await service.forActor(actor, orderId, lang === 'en' ? 'en' : 'th');
  return { url: sheet.url, expiresAt: toBangkokIso(sheet.expiresAt), fileName: sheet.fileName };
}

@ApiSurface('store', 'orders')
@Controller('orders')
export class StoreSpecSheetController {
  constructor(private readonly sheets: SpecSheetService) {}

  @Get(':orderId/spec-sheet')
  @orderParam
  @ApiEndpoint({
    id: 'store.orders.getSpecSheet',
    summary: 'My order’s packaging spec sheet',
    description: DESCRIPTION,
    implements: ['D-287', 'D-211'],
  })
  @ApiSuccess(200, { description: 'Spec sheet', type: SpecSheetDto, example: EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'orders.spec_sheet_unavailable')
  get(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() q: SpecSheetQuery,
  ) {
    return view(this.sheets, actor, orderId, q.lang);
  }
}

@ApiSurface('admin', 'orders')
@Controller('orders')
export class AdminSpecSheetController {
  constructor(private readonly sheets: SpecSheetService) {}

  @Get(':orderId/spec-sheet')
  @Can('orders.read')
  @orderParam
  @ApiEndpoint({
    id: 'admin.orders.getSpecSheet',
    summary: 'An order’s packaging spec sheet',
    description: DESCRIPTION,
    implements: ['D-287', 'D-211'],
  })
  @ApiSuccess(200, { description: 'Spec sheet', type: SpecSheetDto, example: EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'orders.spec_sheet_unavailable')
  get(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() q: SpecSheetQuery,
  ) {
    return view(this.sheets, actor, orderId, q.lang);
  }
}

@ApiSurface('partner', 'production')
@Controller('orders')
export class PartnerSpecSheetController {
  constructor(private readonly sheets: SpecSheetService) {}

  @Get(':orderId/spec-sheet')
  @Can('factory_jobs.read')
  @orderParam
  @ApiEndpoint({
    id: 'partner.orders.getSpecSheet',
    summary: 'The packaging spec sheet of an order we make',
    description: `${DESCRIPTION} Only for an order with a production job of my factory (D-044).`,
    implements: ['D-287', 'D-044'],
  })
  @ApiSuccess(200, { description: 'Spec sheet', type: SpecSheetDto, example: EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'orders.spec_sheet_unavailable')
  get(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() q: SpecSheetQuery,
  ) {
    return view(this.sheets, actor, orderId, q.lang);
  }
}
