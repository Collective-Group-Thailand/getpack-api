import { randomBytes, randomUUID } from 'node:crypto';

import { type Actor, systemActor, type UserActor, type WebhookActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Payment,
  type PaymentMethod,
  type PaymentProvider,
  type Prisma,
  type UploadChannel,
} from '@generated/prisma/client';
import {
  SCB_GATEWAY,
  type ScbConfirmation,
  type ScbGateway,
  SLIP_VERIFIER,
  type SlipCheck,
  type SlipVerifier,
  TWOC2P_GATEWAY,
  type TwoC2PGateway,
} from '@integrations/payments/payment-gateways.port';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { OrderLifecycleHooks } from '@modules/orders/orders.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
import { PromotionRedemptions } from '@modules/promotions/promotion-redemptions.service';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

const D = (v: string | Prisma.Decimal | number) => new MoneyDecimal(v.toString());
const OPEN = ['pending', 'due', 'partially_paid', 'overdue'] as const;
/** 2C2P payment tokens live 30 minutes (provider limit, not a business value). */
const TWOC2P_TOKEN_MINUTES = 30;

export const PAYMENT_INCLUDE = {
  orderGroup: true,
  allocations: { include: { instalment: true } },
  slips: {
    orderBy: { createdAt: 'desc' },
    include: {
      verifications: { orderBy: { requestedAt: 'desc' } },
      fileObject: { select: { publicId: true } },
    },
  },
  refunds: true,
} as const satisfies Prisma.PaymentInclude;
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const METHODS: Partial<Record<PaymentMethod, { provider: PaymentProvider; flag: string | null }>> = {
  scb_qr: { provider: 'scb', flag: 'payments.scb' },
  scb_qr_cross_bank: { provider: 'scb', flag: 'payments.scb' },
  card_2c2p: { provider: 'twoc2p', flag: 'payments.twoc2p' },
  online_banking_2c2p: { provider: 'twoc2p', flag: 'payments.twoc2p' },
  bank_transfer_slip: { provider: 'slip', flag: null },
};

export interface InitiateInput {
  method: PaymentMethod;
  instalmentIds?: string[];
}

export interface SlipInput {
  fileId: string;
  declaredAmount: string;
  transferredAt: string;
}

