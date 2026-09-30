import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Claim,
  type ClaimAction,
  type ClaimLiability,
  type ClaimResolutionKind,
  type ClaimStatus,
  type ClaimType,
  type Order,
  type Prisma,
} from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { OrderLifecycleHooks } from '@modules/orders/orders.service';
import { RefundsService } from '@modules/payments/refunds.service';
import { ProductionService } from '@modules/production/production.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { FilesService } from '@platform/files/files.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { SettingsService } from '@platform/settings/settings.service';

import {
  CLAIM_TYPES,
  type ClaimFormDto,
  type ClaimFormShipmentDto,
  MAX_CLAIM_PHOTOS,
  RESOLUTION_KINDS,
} from './claims.dto';
import { CLAIM_TRANSITIONS, FINAL_CLAIM_STATUSES, liabilityByRule } from './liability';

const DAY_MS = 86_400_000;

export interface ClaimInput {
  type: ClaimType;
  description: string;
  requestedResolution: ClaimResolutionKind;
  shipmentId?: string;
  claimedQuantity?: number;
  claimedAmount?: string;
  productPhotoFileIds?: string[];
  cartonPhotoFileIds?: string[];
}

export interface ResolutionInput {
  action: ClaimAction;
  amount?: string;
  quantity?: number;
  paymentId?: string;
  note?: string;
}

export const CLAIM_INCLUDE = {
  order: { select: { publicId: true, orderCode: true } },
  shipment: { select: { publicId: true, shipmentNo: true } },
  productionJob: { select: { publicId: true, jobNo: true } },
  factory: { select: { publicId: true, code: true } },
  resolutions: {
    orderBy: { id: 'asc' },
    include: {
      productionJob: { select: { publicId: true, jobNo: true } },
      refund: { select: { publicId: true, status: true } },
    },
  },
} satisfies Prisma.ClaimInclude;
export type ClaimRow = Prisma.ClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

/** Claims a factory sees: its own, once Packio sent them for its review or held it liable. */
const FACTORY_VISIBLE: Prisma.ClaimWhereInput = {
  OR: [
    { status: 'factory_review' },
    { factoryResponse: { not: null } },
    { liability: 'factory', decidedAt: { not: null } },
  ],
};

/**
 * Claims (D-082, D-083, D-080). A customer claims within the window after receipt (7 days, `claims.window_days`)
 * with product **and** shipping-carton photos; a tolerance breach opens one automatically; staff may open one.
 * Liability follows the rules (D-083) and can be overridden with a reason by permission. Review → (need info)
 * → (factory review with its response) → approved / rejected → resolved through existing mechanisms only:
 * a re-production job (P24), a refund request (maker-checker), credit note / store credit, factory deduction
 * and carrier recovery events for B5 → closed. An open claim holds the order's automatic completion.
 */
