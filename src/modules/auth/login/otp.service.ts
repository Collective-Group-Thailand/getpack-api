import { randomBytes, randomInt } from 'node:crypto';

import { hmacSha256, sameDigest } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { uuidv7 } from '@common/ids/uuidv7';
import { AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type OtpPurpose } from '@generated/prisma/client';
import { SMS_SENDER, type SmsSender } from '@integrations/sms/sms-sender.port';
import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';

export interface OtpChallengeIssued {
  challengeId: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

/**
 * Customer phone OTP (ADR-0004, D-143 SMS for OTP). Codes are random, stored only as an HMAC bound
 * to the challenge id, never logged. Limits come from `auth.otp_policy`: expiry, attempts per
 * challenge, resend cool-down, requests per phone and per IP per hour (Redis counters; phone
 * numbers are HMAC-hashed before they become keys).
 */
@Injectable()
export class OtpService {
  private readonly secret: string;

  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {
    // Production requires the variable (validateEnv); elsewhere a per-process key is enough.
    this.secret = config.get('OTP_HMAC_SECRET') ?? randomBytes(32).toString('hex');
  }

  async request(phone: string, purpose: OtpPurpose, ip: string | undefined): Promise<OtpChallengeIssued> {
    const policy = await this.settings.value('auth.otp_policy');
    const phoneKey = Buffer.from(hmacSha256(this.secret, `phone:${phone}`))
      .toString('hex')
      .slice(0, 32);
    const hour = Math.floor(Date.now() / 3_600_000);

    // Cool-down per purpose (sign in, then link LINE right away); the hourly cap spans all purposes.
    const cooldownKey = `packio:otp:cooldown:${purpose}:${phoneKey}`;
    const placed = await this.redis.set(cooldownKey, '1', 'EX', policy.resendCooldownSeconds, 'NX');
    if (placed !== 'OK') {
      const ttl = Math.max(await this.redis.ttl(cooldownKey), 1);
      throw rateLimited(ttl);
    }
    const phoneCount = await this.bump(`packio:otp:phone:${phoneKey}:${hour}`);
    const ipCount = ip ? await this.bump(`packio:otp:ip:${ip}:${hour}`) : 0;
    if (phoneCount > policy.maxPerPhonePerHour || ipCount > policy.maxPerIpPerHour) {
      throw rateLimited(3_600 - (Math.floor(Date.now() / 1000) % 3_600));
    }

    const challengeId = uuidv7();
    const code = randomInt(0, 10 ** policy.codeLength)
      .toString()
      .padStart(policy.codeLength, '0');
    const now = Date.now();
    const expiresAt = new Date(now + policy.expirySeconds * 1000);
    const created = await this.prisma.otpChallenge.create({
      data: {
        publicId: challengeId,
        phone,
        purpose,
        codeHash: this.digest(challengeId, code),
        expiresAt,
        maxAttempts: policy.maxAttempts,
        requestIp: ip ?? null,
      },
    });
    const minutes = Math.ceil(policy.expirySeconds / 60);
    const { providerMessageId } = await this.sms.send({
      to: phone,
      text: `รหัส OTP Packio ของคุณคือ ${code} (หมดอายุใน ${minutes} นาที) ห้ามแจ้งรหัสนี้กับผู้อื่น`,
    });
    await this.prisma.otpChallenge.update({ where: { id: created.id }, data: { providerMessageId } });
    return { challengeId, expiresAt, resendAvailableAt: new Date(now + policy.resendCooldownSeconds * 1000) };
  }

  /** Returns the verified phone (E.164). Each call spends one attempt; a used code cannot be reused. */
  async verify(challengeId: string, code: string, purpose: OtpPurpose): Promise<string> {
    const [row] = await this.prisma.$queryRaw<
      { id: bigint; phone: string; code_hash: Uint8Array; attempts: number; max_attempts: number }[]
    >`
      UPDATE otp_challenges SET attempts = attempts + 1
       WHERE public_id = ${challengeId}::uuid AND purpose = ${purpose}::otp_purpose
         AND consumed_at IS NULL AND expires_at > now() AND attempts < max_attempts
      RETURNING id, phone, code_hash, attempts, max_attempts`;
    if (!row) throw new DomainException('auth.otp_expired');
    if (!sameDigest(this.digest(challengeId, code), row.code_hash)) {
      throw new DomainException('auth.otp_invalid', {
        params: { remaining: row.max_attempts - row.attempts },
      });
    }
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new DomainException('auth.otp_expired');
    return row.phone;
  }

  private digest(challengeId: string, code: string): Uint8Array<ArrayBuffer> {
    return hmacSha256(this.secret, `${challengeId}:${code}`);
  }

  private async bump(key: string): Promise<number> {
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, 3_600).exec()) as [
      [null, number],
      unknown,
    ];
    return count;
  }
}

function rateLimited(retryAfterSeconds: number): DomainException {
  return new DomainException('auth.otp_rate_limited', {
    params: { retryAfter: retryAfterSeconds },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}
