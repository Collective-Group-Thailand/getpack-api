import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { RefResolver } from '@modules/catalog/crud/ref-resolver';
import { ScopingService } from '@modules/iam/scoping.service';
import { FactoriesService } from '@modules/partners/factories/factories.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FilesService } from '@platform/files/files.service';

import { type BoardStrengthSheetDto } from './board-sheets.dto';

/** A sheet takes effect now or later; a minute of clock slack, as for factory configuration (ADR-0005). */
const BACKDATE_SLACK_MS = 60_000;

const SHEET_INCLUDE = {
  factory: { select: { publicId: true, code: true, legalName: true, tradeName: true } },
  material: {
    select: {
      publicId: true,
      code: true,
      nameTh: true,
      nameEn: true,
      fluteType: { select: { code: true, layers: true } },
    },
  },
  dataSheetFile: { select: { publicId: true } },
  createdBy: { select: { publicId: true } },
} satisfies Prisma.BoardStrengthSheetInclude;
type SheetRow = Prisma.BoardStrengthSheetGetPayload<{ include: typeof SHEET_INCLUDE }>;

/** The board data the Structure Advisor reads (D-188): one sheet in force per factory × board. */
export interface SheetInForce {
  sheetId: string;
  factoryId: bigint;
  materialId: bigint;
  versionNo: number;
  ectKnPerM: number;
  caliperMm: number;
  grammageGsm: number;
}

/**
 * Board strength sheets (U2.2, D-236): staff holding `partners.manage` key in a partner's signed board data sheet
 * (ECT, caliper, grammage, test method, the signed file) for one factory × corrugated board. Rows are append-only: a
 * new version supersedes the one in force from its `effective_from` (never backdated). Audited and published as
 * `factory.board_strength_sheet_recorded` on the factory. A factory reads its own sheets (D-044).
 */
