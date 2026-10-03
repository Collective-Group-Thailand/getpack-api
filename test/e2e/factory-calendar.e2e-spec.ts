import { randomUUID } from 'node:crypto';

import { addCalendarDays, bangkokDate, bangkokDayOfWeek, startOfBangkokDay } from '@common/time/bangkok';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

const OPEN = { from: '08:00', to: '17:00' };

/** The first `dow` (0 = Sunday) on or after `day`. */
function nextDow(day: string, dow: number): string {
  let d = day;
  while (bangkokDayOfWeek(startOfBangkokDay(d)) !== dow) d = addCalendarDays(d, 1);
  return d;
}

/** U2.9 factory hours and closures kept by the factory (D-292, D-209). */
describe('factory hours and closures (e2e, U2.9)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  // Far enough ahead not to move other suites' lead times on the shared dev factory.
  const from = nextDow(addCalendarDays(bangkokDate(new Date()), 500), 1);

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 161);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const put = (t: string, path: string, body: Record<string, unknown>) =>
    as(ctx, t).put(path, body).set('Idempotency-Key', randomUUID());

  it('lets the factory set weekly hours from tomorrow; they replace its weekend (D-292)', async () => {
    const path = `/v1/partner/factories/${fixture.factoryPublicId}/business-hours`;
    const week = {
      mon: OPEN,
      tue: OPEN,
      wed: OPEN,
      thu: OPEN,
      fri: OPEN,
      sat: { from: '08:00', to: '12:00' },
      sun: null,
    };
    await put(owner, path, { effectiveFrom: bangkokDate(new Date()), hours: week }).expect(422);
    await put(owner, path, {
      effectiveFrom: from,
      hours: { ...week, mon: { from: '17:00', to: '08:00' } },
    }).expect(422);
    await put(owner, path, { effectiveFrom: from, hours: { ...week, sat: null } }).expect(200);
    // A version not yet in force is replaced.
    const set = await put(owner, path, { effectiveFrom: from, hours: week }).expect(200);
    expect(set.body).toMatchObject({
      effectiveFrom: from,
      inForce: false,
      hours: { sat: { from: '08:00', to: '12:00' } },
    });

    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
      include: { calendar: true },
    });
    const calendar = await ctx.app.get(BusinessCalendarService).calendar(factory.calendar!.code);
    const saturday = nextDow(from, 6);
    expect(calendar.isWorkingDay(saturday)).toBe(true);
    expect(calendar.isWorkingDay(nextDow(from, 0))).toBe(false);
    expect(calendar.hoursOn(saturday)).toEqual({ from: '08:00', to: '12:00' });
    // Before the version: the weekend as before.
    expect(calendar.isWorkingDay(nextDow(addCalendarDays(from, -7), 6))).toBe(false);

    const staff = await staffToken(ctx, 'admin');
    const listed = await as(ctx, staff)
      .get(`/v1/admin/factories/${fixture.factoryPublicId}/business-hours`)
      .expect(200);
    expect((listed.body as { effectiveFrom: string }[]).map((v) => v.effectiveFrom)).toContain(from);
    const audit = await ctx.prisma.auditLog.count({
      where: { action: 'factory.business_hours_set', resourcePublicId: fixture.factoryPublicId },
    });
    expect(audit).toBeGreaterThanOrEqual(2);
  });

  it('lets the factory close and reopen a day, its own factory only (D-292, D-044)', async () => {
    const day = addCalendarDays(from, 2);
    const base = `/v1/partner/factories/${fixture.factoryPublicId}/closures`;
    await put(owner, `${base}/${bangkokDate(new Date())}`, { nameTh: 'ปิด' }).expect(422);
    await put(owner, `${base}/${day}`, { nameTh: 'ปิดซ่อมบำรุงเครื่องจักร' }).expect(200);
    const closures = await as(ctx, owner).get(`${base}?from=${from}`).expect(200);
    expect((closures.body as { day: string; kind: string }[]).find((c) => c.day === day)).toMatchObject({
      kind: 'closure',
    });
    await as(ctx, owner).delete(`${base}/${day}`).set('Idempotency-Key', randomUUID()).expect(204);

    const other = await ctx.prisma.factory.findFirst({
      where: { publicId: { not: fixture.factoryPublicId } },
    });
    if (other)
      await put(owner, `/v1/partner/factories/${other.publicId}/closures/${day}`, { nameTh: 'ปิด' }).expect(
        404,
      );
  });
});
