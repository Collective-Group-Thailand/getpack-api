import { Public } from '@common/auth/auth.decorators';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ConvertDimensionsDto, CONVERTED_EXAMPLE, ConvertedDimensionsDto } from './specs.dto';
import { SpecsService } from './specs.service';

@ApiSurface('store', 'specs')
@Controller('specs')
export class StoreSpecsController {
  constructor(private readonly specs: SpecsService) {}

  @Post('actions/convert-dimensions')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiEndpoint({
    id: 'store.specs.convertDimensions',
    summary: 'Show a size on every measurement basis',
    description:
      'The inside, outside and score-to-score sizes of a box, tray or sleeve from the size on one basis and the ' +
      'material’s caliper; a flat product has its finished size only (D-182). Millimetres only (D-183). Without a ' +
      'caliper only the given basis is known. The same conversion prices a configuration given on another basis.',
    implements: ['D-182', 'D-183'],
  })
  @ApiBody({
    type: ConvertDimensionsDto,
    examples: {
      default: {
        value: {
          productTypeCode: 'folding_carton',
          materialId: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
          basis: 'internal',
          w: 100,
          l: 150,
          d: 50,
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Sizes per basis',
    type: ConvertedDimensionsDto,
    example: CONVERTED_EXAMPLE,
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'specs.unit_not_accepted',
    'specs.basis_not_accepted',
  )
  convert(@Body() body: ConvertDimensionsDto): Promise<ConvertedDimensionsDto> {
    return this.specs.convertPublic(body);
  }
}
