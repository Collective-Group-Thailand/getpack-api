import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { type RawBodyRequest } from '@common/http/json-body-parser';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated, ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiParam } from '@nestjs/swagger';

import { ConversationStatsService } from './canned-responses.service';
import { conversationView, messageViews } from './conversation-views';
import {
  AssignConversationDto,
  CONVERSATION_EXAMPLE,
  ConversationDto,
  ConversationListQuery,
  LineWebhookAckDto,
  MESSAGE_EXAMPLE,
  MessageDto,
  MessagesQuery,
  RICH_MENU_EXAMPLE,
  RichMenuDto,
  SaveRichMenuDto,
  SendMessageDto,
  STORE_CONVERSATION_EXAMPLE,
  StoreConversationDto,
} from './conversations.dto';
import { type ConversationRow, ConversationsService } from './conversations.service';
import { LineWebhookService } from './line-webhook.service';
import { RichMenusService } from './rich-menus.service';
import {
  ConversationNoteDto,
  ConversationStatsDto,
  ConversationStatsQuery,
  StaffReplyDto,
  STATS_EXAMPLE,
} from './threads.dto';

const conversationParam = ApiParam({ name: 'conversationId', format: 'uuid' });

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}
function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

// =====================================================================================================
// Webhook
// =====================================================================================================

@ApiSurface('webhooks', 'line')
@Controller({ path: 'line', version: VERSION_NEUTRAL })
export class LineWebhookController {
  constructor(private readonly webhook: LineWebhookService) {}

