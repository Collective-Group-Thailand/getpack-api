import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma, type SalesChannel } from '@generated/prisma/client';
import { blank } from '@modules/pricing/calculators/corrugate/geometry';
import { assertStoreRules, validateConfiguration } from '@modules/pricing/quotes/configurations';
import { QuoteEngineService } from '@modules/pricing/quotes/quote-engine.service';
import { Injectable, Logger } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { type AdvisoryRuleSet } from '@platform/settings/setting-keys';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import {
  type AdminAdvisoryRecommendationDto,
  type AdvisoryBoardDto,
  type AdvisoryLoadDto,
  type AdvisoryMethodDto,
  type AdvisoryOptionDto,
  type AdvisoryRecommendationDto,
  NOTICE_CODE,
  type ReplayResultDto,
} from './advisory.dto';
import { BoardSheetsService, type SheetInForce } from './board-sheets.service';
import { type ParsedRuleSet, parseRuleSet, RuleSetError } from './rule-set';
import {
  ADVISOR_ENGINE_VERSION,
  type AdvisoryLoadInputs,
  type BoxGeometry,
  type CandidateBoard,
  type EngineOutput,
  evaluate,
} from './structure-engine';

/** Feature flag of the customer-facing advisor (D-237): off until the D-189 golden cases are signed. */
export const ADVISOR_FLAG = 'advisory.structure_advisor';
/** Technical cap on boards priced per request (gap §U2.2 assumption 4), strongest first; not a business value. */
const MAX_PRICED_BOARDS = 12;

export type AdvisoryOwner =
  | { kind: 'customer'; userId: bigint }
  | { kind: 'anonymous'; anonymousId: string }
  | { kind: 'staff'; userId: bigint };

/** A board as logged: the engine's input plus whose sheet it used (staff only, D-236). */
interface LoggedBoard extends CandidateBoard {
  factoryId: string | null;
  sheetSource: 'priced_factory' | 'lowest_sheet' | 'none';
}

interface LoggedInputs {
  productTypeCode: string;
  configuration: Record<string, unknown>;
  deliveryPostcode: string | null;
  load: AdvisoryLoadInputs;
  box: BoxGeometry;
}

