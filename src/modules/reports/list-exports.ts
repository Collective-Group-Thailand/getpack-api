import { type PrismaService } from '@database/prisma.service';
import { type PermissionKey } from '@modules/iam/permissions.catalog';

import { day, iso, money } from './definitions/helpers';
import { type ReportColumn, type ReportRow } from './report-types';

/**
 * Exports of the staff list screens (U-B0.3): one file of a list with the list's own filters, behind the list's read
 * permission and `reports.export`. Contact details (phone, e-mail, address) are left out of the files (PDPA); the
 * screens show them to whoever may read them.
 */
export const LIST_EXPORT_MAX_ROWS = 10_000;
export const LIST_EXPORT_RESOURCES = ['orders', 'customers', 'companies', 'shipments', 'claims'] as const;
export type ListExportResource = (typeof LIST_EXPORT_RESOURCES)[number];

export interface ListExport {
  resource: ListExportResource;
  nameTh: string;
  nameEn: string;
  permission: PermissionKey;
  /** Query parameters the export understands (the rest are ignored). */
  filters: readonly string[];
  columns: readonly ReportColumn[];
  rows(prisma: PrismaService, query: Record<string, string>): AsyncIterable<ReportRow>;
}

const c = (
  key: string,
  labelTh: string,
  labelEn: string,
  type: ReportColumn['type'] = 'text',
): ReportColumn => ({
  key,
  labelTh,
  labelEn,
  type,
});

/** Keyset pages of 500 until the cap. */
async function* pages<T extends { id: bigint }>(fetch: (after: bigint) => Promise<T[]>): AsyncGenerator<T> {
  let after = 0n;
  let seen = 0;
  for (;;) {
    const rows = await fetch(after);
    for (const row of rows) {
      if (seen++ >= LIST_EXPORT_MAX_ROWS + 1) return;
      yield row;
    }
    if (rows.length < 500) return;
    after = rows.at(-1)!.id;
  }
}

