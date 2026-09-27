import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ADMIN_REFERRAL_EXAMPLE,
  AdminReferralDto,
  AttributeReferralDto,
  MY_REFERRAL_EXAMPLE,
  MyReferralDto,
  REFERRAL_EXAMPLE,
  ReferralDto,
  ReferralListQuery,
} from './referrals.dto';
import { type ReferralRow, ReferralsService } from './referrals.service';

const DECISIONS = ['D-136'];

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

function referralDto(r: ReferralRow): ReferralDto {
  return {
    id: r.publicId,
    code: r.referralCode,
    status: r.status,
    attributedAt: toBangkokIso(r.attributedAt),
    qualifiedAt: iso(r.qualifiedAt),
    rewardedAt: iso(r.rewardedAt),
  };
}

function adminReferralDto(r: ReferralRow): AdminReferralDto {
  return {
    ...referralDto(r),
    referrer: { id: r.referrer.publicId, displayName: r.referrer.displayName },
    referee: { id: r.referee.publicId, displayName: r.referee.displayName },
    firstOrderGroupId: r.firstOrderGroup?.publicId ?? null,
    firstOrderGroupCode: r.firstOrderGroup?.groupCode ?? null,
    fraudFlags: r.fraudFlags,
    approvalId: r.approvalRequest?.publicId ?? null,
    decidedAt: iso(r.decidedAt),
  };
}

@ApiSurface('store', 'referral')
@Controller('referral')
export class StoreReferralController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.referral.get',
    summary: 'Get my referral code and link',
    description:
      'The code (created on first use) and link to share, with how many people used it by status. A friend ' +
      'who orders gets the referee discount on the first order; the reward follows once that order passed the ' +
      'claim window (D-136).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'My referral', type: MyReferralDto, example: MY_REFERRAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  mine(@CurrentActor() actor: Actor): Promise<MyReferralDto> {
    return this.referrals.mine(customer(actor).userId);
  }

  @Post('attribution')
  @ApiEndpoint({
    id: 'store.referral.attribute',
    summary: 'Use a friend’s referral code',
    description:
      'Once per account, before the first order (D-136): the first order then gets the referee discount ' +
      '(`referral.rules`). Own codes are refused. The web client calls this right after sign-up when the ' +
      'customer arrived through a referral link.',
    implements: DECISIONS,
  })
  @ApiBody({ type: AttributeReferralDto, examples: { default: { value: { code: 'PK7QX2MA' } } } })
  @ApiSuccess(201, { description: 'Referral recorded', type: ReferralDto, example: REFERRAL_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'referrals.code_invalid',
    'referrals.self_referral',
    'referrals.already_attributed',
    'referrals.not_new_customer',
  )
  async attribute(@CurrentActor() actor: Actor, @Body() body: AttributeReferralDto): Promise<ReferralDto> {
    return referralDto(await this.referrals.attribute(customer(actor), body.code));
  }
}

@ApiSurface('admin', 'referrals')
@Controller('referrals')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @Can('promotions.read')
  @ApiEndpoint({
    id: 'admin.referrals.list',
    summary: 'List referrals',
    description:
      'Newest first; `status=under_review` is Marketing’s review queue (decided through the approval, ' +
      '`referral_review`, D-136).',
    implements: DECISIONS,
  })
  @ApiPaginated(AdminReferralDto, { example: ADMIN_REFERRAL_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: ReferralListQuery) {
    const [rows, total] = await this.referrals.list(q.status ? { status: q.status } : {}, q.page, q.perPage);
    return { data: rows.map(adminReferralDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get(':referralId')
  @Can('promotions.read')
  @ApiParam({ name: 'referralId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.referrals.get',
    summary: 'Get a referral',
    description: 'Referrer, referee, first order, fraud flags and the review (D-136).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Referral', type: AdminReferralDto, example: ADMIN_REFERRAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('referralId', ParseUUIDPipe) id: string): Promise<AdminReferralDto> {
    return adminReferralDto(await this.referrals.get(id));
  }
}
