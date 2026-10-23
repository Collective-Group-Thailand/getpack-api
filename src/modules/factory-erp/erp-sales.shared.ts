import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import {
  type ErpItem,
  type ErpTradingPartner,
  type ErpUnit,
  type ErpVatMode,
  type Factory,
  type Prisma,
  type User,
} from '@generated/prisma/client';
import { type PersonRefDto } from '@modules/financial-reports/financial-reports.dto';

import { type ErpRefDto } from './erp.dto';
import { dec, documentTotals, fmtCost, fmtMoney, fmtQty, lineAmount } from './erp.math';
import { type ErpDocPartyDto, type ErpSalesLineDto, type ErpSalesLineInput } from './erp-e4.dto';
import { itemRef } from './erp-views';
import { type ErpScope } from './erp-workspace.service';

/**
 * What E4's documents share (D-359 – D-368): the seller and buyer as printed, lines priced the same way on
 * quotations, orders and invoices, the factory's people, and dates in Bangkok.
 */

export const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const isoTs = (d: Date | null): string | null => (d ? toBangkokIso(d) : null);
export const today = () => bangkokDate(new Date());
export function addDays(s: string, n: number): string {
  return new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export const userRef = (u: Pick<User, 'publicId' | 'displayName'> | null): PersonRefDto | null =>
  u ? { id: u.publicId, name: u.displayName } : null;
export const partnerRef = (p: Pick<ErpTradingPartner, 'publicId' | 'code' | 'name'>): ErpRefDto => ({
  id: p.publicId,
  code: p.code,
  name: p.name,
});

/** The document's VAT mode: a factory not registered for VAT charges none (D-363). */
export function vatModeFor(
  factory: Pick<Factory, 'isVatRegistered'>,
  wanted: string | undefined,
): ErpVatMode {
  if (!factory.isVatRegistered) return 'none';
  return (wanted as ErpVatMode | undefined) ?? 'exclusive';
}

// ------------------------------------------------------------------------------------- parties

const GEO_INCLUDE = { subdistrict: { include: { district: { include: { province: true } } } } } as const;

/** Thai postal address of a factory address row: line, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, postcode. */
export function thaiAddress(a: Prisma.FactoryAddressGetPayload<{ include: typeof GEO_INCLUDE }>): string {
  const sub = a.subdistrict;
  const bkk = sub?.district.province.nameTh?.includes('กรุงเทพ');
  return [
    a.line1,
    a.line2,
    sub ? `${bkk ? 'แขวง' : 'ต.'}${sub.nameTh}` : null,
    sub ? `${bkk ? 'เขต' : 'อ.'}${sub.district.nameTh}` : null,
    sub ? (bkk ? sub.district.province.nameTh : `จ.${sub.district.province.nameTh}`) : null,
    a.postcode,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The factory as the seller (D-363): legal name, registered address, tax id and branch. */
export async function sellerOf(tx: Tx, factory: Factory): Promise<ErpDocPartyDto> {
  const address = await tx.factoryAddress.findFirst({
    where: { factoryId: factory.id, kind: 'registered' },
    include: GEO_INCLUDE,
    orderBy: { id: 'asc' },
  });
  return {
    name: factory.legalName,
    address: address ? thaiAddress(address) : null,
    taxId: factory.taxId,
    branchCode: factory.branchCode,
    phone: null,
  };
}

/** A tax invoice needs the seller's name, registered address and tax id (s.86/4). */
export function assertSellerComplete(seller: ErpDocPartyDto): void {
  if (!seller.name || !seller.address || !seller.taxId) throw new DomainException('erp.seller_incomplete');
}

/** The customer as the buyer. */
export function buyerOf(p: ErpTradingPartner): ErpDocPartyDto {
  return {
    name: p.name,
    address: p.address,
    taxId: p.taxId,
    branchCode: p.taxId ? (p.branchCode ?? '00000') : null,
    phone: p.phone,
  };
}

export const party = (json: Prisma.JsonValue | null): ErpDocPartyDto | null =>
  json ? (json as unknown as ErpDocPartyDto) : null;

// ---------------------------------------------------------------------------------- customers

/** A customer of this factory (kind customer or both), not archived. */
export async function customerOf(tx: Tx, scope: ErpScope, publicId: string): Promise<ErpTradingPartner> {
  const p = await tx.erpTradingPartner.findFirst({ where: { publicId, factoryId: scope.factory.id } });
  if (!p) throw new DomainException('http.not_found');
  if (p.status === 'archived') throw new DomainException('erp.archived', { params: { name: p.name } });
  if (p.kind === 'supplier') throw new DomainException('erp.customer_required', { params: { name: p.name } });
  return p;
}

// ------------------------------------------------------------------------------------- people

/** Users holding a role at this factory now (salespeople, assignees). */
export async function factoryUsers(tx: Tx, factoryId: bigint): Promise<{ user: User; roles: string[] }[]> {
  const rows = await tx.userRole.findMany({
    where: {
      scopeType: 'factory',
      scopeId: factoryId,
      revokedAt: null,
      OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
    },
    include: { user: true, role: true },
  });
  const byUser = new Map<bigint, { user: User; roles: string[] }>();
  for (const r of rows) {
    if (r.user.status !== 'active') continue;
    const e = byUser.get(r.userId) ?? { user: r.user, roles: [] };
    e.roles.push(r.role.key);
    byUser.set(r.userId, e);
  }
  return [...byUser.values()].sort((a, b) => a.user.displayName.localeCompare(b.user.displayName, 'th'));
}

/** A user of this factory by public id (else 404 — never someone outside it). */
export async function factoryUser(tx: Tx, factoryId: bigint, publicId: string): Promise<User> {
  const found = (await factoryUsers(tx, factoryId)).find((u) => u.user.publicId === publicId);
  if (!found) throw new DomainException('http.not_found');
  return found.user;
}

// ------------------------------------------------------------------------------------- lines

export interface PricedLine {
  lineNo: number;
  itemId: bigint | null;
  item: ErpItem | null;
  description: string;
  quantity: string;
  unit: ErpUnit;
  unitPrice: string;
  discountPct: string;
  amount: string;
}

/** Resolves and prices input lines: an item line is in the item's base unit; free text needs a description. */
export async function priceLines(tx: Tx, scope: ErpScope, input: ErpSalesLineInput[]): Promise<PricedLine[]> {
  const ids = [...new Set(input.map((l) => l.itemId).filter((x): x is string => !!x))];
  const items = ids.length
    ? await tx.erpItem.findMany({ where: { factoryId: scope.factory.id, publicId: { in: ids } } })
    : [];
  const byId = new Map(items.map((i) => [i.publicId, i]));
  return input.map((l, index) => {
    const item = l.itemId ? byId.get(l.itemId) : undefined;
    if (l.itemId && !item) throw new DomainException('http.not_found');
    if (item?.status === 'archived')
      throw new DomainException('erp.archived', { params: { name: item.name } });
    const description = (l.description ?? '').trim() || item?.name || '';
    if (!description)
      throw new DomainException('validation.failed', {
        errors: [{ path: `lines.${index}.description`, code: 'required', message: 'Describe the line' }],
      });
    const quantity = dec(l.quantity);
    if (!quantity.gt(0))
      throw new DomainException('validation.failed', {
        errors: [{ path: `lines.${index}.quantity`, code: 'min', message: 'More than 0' }],
      });
    const discount = dec(l.discountPct ?? '0');
    if (discount.gt(100))
      throw new DomainException('validation.failed', {
        errors: [{ path: `lines.${index}.discountPct`, code: 'max', message: 'At most 100' }],
      });
    return {
      lineNo: index + 1,
      itemId: item?.id ?? null,
      item: item ?? null,
      description,
      quantity: fmtQty(quantity),
      unit: (item?.baseUnit ?? l.unit ?? 'pcs') as ErpUnit,
      unitPrice: fmtCost(dec(l.unitPrice)),
      discountPct: dec(discount).toFixed(4),
      amount: fmtMoney(lineAmount(quantity, dec(l.unitPrice), discount)),
    };
  });
}

export function totalsOf(
  lines: { amount: Prisma.Decimal | string }[],
  mode: ErpVatMode,
  ratePct: string | Prisma.Decimal,
) {
  const t = documentTotals(
    lines.map((l) => dec(l.amount)),
    mode,
    dec(ratePct),
  );
  return { subtotal: fmtMoney(t.subtotal), vatAmount: fmtMoney(t.vatAmount), total: fmtMoney(t.total) };
}

type LineRow = {
  publicId?: string;
  id: bigint;
  lineNo: number;
  item: ErpItem | null;
  description: string;
  quantity: Prisma.Decimal;
  unit: ErpUnit;
  unitPrice: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  amount: Prisma.Decimal;
};

/** Hex prefixes of the line ids each document's lines carry (`lineId`). */
export const LINE = { quote: 'a01', so: 'a02', do: 'a03', iv: 'a04', note: 'a05' } as const;

export function salesLineDto(l: LineRow, idPrefix: string): ErpSalesLineDto {
  return {
    id: l.publicId ?? lineId(idPrefix, l.id),
    lineNo: l.lineNo,
    item: l.item ? itemRef(l.item) : null,
    description: l.description,
    quantity: fmtQty(l.quantity),
    unit: l.unit,
    unitPrice: fmtCost(l.unitPrice),
    discountPct: dec(l.discountPct).toFixed(4),
    amount: fmtMoney(l.amount),
  };
}

/**
 * Lines have no uuid of their own: a stable id from the document line's numeric id, in uuid form, so the
 * web can key and reference them (`lineId` ↔ `lineIdOf`).
 */
export function lineId(prefix: string, id: bigint): string {
  const hex = id.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4${prefix.padEnd(3, '0').slice(0, 3)}-8000-${hex}`;
}

export function lineIdOf(prefix: string, uuid: string): bigint | null {
  const m = /^00000000-0000-4([0-9a-f]{3})-8000-([0-9a-f]{12})$/i.exec(uuid);
  if (!m || m[1]!.toLowerCase() !== prefix.padEnd(3, '0').slice(0, 3)) return null;
  return BigInt(`0x${m[2]}`);
}
