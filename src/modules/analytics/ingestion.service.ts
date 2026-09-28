import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import {
  type AnalyticsEventName,
  normaliseProperties,
  type PropertyError,
  sanitisePagePath,
  sanitiseUtm,
} from './event-schemas';

export const ANALYTICS_CONSENT_PURPOSE = 'analytics_cookies';
/** Late events (offline queues) are accepted for a week; clock skew of a few minutes is tolerated. */
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_SKEW_MS = 5 * 60_000;

export interface IncomingEvent {
  eventId: string;
  name: AnalyticsEventName;
  occurredAt: string;
  anonymousId: string;
  sessionId: string;
  pagePath?: string | null;
  productTypeCode?: string | null;
  properties?: Record<string, unknown> | null;
  utm?: { source?: string; medium?: string; campaign?: string; term?: string; content?: string } | null;
  deviceClass?: string | null;
  postcode?: string | null;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  dropped: number;
}

/**
 * Frontend analytics events through the BFF with consent mode (B6.1, D-102, PDPA): the visitor's
 * `analytics_cookies` consent is resolved on the server from `consent_records` (the signed-in customer's own
 * decision first, else the anonymous visitor's). Without consent an event keeps no identifier (anonymous id,
 * session, user, province) — it only counts as a page view. No IP is stored; `properties` follow a closed
 * schema per event; replays of an event id are ignored.
 */
@Injectable()
export class AnalyticsIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async ingest(actor: Actor | undefined, batch: IncomingEvent[], now = new Date()): Promise<IngestResult> {
    const errors: PropertyError[] = [];
    const normalised = batch.map((e, i) => {
      const { value, errors: found } = normaliseProperties(e.name, e.properties, `events[${i}].properties`);
      errors.push(...found);
      return { event: e, properties: value };
    });
    if (errors.length) throw new DomainException('validation.failed', { errors });

    const fresh = normalised.filter(({ event }) => {
      const at = Date.parse(event.occurredAt);
      return at >= now.getTime() - MAX_AGE_MS && at <= now.getTime() + MAX_SKEW_MS;
    });
    if (fresh.length === 0) return { accepted: 0, duplicates: 0, dropped: batch.length };

    const customer = actor?.type === 'user' && actor.audience === 'customer' ? actor : undefined;
    const consent = await this.consentOf(customer?.userId ?? null, [
      ...new Set(fresh.map((f) => f.event.anonymousId)),
    ]);
    const provinces = await this.provinceCodes(
      fresh.filter((f) => consent(f.event.anonymousId) && f.event.postcode).map((f) => f.event.postcode!),
    );

    const rows = fresh.map(({ event, properties }) => {
      const granted = consent(event.anonymousId);
      return Prisma.sql`(${event.eventId}::uuid, ${new Date(event.occurredAt)}, 'bff', ${event.name},
        ${granted ? event.anonymousId : null}, ${granted ? event.sessionId : null},
        ${granted && customer ? customer.publicId : null}::uuid,
        ${granted ? 'granted' : 'denied'}::analytics.consent_state, ${sanitisePagePath(event.pagePath)},
        ${event.productTypeCode ?? null}, ${JSON.stringify(properties)}::jsonb,
        ${JSON.stringify(sanitiseUtm(event.utm))}::jsonb, ${event.deviceClass ?? null},
        ${granted && event.postcode ? (provinces.get(event.postcode) ?? null) : null})`;
    });
    const inserted = await this.prisma.$queryRaw<{ event_id: string }[]>`
      INSERT INTO analytics.raw_events (event_id, occurred_at, source, event_name, anonymous_id, session_id,
        user_public_id, consent_state, page_path, product_type_code, properties, utm, device_class, province_code)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT DO NOTHING
      RETURNING event_id`;
    return {
      accepted: inserted.length,
      duplicates: fresh.length - inserted.length,
      dropped: batch.length - fresh.length,
    };
  }

  /** `granted(anonymousId)` for this batch: the customer's latest decision wins over the visitor's. */
  private async consentOf(
    userId: bigint | null,
    anonymousIds: string[],
  ): Promise<(anonymousId: string) => boolean> {
    const purpose = await this.prisma.consentPurpose.findUnique({
      where: { key: ANALYTICS_CONSENT_PURPOSE },
    });
    if (!purpose) return () => false;
    const byUser = userId
      ? await this.prisma.consentRecord.findFirst({
          where: { purposeId: purpose.id, userId },
          orderBy: { recordedAt: 'desc' },
        })
      : null;
    if (byUser) return () => byUser.granted;
    const latest = await this.prisma.$queryRaw<{ anonymous_id: string; granted: boolean }[]>`
      SELECT DISTINCT ON (anonymous_id) anonymous_id, granted
      FROM consent_records
      WHERE purpose_id = ${purpose.id} AND anonymous_id = ANY(${anonymousIds}::text[])
      ORDER BY anonymous_id, recorded_at DESC, id DESC`;
    const map = new Map(latest.map((r) => [r.anonymous_id, r.granted]));
    return (anonymousId) => map.get(anonymousId) === true;
  }

  private async provinceCodes(postcodes: string[]): Promise<Map<string, string>> {
    if (postcodes.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ postcode: string; code: string }[]>`
      SELECT DISTINCT ON (s.postcode) s.postcode, p.code
      FROM geo_subdistricts s
      JOIN geo_districts d ON d.id = s.district_id
      JOIN geo_provinces p ON p.id = d.province_id
      WHERE s.postcode = ANY(${[...new Set(postcodes)]}::text[])
      ORDER BY s.postcode, p.id`;
    return new Map(rows.map((r) => [r.postcode, r.code]));
  }

  /**
   * An anonymous visitor's analytics-cookie decision (PDPA consent evidence, D-005): append-only, the latest
   * record wins; a signed-in customer's decision is also recorded against the account.
   */
  async recordConsent(actor: Actor | undefined, anonymousId: string, granted: boolean) {
    const now = new Date();
    const purpose = await this.prisma.consentPurpose.findUnique({
      where: { key: ANALYTICS_CONSENT_PURPOSE },
      include: {
        versions: {
          where: { status: 'approved', effectiveFrom: { lte: now } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
        },
      },
    });
    const version = purpose?.versions[0];
    if (!purpose || !version) throw new DomainException('consent.purpose_unavailable');
    const customer = actor?.type === 'user' && actor.audience === 'customer' ? actor : undefined;
    return this.prisma.withTx(async (tx) => {
      const record = await tx.consentRecord.create({
        data: {
          userId: customer?.userId ?? null,
          anonymousId,
          purposeId: purpose.id,
          purposeVersionId: version.id,
          granted,
          source: 'web',
          ip: null,
        },
      });
      await this.audit.record(tx, {
        category: 'data_access',
        action: granted ? 'consent.granted' : 'consent.withdrawn',
        resourceType: 'consent_purpose',
        resourcePublicId: purpose.publicId,
        data: {
          purpose: ANALYTICS_CONSENT_PURPOSE,
          versionNo: version.versionNo,
          anonymous: !customer,
          recordId: record.id.toString(),
        },
      });
      await this.events.record(tx, {
        type: granted ? 'consent.granted' : 'consent.withdrawn',
        aggregateType: 'consent_purpose',
        aggregateId: purpose.publicId,
        payload: {
          purpose: ANALYTICS_CONSENT_PURPOSE,
          versionNo: version.versionNo,
          anonymous: !customer,
          recordId: record.id.toString(),
        },
      });
      return { granted, versionNo: version.versionNo, recordedAt: record.recordedAt };
    });
  }
}
