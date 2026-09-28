import { type Prisma } from '@generated/prisma/client';

import { paged, type ReportDefinition } from '../report-types';
import { bangkokRange, col, day, iso, money } from './helpers';

const CHANNELS = ['web', 'cs', 'line', 'b2b'] as const;
const ORDER_STATUSES = [
  'waiting_payment',
  'paid_for_production',
  'artwork_approved',
  'in_production',
  'shipping',
  'completed',
  'cancelled',
] as const;

/** Sales register: every order (one per configuration) of the groups placed in the period, with its amounts. */
export const SALES_REPORT: ReportDefinition = {
  key: 'sales',
  nameTh: 'รายงานยอดขาย',
  nameEn: 'Sales register',
  description:
    'Every order of the order groups placed in the period: channel, customer, product type, quantity and the amount set (net, discount, shipping, VAT, gross, expected WHT).',
  decisions: ['D-010', 'D-020'],
  permission: 'orders.read',
  filters: [
    { key: 'period', kind: 'range', required: true },
    { key: 'channel', kind: 'enum', required: false, values: CHANNELS },
    { key: 'productTypeId', kind: 'uuid', required: false },
  ],
  columns: [
    col('placedAt', 'วันที่สั่งซื้อ', 'Placed at', 'datetime'),
    col('groupCode', 'เลขที่กลุ่มคำสั่งซื้อ', 'Order group'),
    col('orderCode', 'เลขที่คำสั่งซื้อ', 'Order'),
    col('channel', 'ช่องทาง', 'Channel'),
    col('customerCode', 'รหัสลูกค้า', 'Customer code'),
    col('companyCode', 'รหัสบริษัท', 'Company code'),
    col('productType', 'ประเภทสินค้า', 'Product type'),
    col('quantity', 'จำนวน', 'Quantity', 'integer'),
    col('unit', 'หน่วย', 'Unit'),
    col('net', 'มูลค่าก่อนภาษี', 'Net', 'money'),
    col('discount', 'ส่วนลด', 'Discount', 'money'),
    col('shipping', 'ค่าขนส่ง', 'Shipping (net)', 'money'),
    col('vat', 'ภาษีมูลค่าเพิ่ม', 'VAT', 'money'),
    col('gross', 'รวมทั้งสิ้น', 'Gross', 'money'),
    col('wht', 'ภาษีหัก ณ ที่จ่าย (คาด)', 'Expected WHT', 'money'),
    col('status', 'สถานะคำสั่งซื้อ', 'Order status'),
    col('groupStatus', 'สถานะกลุ่ม', 'Group status'),
  ],
  async *rows({ prisma, filters }) {
    const where: Prisma.OrderWhereInput = {
      orderGroup: {
        placedAt: bangkokRange(filters),
        ...(filters.channel && { channel: filters.channel as (typeof CHANNELS)[number] }),
      },
      ...(filters.productTypeId && { productType: { publicId: filters.productTypeId } }),
    };
    for await (const o of paged((after, take) =>
      prisma.order.findMany({
        where: { ...where, id: { gt: after } },
        include: {
          orderGroup: {
            select: {
              groupCode: true,
              placedAt: true,
              channel: true,
              status: true,
              company: { select: { companyCode: true } },
            },
          },
          customer: { select: { customerProfile: { select: { customerCode: true } } } },
          productType: { select: { code: true } },
        },
        orderBy: { id: 'asc' },
        take,
      }),
    ))
      yield {
        placedAt: iso(o.orderGroup.placedAt),
        groupCode: o.orderGroup.groupCode,
        orderCode: o.orderCode,
        channel: o.orderGroup.channel,
        customerCode: o.customer.customerProfile?.customerCode ?? null,
        companyCode: o.orderGroup.company?.companyCode ?? null,
        productType: o.productType.code,
        quantity: o.quantityOrdered,
        unit: o.unit,
        net: money(o.netAmount),
        discount: money(o.discountAmount),
        shipping: money(o.shippingNetAmount),
        vat: money(o.vatAmount),
        gross: money(o.grossAmount),
        wht: money(o.whtAmount),
        status: o.status,
        groupStatus: o.orderGroup.status,
      };
  },
};