@Injectable()
export class BoardSheetsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FactoryAccess,
    private readonly factories: FactoriesService,
    private readonly scoping: ScopingService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    // A factory reads the signed sheets Packio keeps for it (D-044); staff read them with `files.read`.
    this.files.registerFileReader('board_strength_sheets', async (actor, file) => {
      if (!(actor.type === 'api_client' || (actor.type === 'user' && actor.audience === 'partner')))
        return false;
      const scope = await this.scoping.scopeOf(actor, 'factory');
      if (scope === 'all' || scope.length === 0) return false;
      const n = await this.prisma.boardStrengthSheet.count({
        where: { dataSheetFileId: file.id, factoryId: { in: [...scope] } },
      });
      return n > 0;
    });
  }

  async create(
    actor: UserActor,
    input: {
      factoryId: string;
      materialId: string;
      ectKnPerM: number;
      caliperMm: number;
      grammageGsm: number;
      testMethod: string;
      dataSheetFileId: string;
      signedOn: Date;
      effectiveFrom?: Date;
      note?: string;
    },
  ): Promise<BoardStrengthSheetDto> {
    const factory = await this.access.factory(actor, input.factoryId);
    const effectiveFrom = input.effectiveFrom ?? new Date();
    if (effectiveFrom.getTime() < Date.now() - BACKDATE_SLACK_MS)
      throw new DomainException('partners.backdated');
    if (bangkokDate(input.signedOn) > bangkokDate(new Date())) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'signedOn', code: 'past', message: 'signedOn cannot be in the future' }],
      });
    }
    const material = await this.prisma.material.findUnique({
      where: { publicId: input.materialId },
      select: { id: true, kind: true },
    });
    if (!material) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'materialId', code: 'exists', message: 'no material with this id' }],
      });
    }
    if (material.kind !== 'corrugated_board') throw new DomainException('advisory.material_not_board');

    return this.prisma.withTx(async (tx) => {
      const fileId = await new RefResolver(tx).file(input.dataSheetFileId, 'dataSheetFileId');
      // One writer per factory × board at a time, so version numbers never collide.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`board_sheet:${factory.id}:${material.id}`}))`;
      const last = await tx.boardStrengthSheet.findFirst({
        where: { factoryId: factory.id, materialId: material.id },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const row = await tx.boardStrengthSheet.create({
        data: {
          factoryId: factory.id,
          materialId: material.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          ectKnPerM: input.ectKnPerM,
          caliperMm: input.caliperMm,
          grammageGsm: input.grammageGsm,
          testMethod: input.testMethod.trim(),
          dataSheetFileId: fileId,
          signedOn: input.signedOn,
          effectiveFrom,
          note: input.note?.trim() || null,
          createdById: actor.userId,
        },
        include: SHEET_INCLUDE,
      });
      await this.factories.record(tx, factory.publicId, 'factory.board_strength_sheet_recorded', {
        sheetId: row.publicId,
        materialId: input.materialId,
        versionNo: row.versionNo,
        ectKnPerM: input.ectKnPerM,
        caliperMm: input.caliperMm,
        grammageGsm: input.grammageGsm,
        effectiveFrom: effectiveFrom.toISOString(),
      });
      return this.dto(row, await this.currentIds(tx, [row]));
    });
  }

  async get(actor: Actor, publicId: string): Promise<BoardStrengthSheetDto> {
    const row = await this.prisma.boardStrengthSheet.findFirst({
      where: { publicId, factory: await this.access.where(actor) },
      include: SHEET_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return this.dto(row, await this.currentIds(this.prisma, [row]));
  }

  async list(
    actor: Actor,
    query: { factoryId?: string; materialId?: string; currentOnly?: boolean; page: number; perPage: number },
  ): Promise<{ rows: BoardStrengthSheetDto[]; total: number }> {
    const where: Prisma.BoardStrengthSheetWhereInput = {
      factory: {
        AND: [await this.access.where(actor), query.factoryId ? { publicId: query.factoryId } : {}],
      },
      ...(query.materialId ? { material: { publicId: query.materialId } } : {}),
    };
    if (query.currentOnly) {
      const current = await this.inForce(this.prisma, { where });
      where.id = { in: current.map((c) => c.id) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.boardStrengthSheet.findMany({
        where,
        include: SHEET_INCLUDE,
        orderBy: [{ materialId: 'asc' }, { factoryId: 'asc' }, { versionNo: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.boardStrengthSheet.count({ where }),
    ]);
    const current = await this.currentIds(this.prisma, rows);
    return { rows: rows.map((r) => this.dto(r, current)), total };
  }

  /**
   * The sheet in force at `at` for each factory × board among `materialIds` (D-188): the greatest `effective_from ≤
   * at`, ties by version. Boards without one have no entry.
   */
  async sheetsInForce(db: Tx | PrismaService, materialIds: bigint[], at: Date): Promise<SheetInForce[]> {
    if (materialIds.length === 0) return [];
    const rows = await this.inForce(db, { where: { materialId: { in: materialIds } }, at });
    return rows.map((r) => ({
      sheetId: r.publicId,
      factoryId: r.factoryId,
      materialId: r.materialId,
      versionNo: r.versionNo,
      ectKnPerM: Number(r.ectKnPerM),
      caliperMm: Number(r.caliperMm),
      grammageGsm: Number(r.grammageGsm),
    }));
  }

  private async inForce(
    db: Tx | PrismaService,
    options: { where: Prisma.BoardStrengthSheetWhereInput; at?: Date },
  ) {
    const at = options.at ?? new Date();
    const candidates = await db.boardStrengthSheet.findMany({
      where: { ...options.where, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    const seen = new Set<string>();
    return candidates.filter((c) => {
      const key = `${c.factoryId}:${c.materialId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async currentIds(db: Tx | PrismaService, rows: SheetRow[]): Promise<Set<bigint>> {
    if (rows.length === 0) return new Set();
    const pairs = rows.map((r) => ({ factoryId: r.factoryId, materialId: r.materialId }));
    const current = await this.inForce(db, { where: { OR: pairs } });
    return new Set(current.map((c) => c.id));
  }

  private dto(row: SheetRow, current: Set<bigint>): BoardStrengthSheetDto {
    return {
      id: row.publicId,
      factory: {
        id: row.factory.publicId,
        code: row.factory.code,
        name: row.factory.tradeName ?? row.factory.legalName,
      },
      material: {
        id: row.material.publicId,
        code: row.material.code,
        nameTh: row.material.nameTh,
        nameEn: row.material.nameEn,
        flute: row.material.fluteType
          ? { code: row.material.fluteType.code, layers: row.material.fluteType.layers }
          : null,
      },
      versionNo: row.versionNo,
      ectKnPerM: Number(row.ectKnPerM),
      caliperMm: Number(row.caliperMm),
      grammageGsm: Number(row.grammageGsm),
      testMethod: row.testMethod,
      dataSheetFileId: row.dataSheetFile.publicId,
      signedOn: row.signedOn.toISOString().slice(0, 10),
      effectiveFrom: toBangkokIso(row.effectiveFrom),
      current: current.has(row.id),
      note: row.note,
      createdAt: toBangkokIso(row.createdAt),
      createdById: row.createdBy?.publicId ?? null,
    };
  }
}
