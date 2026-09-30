import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type PrivacyRequestKind, type PrivacyRequestStatus } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FilesService } from '@platform/files/files.service';
import { SettingsService } from '@platform/settings/settings.service';

const DAY_MS = 86_400_000;
const INCLUDE = {
  user: { select: { publicId: true, displayName: true } },
  exportFile: { select: { publicId: true } },
  decidedBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.PrivacyRequestInclude;
export type PrivacyRequestRow = Prisma.PrivacyRequestGetPayload<{ include: typeof INCLUDE }>;

/** Scrubbed values that still satisfy the column checks (E.164 phone, 13-digit tax id, non-empty text). */
const SCRUBBED = { text: '—', phone: '+66000000000', taxId: '0000000000000', name: 'ลูกค้าที่ลบข้อมูลแล้ว' };

/**
 * PDPA data-subject requests (D-222): a customer asks for an export of their data or its deletion; the Data
 * Protection Officer (`privacy_requests.manage`) answers within `privacy.response_days`. An export is a JSON file of
 * the customer's own data (never Packio's costs or margins), downloadable by the customer for
 * `privacy.export_link_days`. A deletion anonymises the customer — refused while orders, claims or receivables are
 * open — and keeps tax and accounting documents for `documents.retention_years` (they carry their own snapshots).
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly files: FilesService,
  ) {}

  mine(userId: bigint): Promise<PrivacyRequestRow[]> {
    return this.prisma.privacyRequest.findMany({
      where: { userId },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  queue(q: { status?: PrivacyRequestStatus; page: number; perPage: number }) {
    const where = q.status ? { status: q.status } : {};
    return Promise.all([
      this.prisma.privacyRequest.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.privacyRequest.count({ where }),
    ]);
  }

  async submit(actor: UserActor, kind: PrivacyRequestKind, note: string | null): Promise<PrivacyRequestRow> {
    const now = new Date();
    const days = Number((await this.settings.at('privacy.response_days', { at: now })).value);
    return this.prisma.withTx(async (tx) => {
      if (await tx.privacyRequest.count({ where: { userId: actor.userId, kind, status: 'submitted' } }))
        throw new DomainException('privacy.request_open');
      const row = await tx.privacyRequest.create({
        data: { userId: actor.userId, kind, note, dueAt: new Date(now.getTime() + days * DAY_MS) },
        include: INCLUDE,
      });
      await this.record(tx, row, 'privacy.request_submitted', actor);
      return row;
    });
  }

  async reject(actor: UserActor, publicId: string, answer: string): Promise<PrivacyRequestRow> {
    return this.prisma.withTx(async (tx) => {
      const row = await this.open(tx, publicId);
      const done = await tx.privacyRequest.update({
        where: { id: row.id },
        data: { status: 'rejected', answer, decidedById: actor.userId, decidedAt: new Date(), rowVersion: { increment: 1 } },
        include: INCLUDE,
      });
      await this.record(tx, done, 'privacy.request_rejected', actor);
      return done;
    });
  }

  /** Completes a request: builds the export, or anonymises the customer (refused while something is open). */
  async complete(actor: UserActor, publicId: string, answer: string | null): Promise<PrivacyRequestRow> {
    const request = await this.open(this.prisma, publicId);
    const now = new Date();
    if (request.kind === 'export') {
      const days = Number((await this.settings.at('privacy.export_link_days', { at: now })).value);
      const owner: UserActor = { type: 'user', userId: request.userId, publicId: request.user.publicId, audience: 'customer', scopes: [] };
      const body = Buffer.from(JSON.stringify(await this.exportOf(request.userId, now), null, 2));
      const stored = await this.files.storeGenerated(owner, {
        body,
        fileName: `packio-data-${toBangkokIso(now).slice(0, 10)}.json`,
        mimeType: 'application/json',
        retentionClass: 'standard',
      });
      return this.prisma.withTx(async (tx) => {
        const file = await tx.fileObject.findUniqueOrThrow({ where: { publicId: stored.fileId }, select: { id: true } });
        const done = await tx.privacyRequest.update({
          where: { id: request.id, status: 'submitted' },
          data: {
            status: 'completed',
            answer,
            exportFileId: file.id,
            exportExpiresAt: new Date(now.getTime() + days * DAY_MS),
            decidedById: actor.userId,
            decidedAt: now,
            rowVersion: { increment: 1 },
          },
          include: INCLUDE,
        });
        await this.record(tx, done, 'privacy.request_completed', actor);
        return done;
      });
    }
    return this.prisma.withTx(async (tx) => {
      await this.assertDeletable(tx, request.userId);
      await this.anonymise(tx, request.userId, now);
      const done = await tx.privacyRequest.update({
        where: { id: request.id, status: 'submitted' },
        data: { status: 'completed', answer, decidedById: actor.userId, decidedAt: now, rowVersion: { increment: 1 } },
        include: INCLUDE,
      });
      await this.record(tx, done, 'privacy.request_completed', actor);
      await this.events.record(
        tx,
        { type: 'customer.anonymised', aggregateType: 'user', aggregateId: done.user.publicId, payload: { userId: done.user.publicId } },
        actor,
      );
      return done;
    });
  }

  // --- deletion ---------------------------------------------------------------------------------------

  private async assertDeletable(tx: Tx, userId: bigint): Promise<void> {
    const [orders, claims, receivables] = await Promise.all([
      tx.order.count({ where: { customerUserId: userId, status: { notIn: ['completed', 'cancelled'] } } }),
      tx.claim.count({ where: { customerUserId: userId, status: { notIn: ['rejected', 'resolved', 'closed'] } } }),
      tx.receivableItem.count({ where: { customerUserId: userId, status: { in: ['open', 'partially_paid'] } } }),
    ]);
    const open = [
      orders ? `${orders} open order(s)` : null,
      claims ? `${claims} open claim(s)` : null,
      receivables ? `${receivables} unpaid receivable(s)` : null,
    ].filter(Boolean);
    if (open.length > 0)
      throw new DomainException('privacy.deletion_blocked', { params: { open: open.join(', ') } });
  }

  /** Personal data replaced, sign-ins removed, sessions revoked; orders and documents keep their own snapshots. */
  private async anonymise(tx: Tx, userId: bigint, at: Date): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: {
        displayName: SCRUBBED.name,
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        status: 'inactive',
        anonymisedAt: at,
        rowVersion: { increment: 1 },
      },
    });
    for (const identity of await tx.userIdentity.findMany({ where: { userId } })) {
      await tx.userIdentity.update({
        where: { id: identity.id },
        data: { providerSubject: `anonymised:${identity.id}`, profile: undefined, unlinkedAt: identity.unlinkedAt ?? at },
      });
    }
    await tx.customerAddress.updateMany({
      where: { userId },
      data: {
        recipientName: SCRUBBED.text,
        phone: SCRUBBED.phone,
        line1: SCRUBBED.text,
        line2: null,
        lat: null,
        lng: null,
        deletedAt: at,
      },
    });
    await tx.taxProfile.updateMany({
      where: { userId },
      data: { name: SCRUBBED.text, taxId: SCRUBBED.taxId, line1: SCRUBBED.text, line2: null, documentEmail: null, deletedAt: at },
    });
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at, revokeReason: 'admin' } });
  }

  // --- export -----------------------------------------------------------------------------------------

  /** The customer's own data (profile, sign-ins, addresses, tax profiles, consents, orders, quotes, RFQs). */
  private async exportOf(userId: bigint, at: Date) {
    const [user, profile, identities, addresses, taxProfiles, consents, orders, quotes, rfqs] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { displayName: true, firstName: true, lastName: true, email: true, phone: true, locale: true, createdAt: true },
      }),
      this.prisma.customerProfile.findUnique({
        where: { userId },
        select: { customerCode: true, customerType: true, createdVia: true, referralCode: true },
      }),
      this.prisma.userIdentity.findMany({
        where: { userId, unlinkedAt: null },
        select: { provider: true, providerSubject: true, linkedAt: true },
      }),
      this.prisma.customerAddress.findMany({
        where: { userId, deletedAt: null },
        select: { label: true, recipientName: true, phone: true, line1: true, line2: true, postcode: true, isDefault: true },
      }),
      this.prisma.taxProfile.findMany({
        where: { userId, deletedAt: null },
        select: { taxType: true, name: true, taxId: true, branchCode: true, line1: true, line2: true, postcode: true },
      }),
      this.prisma.consentRecord.findMany({
        where: { userId },
        select: { granted: true, recordedAt: true, purposeVersion: { select: { purpose: { select: { key: true } } } } },
        orderBy: { recordedAt: 'asc' },
      }),
      // Customer-facing figures only: never buy prices, margins or the factory (D-050, D-141).
      this.prisma.order.findMany({
        where: { customerUserId: userId },
        select: { orderCode: true, status: true, quantityOrdered: true, grossAmount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.quote.findMany({
        where: { customerUserId: userId },
        select: { quoteCode: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.rfq.findMany({
        where: { customerUserId: userId },
        select: { rfqCode: true, status: true, spec: true, submittedAt: true },
        orderBy: { submittedAt: 'asc' },
      }),
    ]);
    return {
      exportedAt: toBangkokIso(at),
      seller: 'Collective Group (Thailand) — Packio',
      user: { ...user, createdAt: toBangkokIso(user.createdAt) },
      profile,
      signIns: identities.map((i) => ({ ...i, linkedAt: toBangkokIso(i.linkedAt) })),
      addresses,
      taxProfiles,
      consents: consents.map((c) => ({
        purpose: c.purposeVersion.purpose.key,
        granted: c.granted,
        recordedAt: toBangkokIso(c.recordedAt),
      })),
      orders: orders.map((o) => ({ ...o, grossAmount: o.grossAmount.toFixed(2), createdAt: toBangkokIso(o.createdAt) })),
      quotes: quotes.map((q) => ({ ...q, createdAt: toBangkokIso(q.createdAt) })),
      requestsForQuote: rfqs.map((r) => ({ ...r, submittedAt: toBangkokIso(r.submittedAt) })),
    };
  }

  // --- helpers ----------------------------------------------------------------------------------------

  private async open(db: Tx, publicId: string): Promise<PrivacyRequestRow> {
    const row = await db.privacyRequest.findUnique({ where: { publicId }, include: INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    if (row.status !== 'submitted') throw new DomainException('privacy.request_closed');
    return row;
  }

  private async record(tx: Tx, row: PrivacyRequestRow, type: string, actor: UserActor): Promise<void> {
    await this.audit.record(tx, {
      category: 'data_access',
      action: type,
      resourceType: 'privacy_request',
      resourcePublicId: row.publicId,
      data: { kind: row.kind, status: row.status },
      actor,
    });
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'privacy_request',
        aggregateId: row.publicId,
        payload: { requestId: row.publicId, userId: row.user.publicId, kind: row.kind, status: row.status },
      },
      actor,
    );
  }
}
