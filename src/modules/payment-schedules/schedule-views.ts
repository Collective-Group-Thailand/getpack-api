import { formatMoney, MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';

import {
  type AdminPaymentScheduleDto,
  type InstalmentDto,
  type PaymentScheduleDto,
  type StoreInstalmentDto,
  type TemplateDto,
} from './payment-schedules.dto';
import { type PaymentSchedulesService, type ScheduleRow } from './payment-schedules.service';

type TemplateRow = Awaited<ReturnType<PaymentSchedulesService['templates']>>[number];

type InstalmentRow = ScheduleRow['instalments'][number];
/** An instalment row; its allocations carry what the staff view reads (the customer view reads none). */
type InstalmentBase = Omit<InstalmentRow, 'allocations'> & {
  allocations: {
    grossAmount: InstalmentRow['allocations'][number]['grossAmount'];
    cashAmount: InstalmentRow['allocations'][number]['cashAmount'];
    order: { publicId: string; orderCode: string };
  }[];
};

function instalmentDto(i: InstalmentBase, staff: boolean): InstalmentDto {
  return {
    id: i.publicId,
    seq: i.seq,
    labelTh: i.labelTh,
    labelEn: i.labelEn,
    pct: i.pct.toFixed(4),
    dueTrigger: i.dueTrigger,
    requiredBefore: i.requiredBefore,
    dueAt: i.dueAt ? toBangkokIso(i.dueAt) : null,
    status: i.status,
    grossAmount: i.grossAmount.toFixed(2),
    whtAmount: i.whtAmount.toFixed(2),
    cashAmount: i.cashAmount.toFixed(2),
    paidAmount: i.paidAmount.toFixed(2),
    openAmount: formatMoney(new MoneyDecimal(i.cashAmount.toString()).sub(i.paidAmount.toString())),
    paidAt: i.paidAt ? toBangkokIso(i.paidAt) : null,
    ...(staff && {
      allocations: i.allocations.map((a) => ({
        orderId: a.order.publicId,
        orderCode: a.order.orderCode,
        grossAmount: a.grossAmount.toFixed(2),
        cashAmount: a.cashAmount.toFixed(2),
      })),
    }),
  };
}

type CustomerInstalmentRow = Awaited<ReturnType<PaymentSchedulesService['forCustomer']>>['rows'][number];

const SETTLED = new Set(['paid', 'refunded', 'cancelled']);
const TAKES_PAYMENT = new Set(['waiting_payment', 'in_progress']);

export function storeInstalmentDto(i: CustomerInstalmentRow): StoreInstalmentDto {
  const base = instalmentDto(i, false);
  const group = i.schedule.orderGroup;
  const active = [...i.payments].sort((a, b) => b.payment.createdAt.getTime() - a.payment.createdAt.getTime())[0];
  return {
    ...base,
    groupId: group.publicId,
    groupCode: group.groupCode,
    orders: i.allocations.map((a) => ({ orderId: a.order.publicId, orderCode: a.order.orderCode })),
    activePaymentId: active?.payment.publicId ?? null,
    payable: !SETTLED.has(i.status) && TAKES_PAYMENT.has(group.status) && new MoneyDecimal(base.openAmount).gt(0),
  };
}

export function scheduleDto(row: ScheduleRow, staff = false): PaymentScheduleDto {
  const live = row.instalments.filter((i) => i.status !== 'cancelled');
  const paidFor = (gates: string[]) =>
    live
      .filter((i) => gates.includes(i.requiredBefore))
      .every((i) => i.status === 'paid' || i.status === 'refunded');
  const open = live
    .filter((i) => i.status !== 'paid' && i.status !== 'refunded')
    .reduce((a, i) => a.add(i.cashAmount.toString()).sub(i.paidAmount.toString()), new MoneyDecimal(0));
  return {
    id: row.publicId,
    templateKey: row.templateVersion.template.key,
    templateNameTh: row.templateVersion.template.nameTh,
    templateNameEn: row.templateVersion.template.nameEn,
    isOverride: row.isOverride,
    productionGateOpen: paidFor(['production']),
    shippingGateOpen: paidFor(['production', 'shipping']),
    openAmount: formatMoney(open),
    instalments: (staff ? row.instalments : live).map((i) => instalmentDto(i, staff)),
  };
}

export function adminScheduleDto(row: ScheduleRow): AdminPaymentScheduleDto {
  return { ...scheduleDto(row, true), overrideReason: row.overrideReason };
}

export function templateDto(t: TemplateRow): TemplateDto {
  const v = t.versions[0];
  return {
    key: t.key,
    nameTh: t.nameTh,
    nameEn: t.nameEn,
    versionNo: v?.versionNo ?? null,
    priority: v?.priority ?? null,
    selectionRule: (v?.selectionRule as Record<string, unknown> | undefined) ?? null,
    requiresPermissionToSelect: v?.requiresPermissionToSelect ?? false,
    instalments: (v?.instalments ?? []).map((i) => ({
      labelTh: i.labelTh,
      labelEn: i.labelEn,
      pct: i.pct.toFixed(4),
      dueTrigger: i.dueTrigger,
      dueOffsetDays: i.dueOffsetDays,
      requiredBefore: i.requiredBefore,
    })),
  };
}
