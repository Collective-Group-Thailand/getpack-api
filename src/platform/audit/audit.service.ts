import { type Actor, actorColumns } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { jsonSafe } from '@common/json/json-safe';
import { redactDeep } from '@common/logging/redaction';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type AuditCategory, type AuditOutcome } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  category: AuditCategory;
  /** Stable key, e.g. `auth.login_failed`, `iam.role_granted`, `setting.changed`. */
  action: string;
  outcome?: AuditOutcome;
  resourceType?: string;
  resourcePublicId?: string;
  entityId?: bigint;
  /** Before/after or other context; redacted before it is stored (PDPA). */
  data?: Record<string, unknown>;
  /** Defaults to the request's actor, then to `system`. */
  actor?: Actor;
}

/**
 * Security- and finance-relevant actions (schema-design §3.1 `audit_logs`, B1.3 "Audit"): logins,
 * role changes, permission denials, setting changes, exports, approval actions. Append-only.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Inside the caller's transaction — the audit row commits or rolls back with the change. */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.row(entry) });
  }

  /**
   * On its own connection, for outcomes that must be kept even though the request fails
   * (denied permission, failed login). Never throws: auditing a failure must not mask it.
   */
  async recordStandalone(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.row(entry) });
    } catch {
      // The failure is already reported by the caller's error path; losing this row is logged by Prisma.
    }
  }

  private row(entry: AuditEntry) {
    const context = RequestContext.current();
    const actor = entry.actor ?? context?.actor ?? { type: 'system' as const, name: 'unknown' };
    return {
      ...actorColumns(actor),
      onBehalfOfUserId: actor.type === 'user' ? (actor.onBehalfOfUserId ?? null) : null,
      entityId: entry.entityId ?? null,
      category: entry.category,
      action: entry.action,
      outcome: entry.outcome ?? 'success',
      resourceType: entry.resourceType ?? null,
      resourcePublicId: entry.resourcePublicId ?? null,
      requestId: context?.requestId ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      data: jsonSafe(redactDeep(entry.data ?? {})),
    };
  }
}
