import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { AuditService } from '@platform/audit/audit.service';

import { ConsentPurposesAdminService } from './consent-purposes-admin.service';
import { MyNotificationsService } from './my-notifications.service';
import { NoAddressError, NotificationDelivery } from './notification-delivery';
import {
  AddTemplateVersionDto,
  AdminConsentDto,
  ConsentPurposeDto,
  CreateRouteDto,
  CreateTemplateDto,
  NotificationRouteDto,
  NotificationTemplateDto,
  PreviewTemplateDto,
  PublishConsentTextDto,
  RenderedMessageDto,
  ROUTE_EXAMPLE,
  SetRouteEnabledDto,
  TEMPLATE_EXAMPLE,
  TestSendResultDto,
} from './notifications.dto';
import {
  NotificationsAdminService,
  type RouteDetail,
  type TemplateWithVersions,
} from './notifications-admin.service';

const staff = (actor: Actor): UserActor => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};

const toTemplateDto = (t: TemplateWithVersions): NotificationTemplateDto => ({
  id: t.publicId,
  key: t.key,
  channel: t.channel,
  category: t.category,
  description: t.description,
  versions: t.versions.map((v) => ({
    versionNo: v.versionNo,
    locale: v.locale,
    subject: v.subject,
    body: v.body,
    status: v.status,
    publishedAt: v.publishedAt ? toBangkokIso(v.publishedAt) : null,
  })),
});

const toRouteDto = (r: RouteDetail): NotificationRouteDto => ({
  id: r.publicId,
  eventType: r.eventType,
  audience: r.audience,
  staffTeam: r.staffTeam?.code ?? null,
  channel: r.channel,
  template: r.template.key,
  isCritical: r.isCritical,
  isMarketing: r.isMarketing,
  enabled: r.enabled,
});

