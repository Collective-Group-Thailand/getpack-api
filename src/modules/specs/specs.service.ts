import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type CalculatorKey } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import {
  basesOf,
  BasisError,
  constructionFamily,
  type ConvertedSizes,
  convertSize,
  type MeasurementBasis,
  type Size,
} from './dimension-conversion';
import { type ConvertedDimensionsDto } from './specs.dto';

/**
 * Catalogue side of the measurement-basis conversion (D-182): the construction family of a style and the caliper of a
 * material, then the pure conversion. The store and the quote path read the same answer.
 */
@Injectable()
export class SpecsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Converts a size for a style and material (internal ids), or throws `specs.basis_not_accepted`. */
  async convert(
    db: Tx,
    input: {
      calculator: CalculatorKey | null;
      patternId: bigint | null;
      materialId: bigint | null;
      basis: MeasurementBasis;
      size: Size;
    },
  ): Promise<ConvertedSizes> {
    const [pattern, material] = await Promise.all([
      input.patternId === null
        ? null
        : db.pattern.findUnique({
            where: { id: input.patternId },
            select: { geometryFormula: true, corrugateFormula: true },
          }),
      input.materialId === null
        ? null
        : db.material.findUnique({ where: { id: input.materialId }, select: { caliperMm: true } }),
    ]);
    const family = constructionFamily(input.calculator, pattern, input.size.d);
    const caliper = material?.caliperMm ? Number(material.caliperMm) : null;
    try {
      return convertSize(input.size, input.basis, family, caliper);
    } catch (error) {
      if (error instanceof BasisError) throw new DomainException(error.code);
      throw error;
    }
  }

  /** `store.specs.convertDimensions`: public ids in, every basis of the family out. */
  async convertPublic(input: {
    productTypeCode: string;
    patternId?: string;
    materialId?: string;
    basis: MeasurementBasis;
    w: number;
    l: number;
    d?: number;
  }): Promise<ConvertedDimensionsDto> {
    const db = this.prisma;
    const type = await db.productType.findFirst({ where: { code: input.productTypeCode, status: 'active' } });
    if (!type) throw new DomainException('http.not_found');
    const ref = async (find: () => Promise<{ id: bigint } | null>, path: string, given?: string) => {
      if (!given) return null;
      const row = await find();
      if (!row) {
        throw new DomainException('validation.failed', {
          errors: [{ path, code: 'exists', message: `${path} does not exist` }],
        });
      }
      return row.id;
    };
    const patternId = await ref(
      () =>
        db.pattern.findFirst({
          where: { publicId: input.patternId, productTypeId: type.id, status: { not: 'archived' } },
          select: { id: true },
        }),
      'patternId',
      input.patternId,
    );
    const materialId = await ref(
      () => db.material.findFirst({ where: { publicId: input.materialId }, select: { id: true } }),
      'materialId',
      input.materialId,
    );
    const converted = await this.convert(db, {
      calculator: type.calculatorKey,
      patternId,
      materialId,
      basis: input.basis,
      size: { w: input.w, l: input.l, d: input.d ?? 0 },
    });
    return toDto(converted);
  }
}

export function toDto(c: ConvertedSizes): ConvertedDimensionsDto {
  return {
    family: c.family,
    bases: [...basesOf(c.family)],
    caliperMm: c.caliperMm,
    conversionVersion: c.conversionVersion,
    sizes: {
      internal: c.sizes.internal ?? null,
      external: c.sizes.external ?? null,
      overCrease: c.sizes.over_crease ?? null,
      product: c.sizes.product ?? null,
    },
  };
}
