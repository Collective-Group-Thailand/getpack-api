import { randomUUID } from 'node:crypto';

import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { type CartActor } from '@modules/carts/carts.service';
import { CustomersService } from '@modules/customers/customers.service';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { applyDecorators, Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Res, type Type } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import { adminOrderGroupDto, orderGroupDto } from '../orders/order-views';
import {
  ADMIN_ORDER_GROUP_EXAMPLE,
  AdminOrderGroupDto,
  ORDER_GROUP_EXAMPLE,
  OrderGroupDto,
} from '../orders/orders.dto';
import {
  AdminCheckoutDto,
  CHECKOUT_EXAMPLE,
  CheckoutDto,
  CheckoutPreviewDto,
  PREVIEW_EXAMPLE,
} from './checkout.dto';
import { type CheckoutDraft, type CheckoutInput } from './checkout.extensions';
import { CheckoutService } from './checkout.service';

const DECISIONS = ['D-051', 'D-060', 'D-013', 'D-142', 'D-174', 'D-010'];
const ERRORS = [
  'http.bad_request',
  'http.malformed_json',
  'http.not_found',
  'validation.failed',
  'checkout.cart_empty',
  'checkout.price_expired',
  'checkout.destinations_incomplete',
  'checkout.shipping_unavailable',
  'checkout.rfq_destination_fixed',
  'checkout.wht_rate_missing',
  'pricing.vat_rate_missing',
  'payments.no_schedule_template',
  'promotions.limit_reached',
  'promotions.budget_exhausted',
  'loyalty.insufficient_points',
  'companies.po_required',
  'companies.invalid_status',
] as const;
const named = <T>(cls: T, name: string): T => Object.defineProperty(cls, 'name', { value: name });

interface ProposedLike {
  templateKey: string;
  instalments: {
    seq: number;
    labelTh: string;
    labelEn: string;
    pct: string;
    dueTrigger: string;
    requiredBefore: string;
    amounts: { gross: string; cash: string };
  }[];
}

function scheduleOf(draft: CheckoutDraft): CheckoutPreviewDto['paymentSchedule'] {
  const proposed = draft.state['paymentSchedule'] as ProposedLike | undefined;
  if (!proposed) return null;
  return {
    templateKey: proposed.templateKey,
    instalments: proposed.instalments.map((i) => ({
      seq: i.seq,
      labelTh: i.labelTh,
      labelEn: i.labelEn,
      pct: i.pct,
      dueTrigger: i.dueTrigger,
      requiredBefore: i.requiredBefore,
      grossAmount: i.amounts.gross,
      cashAmount: i.amounts.cash,
    })),
  };
}

/** Controller body → checkout input (the CS schedule choice is an extension input). */
function inputOf(body: AdminCheckoutDto, admin: boolean): CheckoutInput {
  const { paymentSchedule, csRemarks, redeemPoints, companyId, companyBranchId, ...rest } = body;
  const extensions = {
    ...(redeemPoints && { points: redeemPoints }),
    ...(companyId && { company: { companyId, branchId: companyBranchId ?? null } }),
    ...(admin && paymentSchedule && { paymentSchedule }),
  };
  return { ...rest, ...(admin && { csRemarks }), ...(Object.keys(extensions).length > 0 && { extensions }) };
}

export function previewDto(draft: CheckoutDraft): CheckoutPreviewDto {
  const money = (t: CheckoutDraft['totals']) => ({ ...t, currency: 'THB' });
  return {
    totals: money(draft.totals),
    orders: draft.orders.map((o) => ({
      cartItemId: o.cartItemPublicId,
      productTypeCode: o.productTypeCode,
      quantity: o.quantity,
      totals: money(o.totals),
      lines: o.lines.map((l, i) => ({
        id: randomUUID(),
        lineNo: i + 1,
        lineType: l.lineType,
        descriptionTh: l.descriptionTh,
        descriptionEn: l.descriptionEn,
        quantity: String(l.quantity),
        unitPrice: l.unitPrice,
        netAmount: l.netAmount,
        discountAmount: l.discountAmount,
        vatRatePct: l.vatRatePct,
        vatAmount: l.vatAmount,
        grossAmount: l.grossAmount,
        whtCategory: l.whtCategory,
        whtAmount: l.whtAmount,
      })),
      destinations: o.legs.map((l) => ({
        postcode: l.postcode,
        quantity: l.quantity,
        shippingNetAmount: l.net.toFixed(2),
      })),
      discounts: o.discounts.map((d) => ({
        lineNo: d.lineIndex === null ? null : d.lineIndex + 1,
        source: d.source,
        amount: d.amount,
        cappedAmount: d.cappedAmount ?? '0.00',
        capReason: d.capReason ?? null,
        promotionId: (d.meta?.['promotionId'] as string | undefined) ?? null,
        code: (d.meta?.['code'] as string | null | undefined) ?? null,
      })),
    })),
    withholding: draft.orders.some((o) => o.lines.some((l) => l.whtAmount !== '0.00')),
    notices: draft.notices,
    paymentSchedule: scheduleOf(draft),
  };
}

