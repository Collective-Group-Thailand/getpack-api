import { OBJECT_STORAGE, type ObjectStorage } from '@collective/integrations/storage';
import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type DocumentBrandMarkKind,
  type DocumentSigningKind,
  type FileObject,
  Prisma,
} from '@generated/prisma/client';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { FilesService } from '@platform/files/files.service';

import { BrandImageError, type BrandImageKind, dataUri, prepareBrandImage } from './brand-image';
import { NO_BRANDING, type RenderBranding } from './render-branding';

/** Whose documents: getpack's legal entity or one partner factory (D-428). */
export type DocumentOwner = { kind: 'entity'; id: bigint } | { kind: 'factory'; id: bigint };

export const SIGNING_KINDS: readonly DocumentSigningKind[] = [
  'tax_invoice',
  'receipt',
  'invoice',
  'credit_note',
  'debit_note',
  'quotation',
  'sales_order',
  'delivery_note',
  'billing_note',
  'wht_certificate',
  'statement',
];

/** Which kinds a getpack entity issues (the factory ERP issues all of them). */
export const ENTITY_SIGNING_KINDS: readonly DocumentSigningKind[] = [
  'tax_invoice',
  'receipt',
  'invoice',
  'credit_note',
  'debit_note',
  'quotation',
  'wht_certificate',
  'statement',
];

const CACHE_LIMIT = 200;
const HISTORY_LIMIT = 40;

const ownerWhere = (o: DocumentOwner) =>
  o.kind === 'entity'
    ? { ownerKind: 'entity' as const, entityId: o.id }
    : { ownerKind: 'factory' as const, factoryId: o.id };

const ownerData = (o: DocumentOwner) =>
  o.kind === 'entity'
    ? { ownerKind: 'entity' as const, entityId: o.id, factoryId: null }
    : { ownerKind: 'factory' as const, factoryId: o.id, entityId: null };

export interface BrandMarkView {
  kind: DocumentBrandMarkKind;
  fileId: string;
  url: string | null;
  setAt: string;
  setBy: string;
}

export interface SignatoryView {
  id: string;
  userId: string;
  userName: string;
  email: string | null;
  displayName: string;
  position: string;
  hasSignature: boolean;
  signatureUrl: string | null;
  signatureUpdatedAt: string | null;
  addedAt: string;
}

export interface SigningRuleView {
  docKind: DocumentSigningKind;
  signatoryId: string | null;
  stampSeal: boolean;
  changedAt: string | null;
}

export interface BrandingHistoryView {
  at: string;
  by: string;
  change: 'logo' | 'seal' | 'signatory_added' | 'signatory_removed' | 'signature' | 'rule';
  detail: string;
}

export interface BrandingOverview {
  logo: BrandMarkView | null;
  seal: BrandMarkView | null;
  signatories: SignatoryView[];
  rules: SigningRuleView[];
  history: BrandingHistoryView[];
}

export interface MySignatoryView {
  id: string;
  owner: { kind: 'entity' | 'factory'; id: string; name: string };
  displayName: string;
  position: string;
  hasSignature: boolean;
  signatureUrl: string | null;
  signatureUpdatedAt: string | null;
  signs: DocumentSigningKind[];
}

/**
 * Logos, company seals and signatures on documents (D-428, D-429). Everything is a history: a change appends a
 * row and a document is rendered with what was in force when it was issued, so an issued document never changes
 * when the branding does. The owner's administrator sets the logo and the seal, names the signatories and decides
 * which signatory signs which kind of document and where the seal is stamped; only the signatory uploads their own
 * signature. Uploaded images are re-encoded (and a seal's or signature's paper made transparent) before use.
 */
@Injectable()
export class DocumentBrandingService {
  private readonly logger = new Logger(DocumentBrandingService.name);
  private readonly images = new Map<bigint, string | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ----------------------------------------------------------------------------------------------- rendering