/** A new payment reference: `PK` + 14 upper-case alphanumerics (SCB ref1 / invoice, 2C2P invoiceNo). */
export function paymentReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  return `PK${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/**
 * Payments (B3.2, D-061): the customer (or CS) pays open instalments by SCB QR, 2C2P card / online banking
 * or bank transfer with a slip. Gateways confirm automatically (SCB callbacks are confirmed by inquiry,
 * 2C2P notifications by their signature and an inquiry); slips are verified by the slip-verification
 * adapter and only failures go to Finance (4 business hours, D-061 / D-175). A provider transaction or a
 * slip bank reference is accepted once. Accepted cash goes to the schedule FIFO (ADR-0008); a receipt that
 * matches no group waits in the unidentified-receipts queue.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: PaymentSchedulesService,
    private readonly hooks: OrderLifecycleHooks,
    private readonly settings: SettingsService,
    private readonly flags: FeatureFlagsService,
    private readonly calendars: BusinessCalendarService,
    private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(SCB_GATEWAY) private readonly scb: ScbGateway,
    @Inject(TWOC2P_GATEWAY) private readonly twoc2p: TwoC2PGateway,
    @Inject(SLIP_VERIFIER) private readonly slipVerifier: SlipVerifier,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly promotions: PromotionRedemptions,
  ) {}

  onModuleInit(): void {
    // An unpaid group is not cancelled while a slip waits for verification (D-060 / D-061).
    this.hooks.register({
      key: 'payments',
      blocksExpiry: async (tx, groupId) =>
        (await tx.payment.count({ where: { orderGroupId: groupId, status: 'awaiting_verification' } })) > 0,
    });
  }

  // --- reads ----------------------------------------------------------------------------------------

  async payment(publicId: string, customerUserId?: bigint, db: Tx = this.prisma): Promise<PaymentRow> {
    const row = await db.payment.findUnique({ where: { publicId }, include: PAYMENT_INCLUDE });
    if (!row || (customerUserId !== undefined && row.orderGroup?.customerUserId !== customerUserId))
      throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.PaymentWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { rows, total };
  }

  // --- initiate -------------------------------------------------------------------------------------

  /** Starts a payment of open instalments; gateway methods return a QR or a redirect URL. */
  async initiate(
    actor: Actor,
    groupPublicId: string,
    input: InitiateInput,
    customerUserId?: bigint,
  ): Promise<PaymentRow> {
    const method = METHODS[input.method];
    if (!method)
      throw new DomainException('payments.method_unavailable', { params: { method: input.method } });
    if (method.flag && !(await this.flags.isEnabled(method.flag, actor)))
      throw new DomainException('payments.method_unavailable', { params: { method: input.method } });
    const group = await this.prisma.orderGroup.findUnique({ where: { publicId: groupPublicId } });
    if (!group || (customerUserId !== undefined && group.customerUserId !== customerUserId))
      throw new DomainException('http.not_found');
    if (!['waiting_payment', 'in_progress'].includes(group.status))
      throw new DomainException('payments.group_not_payable', { params: { status: group.status } });
    // A promotion that names payment methods holds the group to them (D-053 "payment method").
    const allowed = await this.promotions.requiredPaymentMethods(this.prisma, group.id);
    if (allowed.length > 0 && !allowed.includes(input.method))
      throw new DomainException('promotions.payment_method_required', {
        params: { methods: allowed.join(', ') },
      });
    const schedule = await this.schedules.forGroup(group.id);
    const open = schedule.instalments.filter((i) => (OPEN as readonly string[]).includes(i.status));
    const chosen = input.instalmentIds?.length
      ? open.filter((i) => input.instalmentIds!.includes(i.publicId))
      : open.filter((i) => ['due', 'overdue', 'partially_paid'].includes(i.status));
    const selected = chosen.length > 0 ? chosen : input.instalmentIds?.length ? [] : open.slice(0, 1);
    if (selected.length === 0 || (input.instalmentIds && selected.length !== input.instalmentIds.length))
      throw new DomainException('payments.nothing_to_pay');
    let cash = new MoneyDecimal(0);
    let gross = new MoneyDecimal(0);
    for (const i of selected) {
      const openCash = D(i.cashAmount).sub(i.paidAmount);
      cash = cash.add(openCash);
      gross = gross.add(
        D(i.cashAmount).gt(0)
          ? openCash.mul(i.grossAmount.toString()).div(i.cashAmount.toString())
          : openCash,
      );
    }
    gross = gross.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
    const now = new Date();
    const expiresAt = await this.expiryOf(input.method, now);
    const fee = await this.feeOf(input.method, cash, now);
    const reference = paymentReference();
    const payment = await this.prisma.withTx(async (tx) => {
      const row = await tx.payment.create({
        data: {
          entityId: group.entityId,
          orderGroupId: group.id,
          method: input.method,
          provider: method.provider,
          status: method.provider === 'slip' ? 'pending' : 'initiated',
          referenceCode: reference,
          amount: formatMoney(gross),
          whtAmount: formatMoney(gross.sub(cash)),
          cashAmount: formatMoney(cash),
          feeAmount: fee,
          expiresAt,
          initiatedById: actor.type === 'user' ? actor.userId : null,
        },
      });
      await this.record(
        tx,
        group.publicId,
        'payment.initiated',
        {
          paymentId: row.publicId,
          method: input.method,
          cashAmount: row.cashAmount.toFixed(2),
          instalments: selected.map((i) => i.seq),
        },
        actor,
      );
      return row;
    });
    if (method.provider === 'slip') return this.payment(payment.publicId);
    try {
      const data = await this.startGateway(payment, input.method, expiresAt!);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { ...data, status: 'pending', rowVersion: { increment: 1 } },
      });
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureCode: 'provider_error',
          failureReason: (error as Error).message.slice(0, 500),
          rowVersion: { increment: 1 },
        },
      });
      throw error;
    }
    return this.payment(payment.publicId);
  }

  private async startGateway(payment: Payment, method: PaymentMethod, expiresAt: Date) {
    const amount = payment.cashAmount.toFixed(2);
    if (method === 'scb_qr' || method === 'scb_qr_cross_bank') {
      const qr = await this.scb.createQr({
        kind: method === 'scb_qr' ? 'qr30' : 'qr_cs',
        reference: payment.referenceCode,
        amount,
        expiresAt,
      });
      return {
        qrPayload: qr.qrRawData,
        providerPayload: { providerQrId: qr.providerQrId } as Prisma.InputJsonValue,
      };
    }
    const api = this.config.get('PUBLIC_API_BASE_URL') ?? 'https://api.packio.invalid';
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.packio.invalid';
    const session = await this.twoc2p.paymentToken({
      reference: payment.referenceCode,
      amount,
      description: `Packio ${payment.referenceCode}`,
      channel: method === 'card_2c2p' ? 'card' : 'online_banking',
      expiresAt,
      frontendReturnUrl: `${web}/payments/${payment.publicId}/return`,
      backendReturnUrl: `${api}/webhooks/2c2p/payment`,
      idempotencyId: payment.publicId,
    });
    return { redirectUrl: session.webPaymentUrl };
  }

  private async expiryOf(method: PaymentMethod, now: Date): Promise<Date | null> {
    if (method === 'scb_qr' || method === 'scb_qr_cross_bank') {
      const minutes = await this.settings.at('payments.qr_validity_minutes', { at: now });
      return new Date(now.getTime() + Number(minutes.value) * 60_000);
    }
    if (method === 'card_2c2p' || method === 'online_banking_2c2p')
      return new Date(now.getTime() + TWOC2P_TOKEN_MINUTES * 60_000);
    return null;
  }

  /** Expected fee from `payments.method_fees` (not seeded: 0 until Finance sets it). */
  private async feeOf(method: PaymentMethod, cash: MoneyValue, at: Date): Promise<string> {
    try {
      const fees = await this.settings.at('payments.method_fees', { at });
      const rule = fees.value[method];
      if (!rule) return '0.00';
      const pct = D(rule.pct ?? '0');
      const fixed = D(rule.fixedAmount ?? '0');
      return formatMoney(cash.mul(pct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP).add(fixed));
    } catch (error) {
      if (error instanceof SettingNotFoundError) return '0.00';
      throw error;
    }
  }

  // --- gateway callbacks ------------------------------------------------------------------------------

  /** SCB payment confirmation: stored once per transaction, accepted only once confirmed by inquiry. */
  async scbCallback(body: unknown): Promise<Record<string, string>> {
    const { transactionId, confirmation } = await this.scb.confirm(body);
    const eventId = confirmation ? confirmation.transactionId : `unverified:${randomUUID()}`;
    const actor: WebhookActor = { type: 'webhook', provider: 'scb' };
    await this.prisma.withTx(async (tx) => {
      if (await this.seen(tx, 'scb', eventId)) return;
      await tx.webhookInbox.create({
        data: {
          provider: 'scb',
          providerEventId: eventId,
          signatureValid: confirmation !== null,
          payload: confirmation
            ? { reference: confirmation.reference, amount: confirmation.amount, kind: confirmation.kind }
            : { transactionId },
          status: confirmation ? 'processed' : 'ignored',
          error: confirmation ? null : 'not confirmed by inquiry',
          processedAt: new Date(),
        },
      });
      if (!confirmation) return;
      await this.receive(
        tx,
        'scb',
        confirmation.kind === 'qr30' ? 'scb_qr' : 'scb_qr_cross_bank',
        confirmation,
        actor,
      );
    });
    return this.scb.callbackReply(transactionId);
  }

  /** 2C2P backend notification: signature verified, then confirmed by inquiry before acceptance. */
  async twoc2pNotification(body: unknown): Promise<void> {
    const note = await this.twoc2p.decodeNotification(body);
    if (!note.valid || !note.reference) throw new DomainException('auth.unauthenticated');
    const eventId = `${note.reference}:${note.respCode ?? '-'}:${note.tranRef ?? '-'}`;
    const actor: WebhookActor = { type: 'webhook', provider: 'twoc2p' };
    const inquiry = note.succeeded ? await this.twoc2p.inquiry(note.reference) : note;
    await this.prisma.withTx(async (tx) => {
      if (await this.seen(tx, 'twoc2p', eventId)) return;
      await tx.webhookInbox.create({
        data: {
          provider: 'twoc2p',
          providerEventId: eventId,
          signatureValid: true,
          payload: { reference: note.reference, respCode: note.respCode, amount: note.amount },
          status: 'processed',
          processedAt: new Date(),
        },
      });
      const payment = await tx.payment.findUnique({ where: { referenceCode: note.reference! } });
      if (!payment || payment.provider !== 'twoc2p') return;
      if (note.succeeded && inquiry.succeeded) {
        await this.accept(
          tx,
          payment,
          {
            cash: inquiry.amount ?? note.amount ?? payment.cashAmount.toFixed(2),
            providerRef: inquiry.tranRef ?? note.tranRef ?? note.reference!,
            paidAt: new Date(),
            payload: inquiry.raw,
          },
          actor,
        );
      } else if (!note.pending && ['initiated', 'pending'].includes(payment.status)) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'failed',
            failureCode: 'declined',
            failureReason: `2C2P ${note.respCode ?? '-'}`,
            rowVersion: { increment: 1 },
          },
        });
        await this.recordPayment(tx, payment, 'payment.failed', { respCode: note.respCode }, actor);
      }
    });
  }

  /**
   * Asynchronous slip result (Slip2Go queue API): unsigned, so it is stored once and the result re-fetched
   * from the provider; it decides a slip still waiting in review whose last check carried that reference.
   */
  async slipVerifyCallback(body: unknown): Promise<void> {
    const data = ((body ?? {}) as { data?: { queueId?: unknown; referenceId?: unknown } }).data ?? {};
    const referenceId =
      typeof data.queueId === 'string'
        ? data.queueId
        : typeof data.referenceId === 'string'
          ? data.referenceId
          : null;
    if (!referenceId)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'data.queueId', code: 'required', message: 'queueId or referenceId' }],
      });
    let check: SlipCheck | null = null;
    try {
      check = await this.slipVerifier.fetch(referenceId);
    } catch {
      check = null;
    }
    const slipId = await this.prisma.withTx(async (tx) => {
      if (await this.seen(tx, 'slip_verify', referenceId)) return null;
      await tx.webhookInbox.create({
        data: {
          provider: 'slip_verify',
          providerEventId: referenceId,
          signatureValid: check !== null,
          payload: { referenceId, result: check?.result ?? null },
          status: check ? 'processed' : 'ignored',
          error: check ? null : 'result could not be re-fetched',
          processedAt: new Date(),
        },
      });
      if (!check) return null;
      const verification = await tx.slipVerification.findFirst({
        where: { response: { path: ['referenceId'], equals: referenceId } },
        include: { slip: true },
      });
      return verification?.slip.verificationStatus === 'manual_review' ? verification.slipId : null;
    });
    if (slipId && check) await this.applyCheck(slipId, check, (await this.receivers(new Date())).length > 0);
  }

  private async seen(tx: Tx, provider: 'scb' | 'twoc2p' | 'slip_verify', eventId: string) {
    return (
      (await tx.webhookInbox.findUnique({
        where: { provider_providerEventId: { provider, providerEventId: eventId } },
      })) !== null
    );
  }

  /** A confirmed SCB receipt: the payment it references, or an unidentified receipt. */
  private async receive(tx: Tx, provider: 'scb', method: PaymentMethod, c: ScbConfirmation, actor: Actor) {
    const payment = await tx.payment.findUnique({ where: { referenceCode: c.reference } });
    if (payment && payment.provider === provider) {
      await this.accept(
        tx,
        payment,
        { cash: c.amount, providerRef: c.transactionId, paidAt: c.paidAt, payload: c.raw },
        actor,
      );
      return;
    }
    const entity = await tx.entity.findFirstOrThrow({ where: { isDefault: true } });
    const unidentified = await tx.payment.create({
      data: {
        entityId: entity.id,
        method,
        provider,
        status: 'succeeded',
        referenceCode: paymentReference(),
        amount: c.amount,
        cashAmount: c.amount,
        providerRef: c.transactionId,
        providerPayload: { ...c.raw, receivedReference: c.reference },
        paidAt: c.paidAt,
        verifiedAt: new Date(),
      },
    });
    await this.recordPayment(tx, unidentified, 'payment.unidentified', { amount: c.amount }, actor);
  }

  // --- acceptance -------------------------------------------------------------------------------------

  /**
   * Money confirmed for a payment: marks it succeeded (once), applies the cash to the group's schedule
   * FIFO and reports any overpayment. A payment on a closed group is kept for a refund.
   */
  private async accept(
    tx: Tx,
    payment: Payment,
    received: {
      cash: string;
      providerRef: string | null;
      paidAt: Date;
      payload?: Record<string, unknown>;
      verifiedById?: bigint;
    },
    actor: Actor,
  ): Promise<void> {
    const { count } = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ['initiated', 'pending', 'awaiting_verification', 'expired', 'failed'] },
      },
      data: {
        status: 'succeeded',
        providerRef: received.providerRef,
        paidAt: received.paidAt,
        verifiedAt: new Date(),
        verifiedById: received.verifiedById ?? null,
        cashAmount: received.cash,
        amount: formatMoney(D(received.cash).add(payment.whtAmount.toString())),
        ...(received.payload && { providerPayload: received.payload as Prisma.InputJsonValue }),
        rowVersion: { increment: 1 },
      },
    });
    if (count === 0) return; // already accepted: never twice (D-061)
    await this.recordPayment(
      tx,
      payment,
      'payment.received',
      {
        method: payment.method,
        provider: payment.provider,
        cashAmount: received.cash,
        providerRef: received.providerRef,
      },
      actor,
    );
    if (!payment.orderGroupId) return;
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: payment.orderGroupId } });
    if (group.status === 'cancelled' || group.status === 'completed') {
      await this.recordPayment(
        tx,
        payment,
        'payment.refund_required',
        { cashAmount: received.cash, reason: 'group_closed' },
        actor,
      );
      return;
    }
    const { leftover } = await this.schedules.applyPayment(
      tx,
      group.id,
      payment.id,
      received.cash,
      actor,
      received.paidAt,
    );
    if (D(leftover).gt(0))
      await this.recordPayment(tx, payment, 'payment.overpaid', { leftoverAmount: leftover }, actor);
  }

  // --- slips (D-061) ------------------------------------------------------------------------------------

  /**
   * A bank-transfer slip for a slip payment: verified automatically when `payments.slip_verify` is on and
   * Packio's collection accounts are set (`payments.slip_receiver_accounts`); a pass is accepted at once, a
   * duplicate is rejected, anything else goes to the Finance queue with a 4-business-hour SLA.
   */
  async uploadSlip(
    actor: UserActor,
    paymentPublicId: string,
    input: SlipInput,
    channel: UploadChannel,
    customerUserId?: bigint,
  ): Promise<PaymentRow> {
    const payment = await this.payment(paymentPublicId, customerUserId);
    if (payment.method !== 'bank_transfer_slip') throw new DomainException('payments.not_a_slip_payment');
    if (!['pending', 'awaiting_verification'].includes(payment.status))
      throw new DomainException('payments.not_awaiting_slip', { params: { status: payment.status } });
    const file = await this.prisma.fileObject.findFirst({
      // Slip uploads are kept as financial records (file purpose `slip`); only the uploader's own file.
      where: {
        publicId: input.fileId,
        retentionClass: 'financial_record',
        uploadStatus: 'uploaded',
        ownerUserId: customerUserId ?? actor.userId,
      },
    });
    if (!file)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'fileId', code: 'exists', message: 'an uploaded slip file of yours' }],
      });
    if (file.scanStatus !== 'clean') throw new DomainException('payments.slip_not_scanned');
    const now = new Date();
    const sla = await this.slaDueAt(now);
    const slip = await this.prisma.withTx(async (tx) => {
      const row = await tx.slip.create({
        data: {
          paymentId: payment.id,
          fileObjectId: file.id,
          uploadedVia: channel,
          declaredAmount: input.declaredAmount,
          declaredTransferredAt: new Date(input.transferredAt),
          slaDueAt: sla,
          createdById: actor.userId,
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'awaiting_verification', rowVersion: { increment: 1 } },
      });
      await this.recordPayment(
        tx,
        payment,
        'payment.slip_uploaded',
        { slipId: row.publicId, channel },
        actor,
      );
      return row;
    });

    if (!(await this.flags.isEnabled('payments.slip_verify', actor))) {
      await this.toFinance(slip.id, 'automatic verification is off');
      return this.payment(paymentPublicId);
    }
    const receivers = await this.receivers(now);
    let check: SlipCheck;
    try {
      const bytes = await this.read(file.storageKey);
      check = await this.slipVerifier.verify({
        file: bytes,
        mime: file.mimeType,
        fileName: file.originalName,
        amount: payment.cashAmount.toFixed(2),
        // A transfer made before the order existed cannot pay it.
        transferredAfter:
          payment.createdAt < (payment.orderGroup?.placedAt ?? payment.createdAt)
            ? payment.createdAt
            : (payment.orderGroup?.placedAt ?? payment.createdAt),
        receivers,
      });
    } catch (error) {
      this.logger.warn(`slip verification unavailable: ${(error as Error).message}`);
      check = {
        result: 'provider_error',
        code: 'unavailable',
        transRef: null,
        amount: null,
        transferredAt: null,
        receiverMatched: false,
        amountMatched: false,
        dateMatched: false,
        referenceId: null,
        raw: {},
      };
    }
    await this.applyCheck(slip.id, check, receivers.length > 0);
    return this.payment(paymentPublicId);
  }

  /** Records a verification and decides the slip (pass → accepted, duplicate → rejected, else Finance). */
  private async applyCheck(slipId: bigint, check: SlipCheck, receiverChecked: boolean): Promise<void> {
    const actor = systemActor('payments.slip_verify');
    await this.prisma.withTx(async (tx) => {
      const slip = await tx.slip.findUniqueOrThrow({ where: { id: slipId }, include: { payment: true } });
      await tx.slipVerification.create({
        data: {
          slipId,
          provider: this.slipVerifier.name,
          result: check.result,
          receiverMatched: check.receiverMatched,
          amountMatched: check.amountMatched,
          dateMatched: check.dateMatched,
          transRef: check.transRef,
          response: { ...check.raw, code: check.code, referenceId: check.referenceId },
        },
      });
      const duplicate =
        check.result === 'duplicate' ||
        (check.transRef !== null &&
          (await tx.slip.count({
            where: {
              bankTransRef: check.transRef,
              verificationStatus: { in: ['passed', 'manual_approved'] },
            },
          })) > 0);
      if (duplicate) {
        await tx.slip.update({
          where: { id: slipId },
          data: { verificationStatus: 'failed', bankTransRef: check.transRef },
        });
        await tx.payment.update({
          where: { id: slip.paymentId },
          data: { status: 'pending', rowVersion: { increment: 1 } },
        });
        await this.recordPayment(
          tx,
          slip.payment,
          'payment.slip_rejected',
          { slipId: slip.publicId, reason: 'duplicate' },
          actor,
        );
        return;
      }
      if (check.result === 'pass' && receiverChecked && check.receiverMatched) {
        await tx.slip.update({
          where: { id: slipId },
          data: { verificationStatus: 'passed', bankTransRef: check.transRef },
        });
        await this.recordPayment(
          tx,
          slip.payment,
          'payment.verified',
          { slipId: slip.publicId, via: 'automatic' },
          actor,
        );
        await this.accept(
          tx,
          slip.payment,
          {
            cash: check.amount ?? slip.payment.cashAmount.toFixed(2),
            providerRef: null,
            paidAt: check.transferredAt ?? slip.declaredTransferredAt,
          },
          actor,
        );
        return;
      }
      await tx.slip.update({
        where: { id: slipId },
        data: { verificationStatus: 'manual_review', bankTransRef: check.transRef },
      });
      await this.recordPayment(
        tx,
        slip.payment,
        'payment.slip_review_required',
        {
          slipId: slip.publicId,
          result: check.result,
          slaDueAt: slip.slaDueAt?.toISOString() ?? null,
        },
        actor,
      );
    });
  }

  private async toFinance(slipId: bigint, reason: string) {
    await this.prisma.withTx(async (tx) => {
      const slip = await tx.slip.update({
        where: { id: slipId },
        data: { verificationStatus: 'manual_review' },
        include: { payment: true },
      });
      await this.recordPayment(
        tx,
        slip.payment,
        'payment.slip_review_required',
        {
          slipId: slip.publicId,
          reason,
          slaDueAt: slip.slaDueAt?.toISOString() ?? null,
        },
        systemActor('payments.slip_verify'),
      );
    });
  }

  /** Finance decides a slip in the queue (maker ≠ uploader; the bank reference is unique once accepted). */
  async reviewSlip(
    actor: UserActor,
    slipPublicId: string,
    decision: { approve: boolean; bankTransRef?: string; receivedAmount?: string; note?: string },
  ): Promise<PaymentRow> {
    const payment = await this.prisma.withTx(async (tx) => {
      const slip = await tx.slip.findUnique({
        where: { publicId: slipPublicId },
        include: { payment: true },
      });
      if (!slip) throw new DomainException('http.not_found');
      if (slip.verificationStatus !== 'manual_review')
        throw new DomainException('payments.slip_not_in_review', {
          params: { status: slip.verificationStatus },
        });
      if (slip.createdById === actor.userId)
        throw new DomainException('iam.sod_conflict', { params: { rule: 'slip uploader ≠ reviewer' } });
      if (!decision.approve) {
        await tx.slip.update({
          where: { id: slip.id },
          data: {
            verificationStatus: 'manual_rejected',
            reviewedById: actor.userId,
            reviewedAt: new Date(),
            reviewNote: decision.note ?? null,
          },
        });
        await tx.payment.update({
          where: { id: slip.paymentId },
          data: { status: 'pending', rowVersion: { increment: 1 } },
        });
        await this.recordPayment(
          tx,
          slip.payment,
          'payment.slip_rejected',
          { slipId: slip.publicId, reason: 'finance' },
          actor,
        );
        return slip.payment;
      }
      const transRef = decision.bankTransRef?.trim();
      if (!transRef)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'bankTransRef', code: 'required', message: 'the bank transaction reference' }],
        });
      if (
        (await tx.slip.count({
          where: { bankTransRef: transRef, verificationStatus: { in: ['passed', 'manual_approved'] } },
        })) > 0
      )
        throw new DomainException('payments.slip_duplicate');
      await tx.slip.update({
        where: { id: slip.id },
        data: {
          verificationStatus: 'manual_approved',
          bankTransRef: transRef,
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          reviewNote: decision.note ?? null,
        },
      });
      await this.recordPayment(
        tx,
        slip.payment,
        'payment.verified',
        { slipId: slip.publicId, via: 'finance' },
        actor,
      );
      await this.accept(
        tx,
        slip.payment,
        {
          cash: decision.receivedAmount ?? slip.declaredAmount.toFixed(2),
          providerRef: null,
          paidAt: slip.declaredTransferredAt,
          verifiedById: actor.userId,
        },
        actor,
      );
      return slip.payment;
    });
    return this.payment(payment.publicId);
  }

  async slipQueue(page: number, perPage: number) {
    const where: Prisma.SlipWhereInput = { verificationStatus: 'manual_review' };
    const [rows, total] = await Promise.all([
      this.prisma.slip.findMany({
        where,
        include: {
          payment: { include: { orderGroup: true } },
          verifications: { orderBy: { requestedAt: 'desc' }, take: 1 },
          fileObject: { select: { publicId: true } },
        },
        orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.slip.count({ where }),
    ]);
    return { rows, total };
  }

  // --- unidentified receipts ----------------------------------------------------------------------------

  /** Finance attaches an unidentified receipt to the group it pays. */
  async allocate(actor: UserActor, paymentPublicId: string, groupPublicId: string): Promise<PaymentRow> {
    await this.prisma.withTx(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { publicId: paymentPublicId } });
      if (!payment) throw new DomainException('http.not_found');
      if (payment.orderGroupId !== null || payment.status !== 'succeeded')
        throw new DomainException('payments.not_unidentified');
      const group = await tx.orderGroup.findUnique({ where: { publicId: groupPublicId } });
      if (!group) throw new DomainException('http.not_found');
      if (!['waiting_payment', 'in_progress'].includes(group.status))
        throw new DomainException('payments.group_not_payable', { params: { status: group.status } });
      await tx.payment.update({
        where: { id: payment.id },
        data: { orderGroupId: group.id, rowVersion: { increment: 1 } },
      });
      await this.recordPayment(tx, payment, 'payment.allocated', { groupId: group.publicId }, actor);
      const { leftover } = await this.schedules.applyPayment(
        tx,
        group.id,
        payment.id,
        payment.cashAmount.toFixed(2),
        actor,
      );
      if (D(leftover).gt(0))
        await this.recordPayment(tx, payment, 'payment.overpaid', { leftoverAmount: leftover }, actor);
    });
    return this.payment(paymentPublicId);
  }

  // --- expiry -------------------------------------------------------------------------------------------

  /** Scheduled: QR and 2C2P attempts past their lifetime expire (the order keeps its own expiry, D-060). */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.payment.findMany({
      where: { status: { in: ['initiated', 'pending'] }, expiresAt: { lte: now } },
      take: 500,
    });
    const actor = systemActor('payments.expire');
    for (const p of due) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: p.id, status: { in: ['initiated', 'pending'] } },
          data: { status: 'expired', rowVersion: { increment: 1 } },
        });
        if (count === 1) await this.recordPayment(tx, p, 'payment.expired', {}, actor);
      });
    }
    return due.length;
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async slaDueAt(now: Date): Promise<Date | null> {
    try {
      const hours = await this.settings.at('payments.slip_review_sla_business_hours', { at: now });
      const window = await this.settings.at('calendar.business_hours', { at: now });
      const calendar = await this.calendars.calendar();
      return calendar.addBusinessMinutes(now, Number(hours.value) * 60, window.value);
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
  }

  /** The methods a customer can start a payment with, and whether each is offered now (feature flags, D-176). */
  async offeredMethods(actor: Actor): Promise<{ method: PaymentMethod; available: boolean }[]> {
    const out: { method: PaymentMethod; available: boolean }[] = [];
    for (const [method, rule] of Object.entries(METHODS) as [PaymentMethod, { flag: string | null }][]) {
      out.push({ method, available: rule.flag === null || (await this.flags.isEnabled(rule.flag, actor)) });
    }
    return out;
  }

  /** Packio's collection accounts a bank-transfer slip must pay into (D-061); empty until Finance sets them. */
  async slipReceiverAccounts(at = new Date()) {
    return this.receivers(at);
  }

  private async receivers(at: Date) {
    try {
      return (await this.settings.at('payments.slip_receiver_accounts', { at })).value ?? [];
    } catch (error) {
      if (error instanceof SettingNotFoundError) return [];
      throw error;
    }
  }

  private async read(key: string): Promise<Buffer> {
    const stream = await this.storage.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  private async recordPayment(
    tx: Tx,
    payment: Payment,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const group = payment.orderGroupId
      ? await tx.orderGroup.findUnique({ where: { id: payment.orderGroupId } })
      : null;
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'payment',
        aggregateId: payment.publicId,
        entityId: payment.entityId,
        payload: {
          paymentId: payment.publicId,
          groupId: group?.publicId ?? null,
          customerId: null,
          method: payment.method,
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: group ? 'order_group' : 'payment',
      aggregatePublicId: group?.publicId ?? payment.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
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