  @Post('messaging')
  @HttpCode(200)
  @Public()
  @ApiEndpoint({
    id: 'webhooks.line.messaging',
    summary: 'LINE official account webhook',
    description:
      'Sent by LINE for follows, unfollows and messages. Verified with `x-line-signature` (HMAC-SHA256 of the ' +
      'exact body with the channel secret), stored once per `webhookEventId` (redeliveries are no-ops). Messages ' +
      'reach the CS inbox (D-151).',
    implements: ['D-151', 'D-143'],
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'message' },
              webhookEventId: { type: 'string' },
              timestamp: { type: 'integer' },
              source: {
                type: 'object',
                properties: { type: { type: 'string' }, userId: { type: 'string' } },
              },
              message: {
                type: 'object',
                properties: { id: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    examples: { default: { value: { destination: 'U0000000000000000000000000000fake', events: [] } } },
  })
  @ApiHeader({
    name: 'x-line-signature',
    required: true,
    description: 'Base64 HMAC-SHA256 of the exact request body with the channel secret (LINE signature)',
    schema: { type: 'string', example: 'c2lnbmF0dXJlLWV4YW1wbGU=' },
  })
  @ApiSuccess(200, { description: 'Accepted', type: LineWebhookAckDto, example: { ok: true } })
  @ApiStandardErrors('line.signature_invalid', 'http.bad_request', 'http.malformed_json', 'validation.failed')
  async messaging(
    @Req() req: RawBodyRequest,
    @Headers('x-line-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    await this.webhook.receive(signature, req.rawBody, body);
    return { ok: true };
  }
}

// =====================================================================================================
// Store (and LIFF): the customer's chat with CS
// =====================================================================================================

@ApiSurface('store', 'conversations')
@Controller('conversation')
export class StoreConversationController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiEndpoint({
    id: 'store.conversations.get',
    summary: 'My chat with getpack',
    description: 'The latest web / LIFF conversation, or 404 before the first message (D-151).',
    implements: ['D-151'],
  })
  @ApiSuccess(200, {
    description: 'Conversation',
    type: StoreConversationDto,
    example: STORE_CONVERSATION_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found')
  async get(@CurrentActor() actor: Actor) {
    const c = await this.conversations.customerConversation(customer(actor).userId);
    if (!c) throw new DomainException('http.not_found');
    return { id: c.publicId, status: c.status, lastMessageAt: toBangkokIso(c.lastMessageAt) };
  }

  @Get('messages')
  @ApiEndpoint({
    id: 'store.conversations.messages',
    summary: 'Messages of my chat',
    description: 'Newest first; reading marks getpack’s replies as read.',
    implements: ['D-151'],
  })
  @ApiCursorPaginated(MessageDto, { example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async messages(@CurrentActor() actor: Actor, @Query() q: MessagesQuery) {
    const c = await this.conversations.customerConversation(customer(actor).userId);
    if (!c) throw new DomainException('http.not_found');
    const page = await this.conversations.messages(c.id, q.cursor, q.limit);
    await this.conversations.markReadByCustomer(c.id, customer(actor).userId);
    return { data: await messageViews(this.prisma, page.data), meta: page.meta };
  }

  @Post('messages')
  @Idempotent()
  @ApiEndpoint({
    id: 'store.conversations.send',
    summary: 'Write to getpack CS',
    description: 'Opens a conversation when none is live; CS answers from the inbox (D-151).',
    implements: ['D-151'],
  })
  @ApiBody({ type: SendMessageDto, examples: { default: { value: { body: 'สอบถามสถานะคำสั่งซื้อค่ะ' } } } })
  @ApiSuccess(201, { description: 'Sent', type: MessageDto, example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async send(@CurrentActor() actor: Actor, @Body() body: SendMessageDto) {
    const m = await this.conversations.customerSend(customer(actor), body.body);
    return (await messageViews(this.prisma, await this.conversations.messageRows([m.id])))[0];
  }
}

// =====================================================================================================
// Admin: the CS inbox and the rich menus
// =====================================================================================================

@ApiSurface('admin', 'conversations')
@Controller('conversations')
export class AdminConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
    private readonly stats_: ConversationStatsService,
  ) {}

  private view(c: ConversationRow) {
    return conversationView(this.prisma, c, this.conversations.effectiveReplyChannel(c));
  }

  @Get()
  @Can('conversations.read')
  @ApiEndpoint({
    id: 'admin.conversations.list',
    summary: 'The CS inbox',
    description:
      'Latest activity first. Filters: status, assignee, subject (support / order / design / RFQ / RFQ basket, ' +
      'D-300), channel, the subject’s company, first-response state (waiting in time, overdue, answered — D-221), ' +
      'the queue of its contact ticket (D-458) and `q` (customer or LINE name, contains). Each thread carries its SLA timers, reply channel and participants.',
    implements: ['D-151', 'D-143', 'D-300', 'D-221', 'D-458'],
  })
  @ApiPaginated(ConversationDto, { example: CONVERSATION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ConversationListQuery) {
    const me = staff(actor);
    const now = new Date();
    const company = q.companyId
      ? await this.prisma.company.findUnique({ where: { publicId: q.companyId }, select: { id: true } })
      : null;
    const where: Prisma.ConversationWhereInput = {
      mergedIntoId: null,
      ...(q.status && { status: q.status }),
      ...(q.assigned === 'me' && { assignedUserId: me.userId }),
      ...(q.assigned === 'unassigned' && { assignedUserId: null }),
      ...(q.subjectType && { subjectType: q.subjectType }),
      ...(q.channel && { channel: q.channel }),
      ...(q.companyId && { companyId: company?.id ?? -1n }),
      ...(q.sla === 'answered' && { firstRespondedAt: { not: null } }),
      ...(q.sla === 'waiting' && { firstRespondedAt: null, firstResponseDueAt: { gte: now } }),
      ...(q.sla === 'overdue' && { firstRespondedAt: null, firstResponseDueAt: { lt: now } }),
      ...(q.queue && { tickets: { some: { queue: q.queue } } }),
      ...(q.q && {
        OR: [
          { customer: { displayName: { contains: q.q, mode: 'insensitive' } } },
          { lineAccount: { displayName: { contains: q.q, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await this.conversations.list(where, q.page, q.perPage);
    return {
      data: await Promise.all(rows.map((r) => this.view(r))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('stats')
  @Can('conversations.read')
  @ApiEndpoint({
    id: 'admin.conversations.stats',
    summary: 'Inbox first-response and resolution times',
    description:
      'Over Bangkok days `from`–`to` (D-300): threads opened and closed; first response — the thread’s first ' +
      'customer message to its first answer: count, median, 90th percentile and the share answered by its D-221 due ' +
      'time; resolution — opened to closed; and the live threads overdue now.',
    implements: ['D-300', 'D-221'],
  })
  @ApiSuccess(200, { description: 'Stats', type: ConversationStatsDto, example: STATS_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  stats(@Query() q: ConversationStatsQuery) {
    return this.stats_.stats(q.from, q.to);
  }

  @Get(':conversationId')
  @Can('conversations.read')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.get',
    summary: 'Get a conversation',
    description: 'With the customer when known.',
    implements: ['D-151'],
  })
  @ApiSuccess(200, { description: 'Conversation', type: ConversationDto, example: CONVERSATION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('conversationId', ParseUUIDPipe) id: string) {
    return this.view(await this.conversations.get(id));
  }

  @Get(':conversationId/messages')
  @Can('conversations.read')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.messages',
    summary: 'Messages of a conversation',
    description: 'Newest first, cursor-paged, with internal notes (D-300) and context cards resolved now.',
    implements: ['D-151', 'D-300'],
  })
  @ApiCursorPaginated(MessageDto, { example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async messages(@Param('conversationId', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    const c = await this.conversations.get(id);
    const page = await this.conversations.messages(c.id, q.cursor, q.limit, { includeInternal: true });
    return { data: await messageViews(this.prisma, page.data), meta: page.meta };
  }

  @Post(':conversationId/messages')
  @Idempotent()
  @Can('conversations.reply')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.reply',
    summary: 'Reply to the customer',
    description:
      'Text, files and / or a card to one of the customer’s records (D-300). Goes to the customer’s LINE when the ' +
      'thread’s reply channel is LINE (the customer’s choice, else the channel of their last message; files and cards ' +
      'stay in the thread, LINE gets a pointer to it), live on the web otherwise. The first reply answers the D-221 ' +
      'first-response clock and the thread’s support tickets; assigns the thread to me when unassigned.',
    implements: ['D-151', 'D-143', 'D-300', 'D-221'],
  })
  @ApiBody({
    type: StaffReplyDto,
    examples: { default: { value: { body: 'คำสั่งซื้อของคุณกำลังผลิตค่ะ' } } },
  })
  @ApiSuccess(201, {
    description: 'Sent (the first message of the send)',
    type: MessageDto,
    example: {
      ...MESSAGE_EXAMPLE,
      direction: 'outbound',
      body: 'คำสั่งซื้อของคุณกำลังผลิตค่ะ',
      sender: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000f4004', displayName: 'CS ทดสอบ' },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'conversations.closed',
    'conversations.unreachable',
    'provider.unavailable',
  )
  async reply(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Body() body: StaffReplyDto,
  ) {
    const m = await this.conversations.reply(staff(actor), id, body);
    return (await messageViews(this.prisma, await this.conversations.messageRows([m.id])))[0];
  }

  @Post(':conversationId/notes')
  @Idempotent()
  @Can('conversations.reply')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.addNote',
    summary: 'Add an internal note',
    description:
      'A note for colleagues on the thread (D-300): never shown or sent to the customer, does not answer the ' +
      'first-response clock.',
    implements: ['D-300'],
  })
  @ApiBody({
    type: ConversationNoteDto,
    examples: { default: { value: { body: 'ลูกค้าโทรมาแจ้งเพิ่ม: ต้องการส่งก่อนวันศุกร์' } } },
  })
  @ApiSuccess(201, {
    description: 'Noted',
    type: MessageDto,
    example: {
      ...MESSAGE_EXAMPLE,
      direction: 'outbound',
      visibility: 'internal',
      via: null,
      contextCard: null,
      body: 'ลูกค้าโทรมาแจ้งเพิ่ม: ต้องการส่งก่อนวันศุกร์',
      sender: { id: '0192f3a0-7c1e-7d2a-9b1f-0000000f4004', displayName: 'CS ทดสอบ' },
    },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async addNote(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Body() body: ConversationNoteDto,
  ) {
    const m = await this.conversations.note(staff(actor), id, body);
    return (await messageViews(this.prisma, await this.conversations.messageRows([m.id])))[0];
  }

  @Post(':conversationId/actions/mark-read')
  @HttpCode(200)
  @Can('conversations.read')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.markRead',
    summary: 'Mark a thread read',
    description:
      'Moves my read position to its latest message — the customer sees when getpack read it (D-300).',
    implements: ['D-300'],
  })
  @ApiSuccess(200, { description: 'Read', type: ConversationDto, example: CONVERSATION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async markRead(@CurrentActor() actor: Actor, @Param('conversationId', ParseUUIDPipe) id: string) {
    await this.conversations.markReadByStaff(staff(actor), id);
    return this.view(await this.conversations.get(id));
  }

  @Post(':conversationId/actions/assign')
  @HttpCode(200)
  @Can('conversations.reply')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.assign',
    summary: 'Assign a conversation',
    description: 'To a staff member (default: me).',
    implements: ['D-151'],
  })
  @ApiBody({ type: AssignConversationDto, examples: { default: { value: {} } } })
  @ApiSuccess(200, { description: 'Assigned', type: ConversationDto, example: CONVERSATION_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async assign(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Body() body: AssignConversationDto,
  ) {
    await this.conversations.assign(staff(actor), id, body.userId);
    return this.view(await this.conversations.get(id));
  }

  @Post(':conversationId/actions/close')
  @HttpCode(200)
  @Can('conversations.reply')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.close',
    summary: 'Close a conversation',
    description: 'The next customer message opens a new one.',
    implements: ['D-151'],
  })
  @ApiSuccess(200, {
    description: 'Closed',
    type: ConversationDto,
    example: { ...CONVERSATION_EXAMPLE, status: 'closed' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async close(@CurrentActor() actor: Actor, @Param('conversationId', ParseUUIDPipe) id: string) {
    await this.conversations.close(staff(actor), id);
    return this.view(await this.conversations.get(id));
  }
}

@ApiSurface('admin', 'line')
@Controller('line/rich-menus')
export class AdminRichMenusController {
  constructor(private readonly menus: RichMenusService) {}

  @Get()
  @Can('line.manage')
  @ApiEndpoint({
    id: 'admin.line.richMenus',
    summary: 'OA rich menus',
    description: 'Registered menus per audience (D-151).',
    implements: ['D-151'],
  })
  @ApiSuccess(200, { description: 'Menus', type: [RichMenuDto], example: [RICH_MENU_EXAMPLE] })
  @ApiStandardErrors()
  async list() {
    return (await this.menus.list()).map(({ key, audience, providerMenuId, active }) => ({
      key,
      audience,
      providerMenuId,
      active,
    }));
  }

  @Put(':key')
  @Can('line.manage')
  @ApiParam({ name: 'key', example: 'member_2026' })
  @ApiEndpoint({
    id: 'admin.line.saveRichMenu',
    summary: 'Register a rich menu',
    description: 'A menu created in LINE, by key: guest or member audience; one active per audience.',
    implements: ['D-151'],
  })
  @ApiBody({
    type: SaveRichMenuDto,
    examples: {
      default: {
        value: {
          audience: 'member',
          providerMenuId: 'richmenu-0000000000000000000000000000fake',
          active: true,
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Saved', type: RichMenuDto, example: RICH_MENU_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async save(@CurrentActor() actor: Actor, @Param('key') key: string, @Body() body: SaveRichMenuDto) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'key', code: 'matches', message: 'lower-case key' }],
      });
    const m = await this.menus.upsert(staff(actor), key, body);
    return { key: m.key, audience: m.audience, providerMenuId: m.providerMenuId, active: m.active };
  }
}
