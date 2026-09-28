import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { type RawBodyRequest } from '@common/http/json-body-parser';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated, ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
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
import { ApiBody, ApiParam } from '@nestjs/swagger';

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
import { type ConversationRow, ConversationsService, type MessageRow } from './conversations.service';
import { LineWebhookService } from './line-webhook.service';
import { RichMenusService } from './rich-menus.service';

const conversationParam = ApiParam({ name: 'conversationId', format: 'uuid' });

function messageDto(m: MessageRow): MessageDto {
  return {
    id: m.publicId,
    direction: m.direction,
    kind: m.kind,
    body: m.body,
    sender:
      m.direction === 'outbound' && m.senderUser
        ? { id: m.senderUser.publicId, displayName: m.senderUser.displayName }
        : null,
    sentAt: toBangkokIso(m.sentAt),
    readAt: m.readAt ? toBangkokIso(m.readAt) : null,
  };
}

function conversationDto(c: ConversationRow): ConversationDto {
  return {
    id: c.publicId,
    status: c.status,
    lastMessageAt: toBangkokIso(c.lastMessageAt),
    channel: c.channel,
    customer: c.customer ? { id: c.customer.publicId, displayName: c.customer.displayName } : null,
    lineDisplayName: c.lineAccount?.displayName ?? null,
    lineFriendStatus: c.lineAccount?.friendStatus ?? null,
    assignee: c.assignedUser
      ? { id: c.assignedUser.publicId, displayName: c.assignedUser.displayName }
      : null,
    lastMessage: c.messages[0]?.body ?? null,
  };
}

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
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiEndpoint({
    id: 'store.conversations.get',
    summary: 'My chat with Packio',
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
    description: 'Newest first; reading marks Packio’s replies as read.',
    implements: ['D-151'],
  })
  @ApiCursorPaginated(MessageDto, { example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async messages(@CurrentActor() actor: Actor, @Query() q: MessagesQuery) {
    const c = await this.conversations.customerConversation(customer(actor).userId);
    if (!c) throw new DomainException('http.not_found');
    const page = await this.conversations.messages(c.id, q.cursor, q.limit);
    await this.conversations.markReadByCustomer(c.id);
    return { data: page.data.map(messageDto), meta: page.meta };
  }

  @Post('messages')
  @Idempotent()
  @ApiEndpoint({
    id: 'store.conversations.send',
    summary: 'Write to Packio CS',
    description: 'Opens a conversation when none is live; CS answers from the inbox (D-151).',
    implements: ['D-151'],
  })
  @ApiBody({ type: SendMessageDto, examples: { default: { value: { body: 'สอบถามสถานะคำสั่งซื้อค่ะ' } } } })
  @ApiSuccess(201, { description: 'Sent', type: MessageDto, example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async send(@CurrentActor() actor: Actor, @Body() body: SendMessageDto) {
    const m = await this.conversations.customerSend(customer(actor), body.body);
    return messageDto({ ...m, senderUser: null });
  }
}

// =====================================================================================================
// Admin: the CS inbox and the rich menus
// =====================================================================================================

@ApiSurface('admin', 'conversations')
@Controller('conversations')
export class AdminConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @Can('conversations.read')
  @ApiEndpoint({
    id: 'admin.conversations.list',
    summary: 'The CS inbox',
    description: 'Latest activity first; filter by status and assignee.',
    implements: ['D-151', 'D-143'],
  })
  @ApiPaginated(ConversationDto, { example: CONVERSATION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ConversationListQuery) {
    const me = staff(actor);
    const where: Prisma.ConversationWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.assigned === 'me' && { assignedUserId: me.userId }),
      ...(q.assigned === 'unassigned' && { assignedUserId: null }),
    };
    const [rows, total] = await this.conversations.list(where, q.page, q.perPage);
    return { data: rows.map(conversationDto), meta: { page: q.page, perPage: q.perPage, total } };
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
    return conversationDto(await this.conversations.get(id));
  }

  @Get(':conversationId/messages')
  @Can('conversations.read')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.messages',
    summary: 'Messages of a conversation',
    description: 'Newest first, cursor-paged.',
    implements: ['D-151'],
  })
  @ApiCursorPaginated(MessageDto, { example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async messages(@Param('conversationId', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    const c = await this.conversations.get(id);
    const page = await this.conversations.messages(c.id, q.cursor, q.limit);
    return { data: page.data.map(messageDto), meta: page.meta };
  }

  @Post(':conversationId/messages')
  @Idempotent()
  @Can('conversations.reply')
  @conversationParam
  @ApiEndpoint({
    id: 'admin.conversations.reply',
    summary: 'Reply to the customer',
    description:
      'Pushed to the customer’s LINE for LINE conversations; live on the web otherwise. Assigns the conversation to me when unassigned.',
    implements: ['D-151', 'D-143'],
  })
  @ApiBody({
    type: SendMessageDto,
    examples: { default: { value: { body: 'คำสั่งซื้อของคุณกำลังผลิตค่ะ' } } },
  })
  @ApiSuccess(201, {
    description: 'Sent',
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
    @Body() body: SendMessageDto,
  ) {
    const me = staff(actor);
    const m = await this.conversations.reply(me, id, body.body);
    const user = await this.conversations.sender(me.userId);
    return messageDto({ ...m, senderUser: user });
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
    return conversationDto(await this.conversations.get(id));
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
    return conversationDto(await this.conversations.get(id));
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
