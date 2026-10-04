import { Can } from '@common/auth/can.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';

import { COVERAGE_EXAMPLE, CoverageQuery, ProductTypeCoverageDto } from './quote-path.dto';
import { QuotePathService } from './quote-path.service';

@ApiSurface('admin', 'partnerCoverage')
@Controller('partners')
export class AdminCoverageController {
  constructor(private readonly quotePath: QuotePathService) {}

  @Get('coverage')
  @Can('partners.read')
  @ApiEndpoint({
    id: 'admin.partnerCoverage.get',
    summary: 'Coverage map: which factories cover each product type',
    description:
      'Per active type: quote mode, whether an instant path exists, availability (instant / partial / rfq) and every ' +
      'factory with a capability for it — status, tier, tier-B envelope, price-list version and weekly capacity in ' +
      'force (D-043, D-234, D-100, D-101) — and the last 90 days of demand: calculations, how many an instant path ' +
      'priced (coverage %) and RFQs created (D-102).',
    implements: ['D-043', 'D-234', 'D-100', 'D-101', 'D-102'],
  })
  @ApiSuccess(200, { description: 'Coverage', type: [ProductTypeCoverageDto], example: [COVERAGE_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  coverage(@Query() query: CoverageQuery): Promise<ProductTypeCoverageDto[]> {
    return this.quotePath.coverage(query.productTypeId);
  }
}
