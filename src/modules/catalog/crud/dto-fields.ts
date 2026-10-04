import { type Prisma } from '@generated/prisma/client';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Decimal column → JSON number (dimensions and factors are numbers, contract §3). */
export const num = (value: Prisma.Decimal | null | undefined): number | null =>
  value === null || value === undefined ? null : value.toNumber();

export const CATALOG_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export type CatalogStatusValue = (typeof CATALOG_STATUSES)[number];
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ContentStatusValue = (typeof CONTENT_STATUSES)[number];

/** snake_case keys checked by the database (`ck_*__code`): product categories, types, print types. */
export const SNAKE_CODE = /^[a-z][a-z0-9_]*$/;
/** Catalogue codes (materials, finishes, flutes …): letters, digits, `_ . -`. */
export const CATALOG_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** URL slugs checked by the database (`ck_*__slug`). */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface FieldOptions {
  example: unknown;
  description?: string;
  /** Required on create (the update DTO makes everything optional). */
  optional?: boolean;
  /** Still accepted, kept until U-B5 (the replacement is named in the description). */
  deprecated?: boolean;
}

/** Swagger options only (validation-only keys such as `min`, `scale` or `unit` must not leak into the contract). */
const DOC_KEYS = [
  'example',
  'description',
  'nullable',
  'type',
  'format',
  'enum',
  'enumName',
  'pattern',
  'minimum',
  'maximum',
  'deprecated',
] as const;
const doc = (o: FieldOptions & Partial<Record<(typeof DOC_KEYS)[number], unknown>>) => {
  const source = o as unknown as Record<string, unknown>;
  const options = Object.fromEntries(
    DOC_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
  return o.optional ? ApiPropertyOptional(options) : ApiProperty(options);
};

const maybe = (optional: boolean | undefined) => (optional ? [IsOptional()] : []);

export function CodeField(o: FieldOptions & { pattern?: RegExp } = { example: 'art-card-350' }) {
  const pattern = o.pattern ?? CATALOG_CODE;
  return applyDecorators(
    doc({ ...o, type: String, pattern: pattern.source }),
    ...maybe(o.optional),
    IsString(),
    MinLength(1),
    MaxLength(64),
    Matches(pattern),
  );
}

export function SlugField(o: FieldOptions) {
  return applyDecorators(
    doc({ ...o, type: String, pattern: SLUG.source }),
    ...maybe(o.optional),
    IsString(),
    MaxLength(120),
    Matches(SLUG),
  );
}

export function TextField(o: FieldOptions & { max?: number; nullable?: boolean }) {
  return applyDecorators(
    doc({ ...o, type: String, nullable: o.nullable }),
    ...maybe(o.optional || o.nullable),
    IsString(),
    ...(o.nullable ? [] : [MinLength(1)]),
    MaxLength(o.max ?? 200),
  );
}

export function UrlField(o: FieldOptions & { nullable?: boolean }) {
  return applyDecorators(
    doc({
      ...o,
      type: String,
      nullable: o.nullable,
      pattern: '^(https://|/)',
      description: o.description ?? 'An https:// URL or a site path',
    }),
    ...maybe(o.optional || o.nullable),
    IsString(),
    MaxLength(2000),
    Matches(/^(https:\/\/|\/)/, { message: '$property must be an https:// URL or a site path' }),
  );
}

export function RefField(o: FieldOptions & { nullable?: boolean }) {
  return applyDecorators(
    doc({ ...o, type: String, format: 'uuid', nullable: o.nullable }),
    ...maybe(o.optional || o.nullable),
    IsUUID(),
  );
}

export function EnumField(
  values: readonly string[],
  enumName: string,
  o: FieldOptions & { nullable?: boolean },
) {
  return applyDecorators(
    doc({ ...o, enum: values, enumName, nullable: o.nullable }),
    ...maybe(o.optional || o.nullable),
    IsIn(values),
  );
}

export function StatusField(o: FieldOptions = { example: 'active', optional: true }) {
  return EnumField(CATALOG_STATUSES, 'CatalogStatus', {
    ...o,
    description: o.description ?? '`archived` replaces deletion (schema-design §1.6)',
  });
}

export function ContentStatusField(o: FieldOptions = { example: 'published', optional: true }) {
  return EnumField(CONTENT_STATUSES, 'ContentStatus', o);
}

export function BoolField(o: FieldOptions) {
  return applyDecorators(doc({ ...o, type: Boolean }), ...maybe(o.optional), IsBoolean());
}

export function IntField(o: FieldOptions & { min?: number; max?: number; nullable?: boolean }) {
  return applyDecorators(
    doc({ ...o, type: 'integer', minimum: o.min, maximum: o.max, nullable: o.nullable }),
    ...maybe(o.optional || o.nullable),
    Type(() => Number),
    IsInt(),
    ...(o.min !== undefined ? [Min(o.min)] : []),
    ...(o.max !== undefined ? [Max(o.max)] : []),
  );
}

export function SortField() {
  return IntField({
    example: 10,
    optional: true,
    min: 0,
    max: 100_000,
    description: 'Display order (ascending)',
  });
}

/** Non-negative decimal number (millimetres, gsm, factors) with at most `scale` decimals. */
export function DecimalField(
  o: FieldOptions & { scale?: number; nullable?: boolean; positive?: boolean; unit?: string },
) {
  return applyDecorators(
    doc({
      ...o,
      type: Number,
      nullable: o.nullable,
      minimum: 0,
      description:
        [o.description, o.unit ? `Unit: ${o.unit}.` : undefined].filter(Boolean).join(' ') || undefined,
    }),
    ...maybe(o.optional || o.nullable),
    Type(() => Number),
    IsNumber({ maxDecimalPlaces: o.scale ?? 2, allowNaN: false, allowInfinity: false }),
    Min(o.positive ? 0.0001 : 0),
    Max(99_999_999),
  );
}

/** Read-only response fields shared by every catalogue DTO. */
export function IdField(example: string) {
  return ApiProperty({ type: String, format: 'uuid', example });
}

export function TimestampField(example = '2026-09-25T10:00:00+07:00') {
  return ApiProperty({ type: String, format: 'date-time', example });
}
