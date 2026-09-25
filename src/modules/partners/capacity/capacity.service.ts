import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate, bangkokDayOfWeek, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';

import { FactoriesService } from '../factories/factories.service';
import { FactoryAccess } from '../factories/factory-access';

/** How far ahead the engine looks for a free week (technical bound, not a business value). */
export const CAPACITY_HORIZON_WEEKS = 52;

export interface WeekCapacity {
  weekStart: string;
  capacity: Prisma.Decimal;
  booked: Prisma.Decimal;
  free: Prisma.Decimal;
  source: 'version' | 'override';
}

export type Availability =
  | { available: true; weekStart: string; earliestDate: string; unit: string; free: string }
  | { available: false; reason: 'capacity_not_configured' | 'beyond_horizon' };

/** Monday (ISO week start, Bangkok) of the week containing `day` (`YYYY-MM-DD`). */
export function mondayOf(day: string): string {
  const dow = bangkokDayOfWeek(startOfBangkokDay(day)); // 0 = Sunday
  return addCalendarDays(day, dow === 0 ? -6 : 1 - dow);
}

/**
 * Weekly capacity per factory × product type (D-101): the capacity version in force at the start of
 * the week, or the week's override; booked load comes from accepted jobs (`capacity_bookings`, written
 * by production in B4.2). `nextAvailable` gives the first week that can take a load and the earliest
 * working day in it (factory calendar, D-161), so lead-time promises never exceed capacity. With no
 * capacity configured the engine refuses to promise (`capacity_not_configured`).
 */
@Injectable()
export class CapacityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
    private readonly calendars: BusinessCalendarService,
  ) {}

  async weeks(
    factoryId: bigint,
    productTypeId: bigint,
    fromDay: string,
    count: number,
    db: Tx = this.prisma,
  ): Promise<WeekCapacity[]> {
    const firstWeek = mondayOf(fromDay);
    const weekStarts = Array.from({ length: count }, (_, i) => addCalendarDays(firstWeek, i * 7));
    const [versions, overrides, bookings] = await Promise.all([
      db.factoryCapacityVersion.findMany({
        where: { capacity: { factoryId, productTypeId }, status: 'approved' },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      }),
      db.factoryCapacityOverride.findMany({
        where: {
          factoryId,
          productTypeId,
          weekStart: { gte: new Date(firstWeek), lte: new Date(weekStarts.at(-1)!) },
        },
      }),
      db.capacityBooking.groupBy({
        by: ['weekStart'],
        where: {
          factoryId,
          productTypeId,
          releasedAt: null,
          weekStart: { gte: new Date(firstWeek), lte: new Date(weekStarts.at(-1)!) },
        },
        _sum: { load: true },
      }),
    ]);
    const result: WeekCapacity[] = [];
    for (const weekStart of weekStarts) {
      const override = overrides.find((o) => o.weekStart.toISOString().slice(0, 10) === weekStart);
      const at = startOfBangkokDay(weekStart);
      const version = versions.find((v) => v.effectiveFrom.getTime() <= at.getTime());
      const capacity = override?.capacity ?? version?.weeklyCapacity;
      if (capacity === undefined) continue;
      const booked =
        bookings.find((b) => b.weekStart.toISOString().slice(0, 10) === weekStart)?._sum.load ??
        new Prisma.Decimal(0);
      result.push({
        weekStart,
        capacity,
        booked,
        free: Prisma.Decimal.max(capacity.minus(booked), 0),
        source: override ? 'override' : 'version',
      });
    }
    return result;
  }

  async nextAvailable(
    factoryId: bigint,
    productTypeId: bigint,
    load: Prisma.Decimal | number | string,
    from: Date = new Date(),
    db: Tx = this.prisma,
  ): Promise<Availability> {
    const need = new Prisma.Decimal(load);
    const fromDay = bangkokDate(from);
    const configured = await db.factoryCapacityVersion.count({
      where: { capacity: { factoryId, productTypeId }, status: 'approved' },
    });
    if (configured === 0) return { available: false, reason: 'capacity_not_configured' };
    const unit =
      (
        await db.factoryCapacityVersion.findFirst({
          where: { capacity: { factoryId, productTypeId }, status: 'approved' },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        })
      )?.capacityUnit ?? 'jobs';
    const weeks = await this.weeks(factoryId, productTypeId, fromDay, CAPACITY_HORIZON_WEEKS, db);
    const factory = await db.factory.findUniqueOrThrow({
      where: { id: factoryId },
      include: { calendar: true },
    });
    const calendar = await this.calendars.calendar(factory.calendar?.code);
    for (const week of weeks) {
      if (week.free.lt(need)) continue;
      // The earliest working day of that week, not before today.
      let day = week.weekStart < fromDay ? fromDay : week.weekStart;
      const weekEnd = addCalendarDays(week.weekStart, 6);
      while (day <= weekEnd && !calendar.isWorkingDay(day)) day = addCalendarDays(day, 1);
      if (day > weekEnd) continue;
      return {
        available: true,
        weekStart: week.weekStart,
        earliestDate: day,
        unit,
        free: week.free.toFixed(3),
      };
    }
    return { available: false, reason: 'beyond_horizon' };
  }

  // --- API ------------------------------------------------------------------------------------------

  async overview(
    actor: Actor,
    factoryPublicId: string,
    productTypePublicId: string,
    fromDay: string,
    count: number,
  ) {
    const factory = await this.access.factory(actor, factoryPublicId);
    const type = await this.prisma.productType.findUnique({ where: { publicId: productTypePublicId } });
    if (!type) throw new DomainException('http.not_found');
    return this.weeks(factory.id, type.id, fromDay, count);
  }

  async setOverride(
    actor: UserActor,
    factoryPublicId: string,
    input: { productTypeId: string; weekStart: string; capacity: number; reason: string },
  ) {
    const factory = await this.access.factory(actor, factoryPublicId);
    if (mondayOf(input.weekStart) !== input.weekStart) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'weekStart', code: 'monday', message: 'weekStart must be a Monday' }],
      });
    }
    return this.prisma.withTx(async (tx) => {
      const type = await tx.productType.findUnique({ where: { publicId: input.productTypeId } });
      if (!type) {
        throw new DomainException('validation.failed', {
          errors: [{ path: 'productTypeId', code: 'exists', message: 'productTypeId does not exist' }],
        });
      }
      const weekStart = new Date(input.weekStart);
      const row = await tx.factoryCapacityOverride.upsert({
        where: {
          factoryId_productTypeId_weekStart: { factoryId: factory.id, productTypeId: type.id, weekStart },
        },
        create: {
          factoryId: factory.id,
          productTypeId: type.id,
          weekStart,
          capacity: new Prisma.Decimal(input.capacity),
          reason: input.reason,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        update: {
          capacity: new Prisma.Decimal(input.capacity),
          reason: input.reason,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await this.factories.record(tx, factory.publicId, 'factory.capacity_override_set', {
        productTypeId: type.publicId,
        weekStart: input.weekStart,
        capacity: row.capacity.toFixed(3),
      });
      return this.weeks(factory.id, type.id, input.weekStart, 1, tx);
    });
  }
}
