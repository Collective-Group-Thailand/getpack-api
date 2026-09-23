import { WorkingDayCalendar } from '@common/time/working-days';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

/** The national calendar keyed in by admins once a year (D-161). */
export const NATIONAL_CALENDAR_CODE = 'th_public';

const CACHE_TTL_MS = 5 * 60_000;

/**
 * Loads business calendars for SLA and lead-time maths (D-061, D-071, D-074, D-161). A factory
 * calendar inherits the national holidays through `base_calendar_id` and adds its own closures.
 * Only holidays observed by `all` make a day non-working; government-only and financial-institution
 * days are recorded but still count as working days for factories (D-161).
 */
@Injectable()
export class BusinessCalendarService {
  private readonly cache = new Map<string, { calendar: WorkingDayCalendar; loadedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async calendar(code: string = NATIONAL_CALENDAR_CODE): Promise<WorkingDayCalendar> {
    const cached = this.cache.get(code);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.calendar;

    const own = await this.prisma.businessCalendar.findUnique({
      where: { code },
      include: { days: true, baseCalendar: { include: { days: true } } },
    });
    if (!own) throw new Error(`Business calendar ${code} does not exist`);

    const nonWorking = new Set<string>();
    const extraWorking = new Set<string>();
    for (const day of [...(own.baseCalendar?.days ?? []), ...own.days]) {
      const key = day.day.toISOString().slice(0, 10);
      if (day.kind === 'extra_working_day') {
        extraWorking.add(key);
        nonWorking.delete(key);
      } else if (day.kind === 'closure' || day.observance === 'all') {
        nonWorking.add(key);
        extraWorking.delete(key);
      }
    }
    const calendar = new WorkingDayCalendar({ weekendDays: own.weekendDays, nonWorking, extraWorking });
    this.cache.set(code, { calendar, loadedAt: Date.now() });
    return calendar;
  }

  /** Called when admins change calendar days. */
  invalidate(code?: string): void {
    if (code) this.cache.delete(code);
    else this.cache.clear();
  }
}
