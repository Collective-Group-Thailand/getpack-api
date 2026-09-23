import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';

/** The other party an action touches, for `same_vendor` / `same_customer` rules. */
export interface SodParty {
  kind: 'vendor' | 'customer';
  publicId: string;
}

/** Value to put in `audit_logs.data.sodParty` when recording an SoD-relevant action. */
export const sodPartyKey = (party: SodParty): string => `${party.kind}:${party.publicId}`;

export interface SodCheckResult {
  /** Rules with enforcement `warn` that matched (the action proceeds, the warning is audited). */
  warnings: string[];
}

/**
 * Segregation of duties (`accounting-design.md` §8, D-168). Two rule kinds:
 * - `role_pair`: one user may not hold both roles — checked when a role is granted;
 * - `action_pair`: whoever performed action A on a subject (or party) may not perform action B on it.
 *
 * Action history is the audit log: a module that performs an SoD-relevant action records an audit
 * row with `action` = the permission key (e.g. `payout_run.create`), `resource_type` /
 * `resource_public_id` = the subject and, for party rules, `data.sodParty` = `sodPartyKey(party)`.
 * Used by role grants, the approvals engine (B1.3) and the finance modules (B5).
 */
@Injectable()
export class SodService {
  constructor(private readonly audit: AuditService) {}

  async checkRoleGrant(tx: Tx, userId: bigint, roleId: bigint): Promise<SodCheckResult> {
    const held = await tx.userRole.findMany({
      where: { userId, revokedAt: null, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] },
      select: { roleId: true },
    });
    const heldIds = held.map((h) => h.roleId);
    if (heldIds.length === 0) return { warnings: [] };
    const rules = await tx.sodRule.findMany({
      where: {
        active: true,
        kind: 'role_pair',
        OR: [
          { roleAId: roleId, roleBId: { in: heldIds } },
          { roleBId: roleId, roleAId: { in: heldIds } },
        ],
      },
    });
    return this.enforce(tx, rules, { userId, roleId });
  }

  async checkAction(
    tx: Tx,
    input: {
      actorUserId: bigint;
      /** Permission key of the action about to happen, e.g. `payout_run.approve`. */
      action: string;
      subject: { type: string; publicId: string };
      party?: SodParty;
    },
  ): Promise<SodCheckResult> {
    const rules = await tx.sodRule.findMany({
      where: { active: true, kind: 'action_pair', actionB: input.action },
    });
    const violated = [];
    for (const rule of rules) {
      if (!rule.actionA) continue;
      const bySubject = rule.subjectMatch === 'same_subject' || rule.subjectMatch === null;
      if (!bySubject && !input.party) continue;
      const prior = bySubject
        ? await tx.auditLog.count({
            where: {
              actorUserId: input.actorUserId,
              action: rule.actionA,
              outcome: 'success',
              resourceType: input.subject.type,
              resourcePublicId: input.subject.publicId,
            },
          })
        : await tx.auditLog.count({
            where: {
              actorUserId: input.actorUserId,
              action: rule.actionA,
              outcome: 'success',
              data: { path: ['sodParty'], equals: sodPartyKey(input.party!) },
            },
          });
      if (prior > 0) violated.push(rule);
    }
    return this.enforce(tx, violated, {
      userId: input.actorUserId,
      action: input.action,
      subject: input.subject,
    });
  }

  private async enforce(
    tx: Tx,
    rules: { key: string; enforcement: 'block' | 'warn' }[],
    context: Record<string, unknown>,
  ): Promise<SodCheckResult> {
    const blocking = rules.find((r) => r.enforcement === 'block');
    if (blocking) {
      await this.audit.recordStandalone({
        category: 'iam',
        action: 'sod.blocked',
        outcome: 'denied',
        data: { rule: blocking.key, ...context },
      });
      throw new DomainException('iam.sod_conflict', { params: { rule: blocking.key } });
    }
    const warnings = rules.map((r) => r.key);
    if (warnings.length > 0) {
      await this.audit.record(tx, {
        category: 'iam',
        action: 'sod.warned',
        data: { rules: warnings, ...context },
      });
    }
    return { warnings };
  }
}
