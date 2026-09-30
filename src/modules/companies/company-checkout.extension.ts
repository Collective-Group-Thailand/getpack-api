import { type Actor, systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { type Tx } from '@database/prisma.service';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type CheckoutInput,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { type TaxProfileSnapshot } from '@modules/customers/customers.service';
import { OrdersService } from '@modules/orders/orders.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { CompaniesService, type CompanyRow } from './companies.service';
import { CreditService } from './credit.service';

const POLICY = 'company_order_approval';
const DAY_MS = 86_400_000;

interface CompanyInput {
  companyId: string;
  branchId: string | null;
}

interface CompanyState {
  companyId: bigint;
  companyPublicId: string;
  branchId: bigint;
  threshold: string | null;
}

function companyInput(input: CheckoutInput): CompanyInput | null {
  const c = input.extensions?.['company'] as CompanyInput | undefined;
  return c?.companyId ? c : null;
}

function branchOf(company: CompanyRow, branchId: string | null) {
  const branch = branchId
    ? company.branches.find((b) => b.publicId === branchId)
    : company.branches.find((b) => b.isDefault);
  if (!branch)
    throw new DomainException('validation.failed', {
      errors: [{ path: 'companyBranchId', code: 'exists', message: 'unknown branch' }],
    });
  return branch;
}

/**
 * Checkout extension `company` (order 950, D-123 / D-125): a member with `company_orders.place` orders for
 * the company — the tax invoice names the company branch (and its withholding), the company's PO policy
 * applies, and an order above the company's own threshold is placed **pending company approval**: the
 * company approver decides in the store (`company_order_approval`); approval starts the unpaid-expiry
 * clock, rejection cancels the group.
 */
@Injectable()
export class CompanyCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'company';
  readonly order = 950;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly companies: CompaniesService,
    private readonly approvals: ApprovalsService,
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly credit: CreditService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
  }

  async taxProfile(
    who: { actor: Actor; customerUserId: bigint },
    input: CheckoutInput,
    db: Tx,
  ): Promise<TaxProfileSnapshot | undefined> {
    const c = companyInput(input);
    if (!c) return undefined;
    const company = await this.companies.orderingCompany(db, who.customerUserId, c.companyId);
    const branch = await db.companyBranch.findUniqueOrThrow({
      where: { id: branchOf(company, c.branchId).id },
      include: { province: true, subdistrict: { include: { district: true } } },
    });
    const address = [
      branch.line1,
      branch.line2,
      branch.subdistrict?.nameTh,
      branch.subdistrict?.district.nameTh,
      branch.province.nameTh,
      branch.postcode,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      taxProfileId: branch.publicId,
      taxType: 'juristic',
      name: company.legalName,
      taxId: company.taxId,
      branchType: branch.branchType,
      branchCode: branch.branchCode,
      address,
      postcode: branch.postcode,
      provinceNameTh: branch.province.nameTh,
      withholdsTax: company.withholdsTax,
      documentEmail: company.documentEmail,
      companyId: company.publicId,
      companyBranchId: branch.publicId,
    };
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const c = companyInput(draft.input);
    if (!c) return;
    const company = await this.companies.orderingCompany(db, draft.customerUserId, c.companyId);
    const branch = branchOf(company, c.branchId);
    if (company.poNumberPolicy === 'required' && !draft.input.poNumber?.trim())
      throw new DomainException('companies.po_required');
    const threshold = company.orderApprovalThreshold?.toFixed(2) ?? null;
    const approvalRequired = threshold !== null && new MoneyDecimal(draft.totals.grossAmount).gt(threshold);
    if (approvalRequired) {
      draft.initialStatus = 'pending_company_approval';
      draft.notices.push({ code: 'company.approval_required', params: { threshold } });
    }
    // The preview's company block (U-B0.1); the credit decision itself is the credit extension's (order 850).
    const credit = company.creditStatus === 'credit' ? await this.credit.view(company.id, db) : null;
    draft.preview.company = {
      companyId: company.publicId,
      legalName: company.legalName,
      branchId: branch.publicId,
      poNumberPolicy: company.poNumberPolicy,
      approvalThreshold: threshold,
      approvalRequired,
      creditStatus: company.creditStatus,
      creditAvailableAmount: credit?.limit ? credit.available.toFixed(2) : null,
      creditTermDays: credit?.limit?.termDays ?? null,
      onCredit: draft.state['creditApproved'] === true,
    };
    draft.state[this.key] = {
      companyId: company.id,
      companyPublicId: company.publicId,
      branchId: branch.id,
      threshold,
    } satisfies CompanyState;
  }

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    const state = draft.state[this.key] as CompanyState | undefined;
    if (!state) return;
    await tx.orderGroup.update({
      where: { id: placed.groupId },
      data: { companyId: state.companyId, companyBranchId: state.branchId },
    });
    await tx.order.updateMany({
      where: { orderGroupId: placed.groupId },
      data: { companyId: state.companyId },
    });
    if (draft.initialStatus !== 'pending_company_approval') return;
    if (draft.actor.type !== 'user') throw new DomainException('auth.forbidden');
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: placed.groupId } });
    const request = await this.approvals.create(tx, {
      policyKey: POLICY,
      subject: { type: 'order_group', id: group.id, publicId: group.publicId },
      requester: draft.actor,
      amount: group.grossAmount.toFixed(2),
      scope: { companyId: state.companyId },
      refs: state.threshold !== null ? { 'company.order_approval_threshold': state.threshold } : {},
      payload: {
        groupId: group.publicId,
        groupCode: group.groupCode,
        companyId: state.companyPublicId,
        amount: group.grossAmount.toFixed(2),
        orders: placed.orders.length,
        poNumber: group.poNumber,
        threshold: state.threshold,
      },
    });
    await tx.orderGroup.update({ where: { id: group.id }, data: { companyApprovalRequestId: request.id } });
    await this.record(
      tx,
      group.publicId,
      'order_group.company_approval_requested',
      {
        companyId: state.companyPublicId,
        approvalId: request.publicId,
        amount: group.grossAmount.toFixed(2),
        threshold: state.threshold,
      },
      draft.actor,
    );
  }

  /** The approver's decision: approved → waiting for payment (expiry starts now); otherwise cancelled. */
  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'companies.order_approval',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const group = await tx.orderGroup.findFirst({
      where: { companyApprovalRequestId: request.id },
      include: { company: true },
    });
    if (!group || group.status !== 'pending_company_approval') return;
    const actor = systemActor('companies.order_approval');
    if (event.type === 'approval.approved') {
      const expiry = await this.settings.at('orders.unpaid_expiry_days', { tx });
      const now = new Date();
      await tx.orderGroup.update({
        where: { id: group.id },
        data: {
          status: 'waiting_payment',
          expiresAt: new Date(now.getTime() + Number(expiry.value) * DAY_MS),
          rowVersion: { increment: 1 },
        },
      });
      await this.record(
        tx,
        group.publicId,
        'order_group.company_approved',
        { companyId: group.company?.publicId ?? null },
        actor,
      );
      return;
    }
    await this.orders.cancelGroupIn(
      tx,
      actor,
      group.publicId,
      { reasonCode: 'company_approval_rejected', note: null },
      { system: true },
    );
    await this.record(
      tx,
      group.publicId,
      'order_group.company_rejected',
      { companyId: group.company?.publicId ?? null, outcome: event.type },
      actor,
    );
  }

  private async record(
    tx: Tx,
    groupPublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'order_group',
        aggregateId: groupPublicId,
        payload: { groupId: groupPublicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order_group',
      aggregatePublicId: groupPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}
