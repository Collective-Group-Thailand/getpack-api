import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get } from '@nestjs/common';

import { CatalogReadinessDto, READINESS_EXAMPLE } from './readiness.dto';
import { CatalogReadinessService } from './readiness.service';

@ApiSurface('admin', 'catalogReadiness')
@Controller('catalog/readiness')
export class CatalogReadinessController {
  constructor(private readonly readiness: CatalogReadinessService) {}

  @Get()
  @Can('catalog.read')
  @ApiEndpoint({
    id: 'admin.catalogReadiness.get',
    summary: 'What the catalogue still needs',
    description:
      'Per active product type: quote mode and whether its calculator is shipped (the switch to instant, A-16). ' +
      'Catalogue products, stock products and style bases that have no photo, only a reference render (D-426), are ' +
      'not active, have no instant price, or have no publishable variant (D-243) — counts over the whole catalogue, ' +
      'the first fifty of each to open.',
    implements: ['D-426', 'D-100', 'D-243'],
  })
  @ApiSuccess(200, {
    description: 'The readiness lists',
    type: CatalogReadinessDto,
    example: READINESS_EXAMPLE,
  })
  @ApiStandardErrors()
  get(): Promise<CatalogReadinessDto> {
    return this.readiness.readiness();
  }
}
