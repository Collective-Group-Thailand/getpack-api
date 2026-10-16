import { randomBytes, randomUUID } from 'node:crypto';

import { RequestContext } from '@common/context/request-context';
import { sha256 } from '@common/crypto/hashing';
import { PrismaService, type Tx } from '@database/prisma.service';
import { REDIS } from '@database/redis.module';
import { type LoginMethod, type SessionRevokeReason, type TokenAudience } from '@generated/prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { SettingsService } from '@platform/settings/settings.service';
import { type Redis } from 'ioredis';

/** Longer than the longest access token (15 min), so a revoked family's tokens die with the marker. */
const REVOKED_MARKER_TTL_SECONDS = 16 * 60;
const revokedKey = (familyId: string) => `getpack:auth:revoked:${familyId}`;

export const hashRefreshToken = (token: string): Uint8Array<ArrayBuffer> => sha256(token);

export interface IssuedSession {
  sessionId: bigint;
  familyId: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export type RotateResult =
  | { ok: true; session: IssuedSession; userId: bigint; audience: TokenAudience; loginMethod: LoginMethod }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' };

/**
 * Refresh-token sessions (ADR-0004, contract §4): opaque 256-bit tokens stored as SHA-256 hashes,
 * single use and rotating. Presenting a token that was already rotated revokes the whole family
 * (theft detection). The family id is the access token's `sid`; revoked families are also marked
 * in Redis so their still-valid access tokens are refused at once.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async create(
    tx: Tx,
    input: { userId: bigint; audience: TokenAudience; loginMethod: LoginMethod; deviceId?: string },
  ): Promise<IssuedSession> {
    const lifetime = (await this.settings.value('auth.refresh_token_lifetimes'))[input.audience];
    const now = Date.now();
    const expiresAt = new Date(now + lifetime.absoluteHours * 3_600_000);
    return this.insert(tx, {
      ...input,
      familyId: randomUUID(),
      parentSessionId: null,
      expiresAt,
      idleExpiresAt: new Date(Math.min(now + lifetime.idleHours * 3_600_000, expiresAt.getTime())),
    });
  }

  async rotate(refreshToken: string): Promise<RotateResult> {
    const current = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!current || current.revokedAt) return { ok: false, reason: 'invalid' };
    if (current.rotatedAt) {
      await this.revokeFamily(current.familyId, 'reuse_detected', current.userId);
      return { ok: false, reason: 'reused' };
    }
    const now = new Date();
    if (current.expiresAt <= now || current.idleExpiresAt <= now) return { ok: false, reason: 'expired' };
    if (current.user.status !== 'active') return { ok: false, reason: 'invalid' };

    const lifetime = (await this.settings.value('auth.refresh_token_lifetimes'))[current.audience];
    const outcome = await this.prisma.withTx(async (tx) => {
      // Only one concurrent rotation can win; the loser is treated as reuse.
      const claimed = await tx.authSession.updateMany({
        where: { id: current.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now },
      });
      if (claimed.count === 0) return null;
      return this.insert(tx, {
        userId: current.userId,
        audience: current.audience,
        loginMethod: current.loginMethod,
        deviceId: current.deviceId ?? undefined,
        familyId: current.familyId,
        parentSessionId: current.id,
        expiresAt: current.expiresAt,
        idleExpiresAt: new Date(
          Math.min(now.getTime() + lifetime.idleHours * 3_600_000, current.expiresAt.getTime()),
        ),
      });
    });
    if (!outcome) {
      await this.revokeFamily(current.familyId, 'reuse_detected', current.userId);
      return { ok: false, reason: 'reused' };
    }
    return {
      ok: true,
      session: outcome,
      userId: current.userId,
      audience: current.audience,
      loginMethod: current.loginMethod,
    };
  }

  /** Logout with the refresh token: revokes its family. Unknown tokens are ignored (no oracle). */
  async logout(refreshToken: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    });
    if (session && !session.revokedAt) await this.revokeFamily(session.familyId, 'logout', session.userId);
  }

  async revokeFamily(familyId: string, reason: SessionRevokeReason, userId?: bigint): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      await tx.authSession.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: reason },
      });
      if (reason === 'reuse_detected') {
        await this.audit.record(tx, {
          category: 'security',
          action: 'auth.refresh_reuse_detected',
          outcome: 'denied',
          ...(userId !== undefined && { data: { userId } }),
        });
      }
    });
    await this.markRevoked([familyId]);
  }

  /** Suspension, deactivation, password change: every open session of the user ends. */
  async revokeAllForUser(tx: Tx, userId: bigint, reason: SessionRevokeReason): Promise<string[]> {
    const open = await tx.authSession.findMany({
      where: { userId, revokedAt: null },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return open.map((s) => s.familyId);
  }

  /** Call after the revoking transaction committed. */
  async markRevoked(familyIds: readonly string[]): Promise<void> {
    if (familyIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of familyIds) pipeline.set(revokedKey(id), '1', 'EX', REVOKED_MARKER_TTL_SECONDS);
    await pipeline.exec();
  }

  /** Throws when Redis is unreachable: the guard then fails closed. */
  async isRevoked(familyId: string): Promise<boolean> {
    return (await this.redis.exists(revokedKey(familyId))) === 1;
  }

  private async insert(
    tx: Tx,
    input: {
      userId: bigint;
      audience: TokenAudience;
      loginMethod: LoginMethod;
      deviceId?: string;
      familyId: string;
      parentSessionId: bigint | null;
      expiresAt: Date;
      idleExpiresAt: Date;
    },
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const context = RequestContext.current();
    const row = await tx.authSession.create({
      data: {
        userId: input.userId,
        audience: input.audience,
        familyId: input.familyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        parentSessionId: input.parentSessionId,
        loginMethod: input.loginMethod,
        expiresAt: input.expiresAt,
        idleExpiresAt: input.idleExpiresAt,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        deviceId: input.deviceId ?? null,
      },
    });
    return {
      sessionId: row.id,
      familyId: input.familyId,
      refreshToken,
      refreshTokenExpiresAt: input.idleExpiresAt,
    };
  }
}
