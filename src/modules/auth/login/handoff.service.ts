import { randomBytes } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { sameDigest, sha256 } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type AuthClient } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { AuthTokensService, type TokenPair } from '../auth-tokens.service';

/** Rows are kept a day after expiry for the audit trail, then purged when new codes are made. */
const PURGE_AFTER_MS = 24 * 3_600_000;

export const hashHandoffSecret = (value: string): Uint8Array<ArrayBuffer> => sha256(value);

export type HandoffRefusal = 'unknown' | 'used' | 'expired' | 'fingerprint' | 'account';

export interface IssuedHandoffCode {
  code: string;
  expiresAt: Date;
  target: AuthClient;
}

/**
 * Storefront → agent zone hand-off (D-467, PLAN A-08): no cookie is shared across subdomains. The signed-in
 * storefront asks for a one-time code bound to the target zone and to a device fingerprint; the agent zone's server
 * redeems it for a NEW session of client `agent`. 256-bit codes, single use, lifetime `auth.handoff_code_ttl_seconds`;
 * only SHA-256 of the code and of the fingerprint are stored; neither is ever logged. Every refusal is the same
 * neutral `auth.handoff_invalid`; a wrong fingerprint burns the code.
 */
@Injectable()
export class HandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokensService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async create(
    actor: UserActor,
    input: { target: AuthClient; fingerprint: string },
  ): Promise<IssuedHandoffCode> {
    if (actor.audience !== 'customer' || !actor.sessionId) throw new DomainException('auth.unauthenticated');
    const source = await this.prisma.authSession.findFirst({
      where: { familyId: actor.sessionId, userId: actor.userId, revokedAt: null },
      orderBy: { issuedAt: 'desc' },
      select: { loginMethod: true, client: true },
    });
    if (!source) throw new DomainException('auth.unauthenticated');
    const now = new Date();
    const ttl = await this.settings.value('auth.handoff_code_ttl_seconds', now);
    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const context = RequestContext.current();
    await this.prisma.withTx(async (tx) => {
      await tx.authHandoffCode.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) } },
      });
      const row = await tx.authHandoffCode.create({
        data: {
          userId: actor.userId,
          target: input.target,
          codeHash: hashHandoffSecret(code),
          fingerprintHash: hashHandoffSecret(input.fingerprint),
          sourceSessionFamilyId: actor.sessionId,
          loginMethod: source.loginMethod,
          expiresAt,
          ip: context?.ip ?? null,
          userAgent: context?.userAgent ?? null,
        },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'auth.handoff_created',
        actor,
        resourceType: 'user',
        resourcePublicId: actor.publicId,
        data: { handoffId: row.publicId, target: input.target, fromClient: source.client, ttlSeconds: ttl },
      });
      await this.events.record(
        tx,
        {
          type: 'customer.handoff_created',
          aggregateType: 'user',
          aggregateId: actor.publicId,
          payload: { userId: actor.publicId, handoffId: row.publicId, target: input.target },
        },
        actor,
      );
    });
    return { code, expiresAt, target: input.target };
  }

  async redeem(code: string, fingerprint: string): Promise<TokenPair> {
    const now = new Date();
    const outcome = await this.prisma.withTx(async (tx) => {
      const row = await tx.authHandoffCode.findUnique({
        where: { codeHash: hashHandoffSecret(code) },
        include: { user: true },
      });
      if (!row) return { refused: 'unknown' as const };
      const actor = {
        type: 'user' as const,
        userId: row.user.id,
        publicId: row.user.publicId,
        audience: 'customer' as const,
        scopes: [],
      };
      const refuse = async (reason: HandoffRefusal) => {
        await this.audit.record(tx, {
          category: 'security',
          action: 'auth.handoff_refused',
          outcome: 'denied',
          actor,
          resourceType: 'user',
          resourcePublicId: row.user.publicId,
          data: { handoffId: row.publicId, reason },
        });
        return { refused: reason };
      };
      // Single use: the first presentation claims the code, whatever happens next.
      const claimed = await tx.authHandoffCode.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (claimed.count === 0) return refuse('used');
      if (row.expiresAt <= now) return refuse('expired');
      if (!sameDigest(row.fingerprintHash, hashHandoffSecret(fingerprint))) return refuse('fingerprint');
      const user = row.user;
      if (user.kind !== 'customer' || user.status !== 'active' || user.anonymisedAt) return refuse('account');

      const pair = await this.tokens.issue(tx, user, 'customer', row.loginMethod, undefined, row.target);
      await tx.authHandoffCode.update({
        where: { id: row.id },
        data: { redeemedSessionFamilyId: pair.sessionFamilyId },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      await this.audit.record(tx, {
        category: 'security',
        action: 'auth.login_succeeded',
        actor,
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { method: row.loginMethod, client: row.target, via: 'handoff', handoffId: row.publicId },
      });
      await this.events.record(
        tx,
        {
          type: 'customer.handoff_redeemed',
          aggregateType: 'user',
          aggregateId: user.publicId,
          payload: { userId: user.publicId, handoffId: row.publicId, target: row.target },
        },
        actor,
      );
      return { pair };
    });
    if ('pair' in outcome) return outcome.pair;
    if (outcome.refused === 'unknown') {
      await this.audit.recordStandalone({
        category: 'security',
        action: 'auth.handoff_refused',
        outcome: 'denied',
        data: { reason: 'unknown' },
      });
    }
    throw new DomainException('auth.handoff_invalid');
  }
}
