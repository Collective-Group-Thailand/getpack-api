import { OptionalActor, Public } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  SUPPORT_TICKET_EXAMPLE,
  SupportContactDto,
  SupportHandoffDto,
  SupportTicketDto,
} from './support.dto';
import { SupportService } from './support.service';

/** Anti-abuse bound of the public forms per client (technical; override with `SUPPORT_THROTTLE_LIMIT`). */
export const SUPPORT_THROTTLE = {
  default: { limit: () => Number(process.env.SUPPORT_THROTTLE_LIMIT ?? 5), ttl: 60_000 },
};
const ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'validation.failed',
  'support.contact_required',
  'http.too_many_requests',
] as const;
const CONTACT = { name: 'สมชาย ทดสอบ', phone: '0000000000' };

@ApiSurface('store', 'support')
@Controller('support/actions')
export class StoreSupportController {
  constructor(private readonly support: SupportService) {}

  @Post('contact')
  @Public()
  @Idempotent()
  @Throttle(SUPPORT_THROTTLE)
  @ApiEndpoint({
    id: 'store.support.contact',
    summary: 'Contact getpack CS',
    description:
      'The contact form, for guests and customers: opens a CS ticket on a CS conversation (D-221) — a signed-in ' +
      'customer’s own chat, a new one for a guest, who leaves a name and a phone or e-mail. Answers the ticket ' +
      'number, the first-response target (`support.first_response_business_days` business days, D-175) and a LINE ' +
      'link carrying only the ticket number. Rate-limited per client (429 with `Retry-After`).',
    implements: ['D-221', 'D-175'],
  })
  @ApiBody({
    type: SupportContactDto,
    examples: {
      default: {
        value: {
          contact: CONTACT,
          topic: 'order_status',
          orderCode: 'PK-2610-0001-01',
          message: 'สอบถามกำหนดส่งค่ะ',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Ticket opened', type: SupportTicketDto, example: SUPPORT_TICKET_EXAMPLE })
  @ApiStandardErrors(...ERRORS)
  contact(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: SupportContactDto,
  ): Promise<SupportTicketDto> {
    return this.support.contact(actor, body);
  }

  @Post('handoff')
  @Public()
  @Idempotent()
  @Throttle(SUPPORT_THROTTLE)
  @ApiEndpoint({
    id: 'store.support.handoff',
    summary: 'Hand the guided help over to CS',
    description:
      'Passes the page, the guided-help answers and what was recommended to CS as a ticket (topic `guided_help`), ' +
      'answered in chat or by a call back (`callback`). Same rules and answer as `store.support.contact` (D-221).',
    implements: ['D-221', 'D-175'],
  })
  @ApiBody({
    type: SupportHandoffDto,
    examples: {
      default: {
        value: {
          contact: CONTACT,
          page: '/guided-help',
          answers: { use: 'food', size: 'small' },
          recommended: ['tuck-end-box'],
          note: 'อยากได้กล่องใส่คุกกี้',
          callback: true,
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Ticket opened',
    type: SupportTicketDto,
    example: { ...SUPPORT_TICKET_EXAMPLE, source: 'handoff', topic: 'guided_help' },
  })
  @ApiStandardErrors(...ERRORS)
  handoff(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: SupportHandoffDto,
  ): Promise<SupportTicketDto> {
    return this.support.handoff(actor, body);
  }
}