const startOf = (d: string) => new Date(`${d}T00:00:00+07:00`);
const isDay = (v: string | undefined) => v !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const LIST_EXPORTS: readonly ListExport[] = [
  {
    resource: 'orders',
    nameTh: 'คำสั่งซื้อ',
    nameEn: 'Orders',
    permission: 'orders.read',
    filters: ['status', 'customerId', 'placedFrom', 'placedTo'],
    columns: [
      c('orderCode', 'เลขที่คำสั่งซื้อ', 'Order no.'),
      c('groupCode', 'กลุ่มคำสั่งซื้อ', 'Order group'),
      c('status', 'สถานะ', 'Status'),
      c('customerCode', 'รหัสลูกค้า', 'Customer code'),
      c('customerName', 'ลูกค้า', 'Customer'),
      c('productType', 'ประเภทสินค้า', 'Product type'),
      c('quantity', 'จำนวน', 'Quantity', 'integer'),
      c('gross', 'รวมทั้งสิ้น', 'Gross', 'money'),
      c('placedAt', 'วันที่สั่ง', 'Placed', 'datetime'),
      c('promisedShipDate', 'กำหนดส่ง', 'Promised ship date', 'date'),
    ],
    rows: (prisma, q) =>
      (async function* () {
        for await (const o of pages((after) =>
          prisma.order.findMany({
            where: {
              id: { gt: after },
              ...(q['status'] && { status: q['status'] as never }),
              orderGroup: {
                ...(q['customerId'] && { customer: { publicId: q['customerId'] } }),
                ...((isDay(q['placedFrom']) || isDay(q['placedTo'])) && {
                  placedAt: {
                    ...(isDay(q['placedFrom']) && { gte: startOf(q['placedFrom']!) }),
                    ...(isDay(q['placedTo']) && {
                      lt: new Date(startOf(q['placedTo']!).getTime() + 86_400_000),
                    }),
                  },
                }),
              },
            },
            include: {
              orderGroup: {
                select: {
                  groupCode: true,
                  placedAt: true,
                  customer: {
                    select: { displayName: true, customerProfile: { select: { customerCode: true } } },
                  },
                },
              },
              productType: { select: { code: true } },
            },
            orderBy: { id: 'asc' },
            take: 500,
          }),
        ))
          yield {
            orderCode: o.orderCode,
            groupCode: o.orderGroup.groupCode,
            status: o.status,
            customerCode: o.orderGroup.customer.customerProfile?.customerCode ?? null,
            customerName: o.orderGroup.customer.displayName,
            productType: o.productType.code,
            quantity: o.quantityOrdered,
            gross: money(o.grossAmount),
            placedAt: iso(o.orderGroup.placedAt),
            promisedShipDate: day(o.promisedShipDate),
          };
      })(),
  },
  {
    resource: 'customers',
    nameTh: 'ลูกค้า',
    nameEn: 'Customers',
    permission: 'customers.read',
    filters: ['customerType', 'createdVia'],
    columns: [
      c('customerCode', 'รหัสลูกค้า', 'Customer code'),
      c('displayName', 'ชื่อ', 'Name'),
      c('customerType', 'ประเภท', 'Type'),
      c('createdVia', 'ช่องทางสมัคร', 'Created via'),
      c('createdAt', 'วันที่สมัคร', 'Created', 'datetime'),
    ],
    rows: (prisma, q) =>
      (async function* () {
        for await (const u of pages((after) =>
          prisma.user.findMany({
            where: {
              id: { gt: after },
              kind: 'customer',
              anonymisedAt: null,
              ...((q['customerType'] || q['createdVia']) && {
                customerProfile: {
                  ...(q['customerType'] && { customerType: q['customerType'] as never }),
                  ...(q['createdVia'] && { createdVia: q['createdVia'] as never }),
                },
              }),
            },
            include: {
              customerProfile: { select: { customerCode: true, customerType: true, createdVia: true } },
            },
            orderBy: { id: 'asc' },
            take: 500,
          }),
        ))
          yield {
            customerCode: u.customerProfile?.customerCode ?? null,
            displayName: u.displayName,
            customerType: u.customerProfile?.customerType ?? null,
            createdVia: u.customerProfile?.createdVia ?? null,
            createdAt: iso(u.createdAt),
          };
      })(),
  },
  {
    resource: 'companies',
    nameTh: 'บริษัท',
    nameEn: 'Companies',
    permission: 'companies.read',
    filters: ['status', 'creditStatus'],
    columns: [
      c('companyCode', 'รหัสบริษัท', 'Company code'),
      c('legalName', 'ชื่อนิติบุคคล', 'Legal name'),
      c('taxId', 'เลขประจำตัวผู้เสียภาษี', 'Tax id'),
      c('status', 'สถานะ', 'Status'),
      c('creditStatus', 'เครดิต', 'Credit'),
      c('paidOrders', 'คำสั่งซื้อที่ชำระแล้ว', 'Paid orders', 'integer'),
      c('createdAt', 'วันที่สมัคร', 'Created', 'datetime'),
    ],
    rows: (prisma, q) =>
      (async function* () {
        for await (const co of pages((after) =>
          prisma.company.findMany({
            where: {
              id: { gt: after },
              ...(q['status'] && { status: q['status'] as never }),
              ...(q['creditStatus'] && { creditStatus: q['creditStatus'] as never }),
            },
            orderBy: { id: 'asc' },
            take: 500,
          }),
        ))
          yield {
            companyCode: co.companyCode,
            legalName: co.legalName,
            taxId: co.taxId,
            status: co.status,
            creditStatus: co.creditStatus,
            paidOrders: co.paidOrdersCount,
            createdAt: iso(co.createdAt),
          };
      })(),
  },
  {
    resource: 'shipments',
    nameTh: 'การจัดส่ง',
    nameEn: 'Shipments',
    permission: 'shipments.read',
    filters: ['status', 'factoryId'],
    columns: [
      c('shipmentNo', 'เลขที่จัดส่ง', 'Shipment no.'),
      c('status', 'สถานะ', 'Status'),
      c('carrier', 'ผู้ขนส่ง', 'Carrier'),
      c('factoryCode', 'โรงงาน', 'Factory'),
      c('postcode', 'รหัสไปรษณีย์', 'Postcode'),
      c('cartons', 'จำนวนกล่อง', 'Cartons', 'integer'),
      c('plannedShipOn', 'วันที่วางแผนส่ง', 'Planned ship date', 'date'),
      c('pickedUpAt', 'รับสินค้า', 'Picked up', 'datetime'),
      c('deliveredAt', 'ส่งมอบ', 'Delivered', 'datetime'),
    ],
    rows: (prisma, q) =>
      (async function* () {
        for await (const s of pages((after) =>
          prisma.shipment.findMany({
            where: {
              id: { gt: after },
              ...(q['status'] && { status: q['status'] as never }),
              ...(q['factoryId'] && { factory: { publicId: q['factoryId'] } }),
            },
            include: { carrier: { select: { code: true } }, factory: { select: { code: true } } },
            orderBy: { id: 'asc' },
            take: 500,
          }),
        ))
          yield {
            shipmentNo: s.shipmentNo,
            status: s.status,
            carrier: s.carrier.code,
            factoryCode: s.factory.code,
            postcode: s.postcode,
            cartons: s.cartonsCount,
            plannedShipOn: day(s.plannedShipOn),
            pickedUpAt: iso(s.pickedUpAt),
            deliveredAt: iso(s.deliveredAt),
          };
      })(),
  },
  {
    resource: 'claims',
    nameTh: 'เคลม',
    nameEn: 'Claims',
    permission: 'claims.read',
    filters: ['status', 'type', 'origin'],
    columns: [
      c('claimNo', 'เลขที่เคลม', 'Claim no.'),
      c('orderCode', 'คำสั่งซื้อ', 'Order'),
      c('type', 'ประเภท', 'Type'),
      c('origin', 'ที่มา', 'Origin'),
      c('status', 'สถานะ', 'Status'),
      c('liability', 'ผู้รับผิดชอบ', 'Liability'),
      c('claimedAmount', 'มูลค่าที่เคลม', 'Claimed amount', 'money'),
      c('submittedAt', 'วันที่ยื่น', 'Submitted', 'datetime'),
      c('decidedAt', 'วันที่ตัดสิน', 'Decided', 'datetime'),
    ],
    rows: (prisma, q) =>
      (async function* () {
        for await (const cl of pages((after) =>
          prisma.claim.findMany({
            where: {
              id: { gt: after },
              ...(q['status'] && { status: q['status'] as never }),
              ...(q['type'] && { type: q['type'] as never }),
              ...(q['origin'] && { origin: q['origin'] as never }),
            },
            include: { order: { select: { orderCode: true } } },
            orderBy: { id: 'asc' },
            take: 500,
          }),
        ))
          yield {
            claimNo: cl.claimNo,
            orderCode: cl.order.orderCode,
            type: cl.type,
            origin: cl.origin,
            status: cl.status,
            liability: cl.liability,
            claimedAmount: money(cl.claimedAmount),
            submittedAt: iso(cl.submittedAt),
            decidedAt: iso(cl.decidedAt),
          };
      })(),
  },
];

export const listExportOf = (resource: string) => LIST_EXPORTS.find((e) => e.resource === resource);
