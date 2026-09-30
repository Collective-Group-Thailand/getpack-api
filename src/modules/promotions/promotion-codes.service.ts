import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type Prisma } from '@generated/prisma/client';
import { type CartActor, cartEtag, type CartRow, CartsService } from '@modules/carts/carts.service';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';

import { IdentityFingerprints } from './identity-fingerprints.service';
import { couponReason } from './promotion-checkout.extension';

const COUPON_INCLUDE = { promotion: { include: { campaign: true } } } as const;
type CouponRow = Prisma.CouponCodeGetPayload<{ include: typeof COUPON_INCLUDE }>;

/** What a customer may know of a code: title, benefit, main conditions, validity, whether it is usable now. */
export interface PromotionOffer {
  code: string;
  title: string;
  description: string | null;
  benefit: { type: string; pct: string | null; amount: string | null; maxAmount: string | null };
  conditions: {
    minOrderValue: string | null;
    minQuantity: number | null;
    productTypeCodes: string[];
    firstOrderOnly: boolean;
    paymentMethods: string[];
  };
  validUntil: string | null;
  status: string;
}

function offerView(c: CouponRow, reason: string | null): PromotionOffer {
  const b = (c.promotion.benefit ?? {}) as { type?: string; pct?: string; amount?: string; maxAmount?: string };
  const k = (c.promotion.conditions ?? {}) as {
    minOrderValue?: string;
    minQuantity?: number;
    productTypeCodes?: string[];
    firstOrderOnly?: boolean;
    paymentMethods?: string[];
  };
  const ends = [c.promotion.endsAt, c.promotion.campaign?.endsAt].filter((d): d is Date => !!d);
  return {
    code: c.code,
    title: c.promotion.name,
    description: c.promotion.description,
    benefit: { type: b.type ?? 'other', pct: b.pct ?? null, amount: b.amount ?? null, maxAmount: b.maxAmount ?? null },
    conditions: {
      minOrderValue: k.minOrderValue ?? null,
      minQuantity: k.minQuantity ?? null,
      productTypeCodes: k.productTypeCodes ?? [],
      firstOrderOnly: k.firstOrderOnly ?? false,
      paymentMethods: k.paymentMethods ?? [],
    },
    validUntil: ends.length ? toBangkokIso(new Date(Math.min(...ends.map((d) => d.getTime())))) : null,
    status: reason ?? 'usable',
  };
}

/** Codes one cart may carry; the engine decides which of them stack (D-053). */
export const MAX_CART_CODES = 5;
const CODE = /^[A-Za-z0-9-]{3,40}$/;

export interface AttemptSource {
  ip?: string;
  deviceId?: string;
}

/**
 * Coupon codes on the cart (D-053): each attempt counts against hourly limits per customer, IP and
 * device (`promotions.code_attempt_limits`); a code is checked for status, window, assignment and usage
 * when entered and again at every checkout preview, where the cart's conditions are evaluated.
 */
