import { OptionalActor, Public } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  SUPPORT_CONTACT_OPTIONS_EXAMPLE,
  SUPPORT_TICKET_EXAMPLE,
  SUPPORT_TICKET_STATUS_EXAMPLE,
  SupportAddInfoDto,
  SupportContactDto,
  SupportContactOptionsDto,
  SupportHandoffDto,
  SupportTicketDto,
  SupportTicketLookupDto,
  SupportTicketStatusDto,
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
const CONTACT_ERRORS = [...ERRORS, 'support.callback_unavailable'] as const;
const LOOKUP_ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'validation.failed',
  'support.ticket_not_found',
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
      'link carrying only the ticket number. Rate-limited per client (429 with `Retry-After`). D-458: the intent’s ' +
      'own fields (`details`: company, volume, interests, capabilities, province, current system, product, quantity, ' +
      'inside size, postcode), the reply channel and a call-back slot are stored with the ticket; the ticket is ' +
      'routed to the topic’s queue (`support.topic_queues`) and its target follows the topic ' +
      '(`support.reply_business_days_by_topic`). A call back needs a phone and one of the offered days and windows ' +
      '(`support.callback_unavailable`). References stay `CS-YYMM-NNNNN` for every topic (D-440).',
    implements: ['D-221', 'D-175', 'D-440', 'D-458'],
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
      sales: {
        value: {
          contact: { name: 'สมชาย ทดสอบ', email: 'someone@example.test', phone: '0000000000' },
          topic: 'business',
          message: 'สนใจเปิดบัญชีบริษัท 4 สาขา',
          details: {
            company: 'บริษัท ตัวอย่าง จำกัด',
            monthlyVolume: '1000_5000',
            interests: ['credit', 'branches'],
          },
          replyChannel: 'email',
        },
      },
      callback: {
        value: {
          contact: CONTACT,
          topic: 'payment',
          orderCode: 'PK-2610-0001-01',
          message: 'สอบถามการชำระเงินค่ะ',
          replyChannel: 'callback',
          callback: { date: '2026-10-21', slot: 'morning' },
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Ticket opened', type: SupportTicketDto, example: SUPPORT_TICKET_EXAMPLE })
  @ApiStandardErrors(...CONTACT_ERRORS)
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

  @Post('lookup')
  @Public()
  @HttpCode(200)
  @Throttle(SUPPORT_THROTTLE)
  @ApiEndpoint({
    id: 'store.support.lookupTicket',
    summary: 'Where my request stands',
    description:
      'D-458: the stage of a contact ticket (ได้รับเรื่อง → กำลังดำเนินการ → ตอบกลับแล้ว) for the person who sent it: a ' +
      'signed-in customer reads their own tickets; a guest gives the phone or e-mail they left. Any other ticket — or ' +
      'none — is `support.ticket_not_found` (never confirms a ticket exists). A POST so the phone or e-mail never ' +
      'travels in a URL. Rate-limited per client.',
    implements: ['D-458', 'D-221'],
  })
  @ApiBody({
    type: SupportTicketLookupDto,
    examples: {
      default: { value: { ticketNo: 'CS-2610-00001', contact: { name: '-', phone: '0000000000' } } },
    },
  })
  @ApiSuccess(200, {
    description: 'Ticket status',
    type: SupportTicketStatusDto,
    example: SUPPORT_TICKET_STATUS_EXAMPLE,
  })
  @ApiStandardErrors(...LOOKUP_ERRORS)
  lookup(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: SupportTicketLookupDto,
  ): Promise<SupportTicketStatusDto> {
    return this.support.lookup(actor, body);
  }

  @Post('add-info')
  @Public()
  @Idempotent()
  @HttpCode(200)
  @Throttle(SUPPORT_THROTTLE)
  @ApiEndpoint({
    id: 'store.support.addInfo',
    summary: 'Add information to my request',
    description:
      'D-458 "เพิ่มข้อมูลในเรื่องนี้": a message added to my contact ticket’s conversation (the same ownership check as ' +
      '`store.support.lookupTicket`); it reopens the conversation for CS. Audited (`support.ticket_info_added`) with ' +
      'the event of the same name; no contact details in either (PDPA). Rate-limited per client.',
    implements: ['D-458', 'D-221'],
  })
  @ApiBody({
    type: SupportAddInfoDto,
    examples: {
      default: {
        value: {
          ticketNo: 'CS-2610-00001',
          contact: { name: '-', phone: '0000000000' },
          message: 'แนบเลขพัสดุเพิ่มค่ะ',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Ticket status',
    type: SupportTicketStatusDto,
    example: SUPPORT_TICKET_STATUS_EXAMPLE,
  })
  @ApiStandardErrors(...LOOKUP_ERRORS)
  addInfo(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: SupportAddInfoDto,
  ): Promise<SupportTicketStatusDto> {
    return this.support.addInfo(actor, body);
  }
}

/** `/v1/store/support/contact-options`: what the contact form offers right now (D-458). */
@ApiSurface('store', 'support')
@Controller('support')
export class StoreSupportOptionsController {
  constructor(private readonly support: SupportService) {}

  @Get('contact-options')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiEndpoint({
    id: 'store.support.contactOptions',
    summary: 'What the contact form offers now',
    description:
      'D-458: the first-response target (`support.first_response_business_days`, per topic from ' +
      '`support.reply_business_days_by_topic`), whether CS answers right now and when it answers next ' +
      '(`storefront.support_hours`, Asia/Bangkok, national calendar for `business_days`), and the call-back days ' +
      '(next 5 business days) and windows (`support.callback_slots`; null while unset — no call back offered). ' +
      'Anonymous, cacheable 60 s.',
    implements: ['D-458', 'D-221', 'D-309', 'D-161'],
  })
  @ApiSuccess(200, {
    description: 'Contact options',
    type: SupportContactOptionsDto,
    example: SUPPORT_CONTACT_OPTIONS_EXAMPLE,
  })
  @ApiStandardErrors('validation.failed')
  contactOptions(): Promise<SupportContactOptionsDto> {
    return this.support.contactOptions();
  }
}
