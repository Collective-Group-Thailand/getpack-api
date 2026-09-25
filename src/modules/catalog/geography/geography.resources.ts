import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import {
  CreateGeoDistrictDto,
  CreateGeoProvinceDto,
  CreateGeoSubdistrictDto,
  GEO_IDS,
  GeoDistrictDto,
  GeoDistrictListQuery,
  GeoProvinceDto,
  GeoProvinceListQuery,
  GeoSubdistrictDto,
  GeoSubdistrictListQuery,
  UpdateGeoDistrictDto,
  UpdateGeoProvinceDto,
  UpdateGeoSubdistrictDto,
} from './geography.dto';

const TS = '2026-09-25T10:00:00+07:00';
/** Admin-maintained reference data, no outside dataset (D-161); bulk entry by Excel import (D-170). */
const GEOGRAPHY = ['D-161', 'D-170'];
const NOTE =
  'Admin-maintained (D-161): single-row forms here, bulk loading with the `geography` Excel import (D-170).';

type ProvinceRow = Prisma.GeoProvinceGetPayload<object>;

export const geoProvinces = defineResource({
  key: 'geo_province',
  path: 'provinces',
  operation: 'geographyProvinces',
  area: 'geography',
  label: 'province',
  labelPlural: 'provinces',
  implements: GEOGRAPHY,
  note: NOTE,
  read: 'catalog.read',
  manage: 'geography.manage',
  delegate: (tx) => tx.geoProvince,
  dto: GeoProvinceDto,
  createDto: CreateGeoProvinceDto,
  updateDto: UpdateGeoProvinceDto,
  queryDto: GeoProvinceListQuery,
  example: {
    id: GEO_IDS.province,
    code: '10',
    nameTh: 'กรุงเทพมหานคร',
    nameEn: 'Bangkok',
    region: 'central',
    updatedAt: TS,
  },
  createExample: { code: '10', nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok', region: 'central' },
  updateExample: { region: 'central' },
  toDto: (row: ProvinceRow): GeoProvinceDto => ({
    id: row.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    region: row.region,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateGeoProvinceDto) => ({ ...input }),
  updateData: (input: UpdateGeoProvinceDto) => compact({ ...input }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', nameTh: 'nameTh', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

type DistrictRow = Prisma.GeoDistrictGetPayload<{ include: { province: { select: { publicId: true } } } }>;

export const geoDistricts = defineResource({
  key: 'geo_district',
  path: 'districts',
  operation: 'geographyDistricts',
  area: 'geography',
  label: 'district',
  labelPlural: 'districts',
  implements: GEOGRAPHY,
  note: NOTE,
  read: 'catalog.read',
  manage: 'geography.manage',
  delegate: (tx) => tx.geoDistrict,
  include: { province: { select: { publicId: true } } },
  dto: GeoDistrictDto,
  createDto: CreateGeoDistrictDto,
  updateDto: UpdateGeoDistrictDto,
  queryDto: GeoDistrictListQuery,
  example: {
    id: GEO_IDS.district,
    provinceId: GEO_IDS.province,
    code: '1001',
    nameTh: 'พระนคร',
    nameEn: 'Phra Nakhon',
    updatedAt: TS,
  },
  createExample: { provinceId: GEO_IDS.province, code: '1001', nameTh: 'พระนคร', nameEn: 'Phra Nakhon' },
  updateExample: { nameEn: 'Phra Nakhon' },
  toDto: (row: DistrictRow): GeoDistrictDto => ({
    id: row.publicId,
    provinceId: row.province.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateGeoDistrictDto, refs) => ({
    ...input,
    provinceId: await refs.id('geoProvince', input.provinceId, 'provinceId'),
  }),
  updateData: async (input: UpdateGeoDistrictDto, refs) =>
    compact({
      ...input,
      provinceId:
        input.provinceId === undefined
          ? undefined
          : await refs.id('geoProvince', input.provinceId, 'provinceId'),
    }),
  where: (q: GeoDistrictListQuery) =>
    compact({ province: q.provinceId ? { publicId: q.provinceId } : undefined }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', nameTh: 'nameTh', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

type SubdistrictRow = Prisma.GeoSubdistrictGetPayload<{
  include: { district: { select: { publicId: true } } };
}>;

export const geoSubdistricts = defineResource({
  key: 'geo_subdistrict',
  path: 'subdistricts',
  operation: 'geographySubdistricts',
  area: 'geography',
  label: 'subdistrict',
  labelPlural: 'subdistricts',
  implements: GEOGRAPHY,
  note: NOTE,
  read: 'catalog.read',
  manage: 'geography.manage',
  delegate: (tx) => tx.geoSubdistrict,
  include: { district: { select: { publicId: true } } },
  dto: GeoSubdistrictDto,
  createDto: CreateGeoSubdistrictDto,
  updateDto: UpdateGeoSubdistrictDto,
  queryDto: GeoSubdistrictListQuery,
  example: {
    id: GEO_IDS.subdistrict,
    districtId: GEO_IDS.district,
    code: '100101',
    nameTh: 'พระบรมมหาราชวัง',
    nameEn: 'Phra Borom Maha Ratchawang',
    postcode: '10200',
    updatedAt: TS,
  },
  createExample: {
    districtId: GEO_IDS.district,
    code: '100101',
    nameTh: 'พระบรมมหาราชวัง',
    nameEn: 'Phra Borom Maha Ratchawang',
    postcode: '10200',
  },
  updateExample: { postcode: '10200' },
  toDto: (row: SubdistrictRow): GeoSubdistrictDto => ({
    id: row.publicId,
    districtId: row.district.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    postcode: row.postcode,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateGeoSubdistrictDto, refs) => ({
    ...input,
    districtId: await refs.id('geoDistrict', input.districtId, 'districtId'),
  }),
  updateData: async (input: UpdateGeoSubdistrictDto, refs) =>
    compact({
      ...input,
      districtId:
        input.districtId === undefined
          ? undefined
          : await refs.id('geoDistrict', input.districtId, 'districtId'),
    }),
  where: (q: GeoSubdistrictListQuery) =>
    compact({ district: q.districtId ? { publicId: q.districtId } : undefined, postcode: q.postcode }),
  search: ['code', 'nameTh', 'nameEn', 'postcode'],
  sort: { code: 'code', postcode: 'postcode', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
