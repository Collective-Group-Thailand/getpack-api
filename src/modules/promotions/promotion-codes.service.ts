import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type CartActor, cartEtag, type CartRow, CartsService } from '@modules/carts/carts.service';
import { Inject, Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';

import { IdentityFingerprints } from './identity-fingerprints.service';
import { couponReason } from './promotion-checkout.extension';

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

  async apply(who: CartActor, ifMatch: string | undefined, rawCode: string, source: AttemptSource): Promise<CartRow> {
    const code = rawCode.trim();
    if (!CODE.test(code))
      throw new DomainException('validation.failed', { errors: [{ path: 'code', code: 'pattern', message: '3–40 letters, digits or dashes' }] });
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
      await this.record(tx, cart.publicId, 'cart.code_applied', { code: coupon.code, promotionId: coupon.promotion.publicId }, who);
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

  /** Hourly attempt budgets; CS entering a code for a customer counts against the CS user too. */
  private async countAttempt(who: CartActor, source: AttemptSource): Promise<void> {
    const limits = (await this.settings.at('promotions.code_attempt_limits')).value;
    const hour = Math.floor(Date.now() / 3_600_000);
    const checks: [string, number][] = [[`packio:coupon:user:${who.customerUserId}:${hour}`, limits.perCustomerPerHour]];
    if (who.csUserId === null && source.ip) checks.push([`packio:coupon:ip:${source.ip}:${hour}`, limits.perIpPerHour]);
    if (source.deviceId) checks.push([`packio:coupon:device:${source.deviceId}:${hour}`, limits.perDevicePerHour]);
    for (const [key, limit] of checks) {
      const [[, count]] = (await this.redis.multi().incr(key).expire(key, 3_600).exec()) as [[Error | null, number]];
      if (count > limit) throw new DomainException('promotions.too_many_attempts');
    }
  }

  private async touch(tx: Tx, cartId: bigint) {
    await tx.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date(), rowVersion: { increment: 1 } } });
  }

  private async record(tx: Tx, cartPublicId: string, type: string, data: Record<string, unknown>, who: CartActor) {
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
