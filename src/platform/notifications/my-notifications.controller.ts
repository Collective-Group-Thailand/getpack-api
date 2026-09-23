import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiCursorPaginated } from '@common/pagination/api-paginated.decorator';
import { type CursorPage, CursorQuery, DEFAULT_CURSOR_LIMIT } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface, type Surface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  type Type,
} from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';

import { MyNotificationsService } from './my-notifications.service';
import {
  ConsentDto,
  INBOX_EXAMPLE,
  InboxItemDto,
  NotificationPreferenceDto,
  RecordConsentDto,
  SetPreferencesDto,
} from './notifications.dto';

const me = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};

/** The in-app inbox is the same on every surface (D-143: in-app for staff, customers and factories). */
function inboxController(surface: Extract<Surface, 'store' | 'admin' | 'partner'>): Type<unknown> {
  @ApiSurface(surface, 'notifications')
  @Controller('notifications')
  class InboxController {
    constructor(readonly mine: MyNotificationsService) {}

    @Get()
    @ApiEndpoint({
      id: `${surface}.notifications.list`,
      summary: 'My in-app notifications',
      description:
        'Newest first, cursor-paginated. Realtime signals (`notification.created`) tell the client to refetch.',
      implements: ['D-143'],
    })
    @ApiCursorPaginated(InboxItemDto, { example: INBOX_EXAMPLE })
    @ApiStandardErrors('validation.failed')
    async list(@CurrentActor() actor: Actor, @Query() query: CursorQuery): Promise<CursorPage<InboxItemDto>> {
      const { items, nextCursor } = await this.mine.inbox(
        me(actor).userId,
        query.cursor,
        query.limit ?? DEFAULT_CURSOR_LIMIT,
      );
      return {
        data: items.map(({ row, title, body }) => ({
          id: row.eventId,
          eventType: row.event.type,
          title,
          body,
          createdAt: toBangkokIso(row.createdAt),
          readAt: row.readAt ? toBangkokIso(row.readAt) : null,
        })),
        meta: { nextCursor },
      };
    }

    @Post(':notificationId/actions/read')
    @HttpCode(204)
    @ApiEndpoint({
      id: `${surface}.notifications.markRead`,
      summary: 'Mark an in-app notification read',
      description: 'Idempotent.',
      implements: ['D-143'],
    })
    @ApiSuccess(204, { description: 'Marked read' })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async markRead(
      @CurrentActor() actor: Actor,
      @Param('notificationId', ParseUUIDPipe) id: string,
    ): Promise<void> {
      await this.mine.markRead(me(actor).userId, id);
    }
  }
  Object.defineProperty(InboxController, 'name', {
    value: `${surface[0]!.toUpperCase()}${surface.slice(1)}InboxController`,
  });
  return InboxController;
}

export const StoreInboxController = inboxController('store');
export const AdminInboxController = inboxController('admin');
export const PartnerInboxController = inboxController('partner');

@ApiSurface('store', 'me')
@Controller('me')
export class StoreMyNotificationSettingsController {
  constructor(private readonly mine: MyNotificationsService) {}

  @Get('notification-preferences')
  @ApiEndpoint({
    id: 'store.me.notificationPreferences',
    summary: 'My notification channel choices',
    description: 'Unset = default on. Order and finance e-mails cannot be switched off (D-144).',
    implements: ['D-143', 'D-144'],
  })
  @ApiSuccess(200, {
    description: 'Preferences',
    type: [NotificationPreferenceDto],
    example: [{ channel: 'line', category: 'marketing', enabled: false }],
  })
  @ApiStandardErrors('http.not_found')
  async preferences(@CurrentActor() actor: Actor): Promise<NotificationPreferenceDto[]> {
    return (await this.mine.preferences(me(actor).userId)).map((p) => ({
      channel: p.channel,
      category: p.category,
      enabled: p.enabled,
    }));
  }

  @Put('notification-preferences')
  @ApiEndpoint({
    id: 'store.me.setNotificationPreferences',
    summary: 'Change my notification channel choices',
    description: 'Marketing can be switched off on every channel; transactional e-mail cannot (D-144).',
    implements: ['D-143', 'D-144'],
  })
  @ApiBody({
    type: SetPreferencesDto,
    examples: { default: { value: { items: [{ channel: 'line', category: 'marketing', enabled: false }] } } },
  })
  @ApiSuccess(200, {
    description: 'Saved',
    type: [NotificationPreferenceDto],
    example: [{ channel: 'line', category: 'marketing', enabled: false }],
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  async setPreferences(
    @CurrentActor() actor: Actor,
    @Body() body: SetPreferencesDto,
  ): Promise<NotificationPreferenceDto[]> {
    return (await this.mine.setPreferences(me(actor), body.items)).map((p) => ({
      channel: p.channel,
      category: p.category,
      enabled: p.enabled,
    }));
  }

  @Get('consents')
  @ApiEndpoint({
    id: 'store.me.consents',
    summary: 'My PDPA consents',
    description: 'Each purpose with the text in force and my latest decision.',
    implements: ['D-005', 'D-144'],
  })
  @ApiSuccess(200, {
    description: 'Consents',
    type: [ConsentDto],
    example: [
      {
        purpose: 'marketing_line',
        required: false,
        versionNo: 1,
        summary: 'รับข่าวสารและโปรโมชันทาง LINE',
        text: 'ข้าพเจ้ายินยอมรับข่าวสาร…',
        granted: true,
        outdated: false,
      },
    ],
  })
  @ApiStandardErrors('http.not_found')
  async consents(@CurrentActor() actor: Actor): Promise<ConsentDto[]> {
    return toConsentDtos(await this.mine.consents(me(actor).userId));
  }

  @Post('consents')
  @ApiEndpoint({
    id: 'store.me.recordConsent',
    summary: 'Give or withdraw a consent',
    description:
      'Recorded against the text version in force (append-only evidence, PDPA). Marketing messages need it (D-144).',
    implements: ['D-144', 'D-005'],
  })
  @ApiBody({
    type: RecordConsentDto,
    examples: { default: { value: { purpose: 'marketing_line', granted: true, source: 'web' } } },
  })
  @ApiSuccess(201, {
    description: 'Recorded',
    type: [ConsentDto],
    example: [
      {
        purpose: 'marketing_line',
        required: false,
        versionNo: 1,
        summary: 'รับข่าวสารและโปรโมชันทาง LINE',
        text: 'ข้าพเจ้ายินยอมรับข่าวสาร…',
        granted: true,
        outdated: false,
      },
    ],
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'consent.purpose_unavailable',
  )
  async recordConsent(@CurrentActor() actor: Actor, @Body() body: RecordConsentDto): Promise<ConsentDto[]> {
    return toConsentDtos(
      await this.mine.recordConsent(me(actor), body.purpose, body.granted, body.source ?? 'web'),
    );
  }
}

function toConsentDtos(rows: Awaited<ReturnType<MyNotificationsService['consents']>>): ConsentDto[] {
  return rows.map(({ purpose, version, latest }) => ({
    purpose: purpose.key,
    required: purpose.required,
    versionNo: version?.versionNo ?? null,
    summary: version?.summaryTh ?? null,
    text: version?.textTh ?? null,
    granted: latest?.granted ?? null,
    outdated: latest !== null && version !== null && latest.purposeVersionId !== version.id,
  }));
}
