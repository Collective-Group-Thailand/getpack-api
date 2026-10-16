import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import {
  type CreateSellMarginTableDto,
  type CreateSellMarginVersionDto,
  type SellMarginLineDto,
  type SellMarginTableDto,
  type SellMarginVersionDto,
} from './sell-margins.dto';

const VERSION_INCLUDE = {
  lines: { orderBy: { id: 'asc' }, include: { difficultyLevel: { select: { publicId: true } } } },
} satisfies Prisma.SellMarginTableVersionInclude;
type VersionRow = Prisma.SellMarginTableVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

const dec = (d: Prisma.Decimal | null, scale: number): string | null =>
  d === null ? null : d.toFixed(scale).replace(/\.?0+$/, '') || '0';

const versionDto = (v: VersionRow): SellMarginVersionDto => ({
  id: v.publicId,
  versionNo: v.versionNo,
  status: v.status,
  effectiveFrom: toBangkokIso(v.effectiveFrom),
  fallbackPct: dec(v.fallbackPct, 4),
  fallbackAmount: dec(v.fallbackAmount, 6),
  reason: v.reason,
  lines: v.lines.map((l): SellMarginLineDto => ({
    qtyMin: l.qtyMin,
    qtyMax: l.qtyMax,
    priceMin: dec(l.priceMin, 6),
    priceMax: dec(l.priceMax, 6),
    colourCount: l.colourCount,
    difficultyLevelId: l.difficultyLevel?.publicId ?? null,
    valuePct: dec(l.valuePct, 4),
    valueAmount: dec(l.valueAmount, 6),
    minAmount: dec(l.minAmount, 6),
  })),
});

/**
 * getpack's sell side (D-063): margin tiers, fix costs and design fees per product type and print type,
 * effective-dated and audited; approved by Superadmin / C-Level (`sell_margins.manage`). Versions are
 * copy-on-write: lines are written with the draft and frozen at approval (A-23).
 */
@Injectable()
export class SellMarginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(at = new Date()): Promise<SellMarginTableDto[]> {
    const tables = await this.prisma.sellMarginTable.findMany({
      include: {
        productType: { select: { publicId: true, code: true } },
        printType: { select: { publicId: true } },
        versions: {
          where: { status: 'approved', effectiveFrom: { lte: at } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
          take: 1,
          include: VERSION_INCLUDE,
        },
      },
      orderBy: { id: 'asc' },
    });
    return tables.map((t) => ({
      id: t.publicId,
      productTypeId: t.productType.publicId,
      productTypeCode: t.productType.code,
      printTypeId: t.printType?.publicId ?? null,
      kind: t.kind,
      description: t.description,
      current: t.versions[0] ? versionDto(t.versions[0]) : null,
    }));
  }

