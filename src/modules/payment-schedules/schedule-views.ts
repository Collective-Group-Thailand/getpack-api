import { formatMoney, MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';

import {
  type AdminPaymentScheduleDto,
  type InstalmentDto,
  type PaymentScheduleDto,
  type TemplateDto,
} from './payment-schedules.dto';
import { type PaymentSchedulesService, type ScheduleRow } from './payment-schedules.service';

type TemplateRow = Awaited<ReturnType<PaymentSchedulesService['templates']>>[number];

function instalmentDto(i: ScheduleRow['instalments'][number], staff: boolean): InstalmentDto {
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

export function scheduleDto(row: ScheduleRow, staff = false): PaymentScheduleDto {
  const live = row.instalments.filter((i) => i.status !== 'cancelled');
  const paidFor = (gates: string[]) =>
    live.filter((i) => gates.includes(i.requiredBefore)).every((i) => i.status === 'paid' || i.status === 'refunded');
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
