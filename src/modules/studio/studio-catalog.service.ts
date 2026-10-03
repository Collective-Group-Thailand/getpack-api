import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Prisma, type StudioCatalogStatus, type StudioElementKind } from '@generated/prisma/client';
import { CompaniesService } from '@modules/companies/companies.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

/** The 7 use cases of the studio spec (§① Start); a template is tagged with some of them. */
export const USE_CASES = [
  'coffee',
  'cosmetics',
  'snacks',
  'e_commerce',
  'gift',
  'electronics',
  'pharmacy',
] as const;
export const LOGO_ROLES = ['primary', 'secondary', 'mark'] as const;

export interface BrandKitInput {
  name: string;
  palette: { name: string; hex: string; cmyk?: string }[];
  fontPairs: { heading: string; body: string }[];
  logos: { brandAssetId: string; role: (typeof LOGO_ROLES)[number] }[];
  usageNotes?: string | null;
}

export interface TemplateInput {
  code: string;
  nameTh: string;
  nameEn: string;
  useCases: string[];
  styleFamilies: string[];
  layoutSchemaVersion: number;
  layout: Record<string, unknown>;
  thumbnailFileId?: string | null;
}

export interface ElementInput {
  code: string;
  kind: StudioElementKind;
  nameTh: string;
  nameEn: string;
  path: string;
  tags: string[];
  requiresRight: boolean;
}

const KIT_INCLUDE = {
  company: { select: { publicId: true } },
  logos: {
    include: {
      brandAsset: { select: { publicId: true, name: true, fileObject: { select: { publicId: true } } } },
    },
    orderBy: { sort: 'asc' },
  },
} satisfies Prisma.BrandKitInclude;
export type KitRow = Prisma.BrandKitGetPayload<{ include: typeof KIT_INCLUDE }>;
export const kitEtag = (k: { publicId: string; rowVersion: number }) => etagOf(k.publicId, k.rowVersion);

const TEMPLATE_INCLUDE = {
  thumbnailFile: { select: { publicId: true } },
  createdBy: { select: { publicId: true, displayName: true } },
  approvedBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.StudioTemplateInclude;
export type TemplateRow = Prisma.StudioTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

/** A code already used: `catalog.code_taken` instead of a database error. */
async function codeTaken<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new DomainException('catalog.code_taken');
    throw error;
  }
}

/**
 * D-282 the studio's catalogue: company brand kits (Company Admin manages, every member uses — D-227), Packio's own
 * templates (Marketing / Prepress author, Marketing approves — never the author — before publication, D-216) and
 * elements (a mark with legal meaning needs a declared right before it can be placed). D-284: brand kits name only
 * fonts the studio serves.
 */
