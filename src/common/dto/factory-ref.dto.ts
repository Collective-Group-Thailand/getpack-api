import { ApiProperty } from '@nestjs/swagger';

/** A factory as staff see it: id, staff-facing code and name (never shown to customers, D-050). */
export class FactoryRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003' })
  id!: string;

  @ApiProperty({ example: 'F0001' })
  code!: string;

  @ApiProperty({ example: 'โรงพิมพ์ ทดสอบ' })
  name!: string;
}