@Injectable()
export class PromotionCodes {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartsService,
    private readonly settings: SettingsService,
    private readonly identity: IdentityFingerprints,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async apply(
    who: CartActor,
    ifMatch: string | undefined,
    rawCode: string,
    source: AttemptSource,
  ): Promise<CartRow> {
    const code = rawCode.trim();
    if (!CODE.test(code))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'code', code: 'pattern', message: '3–40 letters, digits or dashes' }],
      });
    await this.countAttempt(who, source);
    return this.prisma.withTx(async (tx) => {
      const cart = await this.carts.active(tx, who);
      assertIfMatch(ifMatch, cartEtag(cart), { required: false });
      if (source.deviceId) await this.identity.record(tx, who.customerUserId, 'device', source.deviceId);
      if (cart.codes.some((c) => c.code.toLowerCase() === code.toLowerCase())) return cart;
      if (cart.codes.length >= MAX_CART_CODES)
        throw new DomainException('promotions.code_invalid', { params: { reason: 'too_many_codes' } });
      const coupon = await tx.couponCode.findUnique({
        where: { code },
        include: { promotion: { include: { campaign: true } } },
      });
      if (!coupon) throw new DomainException('promotions.code_invalid', { params: { reason: 'not_found' } });
      const reason = couponReason(coupon, who.customerUserId, new Date());
      if (reason) throw new DomainException('promotions.code_invalid', { params: { reason } });
      await tx.cartCode.create({
        data: {
          cartId: cart.id,
          code: coupon.code,
          status: 'validated',
          promotionId: coupon.promotionId,
          couponCodeId: coupon.id,
        },
      });
      await this.touch(tx, cart.id);
      await this.record(
        tx,
        cart.publicId,
        'cart.code_applied',
        { code: coupon.code, promotionId: coupon.promotion.publicId },
        who,
      );
      return this.carts.active(tx, who);
    });
  }

  async remove(who: CartActor, ifMatch: string | undefined, code: string): Promise<CartRow> {
    return this.prisma.withTx(async (tx) => {
      const cart = await this.carts.active(tx, who);
      assertIfMatch(ifMatch, cartEtag(cart), { required: false });
      const row = cart.codes.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
      if (!row) throw new DomainException('http.not_found');
      await tx.cartCode.delete({ where: { id: row.id } });
      await this.touch(tx, cart.id);
      await this.record(tx, cart.publicId, 'cart.code_removed', { code: row.code }, who);
      return this.carts.active(tx, who);
    });
  }

  /**
   * Checks a code before any cart (U-B0.1, D-053): the same status, window, assignment and usage rules as
   * entering it on the cart, plus the product type and quantity conditions when given. Nothing is written; each
   * check counts against the same hourly attempt budgets (per customer, IP, device).
   */
  async check(
    customerUserId: bigint | null,
    input: { code: string; productTypeCode?: string; quantity?: number },
    source: AttemptSource,
    at = new Date(),
  ): Promise<{ code: string; valid: boolean; reason: string | null; offer: PromotionOffer | null }> {
    const code = input.code.trim();
    await this.countAttempts(customerUserId, false, source);
    const coupon = await this.prisma.couponCode.findUnique({ where: { code }, include: COUPON_INCLUDE });
    if (!coupon) return { code, valid: false, reason: 'not_found', offer: null };
    let reason = couponReason(coupon, customerUserId ?? -1n, at);
    const conditions = (coupon.promotion.conditions ?? {}) as { productTypeCodes?: string[]; minQuantity?: number };
    if (!reason && input.productTypeCode && conditions.productTypeCodes && !conditions.productTypeCodes.includes(input.productTypeCode))
      reason = 'not_applicable';
    if (!reason && input.quantity !== undefined && conditions.minQuantity && input.quantity < conditions.minQuantity)
      reason = 'not_applicable';
    // Another customer's code: say so, show nothing of it.
    const show = reason === null || reason === 'not_applicable';
    return { code: coupon.code, valid: reason === null, reason, offer: show ? offerView(coupon, reason) : null };
  }

  /** The codes assigned to me or that I saved (U-B0.1 wallet), with whether each can be used now. */
  async mine(userId: bigint, at = new Date()): Promise<PromotionOffer[]> {
    const rows = await this.prisma.couponCode.findMany({
      where: { OR: [{ assignedUserId: userId }, { savedBy: { some: { userId } } }] },
      include: COUPON_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((c) => offerView(c, couponReason(c, userId, at)));
  }

  /** Hourly attempt budgets; CS entering a code for a customer counts against the CS user too. */
  private async countAttempt(who: CartActor, source: AttemptSource): Promise<void> {
    await this.countAttempts(who.customerUserId, who.csUserId !== null, source);
  }

  private async countAttempts(customerUserId: bigint | null, byCs: boolean, source: AttemptSource): Promise<void> {
    const limits = (await this.settings.at('promotions.code_attempt_limits')).value;
    const now = Date.now();
    const hour = Math.floor(now / 3_600_000);
    const checks: [string, number][] = [];
    if (customerUserId !== null)
      checks.push([`packio:coupon:user:${customerUserId}:${hour}`, limits.perCustomerPerHour]);
    if (!byCs && source.ip) checks.push([`packio:coupon:ip:${source.ip}:${hour}`, limits.perIpPerHour]);
    if (source.deviceId)
      checks.push([`packio:coupon:device:${source.deviceId}:${hour}`, limits.perDevicePerHour]);
    for (const [key, limit] of checks) {
      const [[, count]] = (await this.redis.multi().incr(key).expire(key, 3_600).exec()) as [
        [Error | null, number],
      ];
      if (count > limit)
        throw new DomainException('promotions.too_many_attempts', {
          headers: { 'Retry-After': String(Math.max(1, Math.ceil(((hour + 1) * 3_600_000 - now) / 1000))) },
        });
    }
  }

  private async touch(tx: Tx, cartId: bigint) {
    await tx.cart.update({
      where: { id: cartId },
      data: { lastActivityAt: new Date(), rowVersion: { increment: 1 } },
    });
  }

  private async record(
    tx: Tx,
    cartPublicId: string,
    type: string,
    data: Record<string, unknown>,
    who: CartActor,
  ) {
    const event = await this.events.record(
      tx,
      { type, aggregateType: 'cart', aggregateId: cartPublicId, payload: { cartId: cartPublicId, ...data } },
      who.actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'cart',
      aggregatePublicId: cartPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor: who.actor,
    });
  }
}
