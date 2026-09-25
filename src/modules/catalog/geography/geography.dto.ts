import { PageQuery } from '@common/pagination/pagination.dto';
import { ApiProperty, PartialType } from '@nestjs/swagger';

import { CodeField, IdField, RefField, TextField, TimestampField } from '../crud/dto-fields';

const TS = '2026-09-25T10:00:00+07:00';
/** Administrative codes: digits (and letters for any non-standard code). */
export const GEO_CODE = /^[0-9A-Za-z]+$/;

export const GEO_IDS = {
  province: '0192f3a0-7c1e-7d2a-9b1f-00000000a201',
  district: '0192f3a0-7c1e-7d2a-9b1f-00000000a202',
  subdistrict: '0192f3a0-7c1e-7d2a-9b1f-00000000a203',
} as const;

export class GeoProvinceDto {
  @IdField(GEO_IDS.province)
  id!: string;

  @ApiProperty({ example: '10' })
  code!: string;

  @ApiProperty({ example: 'กรุงเทพมหานคร' })
  nameTh!: string;

  @ApiProperty({ example: 'Bangkok' })
  nameEn!: string;

  @ApiProperty({ type: String, nullable: true, example: 'central' })
  region!: string | null;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateGeoProvinceDto {
  @CodeField({ example: '10', pattern: GEO_CODE })
  code!: string;

  @TextField({ example: 'กรุงเทพมหานคร' })
  nameTh!: string;

  @TextField({ example: 'Bangkok' })
  nameEn!: string;

  @TextField({ example: 'central', nullable: true, max: 64 })
  region?: string | null;
}

export class UpdateGeoProvinceDto extends PartialType(CreateGeoProvinceDto) {}

export class GeoProvinceListQuery extends PageQuery {}

export class GeoDistrictDto {
  @IdField(GEO_IDS.district)
  id!: string;

  @ApiProperty({ format: 'uuid', example: GEO_IDS.province })
  provinceId!: string;

  @ApiProperty({ example: '1001' })
  code!: string;

  @ApiProperty({ example: 'พระนคร' })
  nameTh!: string;

  @ApiProperty({ example: 'Phra Nakhon' })
  nameEn!: string;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateGeoDistrictDto {
  @RefField({ example: GEO_IDS.province })
  provinceId!: string;

  @CodeField({ example: '1001', pattern: GEO_CODE })
  code!: string;

  @TextField({ example: 'พระนคร' })
  nameTh!: string;

  @TextField({ example: 'Phra Nakhon' })
  nameEn!: string;
}

export class UpdateGeoDistrictDto extends PartialType(CreateGeoDistrictDto) {}

export class GeoDistrictListQuery extends PageQuery {
  @RefField({ example: GEO_IDS.province, optional: true })
  provinceId?: string;
}

export class GeoSubdistrictDto {
  @IdField(GEO_IDS.subdistrict)
  id!: string;

  @ApiProperty({ format: 'uuid', example: GEO_IDS.district })
  districtId!: string;

  @ApiProperty({ example: '100101' })
  code!: string;

  @ApiProperty({ example: 'พระบรมมหาราชวัง' })
  nameTh!: string;

  @ApiProperty({ example: 'Phra Borom Maha Ratchawang' })
  nameEn!: string;

  @ApiProperty({ example: '10200', pattern: '^[0-9]{5}$' })
  postcode!: string;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateGeoSubdistrictDto {
  @RefField({ example: GEO_IDS.district })
  districtId!: string;

  @CodeField({ example: '100101', pattern: GEO_CODE })
  code!: string;

  @TextField({ example: 'พระบรมมหาราชวัง' })
  nameTh!: string;

  @TextField({ example: 'Phra Borom Maha Ratchawang' })
  nameEn!: string;

  @CodeField({ example: '10200', pattern: /^[0-9]{5}$/ })
  postcode!: string;
}

export class UpdateGeoSubdistrictDto extends PartialType(CreateGeoSubdistrictDto) {}

export class GeoSubdistrictListQuery extends PageQuery {
  @RefField({ example: GEO_IDS.district, optional: true })
  districtId?: string;

  @CodeField({ example: '10200', pattern: /^[0-9]{5}$/, optional: true })
  postcode?: string;
}
