import { systemActor } from '@common/context/actor';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type TaxReport } from '@generated/prisma/client';
import { addMonths, dateOnly, dayOf } from '@modules/ledger/ledger-dates';
import { PeriodsService } from '@modules/ledger/periods.service';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingsService } from '@platform/settings/settings.service';

const FORMS = ['pp30', 'pnd3', 'pnd53'] as const;
type Form = (typeof FORMS)[number];
type Calendar = Record<Form, { dayOfNextMonth: number }> & { reminderDaysBefore: number };
const ACTOR = systemActor('tax.calendar');
const DAY_MS = 86_400_000;

/**
 * The tax calendar (accounting-design §6): for each month the ภ.พ.30, ภ.ง.ด.3 and ภ.ง.ด.53 due dates from the
 * setting `tax.calendar` (the version in force at the month's end), a reminder event `reminderDaysBefore` days
 * ahead, done when the return is filed.
 */
@Injectable()
export class TaxCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: EntitiesService,
    private readonly periods: PeriodsService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
  ) {}

  /** Items of the month before `today` (their returns fall due this month). Idempotent. */
  async ensure(today = bangkokDate(new Date())): Promise<number> {
    const entityId = await this.entities.defaultEntityId();
    const period = await this.periods.periodOf(entityId, addMonths(`${today.slice(0, 7)}-01`, -1));
    const calendar = (await this.settings.at('tax.calendar', { at: period.endDate })).value as Calendar;
    const nextMonth = addMonths(dayOf(period.startDate), 1);
    let created = 0;
    for (const kind of FORMS) {
      const due = new Date(dateOnly(nextMonth).getTime() + (calendar[kind].dayOfNextMonth - 1) * DAY_MS);
      const result = await this.prisma.taxCalendarItem.createMany({
        data: [{ entityId, kind, fiscalPeriodId: period.id, dueOn: due }],
        skipDuplicates: true,
      });
      created += result.count;
    }
    return created;
  }

  /** One reminder per open item entering its reminder window (event `tax_calendar.due_soon`). */
  async remind(today = bangkokDate(new Date())): Promise<number> {
    const calendar = (await this.settings.at('tax.calendar')).value as Calendar;
    const horizon = new Date(dateOnly(today).getTime() + calendar.reminderDaysBefore * DAY_MS);
    const due = await this.prisma.taxCalendarItem.findMany({
      where: { status: 'open', remindedAt: null, dueOn: { lte: horizon } },
      include: { fiscalPeriod: true },
    });
    for (const item of due)
      await this.prisma.withTx(async (tx) => {
        const claimed = await tx.taxCalendarItem.updateMany({
          where: { id: item.id, remindedAt: null },
          data: { remindedAt: new Date() },
        });
        if (claimed.count === 0) return;
        await this.events.record(
          tx,
          {
            type: 'tax_calendar.due_soon',
            aggregateType: 'tax_calendar_item',
            aggregateId: item.publicId,
            entityId: item.entityId,
            payload: {
              itemId: item.publicId,
              kind: item.kind,
              periodLabel: dayOf(item.fiscalPeriod.startDate).slice(0, 7),
              dueOn: dayOf(item.dueOn),
              overdue: dayOf(item.dueOn) < today,
            },
          },
          ACTOR,
        );
      });
    return due.length;
  }

  async markDone(tx: Tx, report: TaxReport): Promise<void> {
    if (!(FORMS as readonly string[]).includes(report.kind)) return;
    const item = await tx.taxCalendarItem.findUnique({
      where: {
        entityId_kind_fiscalPeriodId: {
          entityId: report.entityId,
          kind: report.kind,
          fiscalPeriodId: report.fiscalPeriodId,
        },
      },
    });
    if (item)
      await tx.taxCalendarItem.update({
        where: { id: item.id },
        data: { status: 'done', doneAt: new Date(), taxReportId: report.id },
      });
    else {
      const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: report.fiscalPeriodId } });
      await tx.taxCalendarItem.create({
        data: {
          entityId: report.entityId,
          kind: report.kind,
          fiscalPeriodId: report.fiscalPeriodId,
          dueOn: dateOnly(addMonths(dayOf(period.startDate), 1)),
          status: 'done',
          doneAt: new Date(),
          taxReportId: report.id,
        },
      });
    }
  }

  async list(status?: 'open' | 'done') {
    return this.prisma.taxCalendarItem.findMany({
      where: status ? { status } : {},
      include: {
        fiscalPeriod: { select: { startDate: true } },
        taxReport: { select: { publicId: true, status: true } },
      },
      orderBy: [{ dueOn: 'desc' }, { kind: 'asc' }],
      take: 120,
    });
  }
}
