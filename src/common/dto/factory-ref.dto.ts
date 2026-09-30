import { ApiProperty } from '@nestjs/swagger';

/** A reference to a coded row with its name: a factory (staff-facing code, D-050), a campaign… */
export class CodedRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000d1003' })
  id!: string;

  @ApiProperty({ example: 'F0001' })
  code!: string;

  @ApiProperty({ example: 'โรงพิมพ์ ทดสอบ' })
  name!: string;
}

/** A factory as staff see it (never shown to customers, D-050). */
export const FactoryRefDto = CodedRefDto;
export type FactoryRefDto = CodedRefDto;