@ApiSurface('admin', 'notificationTemplates')
@Controller('notification-templates')
export class NotificationTemplatesController {
  constructor(
    private readonly admin: NotificationsAdminService,
    private readonly delivery: NotificationDelivery,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Can('notification_templates.manage')
  @ApiEndpoint({
    id: 'admin.notificationTemplates.list',
    summary: 'List notification templates',
    description: 'Templates per event key and channel, with their th/en versions.',
    implements: ['D-143'],
  })
  @ApiSuccess(200, { description: 'Templates', type: [NotificationTemplateDto], example: [TEMPLATE_EXAMPLE] })
  @ApiStandardErrors('http.not_found')
  async list(): Promise<NotificationTemplateDto[]> {
    return (await this.admin.listTemplates()).map(toTemplateDto);
  }

  @Post()
  @Can('notification_templates.manage')
  @ApiEndpoint({
    id: 'admin.notificationTemplates.create',
    summary: 'Create a template',
    description: 'One template per key and channel; add versions per locale, then publish.',
    implements: ['D-143'],
  })
  @ApiBody({
    type: CreateTemplateDto,
    examples: {
      default: {
        value: {
          key: 'approval.requested:assignee',
          channel: 'in_app',
          category: 'transactional',
          description: 'Approvers: a request waits for your decision',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Created',
    type: NotificationTemplateDto,
    example: { ...TEMPLATE_EXAMPLE, versions: [] },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed', 'http.conflict')
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateTemplateDto,
  ): Promise<NotificationTemplateDto> {
    return toTemplateDto(await this.admin.createTemplate(staff(actor), body));
  }

  @Post(':templateId/versions')
  @Can('notification_templates.manage')
  @ApiEndpoint({
    id: 'admin.notificationTemplates.addVersion',
    summary: 'Add a draft version for a locale',
    description: 'The template must compile (Handlebars; MJML for e-mail). E-mail needs a subject.',
    implements: ['D-143'],
  })
  @ApiBody({
    type: AddTemplateVersionDto,
    examples: {
      default: {
        value: {
          locale: 'th',
          subject: 'มีคำขออนุมัติรอคุณ',
          body: 'คำขอ {{payload.policyKey}} รอการอนุมัติของคุณ',
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Draft added', type: NotificationTemplateDto, example: TEMPLATE_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async addVersion(
    @CurrentActor() actor: Actor,
    @Param('templateId', ParseUUIDPipe) id: string,
    @Body() body: AddTemplateVersionDto,
  ): Promise<NotificationTemplateDto> {
    return toTemplateDto(await this.admin.addVersion(staff(actor), id, body));
  }

  @Post(':templateId/versions/:locale/:versionNo/actions/publish')
  @HttpCode(200)
  @Can('notification_templates.manage')
  @ApiEndpoint({
    id: 'admin.notificationTemplates.publish',
    summary: 'Publish a draft version',
    description: 'The previously published version of that locale is retired. Audited.',
    implements: ['D-143'],
  })
  @ApiSuccess(200, { description: 'Published', type: NotificationTemplateDto, example: TEMPLATE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'http.conflict', 'validation.failed')
  async publish(
    @CurrentActor() actor: Actor,
    @Param('templateId', ParseUUIDPipe) id: string,
    @Param('locale') locale: string,
    @Param('versionNo', ParseIntPipe) versionNo: number,
  ): Promise<NotificationTemplateDto> {
    if (locale !== 'th' && locale !== 'en')
      throw new DomainException('validation.failed', {
        errors: [{ path: 'locale', code: 'isIn', message: 'th or en' }],
      });
    return toTemplateDto(await this.admin.publish(staff(actor), id, locale, versionNo));
  }

  @Post(':templateId/actions/preview')
  @HttpCode(200)
  @Can('notification_templates.manage')
  @ApiEndpoint({
    id: 'admin.notificationTemplates.preview',
    summary: 'Render a template with a sample payload',
    description: 'Nothing is sent.',
    implements: ['D-143'],
  })
  @ApiBody({
    type: PreviewTemplateDto,
    examples: { default: { value: { locale: 'th', payload: { policyKey: 'discount_memo' } } } },
  })
  @ApiSuccess(200, {
    description: 'Rendered',
    type: RenderedMessageDto,
    example: { subject: 'มีคำขออนุมัติรอคุณ', body: 'คำขอ discount_memo รอการอนุมัติของคุณ' },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async preview(
    @Param('templateId', ParseUUIDPipe) id: string,
    @Body() body: PreviewTemplateDto,
  ): Promise<RenderedMessageDto> {
    const rendered = await this.admin.preview(id, body);
    return { subject: rendered.subject, body: rendered.body };
  }

  @Post(':templateId/actions/test-send')
  @HttpCode(200)
  @Can('notification_templates.manage')
  @ApiEndpoint({
    id: 'admin.notificationTemplates.testSend',
    summary: 'Send a test to my own address',
    description:
      'E-mail, SMS or LINE to the signed-in staff member only (never to others). Audited; not logged as a notification.',
    implements: ['D-143'],
  })
  @ApiBody({
    type: PreviewTemplateDto,
    examples: { default: { value: { locale: 'th', payload: { policyKey: 'discount_memo' } } } },
  })
  @ApiSuccess(200, { description: 'Sent', type: TestSendResultDto, example: { sentTo: 'f***@example.com' } })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'notification.channel_unsupported',
    'provider.unavailable',
  )
  async testSend(
    @CurrentActor() actor: Actor,
    @Param('templateId', ParseUUIDPipe) id: string,
    @Body() body: PreviewTemplateDto,
  ): Promise<TestSendResultDto> {
    const me = staff(actor);
    const template = await this.admin.getTemplate(id);
    const rendered = await this.admin.preview(id, body);
    try {
      const { masked } = await this.delivery.testSend(me.userId, template.channel, rendered);
      await this.audit.recordStandalone({
        category: 'config',
        action: 'notification_template.test_sent',
        resourceType: 'notification_template',
        resourcePublicId: template.publicId,
        data: { channel: template.channel },
      });
      return { sentTo: masked };
    } catch (error) {
      if (error instanceof NoAddressError) throw new DomainException('notification.channel_unsupported');
      throw error;
    }
  }
}

@ApiSurface('admin', 'notificationRoutes')
@Controller('notification-routes')
export class NotificationRoutesController {
  constructor(private readonly admin: NotificationsAdminService) {}

  @Get()
  @Can('notification_routes.manage')
  @ApiEndpoint({
    id: 'admin.notificationRoutes.list',
    summary: 'The routing matrix',
    description: 'Event × audience × channel → template (D-143).',
    implements: ['D-143', 'D-144'],
  })
  @ApiSuccess(200, { description: 'Routes', type: [NotificationRouteDto], example: [ROUTE_EXAMPLE] })
  @ApiStandardErrors('http.not_found')
  async list(): Promise<NotificationRouteDto[]> {
    return (await this.admin.listRoutes()).map(toRouteDto);
  }

  @Post()
  @Can('notification_routes.manage')
  @ApiEndpoint({
    id: 'admin.notificationRoutes.create',
    summary: 'Add a route to the matrix',
    description:
      'SMS routes must be critical (D-143); marketing routes get consent and quiet-hour handling (D-144).',
    implements: ['D-143', 'D-144'],
  })
  @ApiBody({
    type: CreateRouteDto,
    examples: {
      default: {
        value: {
          eventType: 'approval.requested',
          audience: 'assignee',
          templateId: TEMPLATE_EXAMPLE.id,
          isCritical: false,
          isMarketing: false,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: NotificationRouteDto, example: ROUTE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'http.conflict',
    'validation.failed',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateRouteDto): Promise<NotificationRouteDto> {
    return toRouteDto(
      await this.admin.createRoute(staff(actor), {
        eventType: body.eventType,
        audience: body.audience,
        ...(body.staffTeam && { staffTeamCode: body.staffTeam }),
        templateId: body.templateId,
        isCritical: body.isCritical,
        isMarketing: body.isMarketing,
        ...(body.conditions && { conditions: body.conditions }),
      }),
    );
  }

  @Post(':routeId/actions/set-enabled')
  @HttpCode(200)
  @Can('notification_routes.manage')
  @ApiEndpoint({
    id: 'admin.notificationRoutes.setEnabled',
    summary: 'Switch a route on or off',
    description: 'Audited.',
    implements: ['D-143'],
  })
  @ApiBody({ type: SetRouteEnabledDto, examples: { default: { value: { enabled: false } } } })
  @ApiSuccess(200, {
    description: 'Updated',
    type: NotificationRouteDto,
    example: { ...ROUTE_EXAMPLE, enabled: false },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async setEnabled(
    @CurrentActor() actor: Actor,
    @Param('routeId', ParseUUIDPipe) id: string,
    @Body() body: SetRouteEnabledDto,
  ): Promise<NotificationRouteDto> {
    return toRouteDto(await this.admin.setRouteEnabled(staff(actor), id, body.enabled));
  }
}

@ApiSurface('admin', 'consentPurposes')
@Controller('consent-purposes')
export class ConsentPurposesController {
  constructor(private readonly purposes: ConsentPurposesAdminService) {}

  private static toDto(p: Awaited<ReturnType<ConsentPurposesAdminService['publish']>>): ConsentPurposeDto {
    return {
      key: p.key,
      required: p.required,
      versions: p.versions.map((v) => ({
        versionNo: v.versionNo,
        effectiveFrom: toBangkokIso(v.effectiveFrom),
        textTh: v.textTh,
        textEn: v.textEn,
      })),
    };
  }

  @Get()
  @Can('consent_purposes.manage')
  @ApiEndpoint({
    id: 'admin.consentPurposes.list',
    summary: 'Consent purposes and their texts',
    description: "Packio's own PDPA consent management (D-005, D-144).",
    implements: ['D-005', 'D-144'],
  })
  @ApiSuccess(200, {
    description: 'Purposes',
    type: [ConsentPurposeDto],
    example: [
      {
        key: 'marketing_line',
        required: false,
        versions: [
          {
            versionNo: 1,
            effectiveFrom: '2026-10-01T00:00:00+07:00',
            textTh: 'ข้าพเจ้ายินยอมรับข่าวสาร…',
            textEn: 'I agree to receive news…',
          },
        ],
      },
    ],
  })
  @ApiStandardErrors('http.not_found')
  async list(): Promise<ConsentPurposeDto[]> {
    return (await this.purposes.list()).map((p) => ConsentPurposesController.toDto(p));
  }

  @Post(':key/versions')
  @Can('consent_purposes.manage')
  @ApiEndpoint({
    id: 'admin.consentPurposes.publishText',
    summary: 'Publish a new consent text from a date',
    description:
      'Versioned and effective-dated; earlier consents stay tied to the text they accepted (ADR-0005).',
    implements: ['D-144', 'ADR-0005'],
  })
  @ApiBody({
    type: PublishConsentTextDto,
    examples: {
      default: {
        value: {
          textTh: 'ข้าพเจ้ายินยอมรับข่าวสาร…',
          textEn: 'I agree to receive news…',
          effectiveFrom: '2026-10-01T00:00:00+07:00',
          reason: 'Text approved by legal counsel',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Published',
    type: ConsentPurposeDto,
    example: {
      key: 'marketing_line',
      required: false,
      versions: [
        {
          versionNo: 1,
          effectiveFrom: '2026-10-01T00:00:00+07:00',
          textTh: 'ข้าพเจ้ายินยอมรับข่าวสาร…',
          textEn: 'I agree to receive news…',
        },
      ],
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'settings.backdated',
  )
  async publish(
    @CurrentActor() actor: Actor,
    @Param('key') key: string,
    @Body() body: PublishConsentTextDto,
  ): Promise<ConsentPurposeDto> {
    return ConsentPurposesController.toDto(await this.purposes.publish(staff(actor), key, body));
  }
}

@ApiSurface('admin', 'consentPurposes')
@Controller('customers/:customerId/consents')
export class AdminCustomerConsentsController {
  constructor(
    private readonly mine: MyNotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Can('customers.read')
  @ApiParam({ name: 'customerId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.consentPurposes.customerConsents',
    summary: 'A customer’s PDPA consents',
    description:
      'Every purpose with the text version in force and the customer’s latest decision — granted or not, for ' +
      'which version, from where and when (D-144, D-222). Read-only.',
    implements: ['D-144', 'D-222'],
  })
  @ApiSuccess(200, {
    description: 'Consents',
    type: [AdminConsentDto],
    example: [
      {
        purpose: 'marketing_line',
        required: false,
        versionNo: 2,
        granted: true,
        decidedVersionNo: 1,
        outdated: true,
        source: 'web',
        recordedAt: '2026-10-01T10:00:00+07:00',
      },
    ],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@Param('customerId', ParseUUIDPipe) customerId: string): Promise<AdminConsentDto[]> {
    const user = await this.prisma.user.findFirst({ where: { publicId: customerId, kind: 'customer' } });
    if (!user) throw new DomainException('http.not_found');
    return (await this.mine.consents(user.id)).map(({ purpose, version, latest }) => ({
      purpose: purpose.key,
      required: purpose.required,
      versionNo: version?.versionNo ?? null,
      granted: latest?.granted ?? null,
      decidedVersionNo: latest?.purposeVersion.versionNo ?? null,
      outdated: latest !== null && version !== null && latest.purposeVersionId !== version.id,
      source: latest?.source ?? null,
      recordedAt: latest ? toBangkokIso(latest.recordedAt) : null,
    }));
  }
}
