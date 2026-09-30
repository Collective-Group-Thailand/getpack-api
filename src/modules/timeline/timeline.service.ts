import { randomBytes } from 'node:crypto';

import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { cursorPaginated, decodeCursor } from '@common/pagination/pagination';
import { type CursorPage } from '@common/pagination/pagination.dto';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Attachment, type Order, type Prisma } from '@generated/prisma/client';
import { hashToken, ShipmentsService } from '@modules/logistics/shipments.service';
import { estimatedDeliveryDate } from '@modules/orders/order-views';
import { type RouteSnapshot } from '@modules/production/production.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { FilesService } from '@platform/files/files.service';

import {
  type OrderProgressDto,
  type ProgressStepDto,
  type PublicTrackingDto,
  type StaffTimelineEntryDto,
  type TimelineEntryDto,
} from './timeline.dto';

/** An entry with its precise position (the wire timestamps are to the second). */
type Entry = StaffTimelineEntryDto & { _key: string };

const sortKey = (at: Date, kind: number, id: bigint) =>
  `${at.toISOString()}|${kind}|${id.toString().padStart(20, '0')}`;

const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
const storeCarrier = (code: string) => (code === 'factory_fleet' ? 'packio' : code);
/** Shipment steps shown outside Packio (drafts and cancelled trips are not part of the story). */
const SHOWN = ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned'];