  /** The branding a document of this kind prints, as it was at `at` (the document's issue time). */
  async resolve(
    owner: DocumentOwner,
    docKind: DocumentSigningKind,
    at: Date,
    db: Tx | PrismaService = this.prisma,
  ): Promise<RenderBranding> {
    const where = ownerWhere(owner);
    const [logo, rule] = await Promise.all([
      db.documentBrandMark.findFirst({
        where: { ...where, kind: 'logo', createdAt: { lte: at } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      db.documentSigningRule.findFirst({
        where: { ...where, docKind, createdAt: { lte: at } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    if (!logo?.fileId && !rule) return NO_BRANDING;
    const seal = rule?.stampSeal
      ? await db.documentBrandMark.findFirst({
          where: { ...where, kind: 'seal', createdAt: { lte: at } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      : null;
    let signature: RenderBranding['signature'] = null;
    if (rule?.signatoryId) {
      const signatory = await db.documentSignatory.findFirst({
        where: {
          id: rule.signatoryId,
          createdAt: { lte: at },
          OR: [{ removedAt: null }, { removedAt: { gt: at } }],
        },
      });
      const row = signatory
        ? await db.documentSignature.findFirst({
            where: { signatoryId: signatory.id, createdAt: { lte: at } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : null;
      if (row)
        signature = {
          image: row.fileId ? await this.image(row.fileId) : null,
          name: row.displayName,
          position: row.position,
        };
    }
    return {
      logo: logo?.fileId ? await this.image(logo.fileId) : null,
      seal: seal?.fileId ? await this.image(seal.fileId) : null,
      signature,
    };
  }

  /** A stored brand image as a data URI (cached: the rows are append-only, so a file id never changes content). */
  private async image(fileId: bigint): Promise<string | null> {
    if (this.images.has(fileId)) return this.images.get(fileId)!;
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    let uri: string | null = null;
    if (file && !file.purgedAt && file.mimeType.startsWith('image/')) {
      try {
        uri = dataUri(await this.read(file), file.mimeType);
      } catch (error) {
        this.logger.warn(`brand image ${file.publicId} unreadable: ${(error as Error).message}`);
        return null;
      }
    }
    if (this.images.size >= CACHE_LIMIT) this.images.delete(this.images.keys().next().value!);
    this.images.set(fileId, uri);
    return uri;
  }

  private async read(file: FileObject): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(file.storageKey))
      chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  // ----------------------------------------------------------------------------------------------- overview

  async overview(owner: DocumentOwner): Promise<BrandingOverview> {
    const where = ownerWhere(owner);
    const [marks, signatories, rules] = await Promise.all([
      this.prisma.documentBrandMark.findMany({
        where,
        include: { file: true, createdBy: { select: { displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
      }),
      this.prisma.documentSignatory.findMany({
        where,
        include: {
          user: { select: { publicId: true, displayName: true, email: true } },
          createdBy: { select: { displayName: true } },
          signatures: {
            include: { file: true, createdBy: { select: { displayName: true } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 10,
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.documentSigningRule.findMany({
        where,
        include: { signatory: true, createdBy: { select: { displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    ]);
    const mark = async (kind: DocumentBrandMarkKind): Promise<BrandMarkView | null> => {
      const row = marks.find((m) => m.kind === kind);
      if (!row?.file) return null;
      return {
        kind,
        fileId: row.file.publicId,
        url: (await this.files.signedUrl(row.file))?.url ?? null,
        setAt: toBangkokIso(row.createdAt),
        setBy: row.createdBy.displayName,
      };
    };
    const live = signatories.filter((s) => !s.removedAt);
    const kinds = owner.kind === 'entity' ? ENTITY_SIGNING_KINDS : SIGNING_KINDS;
    const latestRule = new Map<DocumentSigningKind, (typeof rules)[number]>();
    for (const r of rules) if (!latestRule.has(r.docKind)) latestRule.set(r.docKind, r);
    const history: BrandingHistoryView[] = [
      ...marks.map((m) => ({
        at: m.createdAt,
        by: m.createdBy.displayName,
        change: m.kind,
        detail: m.fileId ? 'set' : 'removed',
      })),
      ...signatories.flatMap((s) => [
        {
          at: s.createdAt,
          by: s.createdBy.displayName,
          change: 'signatory_added' as const,
          detail: s.user.displayName,
        },
        ...(s.removedAt
          ? [{ at: s.removedAt, by: '', change: 'signatory_removed' as const, detail: s.user.displayName }]
          : []),
        ...s.signatures
          .filter((g) => g.createdById === s.userId)
          .map((g) => ({
            at: g.createdAt,
            by: g.createdBy.displayName,
            change: 'signature' as const,
            detail: g.fileId ? `${g.displayName} · ${g.position}` : 'withdrawn',
          })),
      ]),
      ...rules.map((r) => ({
        at: r.createdAt,
        by: r.createdBy.displayName,
        change: 'rule' as const,
        detail: r.docKind,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, HISTORY_LIMIT)
      .map((h) => ({ ...h, at: toBangkokIso(h.at) }));
    return {
      logo: await mark('logo'),
      seal: await mark('seal'),
      signatories: await Promise.all(live.map((s) => this.signatoryView(s, s.signatures[0] ?? null))),
      rules: kinds.map((docKind) => {
        const r = latestRule.get(docKind);
        const signatoryLive = r?.signatory && !r.signatory.removedAt ? r.signatory.publicId : null;
        return {
          docKind,
          signatoryId: signatoryLive,
          stampSeal: r?.stampSeal ?? false,
          changedAt: r ? toBangkokIso(r.createdAt) : null,
        };
      }),
      history,
    };
  }

  private async signatoryView(
    s: {
      publicId: string;
      createdAt: Date;
      user: { publicId: string; displayName: string; email: string | null };
    },
    latest: { displayName: string; position: string; createdAt: Date; file: FileObject | null } | null,
  ): Promise<SignatoryView> {
    return {
      id: s.publicId,
      userId: s.user.publicId,
      userName: s.user.displayName,
      email: s.user.email,
      displayName: latest?.displayName ?? s.user.displayName,
      position: latest?.position ?? '',
      hasSignature: Boolean(latest?.file),
      signatureUrl: latest?.file ? ((await this.files.signedUrl(latest.file))?.url ?? null) : null,
      signatureUpdatedAt: latest?.file ? toBangkokIso(latest.createdAt) : null,
      addedAt: toBangkokIso(s.createdAt),
    };
  }

  // ----------------------------------------------------------------------------------------------- changes

  /** Sets (or with `null` removes) the logo or the seal from now on. */
  async setMark(
    actor: UserActor,
    owner: DocumentOwner,
    kind: DocumentBrandMarkKind,
    filePublicId: string | null,
  ): Promise<BrandingOverview> {
    const fileId = filePublicId
      ? await this.prepared(actor, owner, filePublicId, kind, `${kind}.png`, { ownerUserId: null, owner })
      : null;
    await this.prisma.withTx(async (tx) => {
      await tx.documentBrandMark.create({
        data: { ...ownerData(owner), kind, fileId, createdById: actor.userId },
      });
      // The factory ERP's settings show the same logo (D-368 kept as the current value).
      if (owner.kind === 'factory' && kind === 'logo')
        await tx.erpFactorySettings.upsert({
          where: { factoryId: owner.id },
          create: { factoryId: owner.id, documentLogoFileId: fileId, updatedById: actor.userId },
          update: { documentLogoFileId: fileId, updatedById: actor.userId, rowVersion: { increment: 1 } },
        });
      await this.audited(tx, actor, owner, `document_branding.${kind}_${fileId ? 'set' : 'removed'}`, {});
    });
    return this.overview(owner);
  }

  /** Names a person who may sign the owner's documents (staff for the entity, a member for a factory). */
  async addSignatory(
    actor: UserActor,
    owner: DocumentOwner,
    input: { userId: string; position: string },
  ): Promise<BrandingOverview> {
    await this.prisma.withTx(async (tx) => {
      const user = await tx.user.findUnique({ where: { publicId: input.userId } });
      if (
        !user ||
        user.deletedAt ||
        user.status !== 'active' ||
        !(await this.eligible(tx, owner, user.id, user.kind))
      )
        throw new DomainException('documents.signatory_not_eligible');
      const existing = await tx.documentSignatory.findFirst({
        where: { ...ownerWhere(owner), userId: user.id },
      });
      if (existing && !existing.removedAt) throw new DomainException('documents.signatory_exists');
      // A removed signatory is named again as a new row would clash with the unique key: reinstate instead.
      const signatory = existing
        ? await tx.documentSignatory.update({
            where: { id: existing.id },
            data: { removedAt: null },
          })
        : await tx.documentSignatory.create({
            data: { ...ownerData(owner), userId: user.id, createdById: actor.userId },
          });
      await tx.documentSignature.create({
        data: {
          signatoryId: signatory.id,
          fileId: null,
          displayName: user.displayName,
          position: input.position.trim(),
          createdById: actor.userId,
        },
      });
      await this.audited(tx, actor, owner, 'document_branding.signatory_added', { userId: user.publicId });
    });
    return this.overview(owner);
  }

  async removeSignatory(
    actor: UserActor,
    owner: DocumentOwner,
    signatoryPublicId: string,
  ): Promise<BrandingOverview> {
    await this.prisma.withTx(async (tx) => {
      const s = await tx.documentSignatory.findFirst({
        where: { ...ownerWhere(owner), publicId: signatoryPublicId, removedAt: null },
      });
      if (!s) throw new DomainException('http.not_found');
      await tx.documentSignatory.update({ where: { id: s.id }, data: { removedAt: new Date() } });
      await this.audited(tx, actor, owner, 'document_branding.signatory_removed', {
        signatoryId: s.publicId,
      });
    });
    return this.overview(owner);
  }

  /** Who signs a kind of document and whether the seal is stamped on it, from now on. */
  async setRule(
    actor: UserActor,
    owner: DocumentOwner,
    docKind: DocumentSigningKind,
    input: { signatoryId: string | null; stampSeal: boolean },
  ): Promise<BrandingOverview> {
    const kinds = owner.kind === 'entity' ? ENTITY_SIGNING_KINDS : SIGNING_KINDS;
    if (!kinds.includes(docKind)) throw new DomainException('http.not_found');
    await this.prisma.withTx(async (tx) => {
      let signatoryId: bigint | null = null;
      if (input.signatoryId) {
        const s = await tx.documentSignatory.findFirst({
          where: { ...ownerWhere(owner), publicId: input.signatoryId, removedAt: null },
        });
        if (!s) throw new DomainException('documents.signatory_not_eligible');
        signatoryId = s.id;
      }
      await tx.documentSigningRule.create({
        data: {
          ...ownerData(owner),
          docKind,
          signatoryId,
          stampSeal: input.stampSeal,
          createdById: actor.userId,
        },
      });
      await this.audited(tx, actor, owner, 'document_branding.rule_set', {
        docKind,
        signatoryId: input.signatoryId,
        stampSeal: input.stampSeal,
      });
    });
    return this.overview(owner);
  }

  /** People who may be named signatory: active staff (entity) or active members of the factory. */
  async candidates(owner: DocumentOwner, q: string | undefined) {
    const text = q?.trim();
    const where: Prisma.UserWhereInput = {
      status: 'active',
      deletedAt: null,
      ...(owner.kind === 'entity'
        ? { kind: 'staff' }
        : {
            kind: 'partner',
            roles: { some: { scopeType: 'factory', scopeId: owner.id, revokedAt: null } },
          }),
      ...(text
        ? {
            OR: [
              { displayName: { contains: text, mode: 'insensitive' } },
              { email: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const users = await this.prisma.user.findMany({
      where,
      select: { publicId: true, displayName: true, email: true },
      orderBy: { displayName: 'asc' },
      take: 20,
    });
    return users.map((u) => ({ id: u.publicId, name: u.displayName, email: u.email }));
  }

  // ----------------------------------------------------------------------------------------------- my signature

  /** Where the signed-in person is a signatory, with their current signature. */
  async mine(actor: UserActor): Promise<MySignatoryView[]> {
    const rows = await this.prisma.documentSignatory.findMany({
      where: { userId: actor.userId, removedAt: null },
      include: {
        entity: { select: { publicId: true, displayName: true } },
        factory: { select: { publicId: true, tradeName: true, legalName: true } },
        signatures: { include: { file: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    const out: MySignatoryView[] = [];
    for (const s of rows) {
      if (
        s.factoryId &&
        !actor.scopes.some((x) => x === `factory:${s.factory!.publicId}`) &&
        actor.audience === 'partner'
      )
        continue;
      const latest = s.signatures[0] ?? null;
      const rules = await this.prisma.documentSigningRule.findMany({
        where: s.entityId ? { entityId: s.entityId } : { factoryId: s.factoryId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const seen = new Set<DocumentSigningKind>();
      const signs: DocumentSigningKind[] = [];
      for (const r of rules) {
        if (seen.has(r.docKind)) continue;
        seen.add(r.docKind);
        if (r.signatoryId === s.id) signs.push(r.docKind);
      }
      out.push({
        id: s.publicId,
        owner: s.entity
          ? { kind: 'entity', id: s.entity.publicId, name: s.entity.displayName }
          : { kind: 'factory', id: s.factory!.publicId, name: s.factory!.tradeName ?? s.factory!.legalName },
        displayName: latest?.displayName ?? '',
        position: latest?.position ?? '',
        hasSignature: Boolean(latest?.file),
        signatureUrl: latest?.file ? ((await this.files.signedUrl(latest.file))?.url ?? null) : null,
        signatureUpdatedAt: latest?.file ? toBangkokIso(latest.createdAt) : null,
        signs,
      });
    }
    return out;
  }

  /**
   * The signatory sets their signature image (`fileId`; `null` withdraws it, `undefined` keeps it) and the name and
   * position printed under it. Only the signatory themself — never an administrator (D-429).
   */
  async updateMine(
    actor: UserActor,
    signatoryPublicId: string,
    input: { fileId?: string | null; displayName: string; position: string },
  ): Promise<MySignatoryView[]> {
    const s = await this.prisma.documentSignatory.findFirst({
      where: { publicId: signatoryPublicId, userId: actor.userId, removedAt: null },
    });
    if (!s) throw new DomainException('http.not_found');
    const owner: DocumentOwner = s.entityId
      ? { kind: 'entity', id: s.entityId }
      : { kind: 'factory', id: s.factoryId! };
    let fileId: bigint | null;
    if (input.fileId === undefined) {
      const latest = await this.prisma.documentSignature.findFirst({
        where: { signatoryId: s.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      fileId = latest?.fileId ?? null;
    } else if (input.fileId === null) fileId = null;
    else
      fileId = await this.prepared(actor, owner, input.fileId, 'signature', 'signature.png', {
        ownerUserId: actor.userId,
        owner: null,
      });
    await this.prisma.withTx(async (tx) => {
      await tx.documentSignature.create({
        data: {
          signatoryId: s.id,
          fileId,
          displayName: input.displayName.trim(),
          position: input.position.trim(),
          createdById: actor.userId,
        },
      });
      await this.audited(tx, actor, owner, 'document_branding.signature_updated', {
        signatoryId: s.publicId,
        image: input.fileId === undefined ? 'kept' : fileId ? 'set' : 'withdrawn',
      });
    });
    return this.mine(actor);
  }

  // ----------------------------------------------------------------------------------------------- helpers

  /** An uploaded image of the caller (or of the factory), clean, re-encoded and stored as a financial record. */
  private async prepared(
    actor: UserActor,
    owner: DocumentOwner,
    filePublicId: string,
    kind: BrandImageKind,
    name: string,
    store: { ownerUserId: bigint | null; owner: DocumentOwner | null },
  ): Promise<bigint> {
    const file = await this.prisma.fileObject.findUnique({ where: { publicId: filePublicId } });
    const mine =
      file &&
      (file.ownerUserId === actor.userId || (owner.kind === 'factory' && file.ownerFactoryId === owner.id));
    if (
      !file ||
      !mine ||
      file.uploadStatus !== 'uploaded' ||
      file.scanStatus !== 'clean' ||
      file.purgedAt ||
      !file.mimeType.startsWith('image/')
    )
      throw new DomainException('documents.image_not_usable', { params: { fileId: filePublicId } });
    let png: Buffer;
    try {
      png = await prepareBrandImage(await this.read(file), kind);
    } catch (error) {
      if (error instanceof BrandImageError)
        throw new DomainException('documents.image_not_usable', { params: { fileId: filePublicId } });
      throw error;
    }
    const stored = await this.files.storeSystem({
      body: png,
      fileName: name,
      mimeType: 'image/png',
      retentionClass: 'financial_record',
      ownerUserId: store.ownerUserId,
      ownerFactoryId: store.owner?.kind === 'factory' ? store.owner.id : null,
    });
    return stored.id;
  }

  private async eligible(tx: Tx, owner: DocumentOwner, userId: bigint, kind: string): Promise<boolean> {
    if (owner.kind === 'entity') return kind === 'staff';
    if (kind !== 'partner') return false;
    const n = await tx.userRole.count({
      where: { userId, scopeType: 'factory', scopeId: owner.id, revokedAt: null },
    });
    return n > 0;
  }

  private async audited(
    tx: Tx,
    actor: UserActor,
    owner: DocumentOwner,
    action: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const factory =
      owner.kind === 'factory'
        ? await tx.factory.findUnique({ where: { id: owner.id }, select: { publicId: true } })
        : null;
    await this.audit.record(tx, {
      category: 'config',
      action,
      actor,
      resourceType: owner.kind === 'entity' ? 'entity' : 'factory',
      ...(factory ? { resourcePublicId: factory.publicId } : {}),
      ...(owner.kind === 'entity' ? { entityId: owner.id } : {}),
      data,
    });
  }
}

/** The signing kind of a getpack customer document (D-429). */
export function signingKindOfCustomerDocument(docType: string, isTaxInvoice: boolean): DocumentSigningKind {
  switch (docType) {
    case 'tr':
      return 'tax_invoice';
    case 'rc':
      return isTaxInvoice ? 'tax_invoice' : 'receipt';
    case 'iv':
      return isTaxInvoice ? 'tax_invoice' : 'invoice';
    case 'cn':
      return 'credit_note';
    default:
      return 'debit_note';
  }
}
