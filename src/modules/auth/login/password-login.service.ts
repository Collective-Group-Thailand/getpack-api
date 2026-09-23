import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type User } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { SettingsService } from '@platform/settings/settings.service';

import { AuthTokensService, type TokenPair } from '../auth-tokens.service';
import { PasswordService } from '../password.service';

/**
 * Staff and partner login with email + password (argon2id), and partner device-PIN login
 * (ADR-0004). Failed attempts lock the account per `auth.password_lockout` / `auth.device_pin_policy`.
 * Unknown accounts cost the same hashing time as known ones and return the same problem.
 */
@Injectable()
export class PasswordLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: AuthTokensService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async withPassword(kind: 'staff' | 'partner', email: string, password: string): Promise<TokenPair> {
    const user = await this.findByEmail(kind, email);
    this.assertNotLocked(user);
    const ok = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !ok) {
      if (user) await this.recordFailure(user, 'auth.login_failed');
      else
        await this.audit.recordStandalone({
          category: 'security',
          action: 'auth.login_failed',
          outcome: 'denied',
          actor: { type: 'system', name: 'login' },
          data: { audience: kind, knownAccount: false },
        });
      throw new DomainException('auth.invalid_credentials');
    }
    return this.succeed(user, kind, 'password');
  }

  async withDevicePin(email: string, deviceId: string, pin: string): Promise<TokenPair> {
    const user = await this.findByEmail('partner', email);
    const device = user
      ? await this.prisma.devicePin.findFirst({ where: { userId: user.id, deviceId, revokedAt: null } })
      : null;
    if (device?.lockedUntil && device.lockedUntil > new Date()) throw lockedProblem(device.lockedUntil);
    const ok = await this.passwords.verify(device?.pinHash, pin);
    if (!user || !device || !ok) {
      if (device) {
        const policy = await this.settings.value('auth.device_pin_policy');
        const failed = device.failedAttempts + 1;
        const lock = failed >= policy.maxAttempts;
        await this.prisma.devicePin.update({
          where: { id: device.id },
          data: {
            failedAttempts: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + policy.lockMinutes * 60_000) : device.lockedUntil,
          },
        });
      }
      await this.audit.recordStandalone({
        category: 'security',
        action: 'auth.pin_failed',
        outcome: 'denied',
        actor: { type: 'system', name: 'login' },
        ...(user && { data: { userId: user.id } }),
      });
      throw new DomainException('auth.pin_invalid');
    }
    await this.prisma.devicePin.update({
      where: { id: device.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    return this.succeed(user, 'partner', 'device_pin', deviceId);
  }

  /** Registers (or replaces) the PIN of one device for the signed-in partner user. */
  async setDevicePin(userId: bigint, deviceId: string, pin: string): Promise<void> {
    const policy = await this.settings.value('auth.device_pin_policy');
    if (!new RegExp(`^\\d{${policy.length}}$`).test(pin)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'pin', code: 'length', message: `PIN must be ${policy.length} digits` }],
      });
    }
    const pinHash = await this.passwords.hash(pin);
    await this.prisma.withTx(async (tx) => {
      await tx.devicePin.updateMany({
        where: { userId, deviceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.devicePin.create({ data: { userId, deviceId, pinHash } });
      await this.audit.record(tx, { category: 'security', action: 'auth.device_pin_set', data: { userId } });
    });
  }

  async removeDevicePin(userId: bigint, deviceId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      await tx.devicePin.updateMany({
        where: { userId, deviceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'auth.device_pin_removed',
        data: { userId },
      });
    });
  }

  private findByEmail(kind: 'staff' | 'partner', email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { kind, email: email.trim(), anonymisedAt: null } });
  }

  private assertNotLocked(user: User | null): void {
    if (user?.lockedUntil && user.lockedUntil > new Date()) throw lockedProblem(user.lockedUntil);
  }

  private async recordFailure(user: User, action: string): Promise<void> {
    const policy = await this.settings.value('auth.password_lockout');
    const failed = user.failedLoginCount + 1;
    const lock = failed >= policy.maxFailedAttempts;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + policy.lockMinutes * 60_000) : user.lockedUntil,
      },
    });
    await this.audit.recordStandalone({
      category: 'security',
      action: lock ? 'auth.account_locked' : action,
      outcome: 'denied',
      actor: { type: 'system', name: 'login' },
      resourceType: 'user',
      resourcePublicId: user.publicId,
    });
  }

  private async succeed(
    user: User,
    kind: 'staff' | 'partner',
    method: 'password' | 'device_pin',
    deviceId?: string,
  ): Promise<TokenPair> {
    if (user.status !== 'active') throw new DomainException('auth.account_inactive');
    return this.prisma.withTx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await this.audit.record(tx, {
        category: 'security',
        action: 'auth.login_succeeded',
        actor: { type: 'user', userId: user.id, publicId: user.publicId, audience: kind, scopes: [] },
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { method },
      });
      return this.tokens.issue(tx, user, kind, method, deviceId);
    });
  }
}

function lockedProblem(until: Date): DomainException {
  const seconds = Math.max(Math.ceil((until.getTime() - Date.now()) / 1000), 1);
  return new DomainException('auth.account_locked', { headers: { 'Retry-After': String(seconds) } });
}
