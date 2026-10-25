import { randomUUID } from 'node:crypto';

import { ProviderUnavailableError } from '@collective/integrations/http';
import { SECRETS_PROVIDER, type SecretsProvider } from '@collective/integrations/secrets';
import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CarrierCode, Prisma, type WebhookProvider } from '@generated/prisma/client';
import {
  CARRIER_ADAPTERS,
  type CarrierAdapters,
  type CarrierBooking,
  type CarrierBookingRequest,
  type CarrierCall,
  type CarrierParcel,
  type CarrierPlace,
  type FallbackCarrierCode,
} from '@integrations/carriers/carrier-adapter.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';

export interface CarrierEstimate {
  carrier: FallbackCarrierCode;
  accountId: bigint;
  /** getpack's cost of the fallback delivery, THB, as the carrier quotes it. */
  amount: MoneyValue;
  transitDays: number | null;
}

const ESTIMATE_TIMEOUT_MS = 4_000;
/** Headers kept in `webhook_inbox` (schema-design §3.1: allow-listed; never the signature key). */
const KEPT_HEADERS = ['content-type', 'user-agent', 'x-request-id'];

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

/**
 * Fallback carriers (D-013, D-114): the factory's own fleet delivers by default; a getpack-booked
 * carrier is used only where the factory cannot serve the zone. Carriers are enabled by a Superadmin
 * once getpack's own account (D-005) is registered; credentials stay in Secrets Manager.
 */
@Injectable()
export class CarriersService {
  private readonly logger = new Logger(CarriersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(CARRIER_ADAPTERS) private readonly adapters: CarrierAdapters,
    @Inject(SECRETS_PROVIDER) private readonly secrets: SecretsProvider,
  ) {}

  list() {
    return this.prisma.carrier.findMany({
      orderBy: { id: 'asc' },
      include: { accounts: { include: { entity: { select: { code: true } } }, orderBy: { id: 'asc' } } },
    });
  }