/**
 * Checkout on two surfaces: the customer's own cart (`/v1/store/checkout`) and CS placing a customer's CS
 * cart on their behalf (`/v1/admin/customers/{customerId}/checkout`, `carts.manage_on_behalf`).
 */
function checkoutController(surface: 'store' | 'admin'): Type<unknown> {
  const admin = surface === 'admin';
  const guard = () =>
    applyDecorators(
      ...(admin ? [Can('carts.manage_on_behalf'), ApiParam({ name: 'customerId', format: 'uuid' })] : []),
    );
  const Body_ = admin ? AdminCheckoutDto : CheckoutDto;

  @ApiSurface(surface, 'checkout')
  @Controller(admin ? 'customers/:customerId/checkout' : 'checkout')
  class CheckoutController {
    constructor(
      private readonly checkout: CheckoutService,
      private readonly customers: CustomersService,
      private readonly permissions: PermissionResolver,
    ) {}

    async who(actor: Actor, customerId: string | undefined): Promise<CartActor> {
      if (actor.type !== 'user') throw new DomainException('auth.forbidden');
      if (!admin) return { actor, customerUserId: actor.userId, channel: 'web', csUserId: null };
      return {
        actor,
        customerUserId: await this.customers.customerIdOf(customerId!),
        channel: 'cs',
        csUserId: actor.userId,
      };
    }

    @Post('actions/preview')
    @HttpCode(200)
    @guard()
    @ApiEndpoint({
      id: `${surface}.checkout.preview`,
      summary: 'Preview checkout',
      description:
        'Prices the cart exactly as checkout would: locked quotation prices (D-051), shipping per destination ' +
        'on the customer rate card (D-013), VAT per line and the expected withholding of the chosen tax ' +
        'profile (D-174). Nothing is written.',
      implements: DECISIONS,
    })
    @ApiBody({ type: Body_, examples: { default: { value: CHECKOUT_EXAMPLE } } })
    @ApiSuccess(200, { description: 'Priced checkout', type: CheckoutPreviewDto, example: PREVIEW_EXAMPLE })
    @ApiStandardErrors(...ERRORS)
    async preview(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Body() body: AdminCheckoutDto,
    ): Promise<CheckoutPreviewDto> {
      const input = inputOf(body, admin);
      return previewDto(await this.checkout.price(await this.who(actor, customerId), input));
    }

    @Post()
    @guard()
    @Idempotent()
    @ApiEndpoint({
      id: `${surface}.checkout.place`,
      summary: admin ? 'Place a customer’s order (CS)' : 'Place my order',
      description:
        'Re-prices the cart on the server and writes one order group with one order per cart item (legacy ' +
        'rule), lines, destinations (snapshot, D-142), the pricing snapshot with every version id, the ' +
        'expected withholding (D-174) and the unpaid expiry (`orders.unpaid_expiry_days`, D-060). The cart ' +
        'is checked out and its quotations converted. Requires `Idempotency-Key`; a replay returns the same ' +
        'group. `expectedGrossAmount` guards against a total that changed since the preview.',
      implements: DECISIONS,
    })
    @ApiBody({ type: Body_, examples: { default: { value: CHECKOUT_EXAMPLE } } })
    @ApiSuccess(201, {
      description: 'Order group placed',
      type: admin ? AdminOrderGroupDto : OrderGroupDto,
      example: admin ? ADMIN_ORDER_GROUP_EXAMPLE : ORDER_GROUP_EXAMPLE,
      headers: ['Location'],
    })
    @ApiStandardErrors(...ERRORS, 'checkout.total_changed', 'concurrency.stale', 'numbering.series_missing')
    async place(
      @CurrentActor() actor: Actor,
      @Param('customerId', new ParseUUIDPipe({ optional: true })) customerId: string | undefined,
      @Body() body: AdminCheckoutDto,
      @Res({ passthrough: true }) res: Response,
    ) {
      const input = inputOf(body, admin);
      const group = await this.checkout.checkout(await this.who(actor, customerId), input);
      res.setHeader(
        'Location',
        admin ? `/v1/admin/order-groups/${group.publicId}` : `/v1/store/order-groups/${group.publicId}`,
      );
      if (!admin) return orderGroupDto(group);
      const granted = (await this.permissions.forUser((actor as { userId: bigint }).userId)).permissions;
      return adminOrderGroupDto(group, { cost: granted.has('factory_cost.read'), margin: granted.has('margin.read') });
    }
  }

  return named(CheckoutController, `${admin ? 'Admin' : 'Store'}CheckoutController`);
}

export const StoreCheckoutController = checkoutController('store');
export const AdminCheckoutController = checkoutController('admin');
