import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type CreationChannel,
  type CustomerProfile,
  type CustomerType,
  type Prisma,
  type TaxProfile,
  type User,
} from '@generated/prisma/client';
import { toE164 } from '@modules/auth/login/phone';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';

import {
  type AddressInputDto,
  type FindOrCreateCustomerDto,
  type TaxProfileInputDto,
  type UpdateAddressDto,
  type UpdateCustomerProfileDto,
  type UpdateTaxProfileDto,
} from './customers.dto';
import { isValidThaiTaxId } from './thai-tax-id';

export const GEO_INCLUDE = {
  province: true,
  subdistrict: { include: { district: true } },
} as const;

export type AddressRow = Prisma.CustomerAddressGetPayload<{ include: typeof GEO_INCLUDE }>;
export type TaxProfileRow = Prisma.TaxProfileGetPayload<{ include: typeof GEO_INCLUDE }>;
export type CustomerRow = User & { customerProfile: CustomerProfile | null };

/** The address copied onto carts, orders and shipments (D-142: the only customer data factories see). */
export interface AddressSnapshot {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subdistrictId: string | null;
  subdistrictNameTh: string | null;
  districtNameTh: string | null;
  provinceId: string;
  provinceNameTh: string;
  postcode: string;
}

/** Tax-invoice buyer data frozen on an order group (accounting-design §2, full-form tax invoice). */
export interface TaxProfileSnapshot {
  taxProfileId: string;
  taxType: string;
  name: string;
  taxId: string;
  branchType: string;
  branchCode: string;
  address: string;
  postcode: string;
  provinceNameTh: string;
  withholdsTax: boolean;
  documentEmail: string | null;
  /** Set when the buyer is a B2B company: the invoice names the company branch (D-125). */
  companyId?: string;
  companyBranchId?: string;
}

export const addressEtag = (row: { publicId: string; rowVersion: number }) =>
  etagOf(row.publicId, row.rowVersion);
export const customerEtag = (row: CustomerRow) =>
  etagOf(row.publicId, row.rowVersion, row.customerProfile?.rowVersion ?? 0);

const LIVE = { deletedAt: null } as const;

function invalid(path: string, message: string): never {
  throw new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
}