@Injectable()
export class ClaimsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly hooks: OrderLifecycleHooks,
    private readonly files: FilesService,
    private readonly scoping: ScopingService,
    private readonly production: ProductionService,
    private readonly refunds: RefundsService,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      key: 'claims',
      blocksCompletion: async (tx, orderId) =>
        (await tx.claim.count({ where: { orderId, status: { notIn: [...FINAL_CLAIM_STATUSES] } } })) > 0,
    });
    this.files.registerAttachmentPolicy('claim', async (actor, claimId) => {
      const where = await this.scopeWhere(actor);
      return (await this.prisma.claim.count({ where: { id: claimId, ...where } })) > 0;
    });
  }

  // --- reads ------------------------------------------------------------------------------------------------

  async scopeWhere(actor: Actor): Promise<Prisma.ClaimWhereInput> {
    if (actor.type === 'user' && actor.audience === 'customer') return { customerUserId: actor.userId };
    const scope = await this.scoping.scopeOf(actor, 'factory');
    return scope === 'all' ? {} : { AND: [{ factoryId: { in: [...scope] } }, FACTORY_VISIBLE] };
  }

  async get(actor: Actor, publicId: string, db: Tx = this.prisma): Promise<ClaimRow> {
    const row = await db.claim.findFirst({
      where: { publicId, ...(await this.scopeWhere(actor)) },
      include: CLAIM_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(actor: Actor, where: Prisma.ClaimWhereInput, page: number, perPage: number) {
    const scoped = { AND: [where, await this.scopeWhere(actor)] };
    return Promise.all([
      this.prisma.claim.findMany({
        where: scoped,
        include: CLAIM_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.claim.count({ where: scoped }),
    ]);
  }

  /** Evidence photos by role. */
  async photos(claimIds: bigint[]): Promise<Map<bigint, { product: string[]; carton: string[] }>> {
    const rows = claimIds.length
      ? await this.prisma.attachment.findMany({
          where: { subjectType: 'claim', subjectId: { in: claimIds } },
          include: { fileObject: { select: { publicId: true } } },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        })
      : [];
    const map = new Map<bigint, { product: string[]; carton: string[] }>();
    for (const id of claimIds) {
      const mine = rows.filter((r) => r.subjectId === id);
      map.set(id, {
        product: mine.filter((r) => r.role === 'claim.product_photo').map((r) => r.fileObject.publicId),
        carton: mine.filter((r) => r.role === 'claim.carton_photo').map((r) => r.fileObject.publicId),
      });
    }
    return map;
  }

  // --- claim form -------------------------------------------------------------------------------------------

  /** The claim form of my order (D-082): delivered shipments with their windows and the evidence rules. */
  async form(customerUserId: bigint, orderPublicId: string): Promise<ClaimFormDto> {
    const order = await this.prisma.order.findFirst({ where: { publicId: orderPublicId, customerUserId } });
    if (!order) throw new DomainException('http.not_found');
    const now = new Date();
    const windowEnd = async (receivedAt: Date) =>
      new Date(
        receivedAt.getTime() + (await this.settings.at('claims.window_days', { at: receivedAt })).value * DAY_MS,
      );
    const items = await this.prisma.shipmentItem.findMany({
      where: { orderId: order.id, shipment: { status: 'delivered', deliveredAt: { not: null } } },
      include: { shipment: { select: { publicId: true, shipmentNo: true, deliveredAt: true } } },
      orderBy: { id: 'asc' },
    });
    const shipments: ClaimFormShipmentDto[] = [];
    for (const item of items) {
      const ends = await windowEnd(item.shipment.deliveredAt!);
      shipments.push({
        id: item.shipment.publicId,
        shipmentNo: item.shipment.shipmentNo,
        deliveredAt: toBangkokIso(item.shipment.deliveredAt!),
        quantity: item.quantity,
        deliveredQuantity: item.deliveredQuantity,
        windowEndsAt: toBangkokIso(ends),
        open: now <= ends,
      });
    }
    const orderEnds = order.deliveredAt ? await windowEnd(order.deliveredAt) : null;
    const latest = [orderEnds, ...shipments.map((s) => new Date(s.windowEndsAt))]
      .filter((d): d is Date => d !== null)
      .reduce<Date | null>((a, b) => (a === null || b > a ? b : a), null);
    const open = order.deliveredAt !== null && latest !== null && now <= latest;
    const evidence = FILE_PURPOSES.evidence;
    return {
      orderId: order.publicId,
      orderCode: order.orderCode,
      quantityOrdered: order.quantityOrdered,
      deliveredAt: order.deliveredAt ? toBangkokIso(order.deliveredAt) : null,
      windowEndsAt: latest ? toBangkokIso(latest) : null,
      open,
      closedReason: open ? null : order.deliveredAt ? 'window_closed' : 'not_delivered',
      types: [...CLAIM_TYPES],
      resolutions: [...RESOLUTION_KINDS],
      shipments,
      evidence: {
        purpose: 'evidence',
        accept: [...evidence.mimeTypes],
        maxBytes: evidence.maxBytes,
        productPhotosMin: 1,
        productPhotosMax: MAX_CLAIM_PHOTOS,
        cartonPhotosMin: 1,
        cartonPhotosMax: MAX_CLAIM_PHOTOS,
      },
    };
  }

  // --- open -------------------------------------------------------------------------------------------------

  /** The customer's claim: delivered order, within the window, both kinds of photos (D-082). */
  async submit(actor: UserActor, orderPublicId: string, input: ClaimInput): Promise<string> {
    if (!input.productPhotoFileIds?.length || !input.cartonPhotoFileIds?.length)
      throw new DomainException('claims.evidence_missing');
    return this.prisma.withTx(async (tx) => {
      const order = await tx.order.findFirst({
        where: { publicId: orderPublicId, customerUserId: actor.userId },
      });
      if (!order) throw new DomainException('http.not_found');
      const claim = await this.open(tx, order, 'customer', input, actor);
      return claim.publicId;
    });
  }

  /** Staff open a claim for the customer (phone, LINE): not bound by the window, photos optional. */
  async openByStaff(actor: UserActor, orderPublicId: string, input: ClaimInput): Promise<string> {
    return this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({ where: { publicId: orderPublicId } });
      if (!order) throw new DomainException('http.not_found');
      return (await this.open(tx, order, 'staff', input, actor)).publicId;
    });
  }

  private async open(
    tx: Tx,
    order: Order,
    origin: 'customer' | 'staff',
    input: ClaimInput,
    actor: UserActor,
  ) {
    if (!order.deliveredAt) throw new DomainException('claims.not_delivered');
    const shipment = input.shipmentId
      ? await tx.shipment.findFirst({
          where: { publicId: input.shipmentId, items: { some: { orderId: order.id } }, status: 'delivered' },
          include: { carrier: true },
        })
      : null;
    if (input.shipmentId && !shipment) throw new DomainException('http.not_found');
    const receivedAt = shipment?.deliveredAt ?? order.deliveredAt;
    const productPhotos = await this.evidence(tx, actor, input.productPhotoFileIds ?? []);
    const cartonPhotos = await this.evidence(tx, actor, input.cartonPhotoFileIds ?? []);
    const claim = await this.create(
      tx,
      order,
      {
        origin,
        type: input.type,
        description: input.description,
        requestedResolution: input.requestedResolution,
        claimedQuantity: input.claimedQuantity ?? null,
        claimedAmount: input.claimedAmount ?? null,
        receivedAt,
        shipmentId: shipment?.id ?? null,
        shippedBy: shipment
          ? shipment.carrier.code === 'factory_fleet'
            ? 'factory_fleet'
            : 'carrier'
          : null,
        createdById: actor.userId,
      },
      actor,
    );
    for (const [role, ids] of [
      ['claim.product_photo', productPhotos],
      ['claim.carton_photo', cartonPhotos],
    ] as const) {
      for (const [i, fileObjectId] of ids.entries())
        await tx.attachment.create({
          data: {
            subjectType: 'claim',
            subjectId: claim.id,
            fileObjectId,
            role,
            sort: i,
            customerShareable: true,
          },
        });
    }
    return claim;
  }

  private async create(
    tx: Tx,
    order: Order,
    c: {
      origin: 'customer' | 'staff' | 'tolerance_auto';
      type: ClaimType;
      description: string;
      requestedResolution: ClaimResolutionKind;
      claimedQuantity: number | null;
      claimedAmount: string | null;
      receivedAt: Date;
      shipmentId: bigint | null;
      shippedBy: 'factory_fleet' | 'carrier' | null;
      createdById: bigint | null;
    },
    actor: Actor,
  ): Promise<Claim> {
    const windowDays = (await this.settings.at('claims.window_days', { at: c.receivedAt, tx })).value;
    const job = await tx.productionJob.findFirst({
      where: { orderId: order.id, jobKind: 'production', status: { notIn: ['rejected', 'cancelled'] } },
    });
    // Without a shipment named, the order's own deliveries decide who shipped it.
    const shippedBy =
      c.shippedBy ??
      ((await tx.shipment.count({
        where: {
          items: { some: { orderId: order.id } },
          status: 'delivered',
          carrier: { code: { not: 'factory_fleet' } },
        },
      })) > 0
        ? 'carrier'
        : 'factory_fleet');
    const rule = liabilityByRule(c.type, shippedBy);
    const at = new Date();
    const windowEndsAt = new Date(c.receivedAt.getTime() + windowDays * DAY_MS);
    // D-082: the customer claims within the window; automatic and staff claims are not bound by it.
    if (c.origin === 'customer' && at > windowEndsAt)
      throw new DomainException('claims.window_closed', { params: { until: windowEndsAt.toISOString() } });
    const claim = await tx.claim.create({
      data: {
        claimNo: await this.numbering.next(tx, 'claim', at, order.entityId),
        entityId: order.entityId,
        orderId: order.id,
        shipmentId: c.shipmentId,
        productionJobId: job?.id ?? null,
        customerUserId: order.customerUserId,
        type: c.type,
        origin: c.origin,
        description: c.description,
        receivedAt: c.receivedAt,
        windowEndsAt,
        submittedAt: at,
        requestedResolution: c.requestedResolution,
        claimedQuantity: c.claimedQuantity,
        claimedAmount: c.claimedAmount,
        liabilityByRule: rule,
        liability: rule === 'factory' && !job ? 'undetermined' : rule,
        factoryId: job?.factoryId ?? null,
        createdById: c.createdById,
      },
    });
    await this.record(tx, claim, 'claim.submitted', { type: c.type, origin: c.origin }, actor, [
      'internal',
      'customer',
    ]);
    return claim;
  }

  /** D-080: delivery outside the tolerance opens a claim by itself. */
  @OnDomainEvent('delivery.reconciled', { consumer: 'claims.tolerance' })
  async onReconciled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const p = event.payload as {
      orderId: string;
      outcome: string;
      orderedQuantity: number;
      deliveredQuantity: number;
      toleranceShortagePct: string;
      toleranceOveragePct: string;
    };
    if (p.outcome !== 'shortage_outside' && p.outcome !== 'overage_outside') return;
    const order = await tx.order.findUnique({
      where: { publicId: p.orderId },
      include: { deliveryReconciliation: true },
    });
    if (!order?.deliveredAt || !order.deliveryReconciliation || order.deliveryReconciliation.claimId) return;
    const shortage = p.outcome === 'shortage_outside';
    const claim = await this.create(
      tx,
      order,
      {
        origin: 'tolerance_auto',
        type: shortage ? 'quantity_short' : 'other',
        description: shortage
          ? `ส่งมอบ ${p.deliveredQuantity} จาก ${p.orderedQuantity} ชิ้น ขาดเกินเกณฑ์ ${p.toleranceShortagePct}% (D-080)`
          : `ส่งมอบ ${p.deliveredQuantity} จาก ${p.orderedQuantity} ชิ้น เกินเกณฑ์ ${p.toleranceOveragePct}% (D-080)`,
        requestedResolution: 'credit',
        claimedQuantity: Math.abs(p.orderedQuantity - p.deliveredQuantity) || null,
        claimedAmount: null,
        receivedAt: order.deliveredAt,
        shipmentId: null,
        shippedBy: null,
        createdById: null,
      },
      systemActor('claims.tolerance'),
    );
    // Overage is the factory's too: it produced and shipped beyond the tolerance (not paid, D-165).
    if (!shortage && claim.factoryId)
      await tx.claim.update({
        where: { id: claim.id },
        data: { liability: 'factory', liabilityByRule: 'factory' },
      });
    await tx.deliveryReconciliation.update({
      where: { id: order.deliveryReconciliation.id },
      data: { claimId: claim.id },
    });
  }

  // --- review ---------------------------------------------------------------------------------------------

  async startReview(actor: UserActor, publicId: string) {
    return this.move(actor, publicId, 'under_review', {}, 'claim.under_review', ['internal', 'customer']);
  }

  async requestInfo(actor: UserActor, publicId: string, note: string) {
    return this.move(
      actor,
      publicId,
      'need_info',
      { infoRequest: note },
      'claim.info_requested',
      ['internal', 'customer'],
      {
        note,
      },
    );
  }

  /** The customer answers the information request (text and optionally more photos). */
  async respondInfo(
    actor: UserActor,
    publicId: string,
    input: { response: string; photoFileIds?: string[] },
  ) {
    await this.prisma.withTx(async (tx) => {
      const claim = await this.lock(tx, await this.get(actor, publicId, tx));
      if (claim.status !== 'need_info')
        throw new DomainException('claims.invalid_status', { params: { status: claim.status } });
      const photos = await this.evidence(tx, actor, input.photoFileIds ?? []);
      const existing = await tx.attachment.count({ where: { subjectType: 'claim', subjectId: claim.id } });
      for (const [i, fileObjectId] of photos.entries())
        await tx.attachment.create({
          data: {
            subjectType: 'claim',
            subjectId: claim.id,
            fileObjectId,
            role: 'claim.product_photo',
            sort: existing + i,
            customerShareable: true,
          },
        });
      await this.update(tx, claim, 'under_review', { infoResponse: input.response }, actor);
      await this.record(tx, claim, 'claim.info_provided', {}, actor, ['internal', 'customer']);
    });
  }

  async sendToFactory(actor: UserActor, publicId: string) {
    const claim = await this.get(actor, publicId);
    if (!claim.factoryId)
      throw new DomainException('claims.action_not_allowed', { params: { reason: 'no factory' } });
    return this.move(actor, publicId, 'factory_review', {}, 'claim.sent_to_factory', ['internal', 'partner']);
  }

  /** The factory accepts or disputes (D-083); the claim goes back to Packio's review. */
  async factoryRespond(
    actor: Actor,
    publicId: string,
    input: { response: 'accepted' | 'disputed'; note?: string },
  ) {
    await this.prisma.withTx(async (tx) => {
      const claim = await this.lock(tx, await this.get(actor, publicId, tx));
      if (claim.status !== 'factory_review')
        throw new DomainException('claims.invalid_status', { params: { status: claim.status } });
      await this.update(
        tx,
        claim,
        'under_review',
        {
          factoryResponse: input.response,
          factoryResponseNote: input.note ?? null,
          factoryRespondedAt: new Date(),
          factoryRespondedById: actor.type === 'user' ? actor.userId : null,
        },
        actor,
      );
      await this.record(tx, claim, 'claim.factory_responded', { response: input.response }, actor, [
        'internal',
        'partner',
      ]);
    });
  }

  /** D-083 override: another liability than the rule's, with a reason (audited through the activity trail). */
  async overrideLiability(
    actor: UserActor,
    publicId: string,
    input: { liability: ClaimLiability; reason: string },
  ) {
    await this.prisma.withTx(async (tx) => {
      const claim = await this.lock(tx, await this.get(actor, publicId, tx));
      if (!['submitted', 'under_review', 'need_info', 'factory_review'].includes(claim.status))
        throw new DomainException('claims.invalid_status', { params: { status: claim.status } });
      if (input.liability === 'factory' && !claim.factoryId)
        throw new DomainException('claims.action_not_allowed', { params: { reason: 'no factory' } });
      await tx.claim.update({
        where: { id: claim.id },
        data: {
          liability: input.liability,
          liabilityOverriddenById: actor.userId,
          overrideReason: input.reason,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        claim,
        'claim.liability_overridden',
        {
          from: claim.liability,
          to: input.liability,
          byRule: claim.liabilityByRule,
          reason: input.reason,
        },
        actor,
        ['internal'],
      );
    });
  }

  async decide(
    actor: UserActor,
    publicId: string,
    input: { decision: 'approved' | 'rejected'; note: string },
  ) {
    await this.prisma.withTx(async (tx) => {
      const claim = await this.lock(tx, await this.get(actor, publicId, tx));
      if (claim.status !== 'under_review')
        throw new DomainException('claims.invalid_status', { params: { status: claim.status } });
      if (input.decision === 'approved' && claim.liability === 'undetermined')
        throw new DomainException('claims.liability_undetermined');
      await this.update(
        tx,
        claim,
        input.decision,
        {
          decisionNote: input.note,
          decidedById: actor.userId,
          decidedAt: new Date(),
        },
        actor,
      );
      const visibility: ('internal' | 'customer' | 'partner')[] =
        claim.liability === 'factory' ? ['internal', 'customer', 'partner'] : ['internal', 'customer'];
      await this.record(
        tx,
        claim,
        `claim.${input.decision}`,
        { liability: claim.liability },
        actor,
        visibility,
      );
    });
  }

  // --- resolution -------------------------------------------------------------------------------------------

  /** Executes the resolution through existing mechanisms only and resolves the claim (one transaction). */
  async resolve(actor: UserActor, publicId: string, actions: ResolutionInput[]) {
    await this.prisma.withTx(
      async (tx) => {
        const claim = await this.lock(tx, await this.get(actor, publicId, tx));
        if (claim.status !== 'approved')
          throw new DomainException('claims.invalid_status', { params: { status: claim.status } });
        const order = await tx.order.findUniqueOrThrow({ where: { id: claim.orderId } });
        for (const a of actions) {
          const done = await this.execute(tx, claim, order, a, actor);
          await tx.claimResolution.create({
            data: {
              claimId: claim.id,
              action: a.action,
              amount: a.amount ?? null,
              quantity: done.quantity ?? null,
              productionJobId: done.productionJobId ?? null,
              refundId: done.refundId ?? null,
              note: a.note ?? null,
              executedById: actor.userId,
            },
          });
        }
        await this.update(tx, claim, 'resolved', { resolvedAt: new Date() }, actor);
        await this.record(tx, claim, 'claim.resolved', { actions: actions.map((a) => a.action) }, actor, [
          'internal',
          'customer',
          ...(claim.liability === 'factory' ? (['partner'] as const) : []),
        ]);
      },
      { timeout: 30_000 },
    );
  }

  private async execute(
    tx: Tx,
    claim: Claim,
    order: Order,
    a: ResolutionInput,
    actor: UserActor,
  ): Promise<{ productionJobId?: bigint; refundId?: bigint; quantity?: number }> {
    const refuse = (reason: string) =>
      new DomainException('claims.action_not_allowed', { params: { reason } });
    switch (a.action) {
      case 'reproduction_job': {
        if (!claim.productionJobId) throw refuse('no production job');
        const original = await tx.productionJob.findUniqueOrThrow({ where: { id: claim.productionJobId } });
        const quantity = a.quantity ?? claim.claimedQuantity ?? original.quantityOrdered;
        const job = await this.production.releaseReproduction(
          tx,
          {
            originalJobId: original.id,
            claimId: claim.id,
            claimNo: claim.claimNo,
            quantity,
            factoryLiable: claim.liability === 'factory',
          },
          actor,
        );
        return { productionJobId: job.id, quantity };
      }
      case 'refund': {
        if (!a.paymentId || !a.amount) throw refuse('a refund needs the payment and the amount');
        const order_ = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        const refund = await this.refunds.requestIn(tx, actor, a.paymentId, {
          amount: a.amount,
          reasonNote: `claim ${claim.claimNo}`,
          orderId: order_.publicId,
        });
        return { refundId: (await tx.refund.findUniqueOrThrow({ where: { publicId: refund.publicId } })).id };
      }
      case 'credit_note':
      case 'store_credit':
      case 'factory_deduction':
      case 'carrier_recovery': {
        if (!a.amount) throw refuse('an amount is required');
        if (a.action === 'factory_deduction' && claim.liability !== 'factory')
          throw refuse('the factory is not liable');
        if (a.action === 'carrier_recovery' && claim.liability !== 'carrier')
          throw refuse('the carrier is not liable');
        // Finance documents are B5's: the request is an event its subscribers turn into CN / credit / deduction.
        await this.record(
          tx,
          claim,
          `claim.${a.action}_requested`,
          { action: a.action, amount: formatMoney(a.amount) },
          actor,
          ['internal'],
        );
        return {};
      }
    }
  }

  async close(actor: UserActor, publicId: string) {
    return this.move(actor, publicId, 'closed', { closedAt: new Date() }, 'claim.closed', [
      'internal',
      'customer',
    ]);
  }

  // --- helpers ----------------------------------------------------------------------------------------------

  private async move(
    actor: UserActor,
    publicId: string,
    to: ClaimStatus,
    data: Prisma.ClaimUncheckedUpdateInput,
    type: string,
    visibility: ('internal' | 'customer' | 'partner')[],
    params: Record<string, unknown> = {},
  ) {
    await this.prisma.withTx(async (tx) => {
      const claim = await this.lock(tx, await this.get(actor, publicId, tx));
      await this.update(tx, claim, to, data, actor);
      await this.record(tx, claim, type, params, actor, visibility);
    });
  }

  private async update(
    tx: Tx,
    claim: Claim,
    to: ClaimStatus,
    data: Prisma.ClaimUncheckedUpdateInput,
    _actor: Actor,
  ) {
    if (!(CLAIM_TRANSITIONS[claim.status] ?? []).includes(to))
      throw new DomainException('claims.invalid_status', { params: { status: claim.status } });
    await tx.claim.update({
      where: { id: claim.id },
      data: { ...data, status: to, statusChangedAt: new Date(), rowVersion: { increment: 1 } },
    });
  }

  private async lock(tx: Tx, claim: { id: bigint }): Promise<Claim> {
    await tx.$queryRaw`SELECT id FROM claims WHERE id = ${claim.id} FOR UPDATE`;
    return tx.claim.findUniqueOrThrow({ where: { id: claim.id } });
  }

  /** Evidence must be the actor's own clean uploads. */
  private async evidence(tx: Tx, actor: Actor, publicIds: string[]): Promise<bigint[]> {
    if (publicIds.length === 0) return [];
    const files = await tx.fileObject.findMany({ where: { publicId: { in: publicIds } } });
    if (
      files.length !== new Set(publicIds).size ||
      files.some(
        (f) =>
          !(actor.type === 'user' && f.ownerUserId === actor.userId) ||
          f.uploadStatus !== 'uploaded' ||
          f.scanStatus === 'infected',
      )
    )
      throw new DomainException('artwork.file_not_usable', { params: { fileId: publicIds.join(', ') } });
    return publicIds.map((id) => files.find((f) => f.publicId === id)!.id);
  }

  private async record(
    tx: Tx,
    claim: Claim,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
    visibility: ('internal' | 'customer' | 'partner')[],
  ) {
    const [order, customer, factory] = await Promise.all([
      tx.order.findUniqueOrThrow({ where: { id: claim.orderId }, select: { publicId: true } }),
      tx.user.findUniqueOrThrow({ where: { id: claim.customerUserId }, select: { publicId: true } }),
      claim.factoryId
        ? tx.factory.findUniqueOrThrow({ where: { id: claim.factoryId }, select: { publicId: true } })
        : null,
    ]);
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'claim',
        aggregateId: claim.publicId,
        entityId: claim.entityId,
        payload: {
          claimId: claim.publicId,
          claimNo: claim.claimNo,
          orderId: order.publicId,
          customerId: customer.publicId,
          ...(visibility.includes('partner') && factory && { factoryId: factory.publicId }),
          ...data,
        },
      },
      actor,
    );
    // On the order's timeline, so the customer (and staff) follow the claim where they follow the order.
    await this.activity.record(tx, {
      aggregateType: 'order',
      aggregatePublicId: order.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: { claimId: claim.publicId, claimNo: claim.claimNo, ...data },
      visibility,
      entityId: claim.entityId,
      domainEventId: event.id,
      actor,
    });
  }
}
