import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import {
  type LocaleCode,
  type NotificationAudience,
  type NotificationCategory,
  type NotificationChannel,
  Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

import { assertTemplateCompiles, renderTemplate } from './template-renderer';

export const TEMPLATE_INCLUDE = {
  versions: { orderBy: [{ locale: 'asc' }, { versionNo: 'desc' }] },
} satisfies Prisma.NotificationTemplateInclude;
export type TemplateWithVersions = Prisma.NotificationTemplateGetPayload<{
  include: typeof TEMPLATE_INCLUDE;
}>;
export const ROUTE_INCLUDE = { template: true, staffTeam: true } satisfies Prisma.NotificationRouteInclude;
export type RouteDetail = Prisma.NotificationRouteGetPayload<{ include: typeof ROUTE_INCLUDE }>;

/**
 * Notification templates (versioned per locale: draft → published → retired) and the routing matrix
 * event × audience × channel (D-143). Changes are audited (`config`).
 */
@Injectable()
export class NotificationsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listTemplates(): Promise<TemplateWithVersions[]> {
    return this.prisma.notificationTemplate.findMany({
      include: TEMPLATE_INCLUDE,
      orderBy: [{ key: 'asc' }, { channel: 'asc' }],
    });
  }

  async getTemplate(publicId: string): Promise<TemplateWithVersions> {
    const template = await this.prisma.notificationTemplate.findUnique({
      where: { publicId },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new DomainException('http.not_found');
    return template;
  }

  async createTemplate(
    actor: UserActor,
    input: { key: string; channel: NotificationChannel; category: NotificationCategory; description: string },
  ): Promise<TemplateWithVersions> {
    try {
      return await this.prisma.withTx(async (tx) => {
        const template = await tx.notificationTemplate.create({
          data: { ...input, createdById: actor.userId, updatedById: actor.userId },
          include: TEMPLATE_INCLUDE,
        });
        await this.audit.record(tx, {
          category: 'config',
          action: 'notification_template.created',
          resourceType: 'notification_template',
          resourcePublicId: template.publicId,
          data: input,
        });
        return template;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainException('http.conflict');
      throw error;
    }
  }

  async addVersion(
    actor: UserActor,
    publicId: string,
    input: { locale: LocaleCode; subject?: string; body: string },
  ): Promise<TemplateWithVersions> {
    const template = await this.getTemplate(publicId);
    for (const [path, source] of [
      ['body', input.body],
      ['subject', input.subject ?? ''],
    ] as const) {
      try {
        assertTemplateCompiles(source);
      } catch (error) {
        throw new DomainException('validation.failed', {
          errors: [
            {
              path,
              code: 'template',
              message: error instanceof Error ? error.message.split('\n')[0]! : 'does not compile',
            },
          ],
        });
      }
    }
    if (template.channel === 'email' && !input.subject) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'subject', code: 'required', message: 'e-mail templates need a subject' }],
      });
    }
    await this.prisma.withTx(async (tx) => {
      const last = await tx.notificationTemplateVersion.findFirst({
        where: { templateId: template.id, locale: input.locale },
        orderBy: { versionNo: 'desc' },
      });
      await tx.notificationTemplateVersion.create({
        data: {
          templateId: template.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          locale: input.locale,
          subject: input.subject ?? null,
          body: input.body,
          status: 'draft',
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'notification_template.version_added',
        resourceType: 'notification_template',
        resourcePublicId: template.publicId,
        data: { locale: input.locale },
      });
    });
    return this.getTemplate(publicId);
  }

  /** Publishes a draft; the previously published version of that locale is retired. */
  async publish(
    actor: UserActor,
    publicId: string,
    locale: LocaleCode,
    versionNo: number,
  ): Promise<TemplateWithVersions> {
    const template = await this.getTemplate(publicId);
    await this.prisma.withTx(async (tx) => {
      const version = await tx.notificationTemplateVersion.findFirst({
        where: { templateId: template.id, locale, versionNo },
      });
      if (!version) throw new DomainException('http.not_found');
      if (version.status !== 'draft') throw new DomainException('http.conflict');
      await tx.notificationTemplateVersion.updateMany({
        where: { templateId: template.id, locale, status: 'published' },
        data: { status: 'retired' },
      });
      await tx.notificationTemplateVersion.update({
        where: { id: version.id },
        data: { status: 'published', publishedAt: new Date(), publishedById: actor.userId },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'notification_template.published',
        resourceType: 'notification_template',
        resourcePublicId: template.publicId,
        data: { locale, versionNo },
      });
    });
    return this.getTemplate(publicId);
  }

  async preview(
    publicId: string,
    input: { locale: LocaleCode; versionNo?: number; payload: Record<string, unknown> },
  ) {
    const template = await this.getTemplate(publicId);
    const version =
      template.versions.find(
        (v) =>
          v.locale === input.locale &&
          (input.versionNo ? v.versionNo === input.versionNo : v.status === 'published'),
      ) ?? template.versions.find((v) => v.locale === input.locale);
    if (!version) throw new DomainException('http.not_found');
    return renderTemplate(template.channel, version, {
      event: { type: template.key.split(':')[0], occurredAt: new Date().toISOString() },
      payload: input.payload,
      recipient: { displayName: 'ผู้รับ ทดสอบ' },
    });
  }

  listRoutes(): Promise<RouteDetail[]> {
    return this.prisma.notificationRoute.findMany({
      include: ROUTE_INCLUDE,
      orderBy: [{ eventType: 'asc' }, { audience: 'asc' }, { channel: 'asc' }],
    });
  }

  async createRoute(
    actor: UserActor,
    input: {
      eventType: string;
      audience: NotificationAudience;
      staffTeamCode?: string;
      templateId: string;
      isCritical: boolean;
      isMarketing: boolean;
      conditions?: Record<string, unknown>;
    },
  ): Promise<RouteDetail> {
    const template = await this.prisma.notificationTemplate.findUnique({
      where: { publicId: input.templateId },
    });
    if (!template) throw new DomainException('http.not_found');
    const team = input.staffTeamCode
      ? await this.prisma.team.findUnique({ where: { code: input.staffTeamCode } })
      : null;
    if ((input.audience === 'staff_team') !== (team !== null)) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'staffTeam',
            code: 'staffTeam',
            message: 'staff_team routes need a team; other audiences must not have one',
          },
        ],
      });
    }
    if (template.channel === 'sms' && !input.isCritical) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'isCritical', code: 'd143', message: 'SMS is only for critical events (D-143)' }],
      });
    }
    try {
      return await this.prisma.withTx(async (tx) => {
        const route = await tx.notificationRoute.create({
          data: {
            eventType: input.eventType,
            audience: input.audience,
            staffTeamId: team?.id ?? null,
            channel: template.channel,
            templateId: template.id,
            isCritical: input.isCritical,
            isMarketing: input.isMarketing || template.category === 'marketing',
            conditions: (input.conditions ?? undefined) as Prisma.InputJsonValue | undefined,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          include: ROUTE_INCLUDE,
        });
        await this.audit.record(tx, {
          category: 'config',
          action: 'notification_route.created',
          resourceType: 'notification_route',
          resourcePublicId: route.publicId,
          data: { ...input },
        });
        return route;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainException('http.conflict');
      throw error;
    }
  }

  async setRouteEnabled(actor: UserActor, publicId: string, enabled: boolean): Promise<RouteDetail> {
    const existing = await this.prisma.notificationRoute.findUnique({ where: { publicId } });
    if (!existing) throw new DomainException('http.not_found');
    return this.prisma.withTx(async (tx) => {
      const route = await tx.notificationRoute.update({
        where: { id: existing.id },
        data: { enabled, updatedById: actor.userId, rowVersion: { increment: 1 } },
        include: ROUTE_INCLUDE,
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'notification_route.changed',
        resourceType: 'notification_route',
        resourcePublicId: route.publicId,
        data: { enabled },
      });
      return route;
    });
  }
}
