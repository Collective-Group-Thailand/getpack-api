import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One field-level error inside a problem (e.g. from validation). */
export class ProblemFieldError {
  /** Path of the offending field, e.g. `items[0].quantity`. */
  @ApiProperty({ example: 'items[0].quantity' })
  path!: string;

  /** Machine-readable rule that failed, e.g. `min`, `isUuid`. */
  @ApiProperty({ example: 'min' })
  code!: string;

  @ApiProperty({ example: 'quantity must not be less than 1' })
  message!: string;
}

/**
 * Extension members a problem may carry (RFC 9457 §3.2). Each is published on `ProblemDetails`
 * and set only by the codes named in its description.
 */
export interface ProblemExtensions {
  attemptsRemaining?: number;
}

/** RFC 9457 problem details, served as `application/problem+json` (contract §3). */
export class ProblemDetails {
  @ApiProperty({ example: 'https://errors.getpack/order.invalid_transition' })
  type!: string;

  @ApiProperty({ example: 'Invalid order transition' })
  title!: string;

  @ApiProperty({ type: 'integer', example: 422 })
  status!: number;

  /** Stable machine-readable code; never renamed. */
  @ApiProperty({ example: 'order.invalid_transition' })
  code!: string;

  /** Localised by `Accept-Language` (`th` default, `en`). */
  @ApiProperty({ example: 'ไม่สามารถเปลี่ยนสถานะคำสั่งซื้อได้' })
  detail!: string;

  @ApiPropertyOptional({ type: () => [ProblemFieldError] })
  errors?: ProblemFieldError[];

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    example: 4,
    description: '`auth.otp_invalid` only: codes that may still be tried on this challenge (D-143)',
  })
  attemptsRemaining?: number;

  @ApiProperty({ example: '6f1c2d8e-2c7b-4d0e-9d1c-3f1a2b3c4d5e' })
  requestId!: string;
}
