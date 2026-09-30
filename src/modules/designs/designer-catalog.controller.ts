import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiParam, ApiProduces, ApiResponse } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  DESIGNER_CATALOG_EXAMPLE,
  DESIGNER_TEMPLATE_DETAIL_EXAMPLE,
  DesignerCatalogDto,
  DesignerCatalogQuery,
  DesignerTemplateDetailDto,
} from './designer-catalog.dto';
import { DesignerCatalogService } from './designer-catalog.service';

const CACHE = 'public, max-age=300';
const FONT_TYPES = ['font/ttf', 'font/otf', 'font/woff', 'font/woff2'];

@ApiSurface('store', 'designs')
@Controller('designer')
export class StoreDesignerCatalogController {
  constructor(private readonly designer: DesignerCatalogService) {}

  @Get('catalog')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiEndpoint({
    id: 'store.designer.getCatalog',
    summary: 'Get the online designer’s catalogue of a product',
    description:
      'The box styles with dieline keys and size rules, the materials with caliper and flute allowances, the ' +
      'semi-design templates, the fonts and the artwork rules (bleed, safe zone, resolution — D-070) plus what an ' +
      'asset upload accepts. Catalogue data only: no prices or factories (D-050). Cacheable for 5 minutes.',
    implements: ['D-070', 'D-152', 'D-050'],
  })
  @ApiSuccess(200, { description: 'The catalogue', type: DesignerCatalogDto, example: DESIGNER_CATALOG_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  catalog(@Query() q: DesignerCatalogQuery): Promise<DesignerCatalogDto> {
    return this.designer.catalog(q.product);
  }

  @Get('templates/:templateId')
  @Public()
  @Header('Cache-Control', CACHE)
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.designer.getTemplate',
    summary: 'Get a semi-design template for the designer',
    description:
      'One active template with its palette, fonts, size and the designer document a design starts from ' +
      '(`document` is null until staff set one — `store.designs.create` then refuses it).',
    implements: ['D-005', 'D-152'],
  })
  @ApiSuccess(200, {
    description: 'The template',
    type: DesignerTemplateDetailDto,
    example: DESIGNER_TEMPLATE_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  template(@Param('templateId', ParseUUIDPipe) id: string): Promise<DesignerTemplateDetailDto> {
    return this.designer.template(id);
  }

  @Get('fonts/:fontId')
  @Public()
  @ApiParam({ name: 'fontId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.designer.getFont',
    summary: 'Get a designer font file',
    description:
      'The file of an active design font (its licence is recorded by staff) once scanned clean; anything else is ' +
      '404. Cacheable for a day.',
    implements: ['D-152'],
  })
  @ApiProduces(...FONT_TYPES)
  @ApiResponse({
    status: 200,
    description: 'The font bytes',
    content: Object.fromEntries(
      FONT_TYPES.map((t) => [t, { schema: { type: 'string', format: 'binary' }, example: '(binary font)' }]),
    ),
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async font(@Param('fontId', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const font = await this.designer.font(id);
    res.setHeader('Content-Type', font.mimeType);
    res.setHeader('Content-Length', font.sizeBytes.toString());
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', font.etag);
    font.stream.pipe(res);
  }
}