const REC_INCLUDE = {
  ruleSetVersion: { select: { versionNo: true, effectiveFrom: true } },
  choices: { orderBy: { id: 'desc' }, include: { material: { select: { publicId: true } } } },
  customer: { select: { publicId: true } },
  createdBy: { select: { publicId: true } },
  quotes: { select: { publicId: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.AdvisoryRecommendationInclude;
type RecRow = Prisma.AdvisoryRecommendationGetPayload<{ include: typeof REC_INCLUDE }>;

const BOARD_SELECT = {
  id: true,
  publicId: true,
  code: true,
  nameTh: true,
  nameEn: true,
  fluteType: {
    select: {
      code: true,
      layers: true,
      colA: true,
      colC: true,
      colDd: true,
      colG: true,
      colFh: true,
      ct: true,
      z: true,
    },
  },
} satisfies Prisma.MaterialSelect;
type BoardRow = Prisma.MaterialGetPayload<{ select: typeof BOARD_SELECT }>;

const n0 = (v: Prisma.Decimal | null) => (v === null ? 0 : Number(v));

/**
 * Structure Advisor (U2.2, D-188, D-189, D-235–D-240). Recommends a corrugated board for a configuration and a load:
 * every compatible board with a signed sheet is priced through the **real** quote engine (no calculate log — the
 * advisor is not a customer calculation, D-102), the pure engine ranks them, and the run is logged write-once with
 * everything a replay needs. Customers reach it only with the flag on; staff evaluate at any time. Reason codes and
 * numbers only; no factory, sheet or excluded board on the store (D-050, D-236).
 */
@Injectable()
export class AdvisoryService {
  private readonly logger = new Logger(AdvisoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly settings: SettingsService,
    private readonly flags: FeatureFlagsService,
    private readonly sheets: BoardSheetsService,
    private readonly events: DomainEvents,
  ) {}

  /** `store.advisory.getMethod`: the rule set in force — the row the engine reads (DoD public representation). */
  async method(): Promise<AdvisoryMethodDto> {
    const rules = await this.ruleSet().catch(() => null);
    const enabled = await this.flags.isEnabled(ADVISOR_FLAG);
    return {
      available: enabled && rules !== null,
      noticeCode: NOTICE_CODE,
      engineVersion: ADVISOR_ENGINE_VERSION,
      ruleSetVersion: rules
        ? { versionNo: rules.versionNo, effectiveFrom: toBangkokIso(rules.effectiveFrom) }
        : null,
      ruleSet: rules ? (rules.value as unknown as Record<string, unknown>) : null,
    };
  }

  async recommend(
    owner: AdvisoryOwner,
    channel: SalesChannel,
    input: {
      productTypeCode: string;
      configuration: Record<string, unknown>;
      load: AdvisoryLoadDto;
      deliveryPostcode?: string;
    },
  ): Promise<RecRow> {
    const staff = owner.kind === 'staff';
    if (!staff && !(await this.flags.isEnabled(ADVISOR_FLAG))) throw new DomainException('advisory.disabled');
    const rules = await this.ruleSet();
    const now = new Date();

    const type = await this.prisma.productType.findFirst({
      where: { code: input.productTypeCode, status: 'active' },
    });
    if (!type) throw new DomainException('pricing.not_instant');
    if (type.calculatorKey !== 'corrugate') throw new DomainException('advisory.not_supported');
    if (!staff && type.quoteMode !== 'instant') throw new DomainException('pricing.not_instant');
    const configuration = await validateConfiguration('corrugate', input.configuration, { staff });
    if (!staff) await assertStoreRules(this.prisma, 'corrugate', configuration);

    const pattern = await this.prisma.pattern.findUnique({
      where: { publicId: String(configuration['patternId']) },
      select: {
        id: true,
        corrugateFormula: true,
        productTypeId: true,
        fluteTypes: { select: { fluteTypeId: true } },
      },
    });
    if (!pattern || pattern.productTypeId !== type.id) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'configuration.patternId', code: 'exists', message: 'no such corrugate pattern' }],
      });
    }
    // D-235: McKee only on the styles the rule set lists; a flat sheet has no box to stack.
    if (
      !pattern.corrugateFormula ||
      !rules.parsed.formulas.includes(pattern.corrugateFormula) ||
      !(Number(configuration['d']) > 0)
    ) {
      throw new DomainException('advisory.not_supported');
    }
    const catalogProduct =
      typeof configuration['catalogProductId'] === 'string'
        ? await this.prisma.catalogProduct.findUnique({
            where: { publicId: configuration['catalogProductId'] },
            select: { id: true, options: { where: { optionKind: 'material' }, select: { optionId: true } } },
          })
        : null;

    const boards = await this.candidateBoards(pattern, catalogProduct?.options.map((o) => o.optionId) ?? []);
    const sheets = await this.sheets.sheetsInForce(
      this.prisma,
      boards.map((b) => b.id),
      now,
    );
    const strength = (s: SheetInForce) => s.ectKnPerM * Math.sqrt(s.caliperMm);
    const lowestSheet = (materialId: bigint) =>
      sheets.filter((s) => s.materialId === materialId).sort((a, b) => strength(a) - strength(b))[0] ?? null;
    const withData = boards
      .filter((b) => lowestSheet(b.id))
      .sort(
        (a, b) => strength(lowestSheet(b.id)!) - strength(lowestSheet(a.id)!) || a.code.localeCompare(b.code),
      )
      .slice(0, MAX_PRICED_BOARDS);
    const withoutData = boards.filter((b) => !lowestSheet(b.id));

    const quantity = (configuration['quantities'] as number[])[0]!;
    const factoryIds = new Map<string, bigint>();
    const priced: {
      board: BoardRow;
      price: CandidateBoard['price'];
      factoryPublicId: string | null;
      size: BoxGeometry | null;
    }[] = [];
    for (const board of withData) {
      try {
        const view = await this.engine.price(
          'corrugate',
          { ...configuration, materialId: board.publicId },
          { channel, at: now, log: false, deliveryPostcode: input.deliveryPostcode },
        );
        const step = view.steps.find((s) => s.quantity === quantity) ?? view.steps[0];
        const instant = Boolean(step?.instant && step.unitPrice !== null);
        const factoryPublicId = instant ? (step?.internal?.factoryId ?? null) : null;
        const p = view.dimensions?.priced;
        priced.push({
          board,
          price: {
            instant,
            unitPrice: instant ? step!.unitPrice : null,
            grossAmount: instant ? step!.grossAmount : null,
            leadTimeDays: instant ? step!.leadTimeDays : null,
          },
          factoryPublicId,
          size: p ? { l: p.l, w: p.w, d: p.d } : null,
        });
      } catch (error) {
        // A board this configuration cannot be priced on (e.g. no caliper for a non-internal basis) stays unpriced.
        if (!(error instanceof DomainException)) throw error;
        priced.push({
          board,
          price: { instant: false, unitPrice: null, grossAmount: null, leadTimeDays: null },
          factoryPublicId: null,
          size: null,
        });
      }
    }
    if (priced.some((p) => p.factoryPublicId)) {
      const rows = await this.prisma.factory.findMany({
        where: {
          publicId: { in: priced.map((p) => p.factoryPublicId).filter((x): x is string => x !== null) },
        },
        select: { id: true, publicId: true },
      });
      for (const r of rows) factoryIds.set(r.publicId, r.id);
    }

    // The inside size priced (D-182); with several, the smallest perimeter (conservative).
    const sizes = priced.map((p) => p.size).filter((s): s is BoxGeometry => s !== null);
    const box: BoxGeometry = sizes.sort((a, b) => a.l + a.w - (b.l + b.w))[0] ?? {
      l: Number(configuration['l']),
      w: Number(configuration['w']),
      d: Number(configuration['d']),
    };

    const logged: LoggedBoard[] = [
      ...priced.map(({ board, price, factoryPublicId }): LoggedBoard => {
        const factoryId = factoryPublicId ? factoryIds.get(factoryPublicId) : undefined;
        const sheet =
          factoryId !== undefined
            ? (sheets.find((s) => s.materialId === board.id && s.factoryId === factoryId) ?? null)
            : lowestSheet(board.id);
        return {
          materialId: board.publicId,
          sheet: sheet
            ? {
                sheetId: sheet.sheetId,
                ectKnPerM: sheet.ectKnPerM,
                caliperMm: sheet.caliperMm,
                grammageGsm: sheet.grammageGsm,
              }
            : null,
          blankAreaSqm: blankArea(pattern.corrugateFormula!, box, board),
          price,
          factoryId: factoryPublicId,
          sheetSource: !sheet ? 'none' : factoryId !== undefined ? 'priced_factory' : 'lowest_sheet',
        };
      }),
      ...withoutData.map((board): LoggedBoard => ({
        materialId: board.publicId,
        sheet: null,
        blankAreaSqm: blankArea(pattern.corrugateFormula!, box, board),
        price: { instant: false, unitPrice: null, grossAmount: null, leadTimeDays: null },
        factoryId: null,
        sheetSource: 'none',
      })),
    ];
    const load: AdvisoryLoadInputs = {
      productWeightG: input.load.productWeightG,
      unitsPerBox: input.load.unitsPerBox,
      stackLayers: input.load.stackLayers,
      pallet: input.load.pallet
        ? { pattern: input.load.pallet.pattern, overhang: input.load.pallet.overhang }
        : null,
      fragility: input.load.fragility,
      transportMode: input.load.transportMode,
      humidity: input.load.humidity,
      storage: input.load.storage,
    };
    const output = evaluate(load, box, logged.map(engineBoard), rules.parsed);
    const inputs: LoggedInputs = {
      productTypeCode: input.productTypeCode,
      configuration,
      deliveryPostcode: input.deliveryPostcode ?? null,
      load,
      box,
    };
    const ids = new Map(boards.map((b) => [b.publicId, b.id]));

    return this.prisma.withTx(async (tx) => {
      const row = await tx.advisoryRecommendation.create({
        data: {
          channel,
          customerUserId: owner.kind === 'customer' ? owner.userId : null,
          anonymousId: owner.kind === 'anonymous' ? owner.anonymousId : null,
          createdById: owner.kind === 'staff' ? owner.userId : null,
          productTypeId: type.id,
          patternId: pattern.id,
          catalogProductId: catalogProduct?.id ?? null,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          ruleSetVersionId: rules.versionId,
          ruleSet: rules.value as unknown as Prisma.InputJsonValue,
          engineVersion: ADVISOR_ENGINE_VERSION,
          boards: logged as unknown as Prisma.InputJsonValue,
          output: output as unknown as Prisma.InputJsonValue,
          outcome: output.outcome,
          recommendedMaterialId: output.recommendedMaterialId ? ids.get(output.recommendedMaterialId)! : null,
          warningCodes: output.warnings,
        },
      });
      await this.events.record(tx, {
        type: 'advisory.recommended',
        aggregateType: 'advisory_recommendation',
        aggregateId: row.publicId,
        payload: {
          recommendationId: row.publicId,
          channel,
          productTypeCode: input.productTypeCode,
          outcome: output.outcome,
          recommendedBoardId: output.recommendedMaterialId,
          warnings: output.warnings,
          ruleSetVersionNo: rules.versionNo,
          engineVersion: ADVISOR_ENGINE_VERSION,
        },
      });
      return tx.advisoryRecommendation.findUniqueOrThrow({ where: { id: row.id }, include: REC_INCLUDE });
    });
  }

  /** The recommendation of a store owner (customer or the same anonymous session); anything else is 404. */
  async getOwned(owner: AdvisoryOwner, publicId: string): Promise<RecRow> {
    const row = await this.prisma.advisoryRecommendation.findUnique({
      where: { publicId },
      include: REC_INCLUDE,
    });
    if (!row || !owns(owner, row)) throw new DomainException('http.not_found');
    return row;
  }

  async get(publicId: string): Promise<RecRow> {
    const row = await this.prisma.advisoryRecommendation.findUnique({
      where: { publicId },
      include: REC_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** D-240 / D-189: record the board chosen, acknowledging every warning code it carries. */
  async choose(
    owner: AdvisoryOwner,
    publicId: string,
    input: { materialId: string; acknowledgedWarnings: string[] },
  ): Promise<RecRow> {
    const row = await this.getOwned(owner, publicId);
    const output = row.output as unknown as EngineOutput;
    const option = output.options.find((o) => o.materialId === input.materialId);
    if (!option) throw new DomainException('advisory.option_unknown');
    const acknowledged = [...new Set(input.acknowledgedWarnings)];
    if (option.warnings.some((w) => !acknowledged.includes(w))) {
      throw new DomainException('advisory.acknowledgement_required', {
        params: { warnings: option.warnings.join(', ') },
      });
    }
    const material = await this.prisma.material.findUniqueOrThrow({
      where: { publicId: input.materialId },
      select: { id: true },
    });
    return this.prisma.withTx(async (tx) => {
      const choice = await tx.advisoryChoice.create({
        data: {
          recommendationId: row.id,
          materialId: material.id,
          acknowledgedWarnings: acknowledged,
          chosenByUserId: owner.kind === 'customer' ? owner.userId : null,
          anonymousId: owner.kind === 'anonymous' ? owner.anonymousId : null,
        },
      });
      await this.events.record(tx, {
        type: 'advisory.option_chosen',
        aggregateType: 'advisory_recommendation',
        aggregateId: row.publicId,
        payload: {
          recommendationId: row.publicId,
          choiceId: choice.publicId,
          boardId: input.materialId,
          recommended: input.materialId === output.recommendedMaterialId,
          acknowledgedWarnings: acknowledged,
        },
      });
      return tx.advisoryRecommendation.findUniqueOrThrow({ where: { id: row.id }, include: REC_INCLUDE });
    });
  }

  async list(query: {
    outcome?: 'recommended' | 'no_board_meets_load';
    customerId?: string;
    page: number;
    perPage: number;
  }): Promise<{ rows: RecRow[]; total: number }> {
    const where: Prisma.AdvisoryRecommendationWhereInput = {
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.customerId ? { customer: { publicId: query.customerId } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.advisoryRecommendation.findMany({
        where,
        include: REC_INCLUDE,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.advisoryRecommendation.count({ where }),
    ]);
    return { rows, total };
  }

  /** D-240: re-run the engine on the logged inputs, board data and rule set; the result must equal the log. */
  async replay(publicId: string): Promise<ReplayResultDto> {
    const row = await this.get(publicId);
    const inputs = row.inputs as unknown as LoggedInputs;
    const boards = row.boards as unknown as LoggedBoard[];
    const replayed = evaluate(
      inputs.load,
      inputs.box,
      boards.map(engineBoard),
      parseRuleSet(row.ruleSet as unknown as AdvisoryRuleSet),
    );
    const differences = diff(row.output, JSON.parse(JSON.stringify(replayed)) as unknown);
    return { identical: differences.length === 0, differences, engineVersion: ADVISOR_ENGINE_VERSION };
  }

  // --- Views

  async storeView(row: RecRow): Promise<AdvisoryRecommendationDto> {
    const output = row.output as unknown as EngineOutput;
    const boards = await this.boardViews(output.options.map((o) => o.materialId));
    const choice = row.choices[0];
    return {
      id: row.publicId,
      outcome: row.outcome,
      noticeCode: NOTICE_CODE,
      engineVersion: row.engineVersion,
      ruleSetVersion: {
        versionNo: row.ruleSetVersion.versionNo,
        effectiveFrom: toBangkokIso(row.ruleSetVersion.effectiveFrom),
      },
      requirement: output.requirement,
      recommendedBoardId: output.recommendedMaterialId,
      closestBoardId: output.closestMaterialId,
      options: output.options.map((o): AdvisoryOptionDto => ({
        board: boards.get(o.materialId)!,
        ectKnPerM: o.ectKnPerM,
        caliperMm: o.caliperMm,
        grammageGsm: o.grammageGsm,
        bct: o.bctN,
        requiredEctKnPerM: o.requiredEctKnPerM,
        marginPct: o.marginPct,
        passes: o.passes,
        instant: o.instant,
        unitPrice: o.unitPrice,
        grossAmount: o.grossAmount,
        currency: 'THB',
        leadTimeDays: o.leadTimeDays,
        roles: o.roles,
        warnings: o.warnings,
      })),
      alternatives: output.alternatives.map((a) => ({
        boardId: a.materialId,
        roles: a.roles,
        unitPriceDelta: a.unitPriceDelta,
        leadTimeDeltaDays: a.leadTimeDeltaDays,
      })),
      warnings: output.warnings,
      reasons: output.reasons,
      choice: choice ? choiceView(choice) : null,
      createdAt: toBangkokIso(row.createdAt),
    };
  }

  async adminView(row: RecRow): Promise<AdminAdvisoryRecommendationDto> {
    const output = row.output as unknown as EngineOutput;
    const boards = row.boards as unknown as LoggedBoard[];
    const views = await this.boardViews(output.excluded.map((e) => e.materialId));
    return {
      ...(await this.storeView(row)),
      channel: row.channel,
      customerId: row.customer?.publicId ?? null,
      anonymousId: row.anonymousId,
      createdById: row.createdBy?.publicId ?? null,
      excluded: output.excluded.map((e) => ({ board: views.get(e.materialId)!, reason: e.reason })),
      boardData: boards.map((b) => ({
        boardId: b.materialId,
        sheetId: b.sheet?.sheetId ?? null,
        factoryId: b.factoryId,
        sheetSource: b.sheetSource,
      })),
      inputs: row.inputs as Record<string, unknown>,
      ruleSet: row.ruleSet as Record<string, unknown>,
      quoteIds: row.quotes.map((q) => q.publicId),
      choices: row.choices.map(choiceView),
    };
  }

  // --- Internals

  private async ruleSet(): Promise<{
    value: AdvisoryRuleSet;
    parsed: ParsedRuleSet;
    versionId: bigint;
    versionNo: number;
    effectiveFrom: Date;
  }> {
    try {
      const resolved = await this.settings.at('advisory.rule_set');
      return {
        value: resolved.value,
        parsed: parseRuleSet(resolved.value),
        versionId: resolved.versionId,
        versionNo: resolved.versionNo,
        effectiveFrom: resolved.effectiveFrom,
      };
    } catch (error) {
      if (error instanceof SettingNotFoundError) throw new DomainException('advisory.not_configured');
      if (error instanceof RuleSetError) {
        this.logger.error(error.message);
        throw new DomainException('advisory.not_configured');
      }
      throw error;
    }
  }

  /** Active corrugated boards whose flute the pattern allows, within the catalogue product's materials if it lists any. */
  private async candidateBoards(
    pattern: { fluteTypes: { fluteTypeId: bigint }[] },
    productMaterialIds: bigint[],
  ): Promise<BoardRow[]> {
    return this.prisma.material.findMany({
      where: {
        kind: 'corrugated_board',
        status: 'active',
        fluteTypeId: { in: pattern.fluteTypes.map((f) => f.fluteTypeId) },
        ...(productMaterialIds.length > 0 ? { id: { in: productMaterialIds } } : {}),
      },
      select: BOARD_SELECT,
      orderBy: { code: 'asc' },
    });
  }

  private async boardViews(publicIds: string[]): Promise<Map<string, AdvisoryBoardDto>> {
    const rows = await this.prisma.material.findMany({
      where: { publicId: { in: publicIds } },
      select: BOARD_SELECT,
    });
    return new Map(
      rows.map((r) => [
        r.publicId,
        {
          id: r.publicId,
          code: r.code,
          nameTh: r.nameTh,
          nameEn: r.nameEn,
          fluteCode: r.fluteType?.code ?? null,
          layers: r.fluteType?.layers ?? null,
        },
      ]),
    );
  }
}

/** The engine's view of a logged board (drops the staff-only columns). */
function engineBoard(b: LoggedBoard): CandidateBoard {
  return { materialId: b.materialId, sheet: b.sheet, blankAreaSqm: b.blankAreaSqm, price: b.price };
}

/** The ported corrugate blank of the box on the board's flute (no factory adjustment), m². */
function blankArea(formula: string, box: BoxGeometry, board: BoardRow): number {
  const f = board.fluteType;
  return blank({
    formula: formula as Parameters<typeof blank>[0]['formula'],
    w: box.w,
    l: box.l,
    d: box.d,
    flute: {
      a: n0(f?.colA ?? null),
      c: n0(f?.colC ?? null),
      dd: n0(f?.colDd ?? null),
      g: n0(f?.colG ?? null),
      fh: n0(f?.colFh ?? null),
      ct: n0(f?.ct ?? null),
      z: n0(f?.z ?? null),
    },
    conditions: {},
    plus: null,
  }).areaSqm;
}

function owns(
  owner: AdvisoryOwner,
  row: { customerUserId: bigint | null; anonymousId: string | null },
): boolean {
  if (owner.kind === 'customer') return row.customerUserId === owner.userId;
  if (owner.kind === 'anonymous') return row.customerUserId === null && row.anonymousId === owner.anonymousId;
  return false;
}

function choiceView(c: RecRow['choices'][number]) {
  return {
    id: c.publicId,
    boardId: c.material.publicId,
    acknowledgedWarnings: c.acknowledgedWarnings as AdvisoryOptionDto['warnings'],
    chosenAt: toBangkokIso(c.createdAt),
  };
}

/** JSON paths where two JSON values differ (replay check). */
export function diff(a: unknown, b: unknown, path = '$'): string[] {
  if (a === b) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return [path];
  if (Array.isArray(a) !== Array.isArray(b)) return [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
  return [...keys].flatMap((k) =>
    diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`),
  );
}

export type { RecRow as AdvisoryRecommendationRow };
