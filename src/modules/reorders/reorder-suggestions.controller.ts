import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { DecisionNoteDto } from '@modules/styles/process-capabilities.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  ADMIN_SUGGESTION_EXAMPLE,
  AdminReorderSuggestionDto,
  ReorderSuggestionDto,
  ReorderSuggestionQuery,
  SUGGESTION_EXAMPLE,
} from './reorder-suggestions.dto';
import { ReorderSuggestionsService } from './reorder-suggestions.service';

const DECISIONS = ['D-288', 'D-204'];
const suggestionParam = ApiParam({ name: 'suggestionId', format: 'uuid' });
const HOW =
  'A SKU is the specification (product type + configuration, without quantities or delivery) × the approved ' +
  'artwork, of a customer or of a company; with ≥ `reorder.min_orders` orders: next need = last order + the simple ' +
  'moving average of the last `reorder.average_orders` intervals, suggested date = next need − the last lead time − ' +
  '`reorder.safety_stock_days`, quantity = the mean of the same orders’ quantities. Recomputed nightly; a new order ' +
  'of the SKU opens a new cycle (D-288).';

function user(actor: Actor, audience: 'customer' | 'staff'): UserActor {
  if (actor.type !== 'user' || actor.audience !== audience) throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'reorderSuggestions')
@Controller('reorder-suggestions')
export class StoreReorderSuggestionsController {
  constructor(private readonly suggestions: ReorderSuggestionsService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.reorderSuggestions.list',
    summary: 'List my reorder suggestions',
    description: `My SKUs and those of companies where I may place orders, soonest first; dismissed ones left out. ${HOW}`,
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Suggestions',
    type: [ReorderSuggestionDto],
    example: [SUGGESTION_EXAMPLE],
  })
  @ApiStandardErrors()
  list(@CurrentActor() actor: Actor) {
    return this.suggestions.mine(user(actor, 'customer'));
  }

  @Post(':suggestionId/actions/dismiss')
  @HttpCode(200)
  @Idempotent()
  @suggestionParam
  @ApiEndpoint({
    id: 'store.reorderSuggestions.dismiss',
    summary: 'Dismiss a reorder suggestion',
    description:
      'Not now: the suggestion and its reminder are set aside until the SKU is ordered again (D-288).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Dismissed',
    type: ReorderSuggestionDto,
    example: { ...SUGGESTION_EXAMPLE, status: 'dismissed' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'reorders.suggestion_decided')
  dismiss(@CurrentActor() actor: Actor, @Param('suggestionId', ParseUUIDPipe) id: string) {
    return this.suggestions.dismissMine(user(actor, 'customer'), id);
  }
}

@ApiSurface('admin', 'reorderSuggestions')
@Controller('reorder-suggestions')
export class AdminReorderSuggestionsController {
  constructor(private readonly suggestions: ReorderSuggestionsService) {}

  @Get()
  @Can('orders.read')
  @ApiEndpoint({
    id: 'admin.reorderSuggestions.list',
    summary: 'Work the reorder suggestion queue',
    description: `CS queue: open suggestions by default, soonest suggested date first; filter by status and due date. ${HOW}`,
    implements: DECISIONS,
  })
  @ApiPaginated(AdminReorderSuggestionDto, { example: ADMIN_SUGGESTION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: ReorderSuggestionQuery) {
    const { rows, total } = await this.suggestions.queue(query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }

  @Post(':suggestionId/actions/mark-contacted')
  @HttpCode(200)
  @Idempotent()
  @Can('customers.manage')
  @suggestionParam
  @ApiBody({
    type: DecisionNoteDto,
    examples: { default: { value: { note: 'Called; the customer will reorder next week' } } },
  })
  @ApiEndpoint({
    id: 'admin.reorderSuggestions.markContacted',
    summary: 'Mark a reorder suggestion contacted',
    description: 'CS reached the customer about it, with what was agreed (D-288).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Contacted',
    type: AdminReorderSuggestionDto,
    example: {
      ...ADMIN_SUGGESTION_EXAMPLE,
      status: 'contacted',
      contactedAt: '2026-10-15T10:00:00+07:00',
      contactedBy: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000e7204', displayName: 'Dev CS' },
      contactNote: 'Called; the customer will reorder next week',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'reorders.suggestion_decided',
  )
  contacted(
    @CurrentActor() actor: Actor,
    @Param('suggestionId', ParseUUIDPipe) id: string,
    @Body() body: DecisionNoteDto,
  ) {
    return this.suggestions.staffDecide(user(actor, 'staff'), id, 'contacted', body.note);
  }

  @Post(':suggestionId/actions/dismiss')
  @HttpCode(200)
  @Idempotent()
  @Can('customers.manage')
  @suggestionParam
  @ApiEndpoint({
    id: 'admin.reorderSuggestions.dismiss',
    summary: 'Dismiss a reorder suggestion',
    description: 'Set aside until the SKU is ordered again (D-288).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Dismissed',
    type: AdminReorderSuggestionDto,
    example: { ...ADMIN_SUGGESTION_EXAMPLE, status: 'dismissed' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'reorders.suggestion_decided')
  dismiss(@CurrentActor() actor: Actor, @Param('suggestionId', ParseUUIDPipe) id: string) {
    return this.suggestions.staffDecide(user(actor, 'staff'), id, 'dismissed', null);
  }
}