  async setEnabled(actor: UserActor, code: CarrierCode, enabled: boolean) {
    if (code === 'factory_fleet') throw new DomainException('shipping.carrier_fixed');
    return this.prisma.withTx(async (tx) => {
      const carrier = await tx.carrier.findUnique({ where: { code } });
      if (!carrier) throw new DomainException('http.not_found');
      if (enabled && !(await this.activeAccount(tx, carrier.id))) {
        throw new DomainException('shipping.carrier_account_missing');
      }
      const updated = await tx.carrier.update({
        where: { id: carrier.id },
        data: { enabled, updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, carrier.publicId, enabled ? 'carrier.enabled' : 'carrier.disabled', { code });
      return updated;
    });
  }

  /** Registers getpack's account with a carrier; the previous active one of the same environment is closed. */
  async addAccount(
    actor: UserActor,
    code: CarrierCode,
    input: { label: string; credentialsSecretRef: string; sandbox: boolean },
  ) {
    if (code === 'factory_fleet') throw new DomainException('shipping.carrier_fixed');
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      const carrier = await tx.carrier.findUnique({ where: { code } });
      if (!carrier) throw new DomainException('http.not_found');
      await tx.carrierAccount.updateMany({
        where: { entityId, carrierId: carrier.id, sandbox: input.sandbox, status: 'active' },
        data: { status: 'inactive', updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      const account = await tx.carrierAccount.create({
        data: {
          entityId,
          carrierId: carrier.id,
          ...input,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.record(tx, carrier.publicId, 'carrier.account_registered', {
        code,
        accountId: account.publicId,
        sandbox: input.sandbox,
      });
      return account;
    });
  }

  async deactivateAccount(actor: UserActor, accountPublicId: string) {
    return this.prisma.withTx(async (tx) => {
      const account = await tx.carrierAccount.findUnique({
        where: { publicId: accountPublicId },
        include: { carrier: true },
      });
      if (!account) throw new DomainException('http.not_found');
      const updated = await tx.carrierAccount.update({
        where: { id: account.id },
        data: { status: 'inactive', updatedById: actor.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, account.carrier.publicId, 'carrier.account_deactivated', {
        code: account.carrier.code,
        accountId: account.publicId,
      });
      return updated;
    });
  }

  /**
   * The cheapest estimate of the enabled fallback carriers that can quote the route from postcodes
   * (quote time has no street address or coordinates), or null. A carrier that fails, times out or
   * cannot quote is skipped: the caller then has no delivery path (fail closed).
   */
  async estimate(input: {
    from: string;
    to: string;
    parcels: readonly CarrierParcel[];
  }): Promise<CarrierEstimate | null> {
    const carriers = await this.prisma.carrier.findMany({
      where: { enabled: true, code: { not: 'factory_fleet' }, supports: { has: 'quote' } },
    });
    if (carriers.length === 0 || input.parcels.length === 0) return null;
    const [from, to] = await Promise.all([this.place(input.from), this.place(input.to)]);
    const estimates = await Promise.all(
      carriers.map(async (carrier) => {
        const adapter = this.adapters.get(carrier.code as FallbackCarrierCode);
        const account = await this.activeAccount(this.prisma, carrier.id);
        if (!adapter || !account) return null;
        try {
          const quote = await withTimeout(
            adapter.quote(await this.call(account), { from, to, parcels: input.parcels }),
            ESTIMATE_TIMEOUT_MS,
          );
          return {
            carrier: adapter.code,
            accountId: account.id,
            amount: new MoneyDecimal(quote.amount),
            transitDays: quote.transitDays,
          } satisfies CarrierEstimate;
        } catch (error) {
          this.logger.warn(
            { carrier: carrier.code, err: (error as Error).message },
            'carrier estimate skipped',
          );
          return null;
        }
      }),
    );
    return (
      estimates
        .filter((e): e is CarrierEstimate => e !== null)
        .sort((a, b) => a.amount.comparedTo(b.amount))[0] ?? null
    );
  }

  /**
   * A quote of every fallback carrier for one trip (staff choosing a carrier, D-114): a carrier that is not
   * enabled, has no account, fails or times out comes back unavailable with the reason.
   */
  async quoteAll(input: { from: CarrierPlace; to: CarrierPlace; parcels: readonly CarrierParcel[] }): Promise<
    {
      carrier: FallbackCarrierCode;
      amount: MoneyValue | null;
      transitDays: number | null;
      reason: string | null;
    }[]
  > {
    const carriers = await this.prisma.carrier.findMany({
      where: { code: { not: 'factory_fleet' } },
      orderBy: { code: 'asc' },
    });
    const [from, to] = await Promise.all([this.enrich(input.from), this.enrich(input.to)]);
    return Promise.all(
      carriers.map(async (carrier) => {
        const code = carrier.code as FallbackCarrierCode;
        const unavailable = (reason: string) => ({ carrier: code, amount: null, transitDays: null, reason });
        const adapter = this.adapters.get(code);
        if (!adapter || !carrier.enabled) return unavailable('not enabled');
        const account = await this.activeAccount(this.prisma, carrier.id);
        if (!account) return unavailable('no active account');
        try {
          const quote = await withTimeout(
            adapter.quote(await this.call(account), { from, to, parcels: input.parcels }),
            ESTIMATE_TIMEOUT_MS,
          );
          return {
            carrier: code,
            amount: new MoneyDecimal(quote.amount),
            transitDays: quote.transitDays,
            reason: null,
          };
        } catch (error) {
          this.logger.warn({ carrier: code, err: (error as Error).message }, 'carrier quote failed');
          return unavailable(
            error instanceof ProviderUnavailableError ? 'unavailable' : 'cannot quote this trip',
          );
        }
      }),
    );
  }

  /** Staff test of an account: a quote straight from the carrier, errors surfaced. */
  async testQuote(
    code: CarrierCode,
    input: { from: CarrierPlace; to: CarrierPlace; parcels: CarrierParcel[] },
  ) {
    const carrier = await this.prisma.carrier.findUnique({ where: { code } });
    const adapter = this.adapters.get(code as FallbackCarrierCode);
    if (!carrier || !adapter) throw new DomainException('http.not_found');
    const account = await this.activeAccount(this.prisma, carrier.id);
    if (!account) throw new DomainException('shipping.carrier_account_missing');
    const [from, to] = await Promise.all([this.enrich(input.from), this.enrich(input.to)]);
    try {
      return await adapter.quote(await this.call(account), { from, to, parcels: input.parcels });
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        throw new DomainException('provider.unavailable', { cause: error });
      throw new DomainException('shipping.carrier_refused', {
        params: { detail: (error as Error).message },
        cause: error,
      });
    }
  }

  /**
   * An inbound carrier callback: verified with the active account's credentials, stored once per
   * provider event (`webhook_inbox`, replays are no-ops) and published as `carrier.webhook_received`
   * for logistics (B4.3). Returns what the carrier expects back.
   */
  async webhook(code: FallbackCarrierCode, headers: Record<string, string>, body: unknown) {
    const adapter = this.adapters.get(code);
    const carrier = await this.prisma.carrier.findUnique({ where: { code } });
    if (!adapter || !carrier) throw new DomainException('http.not_found');
    const accounts = await this.prisma.carrierAccount.findMany({
      where: { carrierId: carrier.id, status: 'active' },
    });
    let parsed = adapter.webhook({}, headers, body);
    for (const account of accounts) {
      const attempt = adapter.webhook(await this.credentials(account.credentialsSecretRef), headers, body);
      parsed = attempt;
      if (attempt.valid) break;
    }
    const provider = code as WebhookProvider;
    // An unsigned request never takes the provider's event id: it must not pre-empt the genuine callback.
    const eventId = parsed.valid && parsed.eventId ? parsed.eventId : `unverified:${randomUUID()}`;
    const kept = Object.fromEntries(KEPT_HEADERS.filter((h) => headers[h]).map((h) => [h, headers[h]]));
    await this.prisma.withTx(async (tx) => {
      if (
        await tx.webhookInbox.findUnique({
          where: { provider_providerEventId: { provider, providerEventId: eventId } },
        })
      ) {
        return; // replay
      }
      const inbox = await tx.webhookInbox.create({
        data: {
          provider,
          providerEventId: eventId,
          signatureValid: parsed.valid,
          headers: kept,
          // Status data only: no names, phones or addresses are kept (PDPA).
          payload: {
            bookingRef: parsed.bookingRef,
            status: parsed.status,
            providerStatus: parsed.providerStatus,
          },
          status: parsed.valid ? 'received' : 'ignored',
          error: parsed.valid ? null : 'signature invalid',
        },
      });
      if (!parsed.valid) return;
      const event = await this.events.record(tx, {
        type: 'carrier.webhook_received',
        aggregateType: 'carrier',
        aggregateId: carrier.publicId,
        payload: {
          carrier: code,
          inboxId: inbox.id.toString(),
          bookingRef: parsed.bookingRef,
          status: parsed.status,
          providerStatus: parsed.providerStatus,
        },
      });
      await tx.webhookInbox.update({ where: { id: inbox.id }, data: { domainEventId: event.id } });
    });
    return parsed.reply;
  }

  /**
   * Books a fallback delivery for a shipment (B4.3): getpack's active account, the carrier's quote first
   * (getpack's cost, P25), then the booking. Anything the carrier cannot or will not do →
   * `shipments.carrier_unavailable` (staff pick another carrier or split the shipment).
   */
  async book(
    code: FallbackCarrierCode,
    request: CarrierBookingRequest,
  ): Promise<{ booking: CarrierBooking; carrierId: bigint; costAmount: MoneyValue | null }> {
    const carrier = await this.prisma.carrier.findUnique({ where: { code } });
    const adapter = this.adapters.get(code);
    const unavailable = (reason: string, cause?: unknown) =>
      new DomainException('shipments.carrier_unavailable', { params: { carrier: code, reason }, cause });
    if (!carrier || !adapter || !carrier.enabled) throw unavailable('not enabled');
    const account = await this.activeAccount(this.prisma, carrier.id);
    if (!account) throw unavailable('no active account');
    const call = await this.call(account);
    const [from, to] = await Promise.all([this.enrich(request.from), this.enrich(request.to)]);
    try {
      const quote = await adapter
        .quote(call, { from, to, parcels: request.parcels })
        .catch((error: unknown) => {
          if (error instanceof ProviderUnavailableError) throw error;
          return null;
        });
      const booking = await adapter.book(call, {
        ...request,
        from: { ...request.from, ...from },
        to: { ...request.to, ...to },
      });
      return { booking, carrierId: carrier.id, costAmount: quote ? new MoneyDecimal(quote.amount) : null };
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        throw new DomainException('provider.unavailable', { cause: error });
      throw unavailable((error as Error).message, error);
    }
  }

  /** Cancels a fallback booking; a carrier that refuses (already picked up) surfaces the reason. */
  async cancelBooking(carrierId: bigint, bookingRef: string): Promise<void> {
    const carrier = await this.prisma.carrier.findUniqueOrThrow({ where: { id: carrierId } });
    const adapter = this.adapters.get(carrier.code as FallbackCarrierCode);
    const account = await this.activeAccount(this.prisma, carrier.id);
    if (!adapter || !account) return;
    try {
      await adapter.cancel(await this.call(account), bookingRef);
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        throw new DomainException('provider.unavailable', { cause: error });
      throw new DomainException('shipments.carrier_unavailable', {
        params: { carrier: carrier.code, reason: (error as Error).message },
        cause: error,
      });
    }
  }

  // --- helpers ---------------------------------------------------------------------------------------

  private async activeAccount(db: Tx, carrierId: bigint) {
    const entityId = await this.entities.defaultEntityId();
    const sandbox = !this.config.isProduction;
    return (
      (await db.carrierAccount.findFirst({ where: { entityId, carrierId, status: 'active', sandbox } })) ??
      (await db.carrierAccount.findFirst({
        where: { entityId, carrierId, status: 'active' },
        orderBy: { id: 'desc' },
      }))
    );
  }

  private async call(account: { credentialsSecretRef: string; sandbox: boolean }): Promise<CarrierCall> {
    return { credentials: await this.credentials(account.credentialsSecretRef), sandbox: account.sandbox };
  }

  private async credentials(ref: string) {
    try {
      return await this.secrets.getJsonSecret(ref);
    } catch (error) {
      throw new ProviderUnavailableError('secrets', (error as Error).message);
    }
  }

  /** Province and district names for a postcode (carriers want them), from admin geography (D-170). */
  private async place(postcode: string): Promise<CarrierPlace> {
    const sub = await this.prisma.geoSubdistrict.findFirst({
      where: { postcode },
      include: { district: { include: { province: true } } },
      orderBy: { id: 'asc' },
    });
    return {
      postcode,
      district: sub?.district.nameTh ?? null,
      province: sub?.district.province.nameTh ?? null,
    };
  }

  private async enrich(place: CarrierPlace): Promise<CarrierPlace> {
    const base = await this.place(place.postcode);
    return {
      ...base,
      ...Object.fromEntries(Object.entries(place).filter(([, v]) => v !== undefined && v !== null)),
    };
  }

  private async record(tx: Tx, carrierPublicId: string, type: string, data: Record<string, unknown>) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'carrier',
      resourcePublicId: carrierPublicId,
      data,
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'carrier',
      aggregateId: carrierPublicId,
      payload: { carrierId: carrierPublicId, ...(data as Prisma.JsonObject) },
    });
  }
}
