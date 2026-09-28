import { type Tx } from '@database/prisma.service';
import { type NotificationAudience, type NotificationRoute } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';

/** A person (with a user id) or a team address (LINE group, Teams webhook) to notify. */
export interface Recipient {
  userId?: bigint;
  locale: 'th' | 'en';
  displayName: string;
  /** For staff-team channels (D-143 "LINE group per team", Teams adapter). */
  team?: { id: bigint; code: string };
}

export type RecipientResolver = (
  event: DomainEventEnvelope,
  route: NotificationRoute,
  tx: Tx,
) => Promise<Recipient[]>;

/**
 * Who an audience of the routing matrix means for one event (D-143). Built in: `customer`
 * (`payload.customerId`, or the owner of the aggregate), `staff_team` (members of the route's
 * team, plus the team itself for LINE/Teams) and `assignee` (per aggregate type — the approval
 * engine registers its approvers). `factory` and `company_member` are registered by the partner
 * (B2.2) and company (B3.5) modules.
 */
@Injectable()
export class RecipientDirectory {
  private readonly byAudience = new Map<NotificationAudience, RecipientResolver>();
  private readonly assignees = new Map<string, RecipientResolver>();

  constructor() {
    this.byAudience.set('customer', customerRecipients);
    this.byAudience.set('staff_team', staffTeamRecipients);
    this.byAudience.set('assignee', (event, route, tx) => {
      const resolver = this.assignees.get(event.aggregateType);
      return resolver ? resolver(event, route, tx) : Promise.resolve([]);
    });
  }

  register(audience: 'factory' | 'company_member', resolver: RecipientResolver): void {
    this.byAudience.set(audience, resolver);
  }

  /** The people an event of this aggregate type is "assigned" to (e.g. current approvers). */
  registerAssignees(aggregateType: string, resolver: RecipientResolver): void {
    this.assignees.set(aggregateType, resolver);
  }

  resolve(event: DomainEventEnvelope, route: NotificationRoute, tx: Tx): Promise<Recipient[]> {
    const resolver = this.byAudience.get(route.audience);
    return resolver ? resolver(event, route, tx) : Promise.resolve([]);
  }
}

async function customerRecipients(
  event: DomainEventEnvelope,
  _route: NotificationRoute,
  tx: Tx,
): Promise<Recipient[]> {
  const ids = await customersOf(event, tx);
  if (ids.length === 0) return [];
  const users = await tx.user.findMany({
    where: { OR: ids.map((i) => i.where), kind: 'customer', status: 'active', anonymisedAt: null },
  });
  return users.map((user) => ({ userId: user.id, locale: user.locale, displayName: user.displayName }));
}

/**
 * The customer(s) an event is about: `payload.customerId`, a user aggregate, or the owner of the aggregate
 * (order, order group, claim, RFQ, payment, refund; the orders a shipment carries).
 */
async function customersOf(
  event: DomainEventEnvelope,
  tx: Tx,
): Promise<{ where: { publicId?: string; id?: bigint } }[]> {
  const fromPayload = event.payload['customerId'];
  if (typeof fromPayload === 'string') return [{ where: { publicId: fromPayload } }];
  const id = event.aggregateId;
  const byId = (userId: bigint | null | undefined) => (userId ? [{ where: { id: userId } }] : []);
  switch (event.aggregateType) {
    case 'user':
      return [{ where: { publicId: id } }];
    case 'order':
      return byId(
        (await tx.order.findUnique({ where: { publicId: id }, select: { customerUserId: true } }))
          ?.customerUserId,
      );
    case 'order_group':
      return byId(
        (await tx.orderGroup.findUnique({ where: { publicId: id }, select: { customerUserId: true } }))
          ?.customerUserId,
      );
    case 'claim':
      return byId(
        (await tx.claim.findUnique({ where: { publicId: id }, select: { customerUserId: true } }))
          ?.customerUserId,
      );
    case 'rfq':
      return byId(
        (await tx.rfq.findUnique({ where: { publicId: id }, select: { customerUserId: true } }))
          ?.customerUserId,
      );
    case 'payment':
      return byId(
        (
          await tx.payment.findUnique({
            where: { publicId: id },
            select: { orderGroup: { select: { customerUserId: true } } },
          })
        )?.orderGroup?.customerUserId,
      );
    case 'refund':
      return byId(
        (
          await tx.refund.findUnique({
            where: { publicId: id },
            select: { payment: { select: { orderGroup: { select: { customerUserId: true } } } } },
          })
        )?.payment.orderGroup?.customerUserId,
      );
    case 'shipment': {
      const orderIds = (event.payload['orderIds'] as string[] | undefined) ?? [];
      const orders = await tx.order.findMany({
        where: { publicId: { in: orderIds } },
        select: { customerUserId: true },
      });
      return [...new Set(orders.map((o) => o.customerUserId))].map((userId) => ({ where: { id: userId } }));
    }
    default:
      return [];
  }
}

async function staffTeamRecipients(
  _event: DomainEventEnvelope,
  route: NotificationRoute,
  tx: Tx,
): Promise<Recipient[]> {
  if (route.staffTeamId === null) return [];
  const team = await tx.team.findUnique({ where: { id: route.staffTeamId } });
  if (!team) return [];
  if (route.channel === 'line' || route.channel === 'teams') {
    return [{ locale: 'th', displayName: team.nameTh, team: { id: team.id, code: team.code } }];
  }
  const members = await tx.user.findMany({
    where: { kind: 'staff', status: 'active', anonymisedAt: null, staffProfile: { teamId: team.id } },
  });
  return members.map((u) => ({ userId: u.id, locale: u.locale, displayName: u.displayName }));
}

/** Users holding a role (active grant, optionally in one scope), for assignee resolvers. */
export async function holdersOfRole(tx: Tx, roleId: bigint, scopeId: bigint | null): Promise<Recipient[]> {
  const now = new Date();
  const grants = await tx.userRole.findMany({
    where: {
      roleId,
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      ...(scopeId !== null && { scopeId }),
      user: { status: 'active', anonymisedAt: null },
    },
    include: { user: true },
  });
  return grants.map((g) => ({ userId: g.user.id, locale: g.user.locale, displayName: g.user.displayName }));
}
