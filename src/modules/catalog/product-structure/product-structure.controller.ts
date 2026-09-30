import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PriceHintsService } from '@modules/pricing/hints/price-hints.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { type Response } from 'express';

import { staffActor } from '../crud/catalog-crud.controller';
import { CatalogCrudService, rowEtag } from '../crud/catalog-crud.service';
import { type CrudRow } from '../crud/catalog-resource';
import {
  AddImageDto,
  CatalogProductDto,
  ChangeQuoteModeDto,
  EXAMPLE_IDS,
  PatternDto,
  ProductTypeDto,
  ReferenceConfigurationDto,
  ReplaceFluteTypesDto,
  ReplaceOptionsDto,
  ReplacePatternsDto,
} from './product-structure.dto';
import {
  CATALOG_PRODUCT_EXAMPLE,
  catalogProducts,
  patterns,
  PRODUCT_TYPE_EXAMPLE,
  productTypes,
} from './product-structure.resources';
import { ProductStructureService } from './product-structure.service';

const COLLECTION_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
] as const;

@ApiSurface('admin', 'catalogProductTypes')
@Controller('catalog/product-types')
export class ProductTypeActionsController {
  constructor(
    private readonly service: ProductStructureService,
    private readonly crud: CatalogCrudService,
  ) {}

  @Post(':id/actions/change-quote-mode')
  @HttpCode(200)
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProductTypes.changeQuoteMode',
    summary: 'Switch a product type between instant quote and RFQ',
    description:
      'A type moves to `instant` only when its calculator has shipped with golden tests (D-100); ' +
      'otherwise 422 `catalog.calculator_required`. Whether a given configuration is actually instant ' +
      'is still resolved from factory participations at quote time (D-043). Audited and published as ' +
      '`product_type.quote_mode_changed`.',
    implements: ['D-100', 'D-043'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ChangeQuoteModeDto,
    examples: { default: { value: { quoteMode: 'rfq', reason: 'Calculator withdrawn for review' } } },
  })
  @ApiSuccess(200, { description: 'The product type', type: ProductTypeDto, example: PRODUCT_TYPE_EXAMPLE })
  @ApiStandardErrors(...COLLECTION_ERRORS, 'catalog.calculator_required')
  async changeQuoteMode(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ChangeQuoteModeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(
      productTypes,
      await this.service.changeQuoteMode(staffActor(actor), id, ifMatch, body),
      res,
    );
  }

  private async respond(resource: typeof productTypes, row: CrudRow, res: Response): Promise<object> {
    res.setHeader('ETag', rowEtag(row));
    const [dto] = await this.crud.toDtos(resource, [row]);
    return dto!;
  }
}

@ApiSurface('admin', 'catalogProducts')
@Controller('catalog/catalog-products')
export class CatalogProductRelationsController {
  constructor(
    private readonly service: ProductStructureService,
    private readonly crud: CatalogCrudService,
    private readonly hints: PriceHintsService,
  ) {}