  async create(actor: UserActor, input: CreateSellMarginTableDto): Promise<SellMarginTableDto> {
    const type = await this.prisma.productType.findUnique({ where: { publicId: input.productTypeId } });
    const printType = input.printTypeId
      ? await this.prisma.printType.findUnique({ where: { publicId: input.printTypeId } })
      : null;
    const errors = [
      ...(type ? [] : [{ path: 'productTypeId', code: 'exists', message: 'productTypeId does not exist' }]),
      ...(input.printTypeId && (!printType || printType.productTypeId !== type?.id)
        ? [{ path: 'printTypeId', code: 'invalid', message: 'not a print type of the product type' }]
        : []),
    ];
    if (errors.length > 0) throw new DomainException('validation.failed', { errors });
    return this.prisma.withTx(async (tx) => {
      let table;
      try {
        table = await tx.sellMarginTable.create({
          data: {
            productTypeId: type!.id,
            printTypeId: printType?.id ?? null,
            kind: input.kind,
            description: input.description,
            decisionRefs: ['D-063'],
            createdById: actor.userId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DomainException('catalog.code_taken');
        }
        throw error;
      }
      await this.record(tx, table.publicId, 'sell_margin_table.created', {
        kind: table.kind,
        productTypeCode: type!.code,
      });
      return {
        id: table.publicId,
        productTypeId: type!.publicId,
        productTypeCode: type!.code,
        printTypeId: printType?.publicId ?? null,
        kind: table.kind,
        description: table.description,
        current: null,
      };
    });
  }

  async versions(tablePublicId: string): Promise<SellMarginVersionDto[]> {
    const table = await this.prisma.sellMarginTable.findUnique({
      where: { publicId: tablePublicId },
      include: { versions: { orderBy: { versionNo: 'desc' }, include: VERSION_INCLUDE } },
    });
    if (!table) throw new DomainException('http.not_found');
    return table.versions.map(versionDto);
  }

  /** A draft version with its lines; bands may not overlap (exclusion constraint). */
  async createVersion(
    actor: UserActor,
    tablePublicId: string,
    input: CreateSellMarginVersionDto,
  ): Promise<SellMarginVersionDto> {
    const table = await this.prisma.sellMarginTable.findUnique({ where: { publicId: tablePublicId } });
    if (!table) throw new DomainException('http.not_found');
    const levels = new Map(
      (
        await this.prisma.difficultyLevel.findMany({
          where: {
            publicId: { in: input.lines.flatMap((l) => (l.difficultyLevelId ? [l.difficultyLevelId] : [])) },
          },
        })
      ).map((d) => [d.publicId, d.id]),
    );
    const errors = input.lines.flatMap((l, i) => [
      ...((l.valuePct === null || l.valuePct === undefined) ===
      (l.valueAmount === null || l.valueAmount === undefined)
        ? [{ path: `lines[${i}]`, code: 'invalid', message: 'give exactly one of valuePct and valueAmount' }]
        : []),
      ...(l.difficultyLevelId && !levels.has(l.difficultyLevelId)
        ? [
            {
              path: `lines[${i}].difficultyLevelId`,
              code: 'exists',
              message: 'difficultyLevelId does not exist',
            },
          ]
        : []),
    ]);
    if (errors.length > 0) throw new DomainException('validation.failed', { errors });
    return this.prisma.withTx(async (tx) => {
      const last = await tx.sellMarginTableVersion.findFirst({
        where: { tableId: table.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.sellMarginTableVersion.create({
        data: {
          tableId: table.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: new Date(input.effectiveFrom),
          fallbackPct: input.fallbackPct ?? null,
          fallbackAmount: input.fallbackAmount ?? null,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      try {
        await tx.sellMarginLine.createMany({
          data: input.lines.map((l) => ({
            versionId: version.id,
            qtyMin: l.qtyMin,
            qtyMax: l.qtyMax,
            priceMin: l.priceMin,
            priceMax: l.priceMax,
            colourCount: l.colourCount,
            difficultyLevelId: l.difficultyLevelId ? levels.get(l.difficultyLevelId)! : null,
            valuePct: l.valuePct,
            valueAmount: l.valueAmount,
            minAmount: l.minAmount,
          })),
        });
      } catch (error) {
        if (
          String(error).includes('ex_sell_margin_lines__no_overlap') ||
          String(error).includes('ck_sell_margin_lines')
        ) {
          throw new DomainException('validation.failed', {
            errors: [{ path: 'lines', code: 'invalid', message: 'bands overlap or are out of order' }],
          });
        }
        throw error;
      }
      await this.record(tx, table.publicId, 'sell_margin_table.version_drafted', {
        versionNo: version.versionNo,
      });
      const row = await tx.sellMarginTableVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: VERSION_INCLUDE,
      });
      return versionDto(row);
    });
  }

  /** Approves a draft; it never applies retroactively: an effective date in the past becomes now. */
  async approve(actor: UserActor, versionPublicId: string): Promise<SellMarginVersionDto> {
    return this.prisma.withTx(async (tx) => {
      const version = await tx.sellMarginTableVersion.findUnique({
        where: { publicId: versionPublicId },
        include: { table: true },
      });
      if (!version) throw new DomainException('http.not_found');
      if (version.status !== 'draft') throw new DomainException('partners.proposal_closed');
      const now = new Date();
      const effectiveFrom = version.effectiveFrom < now ? now : version.effectiveFrom;
      await tx.sellMarginTableVersion.update({
        where: { id: version.id },
        data: { status: 'approved', effectiveFrom, decidedAt: now, decidedById: actor.userId },
      });
      await this.record(tx, version.table.publicId, 'sell_margin_table.version_approved', {
        versionNo: version.versionNo,
        effectiveFrom: effectiveFrom.toISOString(),
      });
      const row = await tx.sellMarginTableVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: VERSION_INCLUDE,
      });
      return versionDto(row);
    });
  }

  private async record(
    tx: Tx,
    tablePublicId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'sell_margin_table',
      resourcePublicId: tablePublicId,
      data,
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'sell_margin_table',
      aggregateId: tablePublicId,
      payload: { tableId: tablePublicId, ...data },
    });
  }
}
