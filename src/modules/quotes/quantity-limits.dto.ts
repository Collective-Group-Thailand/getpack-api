import { ApiProperty } from '@nestjs/swagger';

/**
 * A catalogue product's quantity limits (`quantity_min` / `quantity_max`; null = not set) — shared by the reorder
 * preview (D-153) and the cart (D-452); one schema in the contract.
 */
export class ReorderQuantityLimitsDto {
  @ApiProperty({ type: 'integer', nullable: true, example: 500 })
  min!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 100000 })
  max!: number | null;
}
