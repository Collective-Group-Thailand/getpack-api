import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type StyleIntakeStatus } from '@generated/prisma/client';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { FILE_PURPOSES } from '@platform/files/file-purposes';
import { FilesService } from '@platform/files/files.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import {
  type ApproveStyleIntakeDto,
  type IntakeTermsDto,
  type MatchStyleIntakeDto,
  type StyleIntakeDto,
  type SubmitStyleIntakeDto,
} from './style-intakes.dto';

const RECIPE = { select: { publicId: true, version: true, base: { select: { code: true } } } } as const;
const INCLUDE = {
  factory: { select: { publicId: true, code: true, legalName: true, tradeName: true } },
  file: { select: { publicId: true, originalName: true, mimeType: true, sizeBytes: true } },
  termsVersion: { select: { versionNo: true } },
  proposedBase: { select: { code: true } },
  matchedRecipe: RECIPE,
  resultRecipe: RECIPE,
  templateBase: { select: { code: true } },
  reviewedBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.StyleIntakeInclude;
type Row = Prisma.StyleIntakeGetPayload<{ include: typeof INCLUDE }>;

const OPEN: StyleIntakeStatus[] = ['submitted', 'matched'];

/**
 * D-272 partner dieline intake: a factory (Owner, Planner) offers a DXF / PDF of a structure under the intake terms
 * in force (`styles.intake_terms`, none → closed); Prepress (`styles.approve_recipe`) matches it to an existing recipe
 * with a deviation report, approves it as a recipe imported from it (D-242) or as a fixed template of a base, or
 * rejects it. Provenance — factory, file sha256, terms version, reviewer — is frozen in the row (A-94 trigger).
 */
@Injectable()
export class StyleIntakesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly access: FactoryAccess,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async terms(): Promise<IntakeTermsDto> {
    const t = await this.currentTerms();
    return {
      version: t.versionNo,
      textTh: t.value.textTh,
      textEn: t.value.textEn,
      effectiveFrom: toBangkokIso(t.effectiveFrom),
    };
  }

  async submit(
    actor: UserActor,
    factoryPublicId: string,
    input: SubmitStyleIntakeDto,
  ): Promise<StyleIntakeDto> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const terms = await this.currentTerms();
    if (input.acceptedTermsVersion !== terms.versionNo)
      throw new DomainException('styles.intake_terms_outdated');
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const file = await this.files.get(actor, input.fileId).catch(() => {
      throw invalid('fileId', 'no such file of yours');
    });
    if (file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean' || !file.sha256)
      throw new DomainException('file.not_ready');
    if (!(FILE_PURPOSES.dieline.mimeTypes as readonly string[]).includes(file.mimeType))
      throw invalid('fileId', 'a dieline is a DXF, PDF or SVG file');
    const base = input.baseCode
      ? await this.prisma.styleBase.findUnique({ where: { code: input.baseCode }, select: { id: true } })
      : null;
    if (input.baseCode && !base) throw invalid('baseCode', 'no such style base');
    return this.prisma.withTx(async (tx) => {
      const row = await tx.styleIntake.create({
        data: {
          factoryId: factory.id,
          submittedById: actor.userId,
          title: input.title.trim(),
          note: input.note?.trim() || null,
          fileId: file.id,
          fileSha256: file.sha256!,
          termsVersionId: terms.versionId,
          proposedBaseId: base?.id ?? null,
        },
        include: INCLUDE,
      });
      await this.record(tx, actor, row, 'style_intake.submitted', { title: row.title });
      return dto(row, false);
    });
  }

  async listForFactory(actor: Actor, factoryPublicId: string): Promise<StyleIntakeDto[]> {
    const factory = await this.access.factory(actor, factoryPublicId);
    const rows = await this.prisma.styleIntake.findMany({
      where: { factoryId: factory.id },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => dto(r, false));
  }

  async list(status?: StyleIntakeStatus): Promise<StyleIntakeDto[]> {
    const rows = await this.prisma.styleIntake.findMany({
      where: status ? { status } : {},
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => dto(r, true));
  }

  async get(publicId: string): Promise<StyleIntakeDto> {
    const row = await this.prisma.styleIntake.findUnique({ where: { publicId }, include: INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return dto(row, true);
  }

  async match(actor: UserActor, publicId: string, input: MatchStyleIntakeDto): Promise<StyleIntakeDto> {
    return this.decide(actor, publicId, async (tx) => {
      const recipe = await tx.styleRecipe.findUnique({
        where: { publicId: input.recipeId },
        select: { id: true },
      });
      if (!recipe)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'recipeId', code: 'exists', message: 'no such style recipe' }],
        });
      return {
        data: {
          status: 'matched',
          matchedRecipeId: recipe.id,
          deviations: input.deviations.map((d) => ({ aspect: d.aspect.trim(), note: d.note.trim() })),
        },
        event: 'style_intake.matched',
        payload: { deviations: input.deviations.length },
      };
    });
  }

  async approve(actor: UserActor, publicId: string, input: ApproveStyleIntakeDto): Promise<StyleIntakeDto> {
    return this.decide(actor, publicId, async (tx) => {
      if (input.as === 'recipe') {
        const recipe = await tx.styleRecipe.findUnique({
          where: { publicId: input.recipeId! },
          select: { id: true },
        });
        if (!recipe)
          throw new DomainException('validation.failed', {
            errors: [{ path: 'recipeId', code: 'exists', message: 'no such style recipe' }],
          });
        return {
          data: { status: 'approved_recipe', resultRecipeId: recipe.id },
          event: 'style_intake.approved',
          payload: { as: 'recipe' },
        };
      }
      const base = await tx.styleBase.findUnique({ where: { code: input.baseCode! }, select: { id: true } });
      if (!base)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'baseCode', code: 'exists', message: 'no such style base' }],
        });
      return {
        data: { status: 'approved_template', templateBaseId: base.id },
        event: 'style_intake.approved',
        payload: { as: 'template', baseCode: input.baseCode! },
      };
    });
  }

  async reject(actor: UserActor, publicId: string, reason: string): Promise<StyleIntakeDto> {
    return this.decide(actor, publicId, () =>
      Promise.resolve({
        data: { status: 'rejected' as const, rejectReason: reason.trim() },
        event: 'style_intake.rejected',
        payload: {},
      }),
    );
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  private async decide(
    actor: UserActor,
    publicId: string,
    change: (tx: Tx) => Promise<{
      data: Prisma.StyleIntakeUncheckedUpdateInput;
      event: string;
      payload: Record<string, unknown>;
    }>,
  ): Promise<StyleIntakeDto> {
    return this.prisma.withTx(async (tx) => {
      const current = await tx.styleIntake.findUnique({ where: { publicId } });
      if (!current) throw new DomainException('http.not_found');
      if (!OPEN.includes(current.status)) throw new DomainException('styles.intake_decided');
      const { data, event, payload } = await change(tx);
      const row = await tx.styleIntake.update({
        where: { id: current.id },
        data: { ...data, reviewedById: actor.userId, reviewedAt: new Date() },
        include: INCLUDE,
      });
      await this.record(tx, actor, row, event, payload);
      return dto(row, true);
    });
  }

  private async record(tx: Tx, actor: UserActor, row: Row, type: string, data: Record<string, unknown>) {
    const payload = { intakeId: row.publicId, factoryId: row.factory.publicId, status: row.status, ...data };
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType: 'style_intake',
      resourcePublicId: row.publicId,
      data: { ...payload, by: actor.publicId },
    });
    await this.events.record(tx, {
      type,
      aggregateType: 'style_intake',
      aggregateId: row.publicId,
      payload,
    });
  }

  private async currentTerms() {
    try {
      return await this.settings.at('styles.intake_terms');
    } catch (error) {
      if (error instanceof SettingNotFoundError) throw new DomainException('styles.intake_closed');
      throw error;
    }
  }
}

