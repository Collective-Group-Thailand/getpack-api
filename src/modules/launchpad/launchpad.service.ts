import { type UserActor } from '@common/context/actor';
import { nextActions, NO_PERMISSIONS } from '@common/next-actions/next-actions';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { CompaniesService } from '@modules/companies/companies.service';
import { DesignsService } from '@modules/designs/designs.service';
import { STORE_ORDER_ACTIONS } from '@modules/orders/order-actions';
import { type QuoteInput } from '@modules/quotes/quote-input';
import { ReorderSuggestionsService } from '@modules/reorders/reorder-suggestions.service';
import { Injectable } from '@nestjs/common';

import {
  type DefaultsDto,
  LAUNCHPAD_ACTIONS,
  type LaunchpadAction,
  type LaunchpadActionItemDto,
  type LaunchpadDto,
  type NextStepDto,
  type ReorderCandidateDto,
} from './launchpad.dto';

const SHOWN = 5;
/** D-297: the store order actions that wait for the customer (opening a claim or reordering is optional). */
const ORDER_ACTION: Record<string, LaunchpadAction> = {
  'order.approve_proof': 'approve_proof',
  'order.upload_artwork': 'upload_artwork',
  'order.confirm_receipt': 'confirm_receipt',
};
const RANK = new Map(LAUNCHPAD_ACTIONS.map((a, i) => [a, i]));
const typeRef = (t: { publicId: string; code: string; nameTh: string; nameEn: string }) => ({
  id: t.publicId,
  code: t.code,
  nameTh: t.nameTh,
  nameEn: t.nameEn,
});

/**
 * The signed-in home (U5.B1): one read of what the customer last worked on and what waits for them (D-297), and the
 * values that pre-fill the configurator, studio and checkout (D-298). Read models only — every part is scoped to the
 * caller (their own designs, orders and suggestions, and those of companies they may order for).
 */
