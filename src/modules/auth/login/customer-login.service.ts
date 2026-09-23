import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type LoginMethod, type User } from '@generated/prisma/client';
import { ProviderUnavailableError } from '@integrations/http/resilient-http';
import {
  FIREBASE_VERIFIER,
  type FirebaseVerifier,
  IdentityTokenInvalidError,
  LINE_VERIFIER,
  type LineVerifier,
  type VerifiedIdentity,
} from '@integrations/identity/identity-verifier.port';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { AuthTokensService, type TokenPair } from '../auth-tokens.service';
import { OtpService } from './otp.service';
import { maskPhone } from './phone';

/**
 * Customer sign-in (ADR-0004): phone OTP, Firebase (Google/Apple) and LINE Login / LIFF (D-151).
 *
 * Linking rules for an external identity (LINE, Google, Apple) seen for the first time:
 * 1. sent with a customer access token → linked to that signed-in customer;
 * 2. sent with a verified `link_phone` OTP → linked to the customer with that phone (created if new);
 * 3. otherwise → a new customer is created with that identity.
 * Accounts are never linked by e-mail address alone (account-takeover risk).
 */
@Injectable()
export class CustomerLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: AuthTokensService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    @Inject(FIREBASE_VERIFIER) private readonly firebase: FirebaseVerifier,
    @Inject(LINE_VERIFIER) private readonly line: LineVerifier,
  ) {}

  async withOtp(challengeId: string, code: string): Promise<TokenPair> {
    const phone = await this.otp.verify(challengeId, code, 'login');
    return this.prisma.withTx(async (tx) => {
      const user = await this.customerByPhone(tx, phone);
      await this.ensureIdentity(tx, user, { provider: 'phone_otp', subject: phone });
      return this.login(tx, user, 'phone_otp');
    });
  }

  async withFirebase(idToken: string, signedIn?: UserActor): Promise<TokenPair> {
    const identity = await this.verify(() => this.firebase.verifyIdToken(idToken));
    return this.withIdentity(identity, identity.provider, signedIn);
  }

  async withLine(
    input: { idToken?: string; liffAccessToken?: string; otpChallengeId?: string; otpCode?: string },
    signedIn?: UserActor,
  ): Promise<TokenPair> {
    const identity = await this.verify(() =>
      input.liffAccessToken
        ? this.line.verifyLiffAccessToken(input.liffAccessToken)
        : this.line.verifyIdToken(input.idToken ?? ''),
    );
    const phone =
      input.otpChallengeId && input.otpCode
        ? await this.otp.verify(input.otpChallengeId, input.otpCode, 'link_phone')
        : undefined;
    return this.withIdentity(identity, input.liffAccessToken ? 'line_liff' : 'line', signedIn, phone);
  }

  private async withIdentity(
    identity: VerifiedIdentity,
    method: LoginMethod,
    signedIn?: UserActor,
    verifiedPhone?: string,
  ): Promise<TokenPair> {
    return this.prisma.withTx(async (tx) => {
      const linked = await tx.userIdentity.findFirst({
        where: { provider: identity.provider, providerSubject: identity.subject, unlinkedAt: null },
        include: { user: true },
      });
      if (linked) {
        if (signedIn && linked.userId !== signedIn.userId)
          throw new DomainException('auth.identity_linked_elsewhere');
        await tx.userIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: new Date() } });
        return this.login(tx, linked.user, method);
      }

      let user: User;
      if (signedIn) user = await tx.user.findUniqueOrThrow({ where: { id: signedIn.userId } });
      else if (verifiedPhone) user = await this.customerByPhone(tx, verifiedPhone);
      else user = await this.createCustomer(tx, identity);
      await this.ensureIdentity(tx, user, identity);
      return this.login(tx, user, method);
    });
  }

  private async customerByPhone(tx: Tx, phone: string): Promise<User> {
    const existing = await tx.user.findFirst({ where: { kind: 'customer', phone, anonymisedAt: null } });
    if (existing) {
      if (!existing.phoneVerifiedAt) {
        return tx.user.update({ where: { id: existing.id }, data: { phoneVerifiedAt: new Date() } });
      }
      return existing;
    }
    return this.createCustomer(tx, { provider: 'phone_otp', subject: phone }, phone);
  }

  private async createCustomer(
    tx: Tx,
    identity: VerifiedIdentity | { provider: 'phone_otp'; subject: string },
    phone?: string,
  ): Promise<User> {
    const email = 'email' in identity && identity.emailVerified ? identity.email : undefined;
    // An e-mail another customer already uses is not attached (no linking by e-mail).
    const emailFree = email
      ? (await tx.user.count({ where: { kind: 'customer', email, anonymisedAt: null } })) === 0
      : false;
    const displayName =
      ('displayName' in identity && identity.displayName) ||
      (phone ? `ลูกค้า ${maskPhone(phone)}` : 'ลูกค้า Packio');
    const user = await tx.user.create({
      data: {
        kind: 'customer',
        status: 'active',
        displayName,
        ...(phone && { phone, phoneVerifiedAt: new Date() }),
        ...(email && emailFree && { email, emailVerifiedAt: new Date() }),
      },
    });
    // Sign-up rewards (D-135) and welcome notifications subscribe to this event.
    await this.events.record(
      tx,
      {
        type: 'customer.registered',
        aggregateType: 'user',
        aggregateId: user.publicId,
        payload: { userId: user.publicId, via: identity.provider },
      },
      { type: 'user', userId: user.id, publicId: user.publicId, audience: 'customer', scopes: [] },
    );
    return user;
  }

  private async ensureIdentity(
    tx: Tx,
    user: User,
    identity: {
      provider: VerifiedIdentity['provider'] | 'phone_otp';
      subject: string;
      displayName?: string;
      pictureUrl?: string;
    },
  ): Promise<void> {
    const existing = await tx.userIdentity.findFirst({
      where: { provider: identity.provider, providerSubject: identity.subject, unlinkedAt: null },
    });
    if (existing) {
      if (existing.userId !== user.id) throw new DomainException('auth.identity_linked_elsewhere');
      await tx.userIdentity.update({ where: { id: existing.id }, data: { lastUsedAt: new Date() } });
      return;
    }
    await tx.userIdentity.create({
      data: {
        userId: user.id,
        provider: identity.provider,
        providerSubject: identity.subject,
        lastUsedAt: new Date(),
        ...((identity.displayName || identity.pictureUrl) && {
          profile: { displayName: identity.displayName ?? null, pictureUrl: identity.pictureUrl ?? null },
        }),
      },
    });
    const actor = {
      type: 'user' as const,
      userId: user.id,
      publicId: user.publicId,
      audience: 'customer' as const,
      scopes: [],
    };
    await this.audit.record(tx, {
      category: 'security',
      action: 'auth.identity_linked',
      actor,
      resourceType: 'user',
      resourcePublicId: user.publicId,
      data: { provider: identity.provider },
    });
    // LINE linking reward (D-135) subscribes to this event.
    await this.events.record(
      tx,
      {
        type: 'customer.identity_linked',
        aggregateType: 'user',
        aggregateId: user.publicId,
        payload: { userId: user.publicId, provider: identity.provider },
      },
      actor,
    );
  }

  private async login(tx: Tx, user: User, method: LoginMethod): Promise<TokenPair> {
    if (user.kind !== 'customer') throw new DomainException('auth.invalid_credentials');
    if (user.status !== 'active' || user.anonymisedAt) throw new DomainException('auth.account_inactive');
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record(tx, {
      category: 'security',
      action: 'auth.login_succeeded',
      actor: { type: 'user', userId: user.id, publicId: user.publicId, audience: 'customer', scopes: [] },
      resourceType: 'user',
      resourcePublicId: user.publicId,
      data: { method },
    });
    return this.tokens.issue(tx, user, 'customer', method);
  }

  private async verify(call: () => Promise<VerifiedIdentity>): Promise<VerifiedIdentity> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof IdentityTokenInvalidError)
        throw new DomainException('auth.identity_token_invalid');
      if (error instanceof ProviderUnavailableError) throw error;
      throw new DomainException('auth.identity_token_invalid', { cause: error });
    }
  }
}