@Injectable()
export class StudioCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // --- brand kits -------------------------------------------------------------------------------------------

  async kits(actor: UserActor, companyPublicId: string): Promise<KitRow[]> {
    const company = await this.companies.forMember(actor, companyPublicId);
    return this.prisma.brandKit.findMany({
      where: { companyId: company.id, status: 'active' },
      include: KIT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async kit(actor: UserActor, companyPublicId: string, kitPublicId: string): Promise<KitRow> {
    const company = await this.companies.forMember(actor, companyPublicId);
    const row = await this.prisma.brandKit.findFirst({
      where: { publicId: kitPublicId, companyId: company.id },
      include: KIT_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async createKit(actor: UserActor, companyPublicId: string, input: BrandKitInput): Promise<KitRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.companies.forMember(actor, companyPublicId, 'company_assets.manage', tx);
      const logos = await this.kitRefs(tx, company.id, input);
      const kit = await tx.brandKit.create({
        data: {
          companyId: company.id,
          name: input.name.trim(),
          palette: input.palette.map((c) => ({ ...c, hex: c.hex.toLowerCase() })),
          fontPairs: input.fontPairs,
          usageNotes: input.usageNotes?.trim() || null,
          createdById: actor.userId,
          logos: { create: logos },
        },
        include: KIT_INCLUDE,
      });
      await this.record(tx, actor, 'brand_kit', kit.publicId, 'brand_kit.created', {
        companyId: companyPublicId,
      });
      return kit;
    });
  }

  async updateKit(
    actor: UserActor,
    companyPublicId: string,
    kitPublicId: string,
    ifMatch: string | undefined,
    input: BrandKitInput,
  ): Promise<KitRow> {
    return this.prisma.withTx(async (tx) => {
      const company = await this.companies.forMember(actor, companyPublicId, 'company_assets.manage', tx);
      const kit = await tx.brandKit.findFirst({ where: { publicId: kitPublicId, companyId: company.id } });
      if (!kit) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, kitEtag(kit));
      const logos = await this.kitRefs(tx, company.id, input);
      await tx.brandKitLogo.deleteMany({ where: { kitId: kit.id } });
      const updated = await tx.brandKit.update({
        where: { id: kit.id },
        data: {
          name: input.name.trim(),
          palette: input.palette.map((c) => ({ ...c, hex: c.hex.toLowerCase() })),
          fontPairs: input.fontPairs,
          usageNotes: input.usageNotes?.trim() || null,
          rowVersion: { increment: 1 },
          logos: { create: logos },
        },
        include: KIT_INCLUDE,
      });
      await this.record(tx, actor, 'brand_kit', kit.publicId, 'brand_kit.updated', {
        companyId: companyPublicId,
      });
      return updated;
    });
  }

  async archiveKit(actor: UserActor, companyPublicId: string, kitPublicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const company = await this.companies.forMember(actor, companyPublicId, 'company_assets.manage', tx);
      const kit = await tx.brandKit.findFirst({ where: { publicId: kitPublicId, companyId: company.id } });
      if (!kit) throw new DomainException('http.not_found');
      await tx.brandKit.update({
        where: { id: kit.id },
        data: { status: 'archived', rowVersion: { increment: 1 } },
      });
      await this.record(tx, actor, 'brand_kit', kit.publicId, 'brand_kit.archived', {
        companyId: companyPublicId,
      });
    });
  }

  /** The kit's logos are the company's own brand assets; its fonts the studio's served fonts (D-284). */
  private async kitRefs(tx: Tx, companyId: bigint, input: BrandKitInput) {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    const assets = await tx.companyBrandAsset.findMany({
      where: { companyId, publicId: { in: input.logos.map((l) => l.brandAssetId) }, removedAt: null },
      select: { id: true, publicId: true },
    });
    const logos = input.logos.map((l, i) => {
      const asset = assets.find((a) => a.publicId === l.brandAssetId);
      if (!asset) throw invalid(`logos[${i}].brandAssetId`, 'not a brand asset of the company');
      return { brandAssetId: asset.id, role: l.role, sort: i };
    });
    const fontIds = [...new Set(input.fontPairs.flatMap((p) => [p.heading, p.body]))];
    const fonts = await tx.designFont.count({
      where: {
        publicId: { in: fontIds },
        status: 'active',
        licence: 'ofl',
        printAllowed: true,
        embeddingAllowed: true,
      },
    });
    if (fonts !== fontIds.length) throw invalid('fontPairs', 'a font the studio does not serve (D-284)');
    return logos;
  }

  // --- templates --------------------------------------------------------------------------------------------

  async templates(q: { status?: StudioCatalogStatus; useCase?: string; styleFamily?: string }) {
    return this.prisma.studioTemplate.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.useCase && { useCases: { has: q.useCase } }),
        ...(q.styleFamily && { styleFamilies: { has: q.styleFamily } }),
      },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ code: 'asc' }],
      take: 500,
    });
  }

  async template(publicId: string, publishedOnly = false): Promise<TemplateRow> {
    const row = await this.prisma.studioTemplate.findUnique({
      where: { publicId },
      include: TEMPLATE_INCLUDE,
    });
    if (!row || (publishedOnly && row.status !== 'published')) throw new DomainException('http.not_found');
    return row;
  }

  async createTemplate(actor: UserActor, input: TemplateInput): Promise<TemplateRow> {
    return codeTaken(() =>
      this.prisma.withTx(async (tx) => {
        const row = await tx.studioTemplate.create({
          data: { ...(await this.templateData(tx, input)), createdById: actor.userId },
          include: TEMPLATE_INCLUDE,
        });
        await this.record(tx, actor, 'studio_template', row.publicId, 'studio_template.created', {
          code: row.code,
        });
        return row;
      }),
    );
  }

  /** A draft (or a template sent back) is edited; a submitted or published one is not. */
  async updateTemplate(actor: UserActor, publicId: string, input: TemplateInput): Promise<TemplateRow> {
    return this.prisma.withTx(async (tx) => {
      const current = await tx.studioTemplate.findUnique({ where: { publicId } });
      if (!current) throw new DomainException('http.not_found');
      if (current.status !== 'draft') throw new DomainException('studio.template_not_editable');
      const row = await tx.studioTemplate.update({
        where: { id: current.id },
        data: await this.templateData(tx, input),
        include: TEMPLATE_INCLUDE,
      });
      await this.record(tx, actor, 'studio_template', publicId, 'studio_template.updated', {
        code: row.code,
      });
      return row;
    });
  }

  async submitTemplate(actor: UserActor, publicId: string): Promise<TemplateRow> {
    return this.templateStep(actor, publicId, ['draft'], 'studio_template.submitted', () => ({
      status: 'pending_approval',
      submittedAt: new Date(),
    }));
  }

  /** Marketing approves a submitted template — never its author (maker-checker, D-216). */
  async approveTemplate(actor: UserActor, publicId: string): Promise<TemplateRow> {
    return this.templateStep(actor, publicId, ['pending_approval'], 'studio_template.published', (row) => {
      if (row.createdById === actor.userId) throw new DomainException('studio.maker_checker');
      return { status: 'published', approvedById: actor.userId, approvedAt: new Date() };
    });
  }

  /** Back to the author: a submitted template returns to draft. */
  async returnTemplate(actor: UserActor, publicId: string): Promise<TemplateRow> {
    return this.templateStep(actor, publicId, ['pending_approval'], 'studio_template.returned', () => ({
      status: 'draft',
      submittedAt: null,
    }));
  }

  async retireTemplate(actor: UserActor, publicId: string): Promise<TemplateRow> {
    return this.templateStep(actor, publicId, ['published'], 'studio_template.retired', () => ({
      status: 'retired',
    }));
  }

  private async templateStep(
    actor: UserActor,
    publicId: string,
    from: StudioCatalogStatus[],
    event: string,
    change: (row: { createdById: bigint }) => Prisma.StudioTemplateUncheckedUpdateInput,
  ): Promise<TemplateRow> {
    return this.prisma.withTx(async (tx) => {
      const current = await tx.studioTemplate.findUnique({ where: { publicId } });
      if (!current) throw new DomainException('http.not_found');
      if (!from.includes(current.status)) throw new DomainException('studio.template_not_editable');
      const row = await tx.studioTemplate.update({
        where: { id: current.id },
        data: change(current),
        include: TEMPLATE_INCLUDE,
      });
      await this.record(tx, actor, 'studio_template', publicId, event, {
        code: row.code,
        status: row.status,
      });
      return row;
    });
  }

  private async templateData(tx: Tx, input: TemplateInput) {
    const invalid = (path: string, message: string) =>
      new DomainException('validation.failed', { errors: [{ path, code: 'invalid', message }] });
    if (input.useCases.some((u) => !(USE_CASES as readonly string[]).includes(u)))
      throw invalid('useCases', `use cases: ${USE_CASES.join(', ')}`);
    const families = await tx.styleBase.findMany({ distinct: ['family'], select: { family: true } });
    if (families.length > 0 && input.styleFamilies.some((f) => !families.some((x) => x.family === f)))
      throw invalid('styleFamilies', 'not a style family of the library');
    let thumbnailFileId: bigint | null = null;
    if (input.thumbnailFileId) {
      const file = await tx.fileObject.findUnique({ where: { publicId: input.thumbnailFileId } });
      if (!file || file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean')
        throw invalid('thumbnailFileId', 'an uploaded, clean image');
      thumbnailFileId = file.id;
    }
    return {
      code: input.code,
      nameTh: input.nameTh.trim(),
      nameEn: input.nameEn.trim(),
      useCases: [...new Set(input.useCases)],
      styleFamilies: [...new Set(input.styleFamilies)],
      layoutSchemaVersion: input.layoutSchemaVersion,
      layout: input.layout as Prisma.InputJsonValue,
      thumbnailFileId,
    };
  }

  // --- elements and rights ----------------------------------------------------------------------------------

  async elements(q: { status?: StudioCatalogStatus; kind?: StudioElementKind }) {
    return this.prisma.studioElement.findMany({
      where: { ...(q.status && { status: q.status }), ...(q.kind && { kind: q.kind }) },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      take: 1000,
    });
  }

  async createElement(actor: UserActor, input: ElementInput) {
    return codeTaken(() =>
      this.prisma.withTx(async (tx) => {
        const row = await tx.studioElement.create({ data: { ...input, createdById: actor.userId } });
        await this.record(tx, actor, 'studio_element', row.publicId, 'studio_element.created', {
          code: row.code,
        });
        return row;
      }),
    );
  }

  async setElementStatus(actor: UserActor, publicId: string, status: StudioCatalogStatus) {
    return this.prisma.withTx(async (tx) => {
      const current = await tx.studioElement.findUnique({ where: { publicId } });
      if (!current) throw new DomainException('http.not_found');
      const row = await tx.studioElement.update({ where: { id: current.id }, data: { status } });
      await this.record(tx, actor, 'studio_element', publicId, 'studio_element.status_changed', { status });
      return row;
    });
  }

  /** Store: published elements, each telling whether the caller (or a company of theirs) declared its right. */
  async storeElements(actor: UserActor | null, kind?: StudioElementKind) {
    const rows = await this.elements({ status: 'published', kind });
    const declared = actor ? await this.declaredElementIds(actor.userId) : new Set<bigint>();
    return rows.map((r) => ({ row: r, declared: !r.requiresRight || declared.has(r.id) }));
  }

  /** D-282: the right to use a mark — for myself, or (Company Admin) for my company. */
  async declareRight(
    actor: UserActor,
    elementPublicId: string,
    input: { statement: string; companyId?: string },
  ) {
    return this.prisma.withTx(async (tx) => {
      const element = await tx.studioElement.findUnique({ where: { publicId: elementPublicId } });
      if (!element || element.status !== 'published') throw new DomainException('http.not_found');
      if (!element.requiresRight) throw new DomainException('studio.right_not_required');
      const company = input.companyId
        ? await this.companies.forMember(actor, input.companyId, 'company_assets.manage', tx)
        : null;
      const live = await tx.elementRightDeclaration.findFirst({
        where: {
          elementId: element.id,
          revokedAt: null,
          ...(company ? { companyId: company.id } : { userId: actor.userId }),
        },
      });
      if (live) return live;
      const row = await tx.elementRightDeclaration.create({
        data: {
          elementId: element.id,
          companyId: company?.id ?? null,
          userId: company ? null : actor.userId,
          statement: input.statement.trim(),
          declaredById: actor.userId,
        },
      });
      await this.record(tx, actor, 'studio_element', element.publicId, 'studio_element.right_declared', {
        declarationId: row.publicId,
        companyId: input.companyId ?? null,
      });
      return row;
    });
  }

  /** Elements requiring a right that a user may place: declared by them or by a company they are a member of. */
  async declaredElementIds(userId: bigint): Promise<Set<bigint>> {
    const companies = await this.prisma.companyMember.findMany({
      where: { userId, status: 'active' },
      select: { companyId: true },
    });
    const rows = await this.prisma.elementRightDeclaration.findMany({
      where: {
        revokedAt: null,
        OR: [{ userId }, { companyId: { in: companies.map((c) => c.companyId) } }],
      },
      select: { elementId: true },
    });
    return new Set(rows.map((r) => r.elementId));
  }

  private async record(
    tx: Tx,
    actor: UserActor,
    resourceType: string,
    publicId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      category: 'config',
      action: type,
      resourceType,
      resourcePublicId: publicId,
      data: { ...data, by: actor.publicId },
    });
    await this.events.record(
      tx,
      { type, aggregateType: resourceType, aggregateId: publicId, payload: { id: publicId, ...data } },
      actor,
    );
  }
}