/**
 * Customer profiles, addresses and tax profiles (schema-design §3.6, B3.1). Customers maintain their
 * own; CS (`customers.manage`) acts for them with the same rules. Every change is one transaction with
 * an activity row and a domain event (CLAUDE.md).
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- profile --------------------------------------------------------------------------------------

  /** The profile of a customer user, created on first use (registration never needs a numbering series). */
  async ensureProfile(
    tx: Tx,
    userId: bigint,
    via: CreationChannel = 'self',
    createdById: bigint | null = null,
  ): Promise<CustomerProfile> {
    const existing = await tx.customerProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.kind !== 'customer') throw new DomainException('http.not_found');
    await tx.customerProfile.createMany({
      data: [{ userId, createdVia: via, createdById }],
      skipDuplicates: true,
    });
    return tx.customerProfile.findUniqueOrThrow({ where: { userId } });
  }

  /** Assigns the customer code from the `customer` series once (Q-2); idempotent. */
  async assignCode(tx: Tx, userId: bigint): Promise<string> {
    const profile = await this.ensureProfile(tx, userId);
    if (profile.customerCode) return profile.customerCode;
    const code = await this.numbering.next(tx, 'customer');
    const { count } = await tx.customerProfile.updateMany({
      where: { userId, customerCode: null },
      data: { customerCode: code, rowVersion: { increment: 1 } },
    });
    if (count === 0) return (await tx.customerProfile.findUniqueOrThrow({ where: { userId } })).customerCode!;
    return code;
  }

  async customer(userId: bigint, db: Tx = this.prisma): Promise<CustomerRow> {
    const row = await db.user.findFirst({
      where: { id: userId, kind: 'customer' },
      include: { customerProfile: true },
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** Internal id of a customer by public id; anything else is 404. */
  async customerIdOf(publicId: string, db: Tx = this.prisma): Promise<bigint> {
    const row = await db.user.findFirst({
      where: { publicId, kind: 'customer', anonymisedAt: null },
      select: { id: true },
    });
    if (!row) throw new DomainException('http.not_found');
    return row.id;
  }

  async profile(userId: bigint): Promise<CustomerRow> {
    return this.prisma.withTx(async (tx) => {
      await this.ensureProfile(tx, userId);
      return this.customer(userId, tx);
    });
  }

  async updateProfile(
    actor: Actor,
    userId: bigint,
    ifMatch: string | undefined,
    body: UpdateCustomerProfileDto,
  ): Promise<CustomerRow> {
    return this.prisma.withTx(async (tx) => {
      await this.ensureProfile(tx, userId);
      const current = await this.customer(userId, tx);
      assertIfMatch(ifMatch, customerEtag(current));
      const userData: Prisma.UserUpdateInput = {};
      if (body.displayName !== undefined) userData.displayName = body.displayName;
      if (body.firstName !== undefined) userData.firstName = body.firstName;
      if (body.lastName !== undefined) userData.lastName = body.lastName;
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: { ...userData, rowVersion: { increment: 1 } } });
      }
      if (body.customerType !== undefined) {
        await tx.customerProfile.update({
          where: { userId },
          data: {
            customerType: body.customerType,
            updatedById: actor.type === 'user' ? actor.userId : null,
            rowVersion: { increment: 1 },
          },
        });
      }
      // The first save by the customer themselves ends the storefront's profile prompt (U-B0.1); CS edits do not.
      if (
        actor.type === 'user' &&
        actor.audience === 'customer' &&
        !current.customerProfile?.profileCompletedAt
      ) {
        await tx.customerProfile.update({ where: { userId }, data: { profileCompletedAt: new Date() } });
      }
      await this.record(
        tx,
        current.publicId,
        'customer.profile_updated',
        { fields: Object.keys(body) },
        actor,
      );
      return this.customer(userId, tx);
    });
  }

  // --- addresses ------------------------------------------------------------------------------------

  async listAddresses(
    userId: bigint,
    kind: 'delivery' | 'billing' | undefined,
    page: number,
    perPage: number,
  ) {
    const where: Prisma.CustomerAddressWhereInput = { userId, ...LIVE, ...(kind ? { kind } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.customerAddress.findMany({
        where,
        include: GEO_INCLUDE,
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.customerAddress.count({ where }),
    ]);
    return { rows, total };
  }

  async address(userId: bigint, publicId: string, db: Tx = this.prisma): Promise<AddressRow> {
    const row = await db.customerAddress.findFirst({
      where: { publicId, userId, ...LIVE },
      include: GEO_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createAddress(actor: Actor, userId: bigint, body: AddressInputDto): Promise<AddressRow> {
    return this.prisma.withTx(async (tx) => {
      const user = await this.customer(userId, tx);
      await this.ensureProfile(tx, userId);
      const geo = await this.geo(tx, body.provinceId, body.subdistrictId ?? null, body.postcode);
      const firstOfKind =
        (await tx.customerAddress.count({ where: { userId, kind: body.kind, ...LIVE } })) === 0;
      const isDefault = body.isDefault ?? firstOfKind;
      if (isDefault) await this.clearDefaultAddress(tx, userId, body.kind);
      const row = await tx.customerAddress.create({
        data: {
          userId,
          kind: body.kind,
          label: body.label,
          recipientName: body.recipientName,
          phone: this.phone(body.phone, 'phone'),
          line1: body.line1,
          line2: body.line2 ?? null,
          subdistrictId: geo.subdistrictId,
          postcode: body.postcode,
          provinceId: geo.provinceId,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
          isDefault,
          createdById: actor.type === 'user' ? actor.userId : null,
        },
        include: GEO_INCLUDE,
      });
      await this.record(tx, user.publicId, 'customer.address_created', { addressId: row.publicId }, actor);
      return row;
    });
  }

  async updateAddress(
    actor: Actor,
    userId: bigint,
    publicId: string,
    ifMatch: string | undefined,
    body: UpdateAddressDto,
  ): Promise<AddressRow> {
    return this.prisma.withTx(async (tx) => {
      const current = await this.address(userId, publicId, tx);
      assertIfMatch(ifMatch, addressEtag(current));
      const provinceId = body.provinceId ?? current.province.publicId;
      const subdistrictId =
        body.subdistrictId === undefined ? (current.subdistrict?.publicId ?? null) : body.subdistrictId;
      const postcode = body.postcode ?? current.postcode;
      const geo = await this.geo(tx, provinceId, subdistrictId, postcode);
      if (body.isDefault) await this.clearDefaultAddress(tx, userId, current.kind);
      const row = await tx.customerAddress.update({
        where: { id: current.id },
        data: {
          ...(body.label !== undefined && { label: body.label }),
          ...(body.recipientName !== undefined && { recipientName: body.recipientName }),
          ...(body.phone !== undefined && { phone: this.phone(body.phone, 'phone') }),
          ...(body.line1 !== undefined && { line1: body.line1 }),
          ...(body.line2 !== undefined && { line2: body.line2 }),
          ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
          postcode,
          provinceId: geo.provinceId,
          subdistrictId: geo.subdistrictId,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
        include: GEO_INCLUDE,
      });
      const owner = await this.customer(userId, tx);
      await this.record(tx, owner.publicId, 'customer.address_updated', { addressId: row.publicId }, actor);
      return row;
    });
  }

  /** Soft delete (schema-design §1.6); carts and orders keep their own snapshot. */
  async deleteAddress(actor: Actor, userId: bigint, publicId: string, ifMatch: string | undefined) {
    await this.prisma.withTx(async (tx) => {
      const current = await this.address(userId, publicId, tx);
      assertIfMatch(ifMatch, addressEtag(current), { required: false });
      await tx.customerAddress.update({
        where: { id: current.id },
        data: { deletedAt: new Date(), isDefault: false, rowVersion: { increment: 1 } },
      });
      const owner = await this.customer(userId, tx);
      await this.record(tx, owner.publicId, 'customer.address_deleted', { addressId: publicId }, actor);
    });
  }

  /** The snapshot of one of the customer's addresses (checkout, cart destinations). */
  async addressSnapshot(
    tx: Tx,
    userId: bigint,
    publicId: string,
  ): Promise<{ id: bigint; snapshot: AddressSnapshot }> {
    const row = await this.address(userId, publicId, tx);
    return { id: row.id, snapshot: snapshotOf(row) };
  }

  // --- tax profiles ---------------------------------------------------------------------------------

  async listTaxProfiles(userId: bigint, page: number, perPage: number) {
    const where: Prisma.TaxProfileWhereInput = { userId, ...LIVE };
    const [rows, total] = await Promise.all([
      this.prisma.taxProfile.findMany({
        where,
        include: GEO_INCLUDE,
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.taxProfile.count({ where }),
    ]);
    return { rows, total };
  }

  async taxProfile(userId: bigint, publicId: string, db: Tx = this.prisma): Promise<TaxProfileRow> {
    const row = await db.taxProfile.findFirst({ where: { publicId, userId, ...LIVE }, include: GEO_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createTaxProfile(actor: Actor, userId: bigint, body: TaxProfileInputDto): Promise<TaxProfileRow> {
    if (!isValidThaiTaxId(body.taxId)) invalid('taxId', 'the check digit does not match');
    const branchCode = body.branchType === 'head_office' ? '00000' : (body.branchCode ?? '');
    if (body.branchType === 'branch' && (branchCode === '' || branchCode === '00000'))
      invalid('branchCode', 'a branch needs its own 5-digit code');
    return this.prisma.withTx(async (tx) => {
      const user = await this.customer(userId, tx);
      await this.ensureProfile(tx, userId);
      const geo = await this.geo(tx, body.provinceId, body.subdistrictId ?? null, body.postcode);
      const first = (await tx.taxProfile.count({ where: { userId, ...LIVE } })) === 0;
      const isDefault = body.isDefault ?? first;
      if (isDefault) await this.clearDefaultTaxProfile(tx, userId);
      const row = await tx.taxProfile.create({
        data: {
          userId,
          taxType: body.taxType,
          name: body.name,
          taxId: body.taxId,
          branchType: body.branchType,
          branchCode,
          line1: body.line1,
          line2: body.line2 ?? null,
          subdistrictId: geo.subdistrictId,
          postcode: body.postcode,
          provinceId: geo.provinceId,
          withholdsTax: body.withholdsTax ?? false,
          documentEmail: body.documentEmail?.toLowerCase() ?? null,
          isDefault,
          createdById: actor.type === 'user' ? actor.userId : null,
        },
        include: GEO_INCLUDE,
      });
      await this.record(
        tx,
        user.publicId,
        'customer.tax_profile_created',
        { taxProfileId: row.publicId, withholdsTax: row.withholdsTax },
        actor,
      );
      return row;
    });
  }

  async updateTaxProfile(
    actor: Actor,
    userId: bigint,
    publicId: string,
    ifMatch: string | undefined,
    body: UpdateTaxProfileDto,
  ): Promise<TaxProfileRow> {
    return this.prisma.withTx(async (tx) => {
      const current = await this.taxProfile(userId, publicId, tx);
      assertIfMatch(ifMatch, addressEtag(current));
      const provinceId = body.provinceId ?? current.province.publicId;
      const subdistrictId =
        body.subdistrictId === undefined ? (current.subdistrict?.publicId ?? null) : body.subdistrictId;
      const postcode = body.postcode ?? current.postcode;
      const geo = await this.geo(tx, provinceId, subdistrictId, postcode);
      if (body.isDefault) await this.clearDefaultTaxProfile(tx, userId);
      const row = await tx.taxProfile.update({
        where: { id: current.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.line1 !== undefined && { line1: body.line1 }),
          ...(body.line2 !== undefined && { line2: body.line2 }),
          ...(body.withholdsTax !== undefined && { withholdsTax: body.withholdsTax }),
          ...(body.documentEmail !== undefined && {
            documentEmail: body.documentEmail?.toLowerCase() ?? null,
          }),
          ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
          postcode,
          provinceId: geo.provinceId,
          subdistrictId: geo.subdistrictId,
          updatedById: actor.type === 'user' ? actor.userId : null,
          rowVersion: { increment: 1 },
        },
        include: GEO_INCLUDE,
      });
      const owner = await this.customer(userId, tx);
      await this.record(
        tx,
        owner.publicId,
        'customer.tax_profile_updated',
        { taxProfileId: row.publicId },
        actor,
      );
      return row;
    });
  }

  async deleteTaxProfile(actor: Actor, userId: bigint, publicId: string, ifMatch: string | undefined) {
    await this.prisma.withTx(async (tx) => {
      const current = await this.taxProfile(userId, publicId, tx);
      assertIfMatch(ifMatch, addressEtag(current), { required: false });
      await tx.taxProfile.update({
        where: { id: current.id },
        data: { deletedAt: new Date(), isDefault: false, rowVersion: { increment: 1 } },
      });
      const owner = await this.customer(userId, tx);
      await this.record(
        tx,
        owner.publicId,
        'customer.tax_profile_deleted',
        { taxProfileId: publicId },
        actor,
      );
    });
  }

  /** Frozen buyer data for the order group (accounting-design §2). */
  async taxProfileSnapshot(tx: Tx, userId: bigint, publicId: string): Promise<TaxProfileSnapshot> {
    return taxSnapshotOf(await this.taxProfile(userId, publicId, tx));
  }

  // --- CS -------------------------------------------------------------------------------------------

  async search(
    q: string | undefined,
    page: number,
    perPage: number,
    filters: { customerType?: CustomerType; createdVia?: CreationChannel } = {},
  ) {
    const phone = q ? toE164(q) : null;
    const where: Prisma.UserWhereInput = {
      kind: 'customer',
      anonymisedAt: null,
      ...((filters.customerType || filters.createdVia) && {
        customerProfile: {
          ...(filters.customerType && { customerType: filters.customerType }),
          ...(filters.createdVia && { createdVia: filters.createdVia }),
        },
      }),
      ...(q && {
        OR: [
          ...(phone ? [{ phone }] : []),
          { email: { contains: q, mode: 'insensitive' as const } },
          { displayName: { contains: q, mode: 'insensitive' as const } },
          { customerProfile: { customerCode: { equals: q, mode: 'insensitive' as const } } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { customerProfile: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total };
  }

  /** For the staff views: order groups placed (not cancelled), the last one, an active company membership. */
  async staffStats(userIds: bigint[]) {
    const [groups, members] = await Promise.all([
      this.prisma.orderGroup.groupBy({
        by: ['customerUserId'],
        where: { customerUserId: { in: userIds }, status: { not: 'cancelled' } },
        _count: { _all: true },
        _max: { placedAt: true },
      }),
      this.prisma.companyMember.findMany({
        where: { userId: { in: userIds }, status: 'active', company: { status: { not: 'closed' } } },
        include: { company: { select: { legalName: true } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    return new Map(
      userIds.map((id) => {
        const g = groups.find((x) => x.customerUserId === id);
        return [
          id,
          {
            ordersCount: g?._count._all ?? 0,
            lastOrderAt: g?._max.placedAt ?? null,
            companyName: members.find((m) => m.userId === id)?.company.legalName ?? null,
          },
        ];
      }),
    );
  }

  /**
   * CS finds the customer by phone or e-mail, or creates the account (B3.1). A created account gets its
   * customer code at once and publishes `customer.registered` (via `cs`).
   */
  async findOrCreate(actor: Actor & { type: 'user' }, body: FindOrCreateCustomerDto) {
    const phone = body.phone ? this.phone(body.phone, 'phone') : null;
    const email = body.email?.toLowerCase() ?? null;
    if (!phone && !email) invalid('phone', 'phone or email is required');
    return this.prisma.withTx(async (tx) => {
      const existing = await tx.user.findFirst({
        where: {
          kind: 'customer',
          anonymisedAt: null,
          OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])],
        },
      });
      if (existing) {
        await this.ensureProfile(tx, existing.id);
        return { created: false, customer: await this.customer(existing.id, tx) };
      }
      const user = await tx.user.create({
        data: {
          kind: 'customer',
          status: 'active',
          displayName: body.displayName,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          phone,
          email,
          createdById: actor.userId,
        },
      });
      await tx.customerProfile.create({
        data: {
          userId: user.id,
          createdVia: 'cs',
          createdById: actor.userId,
          customerType: body.customerType ?? 'individual',
        },
      });
      await this.assignCode(tx, user.id);
      await this.events.record(
        tx,
        {
          type: 'customer.registered',
          aggregateType: 'user',
          aggregateId: user.publicId,
          payload: { userId: user.publicId, via: 'cs', createdByUserId: actor.publicId },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'customer',
        aggregatePublicId: user.publicId,
        action: 'customer.created_by_cs',
        messageKey: 'activity.customer.created_by_cs',
        visibility: ['internal'],
        actor,
      });
      return { created: true, customer: await this.customer(user.id, tx) };
    });
  }

  // --- helpers --------------------------------------------------------------------------------------

  private phone(input: string, path: string): string {
    const e164 = toE164(input);
    if (!e164) invalid(path, 'not a valid phone number');
    return e164;
  }

  /** Province (required) and subdistrict (optional) by public id; the subdistrict must fit both. */
  private async geo(tx: Tx, provincePublicId: string, subdistrictPublicId: string | null, postcode: string) {
    const province = await tx.geoProvince.findUnique({ where: { publicId: provincePublicId } });
    if (!province) invalid('provinceId', 'unknown province');
    if (!subdistrictPublicId) return { provinceId: province.id, subdistrictId: null };
    const sub = await tx.geoSubdistrict.findUnique({
      where: { publicId: subdistrictPublicId },
      include: { district: true },
    });
    if (!sub) invalid('subdistrictId', 'unknown subdistrict');
    if (sub.district.provinceId !== province.id) invalid('subdistrictId', 'not in the province');
    if (sub.postcode !== postcode) invalid('postcode', 'does not match the subdistrict');
    return { provinceId: province.id, subdistrictId: sub.id };
  }

  private async clearDefaultAddress(tx: Tx, userId: bigint, kind: 'delivery' | 'billing') {
    await tx.customerAddress.updateMany({
      where: { userId, kind, isDefault: true, ...LIVE },
      data: { isDefault: false, rowVersion: { increment: 1 } },
    });
  }

  private async clearDefaultTaxProfile(tx: Tx, userId: bigint) {
    await tx.taxProfile.updateMany({
      where: { userId, isDefault: true, ...LIVE },
      data: { isDefault: false, rowVersion: { increment: 1 } },
    });
  }

  private async record(
    tx: Tx,
    customerPublicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ): Promise<void> {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'customer',
        aggregateId: customerPublicId,
        payload: { customerId: customerPublicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'customer',
      aggregatePublicId: customerPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}

export function snapshotOf(row: AddressRow): AddressSnapshot {
  return {
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    subdistrictId: row.subdistrict?.publicId ?? null,
    subdistrictNameTh: row.subdistrict?.nameTh ?? null,
    districtNameTh: row.subdistrict?.district.nameTh ?? null,
    provinceId: row.province.publicId,
    provinceNameTh: row.province.nameTh,
    postcode: row.postcode,
  };
}

export function taxSnapshotOf(row: TaxProfileRow | (TaxProfile & AddressRowGeo)): TaxProfileSnapshot {
  const parts = [
    row.line1,
    row.line2,
    row.subdistrict?.nameTh,
    row.subdistrict?.district.nameTh,
    row.province.nameTh,
    row.postcode,
  ].filter(Boolean);
  return {
    taxProfileId: row.publicId,
    taxType: row.taxType,
    name: row.name,
    taxId: row.taxId,
    branchType: row.branchType,
    branchCode: row.branchCode,
    address: parts.join(' '),
    postcode: row.postcode,
    provinceNameTh: row.province.nameTh,
    withholdsTax: row.withholdsTax,
    documentEmail: row.documentEmail,
  };
}

type AddressRowGeo = Pick<TaxProfileRow, 'province' | 'subdistrict'>;
