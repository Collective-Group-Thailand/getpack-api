import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { toSkipTake } from '@common/pagination/pagination';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Factory,
  type FactoryStatus,
  type OnboardingStep,
  type OnboardingStepStatus,
  Prisma,
} from '@generated/prisma/client';
import { compact } from '@modules/catalog/crud/compact';
import { RefResolver } from '@modules/catalog/crud/ref-resolver';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { NATIONAL_CALENDAR_CODE } from '@platform/calendar/business-calendar.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { isValidThaiTaxId } from '../tax-id';
import {
  type CreateFactoryAddressDto,
  type CreateFactoryContactDto,
  type CreateFactoryDto,
  type CreateKycDocumentDto,
  type FactoryListQuery,
  ONBOARDING_STEPS,
  type ReviewFactoryKycDocumentDto,
  type UpdateFactoryAddressDto,
  type UpdateFactoryContactDto,
  type UpdateFactoryDto,
  type UpdateOnboardingStepDto,
  type UpdateOwnFactoryDto,
} from './factories.dto';
import { FactoryAccess } from './factory-access';
import { canTransition, SELF_EDITABLE_STATUSES } from './factory-status';

export const FACTORY_INCLUDE = {
  onboardingSteps: { select: { status: true } },
} satisfies Prisma.FactoryInclude;
export type FactoryRow = Prisma.FactoryGetPayload<{ include: typeof FACTORY_INCLUDE }>;

export const factoryEtag = (f: Pick<Factory, 'publicId' | 'rowVersion'>) => etagOf(f.publicId, f.rowVersion);

/** Approval subject for `partner_activation` and `partner_pricing_mode_change` (policy subject type `factory`). */
export const FACTORY_SUBJECT = 'factory';

/**
 * Partner factories and their onboarding (D-011, D-041, D-100 note, D-171). Factories enter through
 * the Partner team: staff create the factory (self-service or assisted mode) together with its 1:1
 * vendor (AP identity) and factory calendar, and create the owner's partner account; the factory then
 * completes its steps in the partner zone. Every change: one transaction, audit (`config`), activity
 * row (internal + partner) and a domain event.
 */
