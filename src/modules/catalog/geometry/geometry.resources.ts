import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';

import { defineResource } from '../crud/catalog-resource';
import { compact } from '../crud/compact';
import { type CatalogStatusValue, num } from '../crud/dto-fields';
import {
  CreateGeometryBandTableDto,
  CreateGeometryConditionDto,
  GEOMETRY_IDS,
  GeometryBandTableDto,
  GeometryBandTableListQuery,
  GeometryConditionDto,
  GeometryConditionListQuery,
  UpdateGeometryBandTableDto,
  UpdateGeometryConditionDto,
} from './geometry.dto';
import { slotViolation } from './geometry-rules';

const TS = '2026-09-29T10:00:00+07:00';
/** Geometry is platform catalogue data read by the ported calculators (D-100); U-B6 gave it an admin. */
const GEOMETRY = ['D-100', 'D-005'];
const GEOMETRY_NOTE =
  'Read by the folding and corrugate calculators when they price a pattern; a change applies to the next quote ' +
  '(quotes keep their frozen inputs).';

export const BAND_TABLE_INCLUDE = { bands: { orderBy: { id: 'asc' } } } as const;

interface BandTableRow {
  id: bigint;
  publicId: string;
  rowVersion: number;
  code: string;
  name: string;
  status: CatalogStatusValue;
  updatedAt: Date;
  bands: { lower: Prisma.Decimal; upper: Prisma.Decimal; value: Prisma.Decimal }[];
}

export const geometryBandTables = defineResource({
  key: 'geometry_band_table',
  path: 'geometry-band-tables',
  operation: 'catalogGeometryBandTables',
  area: 'catalog',
  label: 'geometry band table',
  labelPlural: 'geometry band tables',
  implements: GEOMETRY,
  note: `Allowances by box dimension (legacy \`conditions\`); bands are replaced with \`PUT …/bands\`. ${GEOMETRY_NOTE}`,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.geometryBandTable,
  include: BAND_TABLE_INCLUDE,
  dto: GeometryBandTableDto,
  createDto: CreateGeometryBandTableDto,
  updateDto: UpdateGeometryBandTableDto,
  queryDto: GeometryBandTableListQuery,
  example: {
    id: GEOMETRY_IDS.bandTable,
    code: 'rte_dw',
    name: 'ฝาเสียบ — ระยะเผื่อ DW',
    bands: [
      { lower: 0, upper: 100, value: 12.5 },
      { lower: 100.01, upper: 300, value: 15 },
    ],
    status: 'active',
    updatedAt: TS,
  },
  createExample: { code: 'rte_dw', name: 'ฝาเสียบ — ระยะเผื่อ DW' },
  updateExample: { status: 'active' },
  toDto: (row: BandTableRow): GeometryBandTableDto => ({
    id: row.publicId,
    code: row.code,
    name: row.name,
    bands: row.bands.map((b) => ({ lower: num(b.lower)!, upper: num(b.upper)!, value: num(b.value)! })),
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: (input: CreateGeometryBandTableDto) => ({ ...input }),
  updateData: (input: UpdateGeometryBandTableDto) => compact({ ...input }),
  where: (q: GeometryBandTableListQuery) => compact({ status: q.status }),
  search: ['code', 'name'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});

// ------------------------------------------------------------------------------------------------

interface ConditionRow {
  id: bigint;
  publicId: string;
  rowVersion: number;
  code: string;
  variable: string;
  determinant: GeometryConditionDto['determinant'];
  status: CatalogStatusValue;
  updatedAt: Date;
  bandTable: { publicId: string };
}

export const geometryConditions = defineResource({
  key: 'geometry_condition',
  path: 'geometry-conditions',
  operation: 'catalogGeometryConditions',
  area: 'catalog',
  label: 'geometry condition',
  labelPlural: 'geometry conditions',
  implements: GEOMETRY,
  note:
    'A band table read by one box dimension (legacy `calculate_conditions`); patterns use conditions in their ' +
    `slots (\`PUT /v1/admin/catalog/patterns/{id}/geometry-conditions\`). ${GEOMETRY_NOTE}`,
  read: 'catalog.read',
  manage: 'catalog.manage',
  delegate: (tx) => tx.geometryCondition,
  include: { bandTable: { select: { publicId: true } } },
  dto: GeometryConditionDto,
  createDto: CreateGeometryConditionDto,
  updateDto: UpdateGeometryConditionDto,
  queryDto: GeometryConditionListQuery,
  example: {
    id: GEOMETRY_IDS.condition,
    code: 'rte_dw_by_w',
    bandTableId: GEOMETRY_IDS.bandTable,
    variable: 'a',
    determinant: 'w',
    status: 'active',
    updatedAt: TS,
  },
  createExample: {
    code: 'rte_dw_by_w',
    bandTableId: GEOMETRY_IDS.bandTable,
    variable: 'a',
    determinant: 'w',
  },
  updateExample: { determinant: 'l' },
  toDto: (row: ConditionRow): GeometryConditionDto => ({
    id: row.publicId,
    code: row.code,
    bandTableId: row.bandTable.publicId,
    variable: row.variable,
    determinant: row.determinant,
    status: row.status,
    updatedAt: toBangkokIso(row.updatedAt),
  }),
  createData: async (input: CreateGeometryConditionDto, refs) => ({
    ...input,
    bandTableId: await refs.id('geometryBandTable', input.bandTableId, 'bandTableId'),
  }),
  updateData: async (input: UpdateGeometryConditionDto, refs, current: ConditionRow) => {
    if (input.determinant !== undefined && input.determinant !== current.determinant) {
      // The slots already reading the condition must still take the new dimension.
      const uses = await refs.db.patternGeometryCondition.findMany({
        where: { conditionId: current.id },
        select: { slot: true, subPatternId: true, pattern: { select: { productType: true } } },
      });
      for (const use of uses) {
        const onPart = use.subPatternId !== null;
        const bad = slotViolation(
          'determinant',
          { slot: use.slot, determinant: input.determinant, onPart },
          use.pattern.productType.calculatorKey,
        );
        if (bad) {
          throw new DomainException('validation.failed', {
            errors: [
              { path: 'determinant', code: 'inUse', message: `a pattern slot needs it: ${bad.message}` },
            ],
          });
        }
      }
    }
    return compact({
      ...input,
      bandTableId: await refs.optional('geometryBandTable', input.bandTableId, 'bandTableId'),
    });
  },
  where: (q: GeometryConditionListQuery) =>
    compact({
      status: q.status,
      determinant: q.determinant,
      bandTable: q.bandTableId ? { publicId: q.bandTableId } : undefined,
    }),
  search: ['code', 'variable'],
  sort: { code: 'code', updatedAt: 'updatedAt' },
  conflict: 'catalog.code_taken',
});
