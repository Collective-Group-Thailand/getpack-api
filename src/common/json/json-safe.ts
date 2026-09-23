import { type Prisma } from '@generated/prisma/client';

/**
 * Converts a value to something `jsonb` accepts: bigint → string, Date → ISO string, objects with
 * `toJSON` (Decimal) → their JSON form, `undefined` fields dropped.
 */
export function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value ?? {}, (_key, inner: unknown) =>
      typeof inner === 'bigint' ? inner.toString() : inner,
    ),
  ) as Prisma.InputJsonValue;
}
