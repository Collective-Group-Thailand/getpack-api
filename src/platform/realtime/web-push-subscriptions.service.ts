import { type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/** VAPID web-push subscriptions per user and device (D-143 "web push when permitted"). */
@Injectable()
export class WebPushSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
  ) {}

  /** One row per endpoint: a browser that signs in as someone else moves to that user. */
  async subscribe(
    actor: UserActor,
    input: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ) {
    const data = {
      userId: actor.userId,
      p256dh: input.p256dh,
      authSecretEnc: this.encryption.encrypt(input.auth),
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      revokedAt: null,
    };
    return this.prisma.webPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
  }

  async unsubscribe(actor: UserActor, publicId: string): Promise<void> {
    const updated = await this.prisma.webPushSubscription.updateMany({
      where: { publicId, userId: actor.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) throw new DomainException('http.not_found');
  }
}