/** Orders pipeline: where each order of the period stands, with its milestone dates. */
export const ORDERS_REPORT: ReportDefinition = {
  key: 'orders',
  nameTh: 'รายงานสถานะคำสั่งซื้อ',
  nameEn: 'Orders pipeline',
  description:
    'Orders placed in the period with their status, artwork status, milestone dates (paid, artwork approved, production, shipped, delivered, completed), promised ship date and producing factory.',
  decisions: ['D-073', 'D-081'],
  permission: 'orders.read',
  filters: [
    { key: 'period', kind: 'range', required: true },
    { key: 'status', kind: 'enum', required: false, values: ORDER_STATUSES },
    { key: 'channel', kind: 'enum', required: false, values: CHANNELS },
  ],
  columns: [
    col('orderCode', 'เลขที่คำสั่งซื้อ', 'Order'),
    col('groupCode', 'เลขที่กลุ่มคำสั่งซื้อ', 'Order group'),
    col('placedAt', 'วันที่สั่งซื้อ', 'Placed at', 'datetime'),
    col('channel', 'ช่องทาง', 'Channel'),
    col('productType', 'ประเภทสินค้า', 'Product type'),
    col('quantityOrdered', 'จำนวนสั่ง', 'Ordered', 'integer'),
    col('quantityDelivered', 'จำนวนส่งมอบ', 'Delivered', 'integer'),
    col('status', 'สถานะ', 'Status'),
    col('artworkStatus', 'สถานะอาร์ตเวิร์ก', 'Artwork status'),
    col('paidForProductionAt', 'ชำระพร้อมผลิต', 'Paid for production', 'datetime'),
    col('artworkApprovedAt', 'อนุมัติอาร์ตเวิร์ก', 'Artwork approved', 'datetime'),
    col('productionStartedAt', 'เริ่มผลิต', 'Production started', 'datetime'),
    col('promisedShipDate', 'วันส่งที่สัญญา', 'Promised ship date', 'date'),
    col('shippedAt', 'จัดส่ง', 'Shipped', 'datetime'),
    col('deliveredAt', 'ส่งถึง', 'Delivered', 'datetime'),
    col('completedAt', 'เสร็จสมบูรณ์', 'Completed', 'datetime'),
    col('cancelledAt', 'ยกเลิก', 'Cancelled', 'datetime'),
    col('factoryCode', 'โรงงาน', 'Factory'),
  ],
  async *rows({ prisma, filters }) {
    const where: Prisma.OrderWhereInput = {
      orderGroup: {
        placedAt: bangkokRange(filters),
        ...(filters.channel && { channel: filters.channel as (typeof CHANNELS)[number] }),
      },
      ...(filters.status && { status: filters.status as (typeof ORDER_STATUSES)[number] }),
    };
    for await (const o of paged((after, take) =>
      prisma.order.findMany({
        where: { ...where, id: { gt: after } },
        include: {
          orderGroup: { select: { groupCode: true, placedAt: true, channel: true } },
          productType: { select: { code: true } },
          selectedFactory: { select: { code: true } },
        },
        orderBy: { id: 'asc' },
        take,
      }),
    ))
      yield {
        orderCode: o.orderCode,
        groupCode: o.orderGroup.groupCode,
        placedAt: iso(o.orderGroup.placedAt),
        channel: o.orderGroup.channel,
        productType: o.productType.code,
        quantityOrdered: o.quantityOrdered,
        quantityDelivered: o.quantityDelivered,
        status: o.status,
        artworkStatus: o.artworkStatus,
        paidForProductionAt: iso(o.paidForProductionAt),
        artworkApprovedAt: iso(o.artworkApprovedAt),
        productionStartedAt: iso(o.productionStartedAt),
        promisedShipDate: day(o.promisedShipDate),
        shippedAt: iso(o.shippedAt),
        deliveredAt: iso(o.deliveredAt),
        completedAt: iso(o.completedAt),
        cancelledAt: iso(o.cancelledAt),
        factoryCode: o.selectedFactory?.code ?? null,
      };
  },
};

/** Saved quotations (instant and RFQ) of the period. */
export const QUOTATIONS_REPORT: ReportDefinition = {
  key: 'quotations',
  nameTh: 'รายงานใบเสนอราคา',
  nameEn: 'Quotations',
  description:
    'Quotations saved in the period (instant and from RFQs): quantities, the gross of each quantity, status, validity (D-051) and conversion to an order.',
  decisions: ['D-051', 'D-100'],
  permission: 'quotes.read',
  filters: [
    { key: 'period', kind: 'range', required: true },
    { key: 'channel', kind: 'enum', required: false, values: CHANNELS },
    { key: 'productTypeId', kind: 'uuid', required: false },
  ],
  columns: [
    col('quoteCode', 'เลขที่ใบเสนอราคา', 'Quotation'),
    col('createdAt', 'วันที่', 'Created at', 'datetime'),
    col('channel', 'ช่องทาง', 'Channel'),
    col('source', 'ที่มา', 'Source'),
    col('customerCode', 'รหัสลูกค้า', 'Customer code'),
    col('productType', 'ประเภทสินค้า', 'Product type'),
    col('quantities', 'จำนวน', 'Quantities'),
    col('grossAmounts', 'ราคารวม (ต่อจำนวน)', 'Gross per quantity'),
    col('status', 'สถานะ', 'Status'),
    col('validUntil', 'ใช้ได้ถึง', 'Valid until', 'datetime'),
    col('convertedAt', 'เป็นคำสั่งซื้อเมื่อ', 'Converted at', 'datetime'),
  ],
  async *rows({ prisma, filters }) {
    const where: Prisma.QuoteWhereInput = {
      createdAt: bangkokRange(filters),
      ...(filters.channel && { channel: filters.channel as (typeof CHANNELS)[number] }),
      ...(filters.productTypeId && { productType: { publicId: filters.productTypeId } }),
    };
    for await (const q of paged((after, take) =>
      prisma.quote.findMany({
        where: { ...where, id: { gt: after } },
        include: {
          options: { select: { quantity: true, grossAmount: true }, orderBy: { quantity: 'asc' } },
          productType: { select: { code: true } },
          customer: { select: { customerProfile: { select: { customerCode: true } } } },
        },
        orderBy: { id: 'asc' },
        take,
      }),
    ))
      yield {
        quoteCode: q.quoteCode,
        createdAt: iso(q.createdAt),
        channel: q.channel,
        source: q.source,
        customerCode: q.customer?.customerProfile?.customerCode ?? null,
        productType: q.productType.code,
        quantities: q.options.map((o) => o.quantity).join(' / '),
        grossAmounts: q.options.map((o) => o.grossAmount.toFixed(2)).join(' / '),
        status: q.status,
        validUntil: iso(q.validUntil),
        convertedAt: iso(q.convertedAt),
      };
  },
};