@Injectable()
export class FactoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly activity: ActivityLogService,
    private readonly events: DomainEvents,
  ) {}

  // --- read ---------------------------------------------------------------------------------------

  async list(actor: Actor, query: FactoryListQuery): Promise<{ rows: FactoryRow[]; total: number }> {
    const q = query.q?.trim();
    const where: Prisma.FactoryWhereInput = {
      ...(await this.access.where(actor)),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { legalName: { contains: q, mode: 'insensitive' } },
              { tradeName: { contains: q, mode: 'insensitive' } },
              { taxId: { startsWith: q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.factory.findMany({
        where,
        include: FACTORY_INCLUDE,
        orderBy: { code: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.factory.count({ where }),
    ]);
    return { rows, total };
  }

  async get(actor: Actor, publicId: string): Promise<FactoryRow> {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.factory.findUniqueOrThrow({ where: { id: factory.id }, include: FACTORY_INCLUDE });
  }

  // --- create & edit -----------------------------------------------------------------------------

  async create(actor: UserActor, input: CreateFactoryDto): Promise<FactoryRow> {
    this.assertTaxId(input.taxId);
    try {
      return await this.prisma.withTx(async (tx) => {
        const branchCode = input.branchCode ?? '00000';
        const vendor = await tx.vendor.create({
          data: {
            kind: 'factory',
            legalName: input.legalName,
            juristicType: input.juristicType,
            taxId: input.taxId,
            branchCode,
            isVatRegistered: input.isVatRegistered,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        const code = await this.nextCode(tx);
        const factory = await tx.factory.create({
          data: {
            code,
            vendorId: vendor.id,
            legalName: input.legalName,
            tradeName: input.tradeName ?? null,
            juristicType: input.juristicType,
            taxId: input.taxId,
            branchCode,
            isVatRegistered: input.isVatRegistered,
            vatRegisteredOn: input.vatRegisteredOn ?? null,
            onboardingMode: input.onboardingMode,
            lineGroupId: input.lineGroupId ?? null,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        // Own calendar for closures on top of the national holidays (D-161).
        const national = await tx.businessCalendar.findUnique({ where: { code: NATIONAL_CALENDAR_CODE } });
        const calendar = await tx.businessCalendar.create({
          data: {
            code: `factory_${code.toLowerCase()}`,
            name: `${code} closures`,
            kind: 'factory',
            factoryId: factory.id,
            weekendDays: national?.weekendDays ?? [0, 6],
            baseCalendarId: national?.id ?? null,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        await tx.factory.update({ where: { id: factory.id }, data: { calendarId: calendar.id } });
        await tx.factoryOnboardingStep.createMany({
          data: ONBOARDING_STEPS.map((step) => ({
            factoryId: factory.id,
            step,
            status: step === 'application' ? 'in_progress' : 'pending',
            enteredByStaff: input.onboardingMode === 'assisted',
            updatedById: actor.userId,
          })),
        });
        await tx.factoryStatusHistory.create({
          data: {
            factoryId: factory.id,
            fromStatus: null,
            toStatus: 'applied',
            reason: 'Created by the Partner team (D-171)',
            changedById: actor.userId,
          },
        });
        await this.record(tx, factory.publicId, 'factory.created', {
          code,
          onboardingMode: input.onboardingMode,
        });
        return tx.factory.findUniqueOrThrow({ where: { id: factory.id }, include: FACTORY_INCLUDE });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException('partners.factory_exists', { cause: error });
      }
      throw error;
    }
  }

  /** Staff edit (any status). Legal identity changes are mirrored on the vendor. */
  async update(actor: UserActor, publicId: string, ifMatch: string | undefined, input: UpdateFactoryDto) {
    return this.edit(actor, publicId, ifMatch, input, 'staff');
  }

  /** The factory's own edit, only before getpack starts the trial. */
  async updateOwn(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: UpdateOwnFactoryDto,
  ) {
    return this.edit(actor, publicId, ifMatch, input, 'partner');
  }

  private async edit(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: UpdateFactoryDto | UpdateOwnFactoryDto,
    by: 'staff' | 'partner',
  ): Promise<FactoryRow> {
    if (input.taxId !== undefined) this.assertTaxId(input.taxId);
    const factory = await this.access.factory(actor, publicId);
    if (by === 'partner' && !SELF_EDITABLE_STATUSES.includes(factory.status)) {
      throw new DomainException('partners.profile_locked');
    }
    try {
      return await this.prisma.withTx(async (tx) => {
        const current = await tx.factory.findUniqueOrThrow({ where: { id: factory.id } });
        assertIfMatch(ifMatch, factoryEtag(current));
        const data = compact({ ...input }) as Prisma.FactoryUncheckedUpdateInput;
        const updated = await tx.factory.update({
          where: { id: current.id },
          data: { ...data, updatedById: actor.userId, rowVersion: { increment: 1 } },
          include: FACTORY_INCLUDE,
        });
        const vendorData = compact({
          legalName: input.legalName,
          juristicType: input.juristicType,
          taxId: input.taxId,
          branchCode: input.branchCode,
          isVatRegistered: input.isVatRegistered,
        });
        if (Object.keys(vendorData).length) {
          await tx.vendor.update({
            where: { id: current.vendorId },
            data: { ...vendorData, updatedById: actor.userId, rowVersion: { increment: 1 } },
          });
        }
        await this.record(tx, publicId, 'factory.updated', { fields: Object.keys(data), by });
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException('partners.factory_exists', { cause: error });
      }
      throw error;
    }
  }

  // --- lifecycle -----------------------------------------------------------------------------------

  /**
   * Status changes by the Partner team (or the factory submitting its application). `trial → active`
   * never goes through here: it needs the `partner_activation` approval ({@link requestActivation}).
   */
  async transition(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    to: FactoryStatus,
    reason: string,
  ): Promise<FactoryRow> {
    const factory = await this.access.factory(actor, publicId);
    if (to === 'active' && factory.status === 'trial')
      throw new DomainException('partners.activation_needs_approval');
    return this.prisma.withTx(async (tx) => {
      const current = await tx.factory.findUniqueOrThrow({ where: { id: factory.id } });
      assertIfMatch(ifMatch, factoryEtag(current));
      return this.applyStatus(tx, current, to, reason, actor.userId, null);
    });
  }

  /** Opens the `partner_activation` approval (D-041): needs a passed site visit first. */
  async requestActivation(actor: UserActor, publicId: string, reason: string) {
    const factory = await this.access.factory(actor, publicId);
    if (factory.status !== 'trial')
      throw new DomainException('partners.invalid_transition', {
        params: { from: factory.status, to: 'active' },
      });
    return this.prisma.withTx(async (tx) => {
      const passed = await tx.siteVisit.count({ where: { factoryId: factory.id, result: 'pass' } });
      if (passed === 0) throw new DomainException('partners.site_visit_required');
      const request = await this.approvals.create(tx, {
        policyKey: 'partner_activation',
        subject: { type: FACTORY_SUBJECT, id: factory.id, publicId: factory.publicId },
        requester: actor,
        payload: { factory: factory.code, legalName: factory.legalName, reason },
        scope: { factoryId: factory.id },
      });
      await this.record(tx, factory.publicId, 'factory.activation_requested', {
        approvalRequestId: request.publicId,
        reason,
      });
      return request;
    });
  }

  /** Outcome of `partner_activation`: approved → the factory becomes active (DB trigger re-checks D-041). */
  @OnDomainEvent(['approval.approved', 'approval.rejected'], { consumer: 'partners.factory-activation' })
  async onActivationOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['subjectType'] !== FACTORY_SUBJECT) return;
    const request = await tx.approvalRequest.findUnique({
      where: { publicId: event.aggregateId },
      include: { policy: { select: { key: true } } },
    });
    if (!request || request.policy.key !== 'partner_activation') return;
    const factory = await tx.factory.findUnique({ where: { id: request.subjectId } });
    if (!factory || factory.status !== 'trial') return; // idempotent
    if (event.type === 'approval.approved') {
      await this.applyStatus(
        tx,
        factory,
        'active',
        'partner_activation approved (D-041)',
        request.requesterUserId,
        request.id,
      );
    } else {
      await this.record(tx, factory.publicId, 'factory.activation_rejected', {
        approvalRequestId: request.publicId,
      });
    }
  }

  private async applyStatus(
    tx: Tx,
    current: Factory,
    to: FactoryStatus,
    reason: string,
    userId: bigint | null,
    approvalRequestId: bigint | null,
  ): Promise<FactoryRow> {
    if (!canTransition(current.status, to)) {
      throw new DomainException('partners.invalid_transition', { params: { from: current.status, to } });
    }
    const now = new Date();
    const updated = await tx.factory.update({
      where: { id: current.id },
      data: {
        status: to,
        ...(to === 'active' && !current.activatedAt ? { activatedAt: now } : {}),
        ...(to === 'offboarded' ? { offboardedAt: now } : {}),
        updatedById: userId,
        rowVersion: { increment: 1 },
      },
      include: FACTORY_INCLUDE,
    });
    await tx.factoryStatusHistory.create({
      data: {
        factoryId: current.id,
        fromStatus: current.status,
        toStatus: to,
        reason,
        approvalRequestId,
        changedById: userId,
      },
    });
    const stepFor: Partial<Record<FactoryStatus, OnboardingStep>> = { trial: 'trial', active: 'activation' };
    const step = stepFor[to];
    if (step) await this.markStep(tx, current.id, step, 'approved', userId);
    await this.record(tx, current.publicId, 'factory.status_changed', { from: current.status, to, reason });
    return updated;
  }

  // --- onboarding steps ----------------------------------------------------------------------------

  async steps(actor: Actor, publicId: string) {
    const factory = await this.access.factory(actor, publicId);
    const rows = await this.prisma.factoryOnboardingStep.findMany({ where: { factoryId: factory.id } });
    return ONBOARDING_STEPS.map((step) => rows.find((r) => r.step === step)!).filter(Boolean);
  }

  /** Staff record the state of a step; with assisted onboarding the factory later signs it off. */
  async updateStep(actor: UserActor, publicId: string, step: OnboardingStep, input: UpdateOnboardingStepDto) {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.withTx(async (tx) => {
      const row = await this.markStep(tx, factory.id, step, input.status, actor.userId, {
        enteredByStaff: factory.onboardingMode === 'assisted',
        notes: input.notes,
      });
      await this.record(tx, factory.publicId, 'factory.onboarding_step_changed', {
        step,
        status: input.status,
      });
      return row;
    });
  }

  /** The factory confirms data getpack entered on its behalf (D-100 note). */
  async signOffStep(actor: UserActor, publicId: string, step: OnboardingStep) {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.withTx(async (tx) => {
      const current = await tx.factoryOnboardingStep.findUniqueOrThrow({
        where: { factoryId_step: { factoryId: factory.id, step } },
      });
      if (!current.enteredByStaff) throw new DomainException('partners.nothing_to_sign_off');
      const row = await tx.factoryOnboardingStep.update({
        where: { id: current.id },
        data: {
          factorySignedOffById: actor.userId,
          factorySignedOffAt: new Date(),
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.record(tx, factory.publicId, 'factory.onboarding_step_signed_off', { step });
      return row;
    });
  }

  /** Sets a step's status (services call it when the step's evidence is in place). */
  async markStep(
    tx: Tx,
    factoryId: bigint,
    step: OnboardingStep,
    status: OnboardingStepStatus,
    userId: bigint | null,
    extra: { enteredByStaff?: boolean; notes?: string | null } = {},
  ) {
    const done = status === 'approved' || status === 'waived';
    return tx.factoryOnboardingStep.update({
      where: { factoryId_step: { factoryId, step } },
      data: {
        status,
        completedAt: done ? new Date() : null,
        completedById: done ? userId : null,
        ...(extra.enteredByStaff !== undefined ? { enteredByStaff: extra.enteredByStaff } : {}),
        ...(extra.notes !== undefined ? { notes: extra.notes } : {}),
        updatedById: userId,
        rowVersion: { increment: 1 },
      },
    });
  }

  // --- addresses & contacts ------------------------------------------------------------------------

  async addresses(actor: Actor, publicId: string) {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.factoryAddress.findMany({
      where: { factoryId: factory.id },
      include: { subdistrict: { select: { publicId: true } } },
      orderBy: { id: 'asc' },
    });
  }

  async saveAddress(
    actor: UserActor,
    publicId: string,
    input: CreateFactoryAddressDto | UpdateFactoryAddressDto,
    addressId?: string,
  ) {
    const factory = await this.editableBy(actor, publicId);
    return this.prisma.withTx(async (tx) => {
      const subdistrictId = await new RefResolver(tx).optional(
        'geoSubdistrict',
        input.subdistrictId,
        'subdistrictId',
      );
      const data = compact({ ...input, subdistrictId });
      const row = addressId
        ? await tx.factoryAddress.update({
            where: { id: (await this.child(tx.factoryAddress, factory.id, addressId)).id },
            data: { ...data, updatedById: actor.userId, rowVersion: { increment: 1 } },
            include: { subdistrict: { select: { publicId: true } } },
          })
        : await tx.factoryAddress.create({
            data: {
              ...(data as CreateFactoryAddressDto & { subdistrictId?: bigint | null }),
              factoryId: factory.id,
              createdById: actor.userId,
              updatedById: actor.userId,
            },
            include: { subdistrict: { select: { publicId: true } } },
          });
      await this.record(
        tx,
        factory.publicId,
        addressId ? 'factory.address_updated' : 'factory.address_added',
        {
          addressId: row.publicId,
        },
      );
      return row;
    });
  }

  async contacts(actor: Actor, publicId: string) {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.factoryContact.findMany({ where: { factoryId: factory.id }, orderBy: { id: 'asc' } });
  }

  async saveContact(
    actor: UserActor,
    publicId: string,
    input: CreateFactoryContactDto | UpdateFactoryContactDto,
    contactId?: string,
  ) {
    const factory = await this.editableBy(actor, publicId);
    return this.prisma.withTx(async (tx) => {
      if (input.isPrimary) {
        await tx.factoryContact.updateMany({
          where: { factoryId: factory.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const data = compact({ ...input });
      const row = contactId
        ? await tx.factoryContact.update({
            where: { id: (await this.child(tx.factoryContact, factory.id, contactId)).id },
            data: { ...data, updatedById: actor.userId, rowVersion: { increment: 1 } },
          })
        : await tx.factoryContact.create({
            data: {
              ...(data as CreateFactoryContactDto),
              factoryId: factory.id,
              createdById: actor.userId,
              updatedById: actor.userId,
            },
          });
      // PII never goes into audit or events: only the id.
      await this.record(
        tx,
        factory.publicId,
        contactId ? 'factory.contact_updated' : 'factory.contact_added',
        {
          contactId: row.publicId,
        },
      );
      return row;
    });
  }

  // --- KYC documents ---------------------------------------------------------------------------------

  async kycDocuments(actor: Actor, publicId: string) {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.factoryKycDocument.findMany({
      where: { factoryId: factory.id },
      include: { fileObject: { select: { publicId: true } } },
      orderBy: { id: 'asc' },
    });
  }

  async addKycDocument(actor: UserActor, publicId: string, input: CreateKycDocumentDto) {
    const factory = await this.editableBy(actor, publicId);
    return this.prisma.withTx(async (tx) => {
      const fileObjectId = await new RefResolver(tx).file(input.fileId, 'fileId');
      const row = await tx.factoryKycDocument.create({
        data: {
          factoryId: factory.id,
          docType: input.docType,
          fileObjectId,
          issuedOn: input.issuedOn ?? null,
          expiresOn: input.expiresOn ?? null,
          createdById: actor.userId,
        },
        include: { fileObject: { select: { publicId: true } } },
      });
      // The file belongs to the factory from now on (partner-scoped downloads, B1.3 files).
      await tx.fileObject.update({ where: { id: fileObjectId }, data: { ownerFactoryId: factory.id } });
      const step = await tx.factoryOnboardingStep.findUniqueOrThrow({
        where: { factoryId_step: { factoryId: factory.id, step: 'kyc' } },
      });
      if (step.status === 'pending') await this.markStep(tx, factory.id, 'kyc', 'submitted', actor.userId);
      await this.record(tx, factory.publicId, 'factory.kyc_document_added', {
        documentId: row.publicId,
        docType: input.docType,
      });
      return row;
    });
  }

  /** Staff verify or reject a KYC document; the `kyc` step is approved once every document is verified. */
  async reviewKycDocument(
    actor: UserActor,
    publicId: string,
    documentId: string,
    input: ReviewFactoryKycDocumentDto,
  ) {
    const factory = await this.access.factory(actor, publicId);
    return this.prisma.withTx(async (tx) => {
      const doc = await this.child(tx.factoryKycDocument, factory.id, documentId);
      const row = await tx.factoryKycDocument.update({
        where: { id: doc.id },
        data: {
          status: input.outcome,
          verifiedById: actor.userId,
          verifiedAt: new Date(),
          note: input.note ?? null,
          rowVersion: { increment: 1 },
        },
        include: { fileObject: { select: { publicId: true } } },
      });
      const open = await tx.factoryKycDocument.count({
        where: { factoryId: factory.id, status: { in: ['pending', 'rejected'] } },
      });
      if (open === 0) await this.markStep(tx, factory.id, 'kyc', 'approved', actor.userId);
      await this.record(tx, factory.publicId, 'factory.kyc_document_reviewed', {
        documentId: row.publicId,
        outcome: input.outcome,
      });
      return row;
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------

  /** Partner principals may edit their factory's own data only before the trial starts. */
  private async editableBy(actor: UserActor, publicId: string) {
    const factory = await this.access.factory(actor, publicId);
    if (actor.audience === 'partner' && !SELF_EDITABLE_STATUSES.includes(factory.status)) {
      throw new DomainException('partners.profile_locked');
    }
    return factory;
  }

  private async child<T extends { id: bigint }>(
    table: { findFirst(args: object): Promise<T | null> },
    factoryId: bigint,
    publicId: string,
  ): Promise<T> {
    const row = await table.findFirst({ where: { publicId, factoryId } });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  private assertTaxId(taxId: string): void {
    if (!isValidThaiTaxId(taxId)) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'taxId', code: 'thaiTaxId', message: 'taxId has an invalid check digit' }],
      });
    }
  }

  /** `F0001`, `F0002`… (staff-facing; a collision on concurrent creation is a retryable 409). */
  private async nextCode(tx: Tx): Promise<string> {
    const [row] = await tx.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(MAX(substring(code FROM '^F([0-9]+)$')::int), 0) + 1 AS next FROM factories`;
    return `F${String(row?.next ?? 1).padStart(4, '0')}`;
  }

  async record(tx: Tx, factoryPublicId: string, type: string, data: Record<string, unknown>) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'factory',
      resourcePublicId: factoryPublicId,
      data,
    });
    const event = await this.events.record(tx, {
      type,
      aggregateType: 'factory',
      aggregateId: factoryPublicId,
      payload: { factoryId: factoryPublicId, ...data },
    });
    await this.activity.record(tx, {
      aggregateType: 'factory',
      aggregatePublicId: factoryPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'partner'],
      domainEventId: event.id,
    });
  }
}
