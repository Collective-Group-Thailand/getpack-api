import { randomUUID } from 'node:crypto';

import { systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgentSalesChannel } from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { csvCell, localPhone } from './agent-lead-rules';
import { normalisePhone, recordAgentEvent } from './agent-shared';

/** P7: the consent purpose a waiting-list sign-up relies on (seeded identity; legal counsel enters its text). */
export const WAITLIST_PURPOSE = 'agent_waitlist';
const EXPORT_URL_TTL_SECONDS = 5 * 60;

export interface WaitlistJoinInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  salesChannel?: SalesAgentSalesChannel | null;
  consentVersionNo: number;
}

/** The consent text in force for the waiting list (null: none published yet — the list is closed). */
export async function waitlistConsentInForce(db: Tx, at = new Date()) {
  return db.consentPurposeVersion.findFirst({
    where: { purpose: { key: WAITLIST_PURPOSE }, status: 'approved', effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
  });
}

/** Normalised contact of a sign-up (pure, unit-tested): E.164 phone, lower-case e-mail, at least one. */
export function waitlistContact(input: Pick<WaitlistJoinInput, 'phone' | 'email'>): {
  phone: string | null;
  email: string | null;
} {
  const phone = normalisePhone(input.phone?.trim() || null);
  const email = input.email?.trim().toLowerCase() || null;
  return { phone, email };
}

export const WAITLIST_CSV_HEADER = [
  'name',
  'phone',
  'email',
  'sales_channel',
  'joined_at',
  'last_joined_at',
  'joins',
];

export function waitlistCsv(
  rows: {
    name: string;
    phone: string | null;
    email: string | null;
    salesChannel: string | null;
    createdAt: Date;
    lastJoinedAt: Date;
    joinCount: number;
  }[],
): string {
  const lines = [WAITLIST_CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows)
    lines.push(
      [
        r.name,
        localPhone(r.phone),
        r.email ?? '',
        r.salesChannel ?? '',
        bangkokDate(r.createdAt),
        bangkokDate(r.lastJoinedAt),
        r.joinCount,
      ]
        .map(csvCell)
        .join(','),
    );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * P7 pilot switch: the public landing's waiting list while sign-up is closed. Anonymous and throttled; the consent
 * text in force (purpose `agent_waitlist`) is recorded with its evidence; a repeat sign-up with a known phone or
 * e-mail refreshes the row and answers exactly like a new one (neutral, nothing echoed). Sales Manager and C-Level list
 * and export it (`agent_waitlist.read`; exports audited, transient 5-minute link).
 */
@Injectable()
export class AgentWaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  consentText(at = new Date()) {
    return waitlistConsentInForce(this.prisma, at);
  }

  async join(
    input: WaitlistJoinInput,
    evidence: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    const { phone, email } = waitlistContact(input);
    if (!phone && !email)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'phone', code: 'required', message: 'a phone number or an e-mail' }],
      });
    const name = input.name.trim();
    await this.prisma.withTx(async (tx) => {
      const consent = await waitlistConsentInForce(tx);
      if (!consent) throw new DomainException('agents.waitlist_closed');
      if (consent.versionNo !== input.consentVersionNo)
        throw new DomainException('agents.waitlist_consent_outdated', {
          params: { versionNo: consent.versionNo },
        });
      const record = await tx.consentRecord.create({
        data: {
          anonymousId: randomUUID(),
          purposeId: consent.purposeId,
          purposeVersionId: consent.id,
          granted: true,
          source: 'web',
          ip: evidence.ip,
          userAgent: evidence.userAgent?.slice(0, 500) ?? null,
        },
      });
      const or: Prisma.SalesAgentWaitlistEntryWhereInput[] = [];
      if (phone) or.push({ phone });
      if (email) or.push({ email });
      const existing = await tx.salesAgentWaitlistEntry.findFirst({
        where: { OR: or },
        orderBy: { id: 'asc' },
      });
      const now = new Date();
      const row = existing
        ? await tx.salesAgentWaitlistEntry.update({
            where: { id: existing.id },
            data: {
              name,
              // Fill a missing contact only when no other row holds it (unique per phone / e-mail).
              ...(phone &&
                !existing.phone &&
                !(await tx.salesAgentWaitlistEntry.findUnique({ where: { phone } })) && { phone }),
              ...(email &&
                !existing.email &&
                !(await tx.salesAgentWaitlistEntry.findUnique({ where: { email } })) && { email }),
              ...(input.salesChannel && { salesChannel: input.salesChannel }),
              consentRecordId: record.id,
              joinCount: { increment: 1 },
              lastJoinedAt: now,
              rowVersion: { increment: 1 },
            },
          })
        : await tx.salesAgentWaitlistEntry.create({
            data: {
              name,
              phone,
              email,
              salesChannel: input.salesChannel ?? null,
              consentRecordId: record.id,
              lastJoinedAt: now,
            },
          });
      // No personal data in the event or the activity: ids only (PDPA).
      await recordAgentEvent(this, tx, {
        type: existing ? 'sales_agent_waitlist.refreshed' : 'sales_agent_waitlist.joined',
        aggregateType: 'sales_agent_waitlist',
        aggregateId: row.publicId,
        payload: { entryId: row.publicId },
        actor: systemActor('agents.waitlist'),
      });
    });
  }

  async list(q: { page: number; perPage: number; q?: string }) {
    const text = q.q?.trim();
    const where: Prisma.SalesAgentWaitlistEntryWhereInput = text
      ? {
          OR: [
            { name: { contains: text, mode: 'insensitive' } },
            { email: { contains: text, mode: 'insensitive' } },
            { phone: { contains: normalisePhone(text) ?? text } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.salesAgentWaitlistEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.salesAgentWaitlistEntry.count({ where }),
    ]);
    return { rows, total };
  }

  async exportCsv(actor: UserActor): Promise<{ url: string; expiresAt: Date; rows: number }> {
    const rows = await this.prisma.salesAgentWaitlistEntry.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const body = Buffer.from(waitlistCsv(rows), 'utf8');
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: `agent-waitlist-${bangkokDate(now)}.csv`,
        mimeType: 'text/csv',
        sizeBytes: BigInt(body.length),
        uploadStatus: 'uploaded',
        // Generated by the system from its own data: nothing to scan.
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: 'transient',
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `transient/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, body, 'text/csv; charset=utf-8');
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
    await this.audit.recordStandalone({
      category: 'export',
      action: 'export.generated',
      actor,
      resourceType: 'sales_agent_waitlist',
      data: { kind: 'agent_waitlist', rows: rows.length, fileId: file.publicId },
    });
    const url = await this.storage.presignGet(storageKey, {
      expiresInSeconds: EXPORT_URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: 'text/csv',
    });
    return { url, expiresAt: new Date(now.getTime() + EXPORT_URL_TTL_SECONDS * 1000), rows: rows.length };
  }
}
