import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Query } from '@nestjs/common';

import { ENTRY_EXAMPLE, LoyaltySummaryDto, PointsEntryDto, SUMMARY_EXAMPLE } from './loyalty.dto';
import { LoyaltyService } from './loyalty.service';
import { entryDto, summaryDto } from './loyalty-views';

const DECISIONS = ['D-130', 'D-131', 'D-132', 'D-133', 'D-134'];

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'loyalty')
@Controller('loyalty')
export class StoreLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.loyalty.get',
    summary: 'Get my points and tier',
    description:
      'Available points (redeemable at checkout with `redeemPoints`, D-133), pending points from completed ' +
      'orders (credited after the claim window, D-132), points expiring within 30 days, the point value ' +
      '(D-131) and my tier from 12-month spend (D-134).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Points and tier', type: LoyaltySummaryDto, example: SUMMARY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async summary(@CurrentActor() actor: Actor): Promise<LoyaltySummaryDto> {
    return summaryDto(await this.loyalty.summary(customer(actor).userId));
  }

  @Get('ledger')
  @ApiEndpoint({
    id: 'store.loyalty.ledger',
    summary: 'List my points history',
    description: 'Every earning, redemption, reversal and expiry, newest first (D-130…D-133).',
    implements: DECISIONS,
  })
  @ApiPaginated(PointsEntryDto, { example: ENTRY_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async ledger(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const [rows, total] = await this.loyalty.ledger(customer(actor).userId, q.page, q.perPage);
    return { data: rows.map(entryDto), meta: { page: q.page, perPage: q.perPage, total } };
  }
}
