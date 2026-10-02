import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/** A style-library variant code (D-241): base code + `-` + suffix. */
export const STYLE_VARIANT_CODE = /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}-[A-Z2-7]{4,8}$/;

/** Optional `styleVariantCode` on a box configuration (D-243): an unpublishable variant gets no instant price. */
export function StyleVariantField() {
  return applyDecorators(
    ApiPropertyOptional({
      example: 'PK-TE-01-K7QD',
      pattern: STYLE_VARIANT_CODE.source,
      description:
        'The style-library variant this configuration builds (D-241). It must be publishable and belong to the ' +
        'configuration’s pattern; otherwise no quantity is priced instantly (reason `style_variant_not_publishable`, ' +
        'D-243), so the configuration cannot be saved, carted or ordered',
    }),
    IsOptional(),
    IsString(),
    Matches(STYLE_VARIANT_CODE),
  );
}
