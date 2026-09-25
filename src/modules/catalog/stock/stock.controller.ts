import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { type Response } from 'express';

import { staffActor } from '../crud/catalog-crud.controller';
import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { type CrudRow } from '../crud/catalog-resource';
import { AddStockImageDto, ReplaceStockAttributesDto, STOCK_IDS, StockProductDto } from './stock.dto';
import { STOCK_PRODUCT_EXAMPLE, stockProducts } from './stock.resources';
import { StockProductsService } from './stock.service';

@ApiSurface('admin', 'catalogStockProducts')
@Controller('catalog/stock-products')
export class StockProductRelationsController {
  constructor(
    private readonly service: StockProductsService,
    private readonly crud: CatalogCrudService,
  ) {}

  @Put(':id/attributes')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogStockProducts.replaceAttributes',
    summary: 'Replace the attributes of a stock product',
    description:
      'One value per attribute (material, type, shape, shoulder, neck, colour, size, cap type); each value ' +
      'must belong to its attribute. The whole set is replaced; guarded by the product ETag.',
    implements: ['D-100', 'D-005'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceStockAttributesDto,
    examples: { default: { value: { attributes: [{ attribute: 'colour', valueId: STOCK_IDS.value }] } } },
  })
  @ApiSuccess(200, {
    description: 'The stock product',
    type: StockProductDto,
    example: STOCK_PRODUCT_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async replaceAttributes(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceStockAttributesDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(await this.service.replaceAttributes(staffActor(actor), id, ifMatch, body), res);
  }

  @Post(':id/images')
  @HttpCode(200)
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogStockProducts.addImage',
    summary: 'Add a photo to a stock product',
    description:
      'References an uploaded file; it is served publicly (storefront, Merchant feed) only once the scan ' +
      'reports it clean. Guarded by the product ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiBody({ type: AddStockImageDto, examples: { default: { value: { fileId: STOCK_IDS.file } } } })
  @ApiSuccess(200, {
    description: 'The stock product',
    type: StockProductDto,
    example: STOCK_PRODUCT_EXAMPLE,
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async addImage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: AddStockImageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(await this.service.addImage(staffActor(actor), id, ifMatch, body), res);
  }

  @Delete(':id/images/:imageId')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogStockProducts.removeImage',
    summary: 'Remove a photo from a stock product',
    description: 'The stored file itself is kept (retention policy). Guarded by the product ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiSuccess(200, {
    description: 'The stock product',
    type: StockProductDto,
    example: STOCK_PRODUCT_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async removeImage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(await this.service.removeImage(staffActor(actor), id, imageId, ifMatch), res);
  }

  private async respond(row: CrudRow, res: Response): Promise<object> {
    res.setHeader('ETag', rowEtag(row));
    const [dto] = await this.crud.toDtos(stockProducts, [row]);
    return dto!;
  }
}
