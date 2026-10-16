import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated, ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PrismaService } from '@database/prisma.service';
import { type ConversationMessage } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { CannedResponsesService } from './canned-responses.service';
import { messageViews, storeThreadView } from './conversation-views';
import { MESSAGE_EXAMPLE, MessageDto, MessagesQuery } from './conversations.dto';
import { ConversationsService } from './conversations.service';
import {
  CANNED_EXAMPLE,
  CannedListQuery,
  CannedResponseDto,
  OpenThreadDto,
  PostMessageDto,
  ReplyChannelDto,
  SaveCannedResponseDto,
  SENT_EXAMPLE,
  SentDto,
  STORE_THREAD_EXAMPLE,
  StoreThreadDto,
} from './threads.dto';

const DECISIONS = ['D-300', 'D-151', 'D-221'];
const threadParam = ApiParam({ name: 'conversationId', format: 'uuid' });
const cannedParam = ApiParam({ name: 'cannedResponseId', format: 'uuid' });

function user(actor: Actor, audience: 'customer' | 'staff'): UserActor {
  if (actor.type !== 'user' || actor.audience !== audience) throw new DomainException('auth.forbidden');
  return actor;
}

/** The customer's threads with getpack CS (D-300): the support chat and one per order, design or RFQ of theirs. */
@ApiSurface('store', 'conversations')
@Controller('conversations')
export class StoreThreadsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
  ) {}

  private async sent(r: {
    conversation: { publicId: string };
    messages: ConversationMessage[];
  }): Promise<SentDto> {
    const rows = await this.conversations.messageRows(r.messages.map((m) => m.id));
    return { conversationId: r.conversation.publicId, messages: await messageViews(this.prisma, rows) };
  }

  @Get()
  @ApiEndpoint({
    id: 'store.conversations.list',
    summary: 'My threads with getpack',
    description:
      'Latest activity first (up to 100): the support chat and the threads about my orders, designs, RFQs and RFQ ' +
      'baskets, each with its unread count, where replies go and when getpack last read it (D-300).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Threads', type: [StoreThreadDto], example: [STORE_THREAD_EXAMPLE] })
  @ApiStandardErrors()
  async list(@CurrentActor() actor: Actor): Promise<StoreThreadDto[]> {
    const rows = await this.conversations.customerThreads(user(actor, 'customer').userId);
    return Promise.all(
      rows.map(({ row, unread }) =>
        storeThreadView(this.prisma, row, unread, this.conversations.effectiveReplyChannel(row)),
      ),
    );
  }

  @Post()
  @Idempotent()
  @ApiEndpoint({
    id: 'store.conversations.open',
    summary: 'Write to getpack about something',
    description:
      'Opens (or continues) my live thread about the support chat or one of my orders, designs or RFQs, with my first ' +
      'message: text, my uploaded and scanned files (one message each) and / or a card to one of my records. Someone ' +
      'else’s record → 422 (never confirms it exists). The first message waiting for an answer starts the D-221 ' +
      'first-response clock.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: OpenThreadDto,
    examples: {
      default: {
        value: {
          subjectType: 'order',
          subjectId: '0192f3a0-7c1e-7d2a-9b1f-0000000f4005',
          body: 'ขอแก้ไขสีโลโก้ค่ะ',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Sent', type: SentDto, example: SENT_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async open(@CurrentActor() actor: Actor, @Body() body: OpenThreadDto): Promise<SentDto> {
    return this.sent(await this.conversations.openThread(user(actor, 'customer'), body));
  }

  @Get(':conversationId')
  @threadParam
  @ApiEndpoint({
    id: 'store.conversations.getThread',
    summary: 'One of my threads',
    description: 'Another customer’s thread → 404 (D-300).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Thread', type: StoreThreadDto, example: STORE_THREAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
  ): Promise<StoreThreadDto> {
    const me = user(actor, 'customer');
    const row = await this.conversations.customerThread(me.userId, id);
    return storeThreadView(
      this.prisma,
      row,
      await this.conversations.unreadFor(row, me.userId),
      this.conversations.effectiveReplyChannel(row),
    );
  }

  @Get(':conversationId/messages')
  @threadParam
  @ApiEndpoint({
    id: 'store.conversations.listThreadMessages',
    summary: 'Messages of one of my threads',
    description:
      'Newest first, cursor-paged; never getpack’s internal notes. Reading moves my read position (D-300) — getpack ' +
      'sees it as a read receipt.',
    implements: DECISIONS,
  })
  @ApiCursorPaginated(MessageDto, { example: MESSAGE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async messages(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Query() q: MessagesQuery,
  ) {
    const me = user(actor, 'customer');
    const row = await this.conversations.customerThread(me.userId, id);
    const page = await this.conversations.messages(row.id, q.cursor, q.limit);
    await this.conversations.markReadByCustomer(row.id, me.userId);
    return { data: await messageViews(this.prisma, page.data), meta: page.meta };
  }

  @Post(':conversationId/messages')
  @Idempotent()
  @threadParam
  @ApiEndpoint({
    id: 'store.conversations.post',
    summary: 'Write in one of my threads',
    description:
      'Text, files and / or a card, like opening one. A closed thread continues in a new live thread about the same ' +
      'subject — the response names the thread the messages went into.',
    implements: DECISIONS,
  })
  @ApiBody({ type: PostMessageDto, examples: { default: { value: { body: 'ขอบคุณค่ะ' } } } })
  @ApiSuccess(201, { description: 'Sent', type: SentDto, example: SENT_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async post(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Body() body: PostMessageDto,
  ): Promise<SentDto> {
    return this.sent(await this.conversations.customerPost(user(actor, 'customer'), id, body));
  }

  @Put(':conversationId/reply-channel')
  @threadParam
  @ApiEndpoint({
    id: 'store.conversations.setReplyChannel',
    summary: 'Choose where getpack replies',
    description:
      'On the web / LIFF thread, or on my LINE (D-300) — LINE needs a linked LINE account that follows getpack ' +
      '(`conversations.unreachable` otherwise). Without a choice replies follow the channel of my last message.',
    implements: DECISIONS,
  })
  @ApiBody({ type: ReplyChannelDto, examples: { default: { value: { replyChannel: 'line' } } } })
  @ApiSuccess(200, {
    description: 'Set',
    type: StoreThreadDto,
    example: { ...STORE_THREAD_EXAMPLE, replyChannel: 'line', replyChannelChosen: true },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'conversations.unreachable',
  )
  async setReplyChannel(
    @CurrentActor() actor: Actor,
    @Param('conversationId', ParseUUIDPipe) id: string,
    @Body() body: ReplyChannelDto,
  ): Promise<StoreThreadDto> {
    const me = user(actor, 'customer');
    await this.conversations.setReplyChannel(me, id, body.replyChannel);
    return this.get(actor, id);
  }
}

/** D-300 canned responses for CS replies. */
@ApiSurface('admin', 'conversations')
@Controller('canned-responses')
export class AdminCannedResponsesController {
  constructor(private readonly canned: CannedResponsesService) {}

  @Get()
  @Can('conversations.read')
  @ApiEndpoint({
    id: 'admin.cannedResponses.list',
    summary: 'List canned responses',
    description:
      'By title; `q` searches title and texts, `tag` filters, archived ones only on request (D-300).',
    implements: ['D-300'],
  })
  @ApiPaginated(CannedResponseDto, { example: CANNED_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  list(@Query() q: CannedListQuery) {
    return this.canned.list(q);
  }

  @Post()
  @Idempotent()
  @Can('conversations.manage_canned')
  @ApiEndpoint({
    id: 'admin.cannedResponses.create',
    summary: 'Add a canned response',
    description: 'Thai and English texts; audited (D-300).',
    implements: ['D-300'],
  })
  @ApiBody({ type: SaveCannedResponseDto, examples: { default: { value: CANNED_EXAMPLE } } })
  @ApiSuccess(201, { description: 'Created', type: CannedResponseDto, example: CANNED_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  create(@CurrentActor() actor: Actor, @Body() body: SaveCannedResponseDto) {
    return this.canned.create(user(actor, 'staff'), body);
  }

  @Put(':cannedResponseId')
  @Can('conversations.manage_canned')
  @cannedParam
  @ApiEndpoint({
    id: 'admin.cannedResponses.update',
    summary: 'Change a canned response',
    description: 'Replaces its title, texts and tags; audited with the previous title (D-300).',
    implements: ['D-300'],
  })
  @ApiBody({ type: SaveCannedResponseDto, examples: { default: { value: CANNED_EXAMPLE } } })
  @ApiSuccess(200, { description: 'Saved', type: CannedResponseDto, example: CANNED_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  update(
    @CurrentActor() actor: Actor,
    @Param('cannedResponseId', ParseUUIDPipe) id: string,
    @Body() body: SaveCannedResponseDto,
  ) {
    return this.canned.update(user(actor, 'staff'), id, body);
  }

  @Post(':cannedResponseId/actions/archive')
  @HttpCode(200)
  @Can('conversations.manage_canned')
  @cannedParam
  @ApiEndpoint({
    id: 'admin.cannedResponses.archive',
    summary: 'Archive a canned response',
    description: 'Hidden from the list; messages that used it keep the reference (D-300).',
    implements: ['D-300'],
  })
  @ApiSuccess(200, {
    description: 'Archived',
    type: CannedResponseDto,
    example: { ...CANNED_EXAMPLE, archived: true },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  archive(@CurrentActor() actor: Actor, @Param('cannedResponseId', ParseUUIDPipe) id: string) {
    return this.canned.setArchived(user(actor, 'staff'), id, true);
  }

  @Post(':cannedResponseId/actions/restore')
  @HttpCode(200)
  @Can('conversations.manage_canned')
  @cannedParam
  @ApiEndpoint({
    id: 'admin.cannedResponses.restore',
    summary: 'Restore an archived canned response',
    description: 'Back in the list (D-300).',
    implements: ['D-300'],
  })
  @ApiSuccess(200, { description: 'Restored', type: CannedResponseDto, example: CANNED_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  restore(@CurrentActor() actor: Actor, @Param('cannedResponseId', ParseUUIDPipe) id: string) {
    return this.canned.setArchived(user(actor, 'staff'), id, false);
  }
}
