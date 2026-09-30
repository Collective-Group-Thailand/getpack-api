import { ApiProperty } from '@nestjs/swagger';

/** A reference to a coded master-data row with its Thai and English names (geography, catalogue options). */
export class CodeNameRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-0000000c0004' })
  id!: string;

  @ApiProperty({ example: '10' })
  code!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  nameTh!: string;

  @ApiProperty({ example: 'Bangkok' })
  nameEn!: string;
}
