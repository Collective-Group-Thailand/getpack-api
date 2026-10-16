import { CodedRefDto } from '@common/dto/factory-ref.dto';
import { EnumField, TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { AttachedFileDto } from '@platform/files/files.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const STYLE_INTAKE_STATUSES = [
  'submitted',
  'matched',
  'approved_recipe',
  'approved_template',
  'rejected',
] as const;
const BASE_CODE = /^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$/;

const IDS = {
  intake: '0192f3a0-7c1e-7d2a-9b1f-00000000e901',
  factory: '0192f3a0-7c1e-7d2a-9b1f-00000000a001',
  file: '0192f3a0-7c1e-7d2a-9b1f-00000000f901',
  recipe: '0192f3a0-7c1e-7d2a-9b1f-00000000e902',
};

export class IntakeTermsDto {
  @ApiProperty({ type: 'integer', example: 1, description: 'The version a submission must accept' })
  version!: number;

  @ApiProperty({ example: 'โรงงานอนุญาตให้ getpack ใช้ ดัดแปลง และเผยแพร่โครงสร้างนี้ …' })
  textTh!: string;

  @ApiProperty({ example: 'The factory allows getpack to use, adapt and publish this structure …' })
  textEn!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00+07:00' })
  effectiveFrom!: string;
}

export class SubmitStyleIntakeDto {
  @ApiProperty({
    format: 'uuid',
    example: IDS.file,
    description: 'An uploaded file of purpose `dieline` (DXF / PDF)',
  })
  @IsUUID()
  fileId!: string;

  @TextField({ example: 'กล่องฝาเสียบ 2 ด้าน พร้อมหน้าต่าง', max: 200 })
  title!: string;

  @TextField({ example: 'ใช้กับกระดาษอาร์ตการ์ด 350 แกรม', max: 2000, optional: true })
  note?: string;

  @ApiPropertyOptional({ example: 'PK-TE-01', description: 'The style base the factory says it is' })
  @IsOptional()
  @IsString()
  @Matches(BASE_CODE)
  baseCode?: string;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'The intake terms version accepted (`partner.styleIntakes.getTerms`)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  acceptedTermsVersion!: number;
}

export class IntakeDeviationDto {
  @TextField({ example: 'glue_flap', max: 100 })
  aspect!: string;

  @TextField({ example: 'Glue flap 15 mm instead of 12 mm', max: 1000 })
  note!: string;
}

export class MatchStyleIntakeDto {
  @ApiProperty({ format: 'uuid', example: IDS.recipe, description: 'The existing style recipe it matches' })
  @IsUUID()
  recipeId!: string;

  @ApiProperty({
    type: [IntakeDeviationDto],
    description: 'Deviation report against the recipe (may be empty)',
  })
  @ValidateNested({ each: true })
  @Type(() => IntakeDeviationDto)
  @ArrayMaxSize(50)
  deviations!: IntakeDeviationDto[];
}

export class ApproveStyleIntakeDto {
  @ApiProperty({
    enum: ['recipe', 'template'],
    enumName: 'StyleIntakeOutcome',
    example: 'recipe',
    description: 'A recipe imported from it (D-242), or a fixed template of a base',
  })
  @IsIn(['recipe', 'template'])
  as!: 'recipe' | 'template';

  @ApiPropertyOptional({
    format: 'uuid',
    example: IDS.recipe,
    description: 'For `recipe`: the recipe imported from it',
  })
  @ValidateIf((o: ApproveStyleIntakeDto) => o.as === 'recipe')
  @IsUUID()
  recipeId?: string;

  @ApiPropertyOptional({
    example: 'PK-TE-01',
    description: 'For `template`: the base it is a fixed template of',
  })
  @ValidateIf((o: ApproveStyleIntakeDto) => o.as === 'template')
  @IsString()
  @Matches(BASE_CODE)
  baseCode?: string;
}

export class StyleIntakeQuery {
  @EnumField(STYLE_INTAKE_STATUSES, 'StyleIntakeStatus', { example: 'submitted', optional: true })
  status?: (typeof STYLE_INTAKE_STATUSES)[number];
}

export class IntakeRecipeRefDto {
  @ApiProperty({ format: 'uuid', example: IDS.recipe })
  id!: string;

  @ApiProperty({ example: 'PK-TE-01' })
  baseCode!: string;

  @ApiProperty({ type: 'integer', example: 2 })
  version!: number;
}

export class StyleIntakeDto {
  @ApiProperty({ format: 'uuid', example: IDS.intake })
  id!: string;

  @ApiProperty({ type: CodedRefDto })
  factory!: CodedRefDto;

  @ApiProperty({ example: 'กล่องฝาเสียบ 2 ด้าน พร้อมหน้าต่าง' })
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  note!: string | null;

  @ApiProperty({ type: AttachedFileDto })
  file!: AttachedFileDto;

  @ApiProperty({
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    description: 'sha256 (hex) as submitted',
  })
  fileSha256!: string;

  @ApiProperty({ type: 'integer', example: 1, description: 'Intake terms version accepted' })
  termsVersion!: number;

  @ApiProperty({ type: String, nullable: true, example: 'PK-TE-01' })
  proposedBaseCode!: string | null;

  @ApiProperty({ enum: STYLE_INTAKE_STATUSES, enumName: 'StyleIntakeStatus', example: 'submitted' })
  status!: string;

  @ApiProperty({ type: IntakeRecipeRefDto, nullable: true })
  matchedRecipe!: IntakeRecipeRefDto | null;

  @ApiProperty({ type: [IntakeDeviationDto], nullable: true, example: null })
  deviations!: IntakeDeviationDto[] | null;

  @ApiProperty({ type: IntakeRecipeRefDto, nullable: true })
  resultRecipe!: IntakeRecipeRefDto | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  templateBaseCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectReason!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true, description: 'The Prepress reviewer (staff views only)' })
  reviewedBy!: UserRefDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  reviewedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;
}

export const INTAKE_EXAMPLE: StyleIntakeDto = {
  id: IDS.intake,
  factory: { id: IDS.factory, code: 'FAC-0001', name: 'โรงพิมพ์ ทดสอบ' },
  title: 'กล่องฝาเสียบ 2 ด้าน พร้อมหน้าต่าง',
  note: null,
  file: { id: IDS.file, originalName: 'tuck-window.dxf', mimeType: 'application/dxf', sizeBytes: 48211 },
  fileSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  termsVersion: 1,
  proposedBaseCode: 'PK-TE-01',
  status: 'submitted',
  matchedRecipe: null,
  deviations: null,
  resultRecipe: null,
  templateBaseCode: null,
  rejectReason: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-03T10:00:00+07:00',
};

export const TERMS_EXAMPLE: IntakeTermsDto = {
  version: 1,
  textTh: 'โรงงานอนุญาตให้ getpack ใช้ ดัดแปลง และเผยแพร่โครงสร้างนี้ …',
  textEn: 'The factory allows getpack to use, adapt and publish this structure …',
  effectiveFrom: '2026-10-01T00:00:00+07:00',
};