  @Put(':id/patterns')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProducts.replacePatterns',
    summary: 'Replace the patterns of a catalogue product',
    description:
      'The whole list is replaced in one transaction (legacy `mapping_input_rel_patterns`); factors are ' +
      'indicative until the calculator port fixes them (B2.3). Guarded by the product ETag.',
    implements: ['D-100', 'D-005'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplacePatternsDto,
    examples: {
      default: {
        value: { patterns: [{ patternId: EXAMPLE_IDS.pattern, factorNw: 1, factorNl: 1, factorNd: 1 }] },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'The catalogue product',
    type: CatalogProductDto,
    example: CATALOG_PRODUCT_EXAMPLE,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async replacePatterns(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplacePatternsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(await this.service.replacePatterns(staffActor(actor), id, ifMatch, body), res);
  }

  @Put(':id/reference-configuration')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProducts.setReferenceConfiguration',
    summary: 'Set the reference configuration of the "starting from" price',
    description:
      'D-220: the calculator configuration (one quantity) a product card\'s starting price is quoted at, validated ' +
      'as a store request of the product type\'s calculator. The price hint is recomputed at once and shown by ' +
      '`store.catalog.listPriceHints`; no hint while nothing can price it. Guarded by the product ETag; audited.',
    implements: ['D-220', 'D-181'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReferenceConfigurationDto,
    examples: {
      default: {
        value: {
          configuration: {
            patternId: EXAMPLE_IDS.pattern,
            w: 60,
            l: 60,
            d: 150,
            materialId: EXAMPLE_IDS.material,
            difficultyLevelId: '0192f3a0-7c1e-7d2a-9b1f-00000000c020',
            quantities: [1000],
            parts: [{}],
          },
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'The catalogue product', type: CatalogProductDto, example: CATALOG_PRODUCT_EXAMPLE })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async setReferenceConfiguration(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReferenceConfigurationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const row = await this.service.setReferenceConfiguration(staffActor(actor), id, ifMatch, body.configuration);
    await this.hints.refresh((row as unknown as { id: bigint }).id);
    return this.respond(row, res);
  }

  @Delete(':id/reference-configuration')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProducts.clearReferenceConfiguration',
    summary: 'Remove the reference configuration',
    description: 'The product then has no "starting from" price (D-220). Guarded by the product ETag; audited.',
    implements: ['D-220'],
  })
  @ApiConcurrency()
  @ApiSuccess(200, { description: 'The catalogue product', type: CatalogProductDto, example: CATALOG_PRODUCT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async clearReferenceConfiguration(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const row = await this.service.setReferenceConfiguration(staffActor(actor), id, ifMatch, null);
    await this.hints.refresh((row as unknown as { id: bigint }).id);
    return this.respond(row, res);
  }

  @Put(':id/options')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProducts.replaceOptions',
    summary: 'Replace the options a catalogue product offers',
    description:
      'Materials, finishes, coatings, ink colours, die-cuts, assemblies, print types and patterns the ' +
      'customer may pick. Each option is checked against its definition table (a coating must be a ' +
      'coating or lamination finish). The whole list is replaced; guarded by the product ETag.',
    implements: ['D-100', 'D-005'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceOptionsDto,
    examples: {
      default: {
        value: { options: [{ kind: 'material', optionId: EXAMPLE_IDS.material, isDefault: true }] },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'The catalogue product',
    type: CatalogProductDto,
    example: CATALOG_PRODUCT_EXAMPLE,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async replaceOptions(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceOptionsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(await this.service.replaceOptions(staffActor(actor), id, ifMatch, body), res);
  }

  @Post(':id/images')
  @HttpCode(200)
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProducts.addImage',
    summary: 'Add an image to a catalogue product',
    description:
      'References an uploaded file (presign → PUT → complete). The image is served publicly only once ' +
      'the malware scan reports it clean. Guarded by the product ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: AddImageDto,
    examples: { default: { value: { fileId: EXAMPLE_IDS.file, variant: { material: 'art-card-350' } } } },
  })
  @ApiSuccess(200, {
    description: 'The catalogue product',
    type: CatalogProductDto,
    example: CATALOG_PRODUCT_EXAMPLE,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async addImage(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: AddImageDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    return this.respond(await this.service.addImage(staffActor(actor), id, ifMatch, body), res);
  }

  @Delete(':id/images/:imageId')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogProducts.removeImage',
    summary: 'Remove an image from a catalogue product',
    description: 'The stored file itself is kept (retention policy). Guarded by the product ETag.',
    implements: ['D-005'],
  })
  @ApiConcurrency()
  @ApiSuccess(200, {
    description: 'The catalogue product',
    type: CatalogProductDto,
    example: CATALOG_PRODUCT_EXAMPLE,
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
    const [dto] = await this.crud.toDtos(catalogProducts, [row]);
    return dto!;
  }
}

@ApiSurface('admin', 'catalogPatterns')
@Controller('catalog/patterns')
export class PatternRelationsController {
  constructor(
    private readonly service: ProductStructureService,
    private readonly crud: CatalogCrudService,
  ) {}

  @Put(':id/flute-types')
  @Can('catalog.manage')
  @ApiEndpoint({
    id: 'admin.catalogPatterns.replaceFluteTypes',
    summary: 'Replace the flute types a pattern matches',
    description: 'Legacy `pattern_match_flute`; the whole list is replaced. Guarded by the pattern ETag.',
    implements: ['D-100', 'D-005'],
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceFluteTypesDto,
    examples: { default: { value: { fluteTypeIds: [EXAMPLE_IDS.fluteType] } } },
  })
  @ApiSuccess(200, {
    description: 'The pattern',
    type: PatternDto,
    example: patterns.example,
  })
  @ApiStandardErrors(...COLLECTION_ERRORS)
  async replaceFluteTypes(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceFluteTypesDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    const row = await this.service.replaceFluteTypes(staffActor(actor), id, ifMatch, body.fluteTypeIds);
    res.setHeader('ETag', rowEtag(row));
    const [dto] = await this.crud.toDtos(patterns, [row]);
    return dto!;
  }
}
