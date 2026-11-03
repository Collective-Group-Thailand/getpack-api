import { type Tx } from '@database/prisma.service';
import { type SalesAgentKind } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import {
  type AttributionFacts,
  type CaptureRoute,
  MARKETING_PURPOSES,
  marketingConsent,
  routeCapture,
} from './capture-rules';
import { CLOSED_INBOUND } from './sales-desk-rules';

export interface CaptureContact {
  /** The signed-in customer, when known. */
  userId?: bigint | null;
  /** E.164. */
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
}

const owner = (agent: { kind: SalesAgentKind; staffUserId: bigint | null }) => ({
  kind: agent.kind,
  staffUserId: agent.kind === 'employee' ? agent.staffUserId : null,
});

/**
 * D-471: finds what a contact is already attached to (agent link, agent lead, a rep's open enquiry) and routes a
 * captured signal or enquiry by the precedence of `routeCapture` (agent > rep > pool, D-417 first). Read-only.
 */
@Injectable()
export class CaptureAttributionService {
  async facts(tx: Tx, contact: CaptureContact, now = new Date()): Promise<AttributionFacts> {
    const userId = contact.userId ?? null;
    const companies = userId
      ? (
          await tx.companyMember.findMany({
            where: { userId, status: 'active' },
            select: { companyId: true },
          })
        ).map((m) => m.companyId)
      : [];
    const link = userId
      ? await tx.salesAgentLink.findFirst({
          where: {
            status: 'active',
            OR: [{ customerUserId: userId }, ...(companies.length ? [{ companyId: { in: companies } }] : [])],
          },
          orderBy: { id: 'asc' },
          include: { agent: { select: { kind: true, staffUserId: true } } },
        })
      : null;
    const keys = [
      ...(contact.phone ? [{ phone: contact.phone }] : []),
      ...(contact.email ? [{ email: contact.email }] : []),
      ...(contact.taxId ? [{ taxId: contact.taxId }] : []),
    ];
    const lead =
      keys.length || userId
        ? await tx.salesAgentLead.findFirst({
            where: {
              kind: 'customer',
              OR: [
                ...(keys.length
                  ? [{ status: 'registered' as const, protectedUntil: { gt: now }, OR: keys }]
                  : []),
                ...(userId ? [{ status: 'converted' as const, convertedUserId: userId }] : []),
              ],
            },
            orderBy: { id: 'asc' },
            include: { agent: { select: { kind: true, staffUserId: true } } },
          })
        : null;
    const inboundKeys = [
      ...(userId ? [{ captureUserId: userId }] : []),
      ...(contact.phone ? [{ contactPhone: contact.phone }] : []),
      ...(contact.email ? [{ contactEmail: contact.email }] : []),
    ];
    const repInbound = inboundKeys.length
      ? await tx.salesInboundLead.findFirst({
          where: { status: { notIn: [...CLOSED_INBOUND] }, assigneeUserId: { not: null }, OR: inboundKeys },
          orderBy: { id: 'asc' },
          select: { assigneeUserId: true },
        })
      : null;
    return {
      link: link ? owner(link.agent) : null,
      lead: lead ? owner(lead.agent) : null,
      repInbound: repInbound?.assigneeUserId ? { assigneeUserId: repInbound.assigneeUserId } : null,
    };
  }

  async route(tx: Tx, contact: CaptureContact, now = new Date()): Promise<CaptureRoute> {
    return routeCapture(await this.facts(tx, contact, now));
  }

  /** The marketing consent record a captured signal relies on (latest per purpose; one granted), else null. */
  async marketingConsent(tx: Tx, userId: bigint): Promise<{ id: bigint } | null> {
    const purposes = await tx.consentPurpose.findMany({
      where: { key: { in: [...MARKETING_PURPOSES] } },
      select: { id: true },
    });
    const latest = await Promise.all(
      purposes.map((p) =>
        tx.consentRecord.findFirst({
          where: { userId, purposeId: p.id },
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          select: { id: true, granted: true, recordedAt: true },
        }),
      ),
    );
    return marketingConsent(latest.filter((r) => r !== null));
  }
}