function dto(r: Row, staff: boolean): StyleIntakeDto {
  const recipe = (x: Row['matchedRecipe']) =>
    x ? { id: x.publicId, baseCode: x.base.code, version: x.version } : null;
  return {
    id: r.publicId,
    factory: {
      id: r.factory.publicId,
      code: r.factory.code,
      name: r.factory.tradeName ?? r.factory.legalName,
    },
    title: r.title,
    note: r.note,
    file: {
      id: r.file.publicId,
      originalName: r.file.originalName,
      mimeType: r.file.mimeType,
      sizeBytes: Number(r.file.sizeBytes),
    },
    fileSha256: Buffer.from(r.fileSha256).toString('hex'),
    termsVersion: r.termsVersion.versionNo,
    proposedBaseCode: r.proposedBase?.code ?? null,
    status: r.status,
    matchedRecipe: recipe(r.matchedRecipe),
    deviations: (r.deviations as { aspect: string; note: string }[] | null) ?? null,
    resultRecipe: recipe(r.resultRecipe),
    templateBaseCode: r.templateBase?.code ?? null,
    rejectReason: r.rejectReason,
    reviewedBy:
      staff && r.reviewedBy ? { id: r.reviewedBy.publicId, displayName: r.reviewedBy.displayName } : null,
    reviewedAt: r.reviewedAt ? toBangkokIso(r.reviewedAt) : null,
    createdAt: toBangkokIso(r.createdAt),
  };
}
