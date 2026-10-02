import { ApiProperty } from '@nestjs/swagger';

import { StyleReasonCountDto } from './styles-admin.dto';

/** Style-library coverage (U3.B3, D-243, D-244, D-201): what the network can and cannot make yet. */

export class CategoryCoverageDto {
  @ApiProperty({ example: 'folding_carton' })
  category!: string;

  @ApiProperty({ type: 'integer', example: 40 })
  bases!: number;

  @ApiProperty({ type: 'integer', example: 525, description: 'Active variants' })
  variants!: number;

  @ApiProperty({ type: 'integer', example: 120 })
  publishable!: number;

  @ApiProperty({ type: 'integer', example: 300, description: 'At least one active partner can make it' })
  makeable!: number;

  @ApiProperty({
    type: 'integer',
    example: 225,
    description: 'No active partner can make it yet (recruitment targets)',
  })
  notMakeable!: number;

  @ApiProperty({ type: [StyleReasonCountDto] })
  reasons!: StyleReasonCountDto[];
}

export class ProcessCoverageDto {
  @ApiProperty({ example: 'folder_gluer_crash_lock' })
  code!: string;

  @ApiProperty({ example: 'เครื่องพับทากาว (ก้นล็อก)' })
  nameTh!: string;

  @ApiProperty({ example: 'Folder-gluer (crash-lock)' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 60, description: 'Active variants that need it' })
  variantsNeeding!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Active factories with a verified capability (staff only)',
  })
  factories!: number;
}

export class StyleCoverageDto {
  @ApiProperty({ type: [CategoryCoverageDto] })
  categories!: CategoryCoverageDto[];

  @ApiProperty({ type: [ProcessCoverageDto], description: 'Uncovered processes first' })
  processes!: ProcessCoverageDto[];

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  generatedAt!: string;
}

export const COVERAGE_EXAMPLE: StyleCoverageDto = {
  categories: [
    {
      category: 'folding_carton',
      bases: 40,
      variants: 525,
      publishable: 0,
      makeable: 300,
      notMakeable: 225,
      reasons: [
        { reason: 'no_recipe', count: 525 },
        { reason: 'not_makeable', count: 225 },
      ],
    },
  ],
  processes: [
    {
      code: 'window_patching',
      nameTh: 'ติดหน้าต่างฟิล์ม',
      nameEn: 'Window patching',
      variantsNeeding: 140,
      factories: 0,
    },
  ],
  generatedAt: '2026-10-03T10:00:00+07:00',
};