@Injectable()
export class LaunchpadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly designs: DesignsService,
    private readonly suggestions: ReorderSuggestionsService,
    private readonly companies: CompaniesService,
  ) {}

  async launchpad(actor: UserActor, now = new Date()): Promise<LaunchpadDto> {
    const [designs, reorderCandidates, needsAction] = await Promise.all([
      this.recentDesigns(actor.userId),
      this.reorderCandidates(actor, now),
      this.needsAction(actor.userId),
    ]);
    return {
      designs,
      reorderCandidates,
      needsAction,
      nextStep: nextStep(needsAction, reorderCandidates, designs),
    };
  }

  private async recentDesigns(userId: bigint) {
    const [rows] = await this.designs.list(userId, 1, SHOWN);
    return rows.map((r) => ({
      id: r.publicId,
      title: r.title,
      catalogProductId: r.catalogProduct.publicId,
      catalogProductNameTh: r.catalogProduct.nameTh,
      catalogProductNameEn: r.catalogProduct.nameEn,
      thumbnailFileId: r.thumbnailFile?.publicId ?? null,
      lockedByOrderCode: r.lockedByOrder?.orderCode ?? null,
      updatedAt: toBangkokIso(r.updatedAt),
    }));
  }

  private async reorderCandidates(actor: UserActor, now: Date): Promise<ReorderCandidateDto[]> {
    const today = bangkokDate(now);
    const suggested = (await this.suggestions.mine(actor)).slice(0, SHOWN);
    const out: ReorderCandidateDto[] = suggested.map((s) => ({
      source: 'suggestion',
      suggestionId: s.id,
      orderId: s.lastOrder.orderId,
      orderCode: s.lastOrder.orderCode,
      productType: s.productType,
      quantity: s.lastOrder.quantity,
      suggestedOn: s.suggestedOn,
      suggestedQuantity: s.suggestedQuantity,
      due: s.suggestedOn <= today,
    }));
    if (out.length >= SHOWN) return out;
    const taken = out.map((c) => c.orderId);
    // Delivered standard orders offer `order.reorder` (D-153); the latest delivered first.
    const past = await this.prisma.order.findMany({
      where: {
        customerUserId: actor.userId,
        kind: 'standard',
        deliveredAt: { not: null },
        cancelledAt: null,
        publicId: { notIn: taken },
      },
      include: { productType: true },
      orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }],
      take: SHOWN - out.length,
    });
    for (const o of past)
      out.push({
        source: 'past_order',
        suggestionId: null,
        orderId: o.publicId,
        orderCode: o.orderCode,
        productType: typeRef(o.productType),
        quantity: o.quantityOrdered,
        suggestedOn: null,
        suggestedQuantity: null,
        due: false,
      });
    return out;
  }

  private async needsAction(userId: bigint): Promise<LaunchpadActionItemDto[]> {
    const [groups, orders] = await Promise.all([
      this.prisma.orderGroup.findMany({
        where: { customerUserId: userId, status: 'waiting_payment' },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.order.findMany({
        where: { customerUserId: userId, cancelledAt: null, completedAt: null },
        include: { productType: true, lines: { select: { lineType: true } } },
        orderBy: [{ id: 'asc' }],
      }),
    ]);
    const items: LaunchpadActionItemDto[] = groups.map((g) => ({
      action: 'pay',
      subject: 'order_group',
      id: g.publicId,
      code: g.groupCode,
      productType: null,
      dueAt: g.expiresAt ? toBangkokIso(g.expiresAt) : null,
      amount: g.cashAmount.toFixed(2),
    }));
    for (const o of orders) {
      const offered = nextActions(o, STORE_ORDER_ACTIONS, NO_PERMISSIONS);
      // One item per order: the most urgent of its waiting actions.
      const action = offered
        .filter((a) => a.disabledReason === null && ORDER_ACTION[a.key])
        .map((a) => ORDER_ACTION[a.key]!)
        .sort((a, b) => RANK.get(a)! - RANK.get(b)!)[0];
      if (!action) continue;
      items.push({
        action,
        subject: 'order',
        id: o.publicId,
        code: o.orderCode,
        productType: typeRef(o.productType),
        dueAt: null,
        amount: null,
      });
    }
    // Stable: by the recommendation order, then as listed (oldest first).
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => RANK.get(a.item.action)! - RANK.get(b.item.action)! || a.index - b.index)
      .map((x) => x.item);
  }

  // --- defaults (D-298) ------------------------------------------------------------------------------------

  async defaults(actor: UserActor, productTypeCodes?: string[]): Promise<DefaultsDto> {
    const userId = actor.userId;
    const [address, lastUsed, taxProfile, companies, quotes] = await Promise.all([
      this.prisma.customerAddress.findFirst({
        where: { userId, kind: 'delivery', isDefault: true, deletedAt: null },
        select: { publicId: true },
      }),
      this.prisma.orderDestination.findFirst({
        where: {
          order: { customerUserId: userId },
          customerAddress: { kind: 'delivery', deletedAt: null, userId },
        },
        orderBy: [{ id: 'desc' }],
        select: { customerAddress: { select: { publicId: true } } },
      }),
      this.prisma.taxProfile.findFirst({
        where: { userId, isDefault: true, deletedAt: null },
        select: { publicId: true, name: true, taxId: true, branchCode: true },
      }),
      this.companies.mine(userId),
      this.prisma.quote.findMany({
        where: {
          customerUserId: userId,
          ...(productTypeCodes?.length && { productType: { code: { in: productTypeCodes } } }),
        },
        select: { input: true, createdAt: true, productType: { select: { code: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['productTypeId'],
      }),
    ]);
    const kits = await this.prisma.brandKit.groupBy({
      by: ['companyId'],
      where: { companyId: { in: companies.map((c) => c.id) }, status: 'active' },
      _count: { _all: true },
    });
    const withKit = new Set(kits.map((k) => k.companyId));
    const branches = await this.prisma.companyBranch.findMany({
      where: { companyId: { in: companies.map((c) => c.id) }, isDefault: true, deletedAt: null },
      select: { companyId: true, publicId: true },
    });
    const branchOf = new Map(branches.map((b) => [b.companyId, b.publicId]));
    const deliveryAddress = address
      ? { id: address.publicId, basis: 'default' as const }
      : lastUsed?.customerAddress
        ? { id: lastUsed.customerAddress.publicId, basis: 'last_used' as const }
        : null;
    return {
      deliveryAddress,
      taxProfile: taxProfile
        ? {
            id: taxProfile.publicId,
            name: taxProfile.name,
            taxId: taxProfile.taxId,
            branchCode: taxProfile.branchCode,
          }
        : null,
      companies: await Promise.all(
        companies.map(async (c) => ({
          id: c.publicId,
          legalName: c.legalName,
          taxId: c.taxId,
          defaultBranchId: branchOf.get(c.id) ?? null,
          withholdsTax: c.withholdsTax,
          mayOrder: await this.companies.hasCompanyPermission(userId, c.id, 'company_orders.place'),
          hasBrandKit: withKit.has(c.id),
        })),
      ),
      productTypes: quotes.map((q) => {
        const cfg = (q.input as unknown as QuoteInput | null)?.configuration ?? {};
        return {
          productTypeCode: q.productType.code,
          materialId: typeof cfg['materialId'] === 'string' ? cfg['materialId'] : null,
          printTypeId: typeof cfg['printTypeId'] === 'string' ? cfg['printTypeId'] : null,
          quotedAt: toBangkokIso(q.createdAt),
        };
      }),
    };
  }
}

/** D-297: the first that applies — what waits for me (in rank order), a due reorder, the latest design, else start. */
export function nextStep(
  needsAction: LaunchpadActionItemDto[],
  reorders: ReorderCandidateDto[],
  designs: { id: string }[],
): NextStepDto {
  const first = needsAction[0];
  if (first) return { kind: first.action, target: first.subject, targetId: first.id };
  const due = reorders.find((r) => r.source === 'suggestion' && r.due);
  if (due) return { kind: 'reorder', target: 'reorder_suggestion', targetId: due.suggestionId };
  const design = designs[0];
  if (design) return { kind: 'resume_design', target: 'design', targetId: design.id };
  return { kind: 'start_configuration', target: null, targetId: null };
}
