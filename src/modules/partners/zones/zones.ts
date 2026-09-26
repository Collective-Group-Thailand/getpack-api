import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { ApiConcurrency, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { staffActor } from '@modules/catalog/crud/catalog-crud.controller';
import { CatalogCrudService, rowEtag } from '@modules/catalog/crud/catalog-crud.service';
import { defineResource } from '@modules/catalog/crud/catalog-resource';
import { compact } from '@modules/catalog/crud/compact';
import { CodeField, IdField, RefField, TextField, TimestampField } from '@modules/catalog/crud/dto-fields';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Res } from '@nestjs/common';
import { ApiBody, ApiParam, ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { type Response } from 'express';

const TS = '2026-09-26T10:00:00+07:00';
const IDS = { scheme: '0192f3a0-7c1e-7d2a-9b1f-00000000f601', zone: '0192f3a0-7c1e-7d2a-9b1f-00000000f602' };
const ZONES = ['D-013', 'D-114'];

// --- DTOs -----------------------------------------------------------------------------------------

export class ZoneSchemeDto {
  @IdField(IDS.scheme)
  id!: string;

  @ApiProperty({ example: 'customer_default', description: '`customer_default`, `carrier:<code>` …' })
  code!: string;

  @ApiProperty({ example: 'Customer shipping zones' })
  name!: string;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateZoneSchemeDto {
  @CodeField({ example: 'customer_default', pattern: /^[a-z][a-z0-9_:.-]*$/ })
  code!: string;

  @TextField({ example: 'Customer shipping zones' })
  name!: string;
}

export class UpdateZoneSchemeDto extends PartialType(CreateZoneSchemeDto) {}

export class ZoneSchemeListQuery extends PageQuery {}

export class ZoneDto {
  @IdField(IDS.zone)
  id!: string;

  @ApiProperty({ format: 'uuid', example: IDS.scheme })
  schemeId!: string;

  @ApiProperty({ example: 'BKK' })
  code!: string;

  @ApiProperty({ example: 'กรุงเทพและปริมณฑล' })
  nameTh!: string;

  @ApiProperty({ example: 'Bangkok metropolitan' })
  nameEn!: string;

  @ApiProperty({ type: 'integer', example: 120, description: 'Postcodes mapped to the zone' })
  postcodeCount!: number;

  @TimestampField(TS)
  updatedAt!: string;
}

export class CreateZoneDto {
  @RefField({ example: IDS.scheme })
  schemeId!: string;

  @CodeField({ example: 'BKK' })
  code!: string;

  @TextField({ example: 'กรุงเทพและปริมณฑล' })
  nameTh!: string;

  @TextField({ example: 'Bangkok metropolitan' })
  nameEn!: string;
}

/** A zone stays in its scheme. */
export class UpdateZoneDto extends PartialType(OmitType(CreateZoneDto, ['schemeId'] as const)) {}

export class ZoneListQuery extends PageQuery {
  @RefField({ example: IDS.scheme, optional: true })
  schemeId?: string;
}

export class ReplaceZonePostcodesDto {
  @ApiProperty({
    type: [String],
    example: ['10100', '10200'],
    description: '5-digit postcodes; each belongs to one zone per scheme',
  })
  @Matches(/^[0-9]{5}$/, { each: true })
  postcodes!: string[];
}

export class ZonePostcodesDto {
  @ApiProperty({ format: 'uuid', example: IDS.zone })
  zoneId!: string;

  @ApiProperty({ type: [String], example: ['10100', '10200'] })
  postcodes!: string[];
}

// --- resources (catalogue CRUD kit) ----------------------------------------------------------------

type SchemeRow = Prisma.ZoneSchemeGetPayload<object>;

export const zoneSchemes = defineResource({
  key: 'zone_scheme',
  path: 'zone-schemes',
  operation: 'shippingZoneSchemes',
  area: 'shipping',
  label: 'zone scheme',
  labelPlural: 'zone schemes',
  implements: ZONES,
  note: 'One scheme for customer rates (`customer_default`) and one per carrier (D-114); the customer rate card and factory payout cards use `customer_default` zones (B2.4).',
  read: 'partners.read',
  manage: 'zones.manage',
  delegate: (tx) => tx.zoneScheme,
  dto: ZoneSchemeDto,
  createDto: CreateZoneSchemeDto,
  updateDto: UpdateZoneSchemeDto,
  queryDto: ZoneSchemeListQuery,
  example: { id: IDS.scheme, code: 'customer_default', name: 'Customer shipping zones', updatedAt: TS },
  createExample: { code: 'customer_default', name: 'Customer shipping zones' },
  updateExample: { name: 'Customer zones' },
  toDto: (row: SchemeRow): ZoneSchemeDto => ({
    id: row.publicId,
    code: row.code,
    name: row.name,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateZoneSchemeDto) => ({ ...input }),
  updateData: (input: UpdateZoneSchemeDto) => compact({ ...input }),
  search: ['code', 'name'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

const ZONE_INCLUDE = {
  scheme: { select: { publicId: true } },
  _count: { select: { postcodes: true } },
} satisfies Prisma.ZoneInclude;
type ZoneRow = Prisma.ZoneGetPayload<{ include: typeof ZONE_INCLUDE }>;

export const zones = defineResource({
  key: 'zone',
  path: 'zones',
  operation: 'shippingZones',
  area: 'shipping',
  label: 'zone',
  labelPlural: 'zones',
  implements: ZONES,
  note: 'Postcodes are set through `PUT …/postcodes`; factories declare which zones their fleet serves (D-013).',
  read: 'partners.read',
  manage: 'zones.manage',
  delegate: (tx) => tx.zone,
  include: ZONE_INCLUDE,
  dto: ZoneDto,
  createDto: CreateZoneDto,
  updateDto: UpdateZoneDto,
  queryDto: ZoneListQuery,
  example: {
    id: IDS.zone,
    schemeId: IDS.scheme,
    code: 'BKK',
    nameTh: 'กรุงเทพและปริมณฑล',
    nameEn: 'Bangkok metropolitan',
    postcodeCount: 120,
    updatedAt: TS,
  },
  createExample: {
    schemeId: IDS.scheme,
    code: 'BKK',
    nameTh: 'กรุงเทพและปริมณฑล',
    nameEn: 'Bangkok metropolitan',
  },
  updateExample: { nameEn: 'Greater Bangkok' },
  toDto: (row: ZoneRow): ZoneDto => ({
    id: row.publicId,
    schemeId: row.scheme.publicId,
    code: row.code,
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    postcodeCount: row._count.postcodes,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateZoneDto, refs) => ({
    ...input,
    schemeId: await refs.id('zoneScheme', input.schemeId, 'schemeId'),
  }),
  updateData: (input: UpdateZoneDto) => compact({ ...input }),
  where: (q: ZoneListQuery) => compact({ scheme: q.schemeId ? { publicId: q.schemeId } : undefined }),
  search: ['code', 'nameTh', 'nameEn'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

@ApiSurface('admin', 'shippingZones')
@Controller('shipping/zones')
export class ZonePostcodesController {
  constructor(
    private readonly crud: CatalogCrudService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id/postcodes')
  @Can('partners.read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.shippingZones.listPostcodes',
    summary: 'List the postcodes of a zone',
    description: 'Sorted ascending.',
    implements: ZONES,
  })
  @ApiSuccess(200, {
    description: 'Postcodes',
    type: ZonePostcodesDto,
    example: { zoneId: IDS.zone, postcodes: ['10100', '10200'] },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async list(@Param('id', ParseUUIDPipe) id: string): Promise<ZonePostcodesDto> {
    const zone = await this.crud.get(zones, id);
    return { zoneId: zone.publicId, postcodes: await this.postcodes(zone.id) };
  }

  @Put(':id/postcodes')
  @Can('zones.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.shippingZones.replacePostcodes',
    summary: 'Replace the postcodes of a zone',
    description:
      'A postcode belongs to one zone per scheme: moving it here removes it from the other zone of the scheme. Guarded by the zone ETag.',
    implements: ZONES,
  })
  @ApiConcurrency()
  @ApiBody({
    type: ReplaceZonePostcodesDto,
    examples: { default: { value: { postcodes: ['10100', '10200'] } } },
  })
  @ApiSuccess(200, {
    description: 'Postcodes',
    type: ZonePostcodesDto,
    example: { zoneId: IDS.zone, postcodes: ['10100', '10200'] },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async replace(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ReplaceZonePostcodesDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ZonePostcodesDto> {
    const user = staffActor(actor);
    const postcodes = [...new Set(body.postcodes)];
    if (postcodes.length !== body.postcodes.length) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'postcodes', code: 'unique', message: 'postcodes lists the same postcode twice' }],
      });
    }
    const zone = await this.crud.mutateChildren(
      zones,
      user,
      id,
      ifMatch,
      ['postcodes'],
      async (tx, parent) => {
        const row = await tx.zone.findUniqueOrThrow({ where: { id: parent.id } });
        await tx.zonePostcode.deleteMany({
          where: { OR: [{ zoneId: row.id }, { schemeId: row.schemeId, postcode: { in: postcodes } }] },
        });
        await tx.zonePostcode.createMany({
          data: postcodes.map((postcode) => ({
            zoneId: row.id,
            schemeId: row.schemeId,
            postcode,
            createdById: user.userId,
          })),
        });
      },
    );
    res.setHeader('ETag', rowEtag(zone));
    return { zoneId: zone.publicId, postcodes: await this.postcodes(zone.id) };
  }

  private async postcodes(zoneId: bigint): Promise<string[]> {
    const rows = await this.prisma.zonePostcode.findMany({ where: { zoneId }, orderBy: { postcode: 'asc' } });
    return rows.map((r) => r.postcode);
  }
}
