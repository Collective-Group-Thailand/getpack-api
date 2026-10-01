import { type Tx } from '@database/prisma.service';
import { NATIONAL_CALENDAR_CODE } from '@platform/calendar/business-calendar.service';

import { type ImportKind, type ParsedRow, type PlannedRow } from './import-engine';

/**
 * National holidays loaded once a year by Excel (D-161, D-170; B6.3 launch gap): one sheet `holidays` keyed by the
 * day, into the national calendar every factory shares. Rows are created or updated; nothing is deleted by an
 * import (remove a day with `admin.calendar.removeHoliday`).
 */
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

async function nationalId(db: Tx): Promise<bigint> {
  return (await db.businessCalendar.findUniqueOrThrow({ where: { code: NATIONAL_CALENDAR_CODE } })).id;
}

export const nationalHolidaysImport: ImportKind = {
  key: 'national_holidays',
  label: 'National holidays and extra working days (one year at a time)',
  sheets: [
    {
      name: 'holidays',
      columns: [
        {
          header: 'day',
          field: 'day',
          type: 'text',
          required: true,
          max: 10,
          pattern: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
          description: 'YYYY-MM-DD',
        },
        {
          header: 'kind',
          field: 'kind',
          type: 'enum',
          required: true,
          values: ['holiday', 'extra_working_day'],
        },
        {
          header: 'observance',
          field: 'observance',
          type: 'enum',
          required: true,
          values: ['all', 'government_only', 'financial_institutions'],
          description: 'Only `all` stops factory lead times and SLAs (D-161)',
        },
        { header: 'name_th', field: 'nameTh', type: 'text', required: true, max: 200 },
        { header: 'name_en', field: 'nameEn', type: 'text', nullable: true, max: 200 },
      ],
      key: ['day'],
      existing: async (db: Tx, rows: ParsedRow[]) => {
        const calendarId = await nationalId(db);
        const days = await db.businessCalendarDay.findMany({
          where: { calendarId, day: { in: rows.map((r) => asDate(r.key)) } },
        });
        return new Map(
          days.map((d) => {
            const day = d.day.toISOString().slice(0, 10);
            return [
              day,
              {
                id: d.id,
                values: { day, kind: d.kind, observance: d.observance, nameTh: d.nameTh, nameEn: d.nameEn },
              },
            ];
          }),
        );
      },
      apply: async (db: Tx, rows: PlannedRow[], actorUserId: bigint) => {
        const calendarId = await nationalId(db);
        for (const row of rows) {
          const data = {
            kind: row.data['kind'] as 'holiday' | 'extra_working_day',
            observance: row.data['observance'] as 'all' | 'government_only' | 'financial_institutions',
            nameTh: row.data['nameTh'] as string,
            nameEn: (row.data['nameEn'] as string | null | undefined) ?? null,
          };
          if (row.action === 'create')
            await db.businessCalendarDay.create({
              data: {
                calendarId,
                day: asDate(row.key),
                ...data,
                createdById: actorUserId,
                updatedById: actorUserId,
              },
            });
          else if (row.action === 'update')
            await db.businessCalendarDay.update({
              where: { id: row.existing!.id! },
              data: { ...data, updatedById: actorUserId },
            });
        }
      },
      exportRows: async (db: Tx) => {
        const calendarId = await nationalId(db);
        const days = await db.businessCalendarDay.findMany({
          where: { calendarId },
          orderBy: { day: 'asc' },
        });
        return days.map((d) => ({
          day: d.day.toISOString().slice(0, 10),
          kind: d.kind,
          observance: d.observance,
          name_th: d.nameTh,
          name_en: d.nameEn,
        }));
      },
      compare: ['kind', 'observance', 'nameTh', 'nameEn'],
    },
  ],
};