const SHIPMENTS_OF = (orderId: bigint) =>
  ({
    where: { items: { some: { orderId } }, status: { notIn: ['draft', 'cancelled'] } },
    include: {
      carrier: { select: { code: true } },
      events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      proofOfDelivery: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) satisfies Prisma.ShipmentFindManyArgs;

/**
 * The order's story (B4.4). Customers read it as a chronological, cursor-paged timeline: order and group
 * facts, paid instalments, artwork and proofs, the customer-visible production milestones with their
 * labels and shared photos, shipments and carrier steps, the proof of delivery and completion — no
 * factory identity or cost (D-050). Staff see everything (internal and factory steps, shipments) plus
 * internal notes with @mentions. Progress compares promised and actual dates. Public tracking by token
 * returns no personal data.
 */
@Injectable()
export class TimelineService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly shipments: ShipmentsService,
    private readonly activity: ActivityLogService,
  ) {}

  onModuleInit(): void {
    // A milestone photo the factory shared with the customer is readable by that order's customer (D-075).
    this.files.registerAttachmentPolicy('job_milestone', async (actor, milestoneId, attachment) => {
      if (!(actor.type === 'user' && actor.audience === 'customer') || !attachment?.customerShareable)
        return false;
      const n = await this.prisma.jobMilestone.count({
        where: { id: milestoneId, job: { order: { customerUserId: actor.userId } } },
      });
      return n > 0;
    });
  }

  // --- customer ------------------------------------------------------------------------------------------

  async customer(
    order: Order,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<TimelineEntryDto>> {
    const group = await this.prisma.orderGroup.findUniqueOrThrow({ where: { id: order.orderGroupId } });
    const rows = await this.prisma.activityLog.findMany({
      where: {
        visibility: { has: 'customer' },
        OR: [
          { aggregateType: 'order', aggregatePublicId: order.publicId },
          { aggregateType: 'order_group', aggregatePublicId: group.publicId },
        ],
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const photos = await this.milestonePhotos(rows, true);
    const entries: Entry[] = rows.map((r) => ({
      ...this.activityEntry(r, r.aggregateType === 'order' ? 'order' : 'order_group'),
      photoFileIds: photos.get(String((r.messageParams as { milestoneId?: string }).milestoneId)) ?? [],
    }));
    entries.push(...(await this.shipmentEntries(order.id, true)));
    return this.page(
      entries,
      cursor,
      limit,
      ({ id, occurredAt, type, messageKey, params, photoFileIds, shipment }): TimelineEntryDto => ({
        id,
        occurredAt,
        type,
        messageKey,
        params,
        photoFileIds,
        shipment,
      }),
    );
  }

  // --- staff -----------------------------------------------------------------------------------------------

  async staff(
    order: Order,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<StaffTimelineEntryDto>> {
    const group = await this.prisma.orderGroup.findUniqueOrThrow({ where: { id: order.orderGroupId } });
    const jobs = await this.prisma.productionJob.findMany({
      where: { orderId: order.id },
      select: { publicId: true },
    });
    const shipments = await this.prisma.shipment.findMany({
      where: { items: { some: { orderId: order.id } } },
      select: { publicId: true },
    });
    const rows = await this.prisma.activityLog.findMany({
      where: {
        action: { not: 'order.note_added' },
        OR: [
          { aggregateType: 'order', aggregatePublicId: order.publicId },
          { aggregateType: 'order_group', aggregatePublicId: group.publicId },
          { aggregateType: 'production_job', aggregatePublicId: { in: jobs.map((j) => j.publicId) } },
          { aggregateType: 'shipment', aggregatePublicId: { in: shipments.map((s) => s.publicId) } },
        ],
      },
      include: { actorUser: { select: { displayName: true } } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const photos = await this.milestonePhotos(rows, false);
    const entries: Entry[] = rows.map((r) => ({
      ...this.activityEntry(r, r.aggregateType),
      photoFileIds: photos.get(String((r.messageParams as { milestoneId?: string }).milestoneId)) ?? [],
      actor: { type: r.actorType, displayName: r.actorUser?.displayName ?? null },
    }));
    const notes = await this.prisma.orderNote.findMany({
      where: { orderId: order.id },
      include: { author: { select: { displayName: true } } },
    });
    const mentioned = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(notes.flatMap((n) => n.mentions))] } },
      select: { id: true, publicId: true, displayName: true },
    });
    for (const n of notes) {
      entries.push({
        _key: sortKey(n.createdAt, 2, n.id),
        id: `n:${n.id}`,
        occurredAt: toBangkokIso(n.createdAt),
        type: 'order.note_added',
        messageKey: 'activity.order.note_added',
        params: { noteId: n.publicId },
        photoFileIds: [],
        shipment: null,
        source: 'note',
        visibility: ['internal'],
        actor: { type: 'user', displayName: n.author.displayName },
        body: n.body,
        mentions: mentioned
          .filter((u) => n.mentions.includes(u.id))
          .map((u) => ({ id: u.publicId, displayName: u.displayName })),
      });
    }
    entries.push(...(await this.shipmentEntries(order.id, false)));
    return this.page(entries, cursor, limit, ({ _key: _k, ...entry }): StaffTimelineEntryDto => entry);
  }

  // --- progress (promised vs actual) ------------------------------------------------------------------------

  async progress(order: Order): Promise<OrderProgressDto> {
    const promised = order.promisedShipDate?.toISOString().slice(0, 10) ?? null;
    return {
      orderId: order.publicId,
      status: order.status,
      promisedShipDate: promised,
      estimatedDeliveryDate: await this.estimatedDelivery(order),
      paidForProductionAt: iso(order.paidForProductionAt),
      artworkApprovedAt: iso(order.artworkApprovedAt),
      productionStartedAt: iso(order.productionStartedAt),
      shippedAt: iso(order.shippedAt),
      shippedOnTime: order.shippedAt && promised ? bangkokDate(order.shippedAt) <= promised : null,
      deliveredAt: iso(order.deliveredAt),
      completedAt: iso(order.completedAt),
      steps: await this.customerSteps(order.id),
    };
  }

  // --- public tracking --------------------------------------------------------------------------------------

  /** A shareable link for the whole order; the token is returned once, only its hash is kept. */
  async createLink(actor: Actor, order: Order): Promise<{ url: string; token: string }> {
    const token = randomBytes(24).toString('base64url');
    await this.prisma.withTx(async (tx) => {
      await tx.trackingLink.create({ data: { tokenHash: hashToken(token), orderId: order.id } });
      await this.activity.record(tx, {
        aggregateType: 'order',
        aggregatePublicId: order.publicId,
        action: 'order.tracking_link_created',
        messageKey: 'activity.order.tracking_link_created',
        messageParams: {},
        visibility: ['internal', 'customer'],
        entityId: order.entityId,
        actor,
      });
    });
    return { url: this.shipments.trackingUrl(token), token };
  }

  async track(token: string): Promise<PublicTrackingDto> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new DomainException('http.not_found');
    const link = await this.prisma.trackingLink.findUnique({ where: { tokenHash: hashToken(token) } });
    const now = new Date();
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt <= now))
      throw new DomainException('http.not_found');
    await this.prisma.trackingLink.update({
      where: { id: link.id },
      data: { views: { increment: 1 }, lastViewedAt: now },
    });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: link.orderId } });
    const shipments = await this.prisma.shipment.findMany(SHIPMENTS_OF(order.id));
    return {
      status: order.status,
      promisedShipDate: order.promisedShipDate?.toISOString().slice(0, 10) ?? null,
      estimatedDeliveryDate: await this.estimatedDelivery(order),
      shippedAt: iso(order.shippedAt),
      deliveredAt: iso(order.deliveredAt),
      steps: await this.customerSteps(order.id),
      shipments: shipments
        .filter((s) => link.shipmentId === null || s.id === link.shipmentId)
        .map((s) => ({
          shipmentNo: s.shipmentNo,
          status: s.status,
          carrier: storeCarrier(s.carrier.code),
          trackingNo: s.trackingNo,
          trackingUrl: s.trackingUrl,
          cartonsCount: s.cartonsCount,
          steps: dedupe(s.events.filter((e) => SHOWN.includes(e.status))).map((e) => ({
            status: e.status,
            occurredAt: toBangkokIso(e.occurredAt),
          })),
        })),
    };
  }

  // --- helpers ------------------------------------------------------------------------------------------------

  private activityEntry(
    r: {
      id: bigint;
      occurredAt: Date;
      action: string;
      messageKey: string;
      messageParams: Prisma.JsonValue;
      visibility: string[];
    },
    source: Entry['source'],
  ): Entry {
    return {
      _key: sortKey(r.occurredAt, 0, r.id),
      id: `a:${r.id}`,
      occurredAt: toBangkokIso(r.occurredAt),
      type: r.action,
      messageKey: r.messageKey,
      params: (r.messageParams ?? {}) as Record<string, unknown>,
      photoFileIds: [],
      shipment: null,
      source,
      visibility: r.visibility,
      actor: null,
      body: null,
      mentions: [],
    };
  }

  /** Milestone photos by milestone public id (shared ones only for the customer). */
  private async milestonePhotos(rows: { messageParams: Prisma.JsonValue }[], sharedOnly: boolean) {
    const ids = rows
      .map((r) => (r.messageParams as { milestoneId?: string } | null)?.milestoneId)
      .filter((x): x is string => typeof x === 'string');
    const map = new Map<string, string[]>();
    if (ids.length === 0) return map;
    const milestones = await this.prisma.jobMilestone.findMany({
      where: { publicId: { in: ids } },
      select: { id: true, publicId: true },
    });
    const attachments = await this.prisma.attachment.findMany({
      where: {
        subjectType: 'job_milestone',
        subjectId: { in: milestones.map((m) => m.id) },
        ...(sharedOnly && { customerShareable: true }),
      },
      include: { fileObject: { select: { publicId: true } } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    for (const m of milestones)
      map.set(
        m.publicId,
        attachments.filter((a: Attachment) => a.subjectId === m.id).map((a) => a.fileObject.publicId),
      );
    return map;
  }

  private async shipmentEntries(orderId: bigint, customer: boolean): Promise<Entry[]> {
    const shipments = await this.prisma.shipment.findMany(
      customer
        ? SHIPMENTS_OF(orderId)
        : { ...SHIPMENTS_OF(orderId), where: { items: { some: { orderId } } } },
    );
    const pods = shipments.flatMap((s) => (s.proofOfDelivery ? [s.proofOfDelivery.id] : []));
    const podPhotos = pods.length
      ? await this.prisma.attachment.findMany({
          where: {
            subjectType: 'proof_of_delivery',
            subjectId: { in: pods },
            ...(customer && { customerShareable: true }),
          },
          include: { fileObject: { select: { publicId: true } } },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        })
      : [];
    const out: Entry[] = [];
    for (const s of shipments) {
      const ref = {
        id: s.publicId,
        shipmentNo: s.shipmentNo,
        carrier: storeCarrier(s.carrier.code),
        trackingNo: s.trackingNo,
      };
      const events = customer ? dedupe(s.events.filter((e) => SHOWN.includes(e.status))) : s.events;
      for (const e of events) {
        const delivered = e.status === 'delivered' && s.proofOfDelivery;
        out.push({
          _key: sortKey(e.occurredAt, 1, e.id),
          id: `s:${e.id}`,
          occurredAt: toBangkokIso(e.occurredAt),
          type: `shipment.${e.status}`,
          messageKey: `timeline.shipment.${e.status}`,
          params: {
            location: e.location,
            ...(!customer && { source: e.source, note: e.note }),
            ...(delivered && { receiverName: s.proofOfDelivery!.receiverName }),
          },
          photoFileIds: delivered
            ? podPhotos.filter((a) => a.subjectId === s.proofOfDelivery!.id).map((a) => a.fileObject.publicId)
            : [],
          shipment: ref,
          source: 'shipment',
          visibility: customer ? ['customer'] : ['internal', 'partner', 'customer'],
          actor: null,
          body: null,
          mentions: [],
        });
      }
    }
    return out;
  }

  private async customerSteps(orderId: bigint): Promise<ProgressStepDto[]> {
    const job = await this.prisma.productionJob.findFirst({
      where: { orderId, jobKind: 'production', status: { notIn: ['rejected', 'cancelled'] } },
      include: { milestones: { where: { customerVisible: true }, orderBy: { seq: 'asc' } } },
    });
    if (!job) return [];
    const route = job.routeSnapshot as unknown as RouteSnapshot;
    return job.milestones.map((m) => {
      const step = route.steps.find((s) => s.seq === m.seq);
      return {
        key: m.stepKey,
        labelTh: step?.customerLabelTh ?? step?.nameTh ?? m.stepKey,
        labelEn: step?.customerLabelEn ?? step?.nameEn ?? m.stepKey,
        status: m.status,
        promisedAt: iso(m.dueAt),
        completedAt: iso(m.completedAt),
      };
    });
  }

  private async estimatedDelivery(order: Order): Promise<string | null> {
    const option = await this.prisma.quoteOption.findUnique({
      where: { id: order.quoteOptionId },
      select: { earliestShipDate: true, result: true },
    });
    return estimatedDeliveryDate(order.promisedShipDate, option);
  }

  /** Chronological page after the cursor (entries are few per order; merged in memory). */
  private page<T>(
    entries: Entry[],
    cursor: string | undefined,
    limit: number,
    view: (e: Entry) => T,
  ): CursorPage<T> {
    const sorted = [...entries].sort((a, b) => (a._key < b._key ? -1 : a._key > b._key ? 1 : 0));
    const after = cursor ? decodeCursor(cursor)['k'] : undefined;
    if (cursor && typeof after !== 'string')
      throw new DomainException('validation.failed', {
        errors: [{ path: 'cursor', code: 'isCursor', message: 'cursor is invalid' }],
      });
    const rest = after ? sorted.filter((e) => e._key > after) : sorted;
    const page = cursorPaginated(rest.slice(0, limit + 1), limit, (e) => ({ k: e._key }));
    return { data: page.data.map(view), meta: page.meta };
  }
}

/** Consecutive repeats of one status (a carrier resending it) are one step outside Packio. */
function dedupe<T extends { status: string }>(events: T[]): T[] {
  return events.filter((e, i) => i === 0 || events[i - 1]!.status !== e.status);
}
