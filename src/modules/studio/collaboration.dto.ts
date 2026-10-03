import { TextField } from '@modules/catalog/crud/dto-fields';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRefDto } from '@platform/approvals/approvals.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const SHARE_SCOPES = ['view', 'comment', 'edit'] as const;

export class CreateShareLinkDto {
  @ApiProperty({
    enum: SHARE_SCOPES,
    enumName: 'ShareScope',
    example: 'comment',
    description: '`comment` and `edit` need a signed-in user; `edit` only a member of the design’s company',
  })
  @IsIn(SHARE_SCOPES)
  scope!: (typeof SHARE_SCOPES)[number];
}

export class ShareLinkDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000fb01' })
  id!: string;

  @ApiProperty({ enum: SHARE_SCOPES, enumName: 'ShareScope', example: 'comment' })
  scope!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-18T10:00:00+07:00' })
  expiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  revokedAt!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;
}

export class CreatedShareLinkDto extends ShareLinkDto {
  @ApiProperty({
    example: 'q3Rk0J7d3n2h8xJm1v5yW0b2C4e6G8i0K2m4O6q8S0u',
    description: 'Shown once, never stored in clear (`store.designs.getShared` opens it)',
  })
  token!: string;
}

export class FaceAnchorDto {
  @ApiPropertyOptional({ example: 'front', description: 'A face of the 3D box (with `u`, `v`)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  faceId?: string;

  @ApiPropertyOptional({ example: 0.42, minimum: 0, maximum: 1 })
  @ValidateIf((o: FaceAnchorDto) => o.faceId !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1)
  u?: number;

  @ApiPropertyOptional({ example: 0.3, minimum: 0, maximum: 1 })
  @ValidateIf((o: FaceAnchorDto) => o.faceId !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1)
  v?: number;

  @ApiPropertyOptional({ example: 120.5, description: 'A point on the flat, mm (with `yMm`)' })
  @ValidateIf((o: FaceAnchorDto) => o.faceId === undefined)
  @IsNumber()
  @Min(-100)
  @Max(5000)
  xMm?: number;

  @ApiPropertyOptional({ example: 40 })
  @ValidateIf((o: FaceAnchorDto) => o.faceId === undefined)
  @IsNumber()
  @Min(-100)
  @Max(5000)
  yMm?: number;
}

export class AddCommentDto {
  @TextField({ example: 'โลโก้เล็กไปนิด ขยายอีกหน่อยได้ไหม', max: 4000 })
  body!: string;

  @ApiPropertyOptional({ type: FaceAnchorDto, description: 'Where on the box; absent for a reply' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FaceAnchorDto)
  anchor?: FaceAnchorDto;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '0192f3a0-7c1e-7d2a-9b1f-00000000fc01',
    description: 'Reply to this thread',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: [],
    description: '@mentions: users (public ids) of the design’s owner or company',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mentions?: string[];

  @ApiPropertyOptional({
    type: 'integer',
    example: 3,
    description: 'The version commented on; absent: the current',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;
}

export class CommentDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000fc01' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  parentId!: string | null;

  @ApiProperty({ type: UserRefDto })
  author!: UserRefDto;

  @ApiProperty({ example: 'โลโก้เล็กไปนิด ขยายอีกหน่อยได้ไหม' })
  body!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { faceId: 'front', u: 0.42, v: 0.3 },
  })
  anchor!: Record<string, unknown> | null;

  @ApiProperty({ type: [String], example: [], description: 'Mentioned users (public ids)' })
  mentions!: string[];

  @ApiProperty({ type: 'integer', nullable: true, example: 3 })
  versionNo!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  resolvedAt!: string | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  resolvedBy!: UserRefDto | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-03T10:00:00+07:00' })
  createdAt!: string;
}

export class StudioCartItemRefDto {
  @ApiProperty({ format: 'uuid', example: '0192f3a0-7c1e-7d2a-9b1f-00000000c901' })
  cartItemId!: string;

  @ApiProperty({ type: 'integer', example: 3 })
  designVersionNo!: number;
}
