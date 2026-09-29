import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { CatalogCrudService } from '../crud/catalog-crud.service';
import { type CrudRow } from '../crud/catalog-resource';
import { num } from '../crud/dto-fields';
import { RefResolver } from '../crud/ref-resolver';
import { patterns } from '../product-structure/product-structure.resources';
import {
  type PatternGeometryDto,
  type ReplaceGeometryBandsDto,
  type ReplacePatternConditionsDto,
  type ReplaceStandardBlanksDto,
} from './geometry.dto';
import { geometryBandTables } from './geometry.resources';
import { bandViolation, type RuleViolation, slotViolation } from './geometry-rules';

const invalid = (errors: RuleViolation[]) => new DomainException('validation.failed', { errors });

/**
 * The child sets of geometry data (U-B6 slice 7d): the bands of a band table, and the condition slots and
 * standard blanks of a pattern. Each replaces the whole set in one transaction guarded by the parent's ETag, bumps
 * the parent's `row_version`, and writes the audit row and domain event (`CatalogCrudService.mutateChildren`).
 */
@Injectable()
export class GeometryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: CatalogCrudService,
  ) {}

  async replaceBands(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: ReplaceGeometryBandsDto,
  ): Promise<CrudRow> {
    const bad = bandViolation(input.bands);
    if (bad) throw invalid([bad]);
    return this.crud.mutateChildren(
      geometryBandTables,
      actor,
      publicId,
      ifMatch,
      ['bands'],
      async (tx, table) => {
        await tx.geometryBand.deleteMany({ where: { tableId: table.id } });
        // Inserted one by one: the calculators read bands in id order, which is the order given.
        for (const band of input.bands) {
          await tx.geometryBand.create({
            data: { tableId: table.id, ...band, createdById: actor.userId, updatedById: actor.userId },
          });
        }
      },
    );
  }

  async patternGeometry(
    publicId: string,
    db: Tx = this.prisma,
  ): Promise<{ row: CrudRow; dto: PatternGeometryDto }> {
    const row = await this.crud.get(patterns, publicId, db);
    const [conditions, blanks] = await Promise.all([
      db.patternGeometryCondition.findMany({
        where: { patternId: row.id },
        include: { subPattern: { select: { publicId: true } }, condition: { select: { publicId: true } } },
        orderBy: [{ subPatternId: { sort: 'asc', nulls: 'first' } }, { slot: 'asc' }, { seq: 'asc' }],
      }),
      db.patternStandardBlank.findMany({
        where: { patternId: row.id },
        include: { standardSize: { select: { publicId: true } } },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      row,
      dto: {
        patternId: row.publicId,
        conditions: conditions.map((c) => ({
          subPatternId: c.subPattern?.publicId ?? null,
          slot: c.slot,
          seq: c.seq,
          conditionId: c.condition.publicId,
        })),
        standardBlanks: blanks.map((b) => ({
          standardSizeId: b.standardSize.publicId,
          dwMm: num(b.dwMm)!,
          dlMm: num(b.dlMm)!,
        })),
      },
    };
  }

  async replacePatternConditions(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: ReplacePatternConditionsDto,
  ): Promise<{ row: CrudRow; dto: PatternGeometryDto }> {
    return this.onPattern(actor, publicId, ifMatch, 'geometryConditions', async (tx, pattern) => {
      const refs = new RefResolver(tx);
      const { productType } = await tx.pattern.findUniqueOrThrow({
        where: { id: pattern.id },
        select: { productType: { select: { calculatorKey: true } } },
      });
      const rows = [];
      for (const [index, link] of input.conditions.entries()) {
        const path = `conditions[${index}]`;
        const subPatternId = link.subPatternId
          ? await this.partOf(tx, pattern.id, link.subPatternId, `${path}.subPatternId`)
          : null;
        const conditionId = await refs.id('geometryCondition', link.conditionId, `${path}.conditionId`);
        const condition = await tx.geometryCondition.findUniqueOrThrow({
          where: { id: conditionId },
          select: { determinant: true, status: true },
        });
        if (condition.status === 'archived') {
          throw invalid([
            { path: `${path}.conditionId`, code: 'archived', message: 'the condition is archived' },
          ]);
        }
        const bad = slotViolation(
          path,
          { slot: link.slot, determinant: condition.determinant, onPart: subPatternId !== null },
          productType.calculatorKey,
        );
        if (bad) throw invalid([bad]);
        rows.push({
          patternId: pattern.id,
          subPatternId,
          slot: link.slot,
          seq: link.seq ?? 1,
          conditionId,
          createdById: actor.userId,
        });
      }
      unique(
        rows.map((r) => `${r.subPatternId ?? 0}:${r.slot}:${r.seq}`),
        'conditions',
        'a part lists a slot and seq twice',
      );
      await tx.patternGeometryCondition.deleteMany({ where: { patternId: pattern.id } });
      await tx.patternGeometryCondition.createMany({ data: rows });
    });
  }

  async replaceStandardBlanks(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    input: ReplaceStandardBlanksDto,
  ): Promise<{ row: CrudRow; dto: PatternGeometryDto }> {
    return this.onPattern(actor, publicId, ifMatch, 'standardBlanks', async (tx, pattern) => {
      const refs = new RefResolver(tx);
      const rows = [];
      for (const [index, blank] of input.standardBlanks.entries()) {
        rows.push({
          patternId: pattern.id,
          standardSizeId: await refs.id(
            'standardSize',
            blank.standardSizeId,
            `standardBlanks[${index}].standardSizeId`,
          ),
          dwMm: blank.dwMm,
          dlMm: blank.dlMm,
          createdById: actor.userId,
          updatedById: actor.userId,
        });
      }
      unique(
        rows.map((r) => String(r.standardSizeId)),
        'standardBlanks',
        'a standard size is listed twice',
      );
      await tx.patternStandardBlank.deleteMany({ where: { patternId: pattern.id } });
      await tx.patternStandardBlank.createMany({ data: rows });
    });
  }

  private async onPattern(
    actor: UserActor,
    publicId: string,
    ifMatch: string | undefined,
    field: string,
    work: (tx: Tx, pattern: CrudRow) => Promise<void>,
  ): Promise<{ row: CrudRow; dto: PatternGeometryDto }> {
    await this.crud.mutateChildren(patterns, actor, publicId, ifMatch, [field], work);
    return this.patternGeometry(publicId);
  }

  /** A part must belong to the pattern (the trigger `tg_pattern_geometry_conditions__sub_pattern` agrees). */
  private async partOf(tx: Tx, patternId: bigint, subPatternId: string, path: string): Promise<bigint> {
    const part = await tx.subPattern.findFirst({
      where: { publicId: subPatternId, patternId },
      select: { id: true },
    });
    if (!part) throw invalid([{ path, code: 'exists', message: 'not a part of this pattern' }]);
    return part.id;
  }
}

function unique(keys: string[], path: string, message: string): void {
  if (new Set(keys).size !== keys.length) throw invalid([{ path, code: 'unique', message }]);
}
