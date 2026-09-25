import { Prisma } from '@generated/prisma/client';

/** Drops `undefined` values (PATCH: absent = unchanged; `null` = clear). */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Value for a nullable `jsonb` column: `null` must be `Prisma.DbNull`, `undefined` leaves it unchanged. */
export function jsonField(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}
