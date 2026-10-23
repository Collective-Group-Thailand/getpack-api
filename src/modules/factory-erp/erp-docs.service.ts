import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { paginated, toSkipTake } from '@common/pagination/pagination';
import { addCalendarDays, bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { type ErpPrismaService, type ErpTx } from '@database/erp-prisma.service';
import {
  type ErpDocCategory,
  type ErpDocLink,
  type ErpRecordStatus,
  type FileObject,
  type Prisma,
} from '@generated/prisma-erp/client';
import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { ErpAlertsService } from './erp-alerts.service';
import {
  type ErpAddDocVersionDto,
  type ErpCreateDocDto,
  type ErpDocDto,
  type ErpDocFileDto,
  type ErpDocFolderDto,
  type ErpDocListQuery,
  type ErpDocSummaryDto,
  type ErpSaveFolderDto,
  type ErpUpdateDocDto,
} from './erp-e3.dto';
import { type ErpScope, ErpWorkspace } from './erp-workspace.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => bangkokDate(new Date());

const DOC_INCLUDE = {
  folder: true,
  versions: {
    include: { file: true, createdBy: { select: { displayName: true } } },
    orderBy: { version: 'desc' },
  },
} as const;
type DocRow = Prisma.ErpDocGetPayload<{ include: typeof DOC_INCLUDE }>;

/** none / valid / expiring (within the reminder window) / expired, as of today (D-356). */
export function expiryOf(expiresOn: string | null, remindDays: number, asOf = today()): string {
  if (!expiresOn) return 'none';
  if (expiresOn < asOf) return 'expired';
  return expiresOn <= addCalendarDays(asOf, remindDays) ? 'expiring' : 'valid';
}

/**
 * The factory's documents (D-356): folders, documents with append-only versions in private storage, linked to
 * one ERP record, with expiry reminders for certificates and permits.
 */
@Injectable()
export class ErpDocsService {
  private readonly logger = new Logger(ErpDocsService.name);

  constructor(
    private readonly workspace: ErpWorkspace,
    private readonly alerts: ErpAlertsService,
  ) {}

  // -------------------------------------------------------------------------------- folders

  async folders(scope: ErpScope): Promise<ErpDocFolderDto[]> {
    const rows = await this.workspace.db.erpDocFolder.findMany({
      where: { factoryId: scope.factory.id },
      include: { parent: true, _count: { select: { docs: { where: { status: 'active' } } } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((f) => ({
      id: f.publicId,
      name: f.name,
      parentId: f.parent?.publicId ?? null,
      docCount: f._count.docs,
    }));
  }

  private async folder(db: ErpTx | ErpPrismaService, scope: ErpScope, publicId: string) {
    const f = await db.erpDocFolder.findFirst({ where: { factoryId: scope.factory.id, publicId } });
    if (!f) throw new DomainException('http.not_found');
    return f;
  }

  private async uniqueName(
    tx: ErpTx,
    scope: ErpScope,
    parentId: bigint | null,
    name: string,
    exceptId?: bigint,
  ) {
    const clash = await tx.erpDocFolder.findFirst({
      where: {
        factoryId: scope.factory.id,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
    });
    if (clash) throw new DomainException('erp.folder_exists', { params: { name } });
  }

  async createFolder(scope: ErpScope, body: ErpSaveFolderDto): Promise<ErpDocFolderDto> {
    const name = body.name.trim();
    await this.workspace.tx(async (tx) => {
      const parent = body.parentId ? await this.folder(tx, scope, body.parentId) : null;
      await this.uniqueName(tx, scope, parent?.id ?? null, name);
      await tx.erpDocFolder.create({
        data: {
          factoryId: scope.factory.id,
          parentId: parent?.id ?? null,
          name,
          createdById: scope.actor.userId,
        },
      });
    });
    return (await this.folders(scope)).find(
      (f) => f.name === name && f.parentId === (body.parentId ?? null),
    )!;
  }

  async renameFolder(scope: ErpScope, publicId: string, body: ErpSaveFolderDto): Promise<ErpDocFolderDto> {
    await this.workspace.tx(async (tx) => {
      const f = await this.folder(tx, scope, publicId);
      let parentId = f.parentId;
      if (body.parentId !== undefined) {
        if (body.parentId === null) parentId = null;
        else {
          const parent = await this.folder(tx, scope, body.parentId);
          // A folder cannot move under itself or its own sub-folders.
          for (let p: bigint | null = parent.id; p !== null;) {
            if (p === f.id)
              throw new DomainException('validation.failed', {
                errors: [{ path: 'parentId', code: 'invalid', message: 'Not inside itself' }],
              });
            p = (await tx.erpDocFolder.findUnique({ where: { id: p } }))?.parentId ?? null;
          }
          parentId = parent.id;
        }
      }
      await this.uniqueName(tx, scope, parentId, body.name.trim(), f.id);
      await tx.erpDocFolder.update({ where: { id: f.id }, data: { name: body.name.trim(), parentId } });
    });
    return (await this.folders(scope)).find((x) => x.id === publicId)!;
  }

  /** Deletes an empty folder (no sub-folders, no documents — archived ones included). */
  async deleteFolder(scope: ErpScope, publicId: string): Promise<void> {
    await this.workspace.tx(async (tx) => {
      const f = await this.folder(tx, scope, publicId);
      const [children, docs] = await Promise.all([
        tx.erpDocFolder.count({ where: { parentId: f.id } }),
        tx.erpDoc.count({ where: { folderId: f.id } }),
      ]);
      if (children + docs > 0)
        throw new DomainException('erp.folder_not_empty', { params: { name: f.name } });
      await tx.erpDocFolder.delete({ where: { id: f.id } });
    });
  }

  // ------------------------------------------------------------------------------ documents

  async list(scope: ErpScope, q: ErpDocListQuery) {
    const where: Prisma.ErpDocWhereInput = { factoryId: scope.factory.id };
    where.status = (q.status ?? 'active') as ErpRecordStatus;
    if (q.folderId) where.folder = { publicId: q.folderId };
    if (q.linkType) where.linkType = q.linkType as ErpDocLink;
    if (q.linkId) where.linkPublicId = q.linkId;
    if (q.category) where.category = q.category as ErpDocCategory;
    if (q.expiry === 'expired') where.expiresOn = { lt: day(today()) };
    const search = q.q?.trim();
    if (search)
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
        { linkLabel: { contains: search, mode: 'insensitive' } },
      ];
    if (q.expiry === 'expiring') {
      // Within each document's own reminder window: filtered after reading (the window varies per document).
      const rows = await this.workspace.db.erpDoc.findMany({
        where: { ...where, expiresOn: { gte: day(today()), lte: day(addCalendarDays(today(), 365)) } },
        include: DOC_INCLUDE,
        orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
      });
      const hits = rows.filter((r) => expiryOf(iso(r.expiresOn), r.remindDays) === 'expiring');
      const { skip, take } = toSkipTake(q);
      return paginated(hits.slice(skip, skip + take).map(summary), hits.length, q);
    }
    const [rows, total] = await Promise.all([
      this.workspace.db.erpDoc.findMany({
        where,
        include: DOC_INCLUDE,
        orderBy: q.expiry ? [{ expiresOn: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(q),
      }),
      this.workspace.db.erpDoc.count({ where }),
    ]);
    return paginated(rows.map(summary), total, q);
  }

  async get(scope: ErpScope, publicId: string): Promise<ErpDocDto> {
    const row = await this.workspace.db.erpDoc.findFirst({
      where: { factoryId: scope.factory.id, publicId },
      include: DOC_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return docDto(row);
  }

  /** An uploaded file of this factory, usable (scanned clean or pending). */
  private async file(tx: ErpTx, scope: ErpScope, publicId: string): Promise<FileObject> {
    const f = await tx.fileObject.findUnique({ where: { publicId } });
    if (
      !f ||
      f.ownerFactoryId !== scope.factory.id ||
      f.uploadStatus !== 'uploaded' ||
      f.scanStatus === 'infected'
    )
      throw new DomainException('erp.file_not_usable');
    return f;
  }

  /** The record a document links to, checked to be this factory's, with a label for lists. */
  private async link(tx: ErpTx, scope: ErpScope, type: string, publicId: string): Promise<string> {
    const factoryId = scope.factory.id;
    const notFound = () => new DomainException('http.not_found');
    switch (type as ErpDocLink) {
      case 'trading_partner': {
        const r = await tx.erpTradingPartner.findFirst({ where: { factoryId, publicId } });
        if (!r) throw notFound();
        return `${r.code} · ${r.name}`;
      }
      case 'item': {
        const r = await tx.erpItem.findFirst({ where: { factoryId, publicId } });
        if (!r) throw notFound();
        return `${r.sku} · ${r.name}`;
      }
      case 'machine': {
        const r = await tx.factoryMachine.findFirst({ where: { factoryId, publicId } });
        if (!r) throw notFound();
        return r.name;
      }
      case 'purchase_order': {
        const r = await tx.erpPurchaseOrder.findFirst({
          where: { factoryId, publicId },
          include: { supplier: true },
        });
        if (!r) throw notFound();
        return `${r.poNo ?? 'PO (ร่าง)'} · ${r.supplier.name}`;
      }
      case 'production_order': {
        const r = await tx.erpProductionOrder.findFirst({ where: { factoryId, publicId } });
        if (!r) throw notFound();
        return `${r.moNo} · ${r.title}`;
      }
      case 'maintenance_order': {
        const r = await tx.erpMaintenanceOrder.findFirst({ where: { factoryId, publicId } });
        if (!r) throw notFound();
        return `${r.mtNo} · ${r.title}`;
      }
      default:
        throw notFound();
    }
  }

  private async linkFields(
    tx: ErpTx,
    scope: ErpScope,
    type: string | null | undefined,
    id: string | null | undefined,
  ) {
    if (!type && !id) return { linkType: null, linkPublicId: null, linkLabel: null };
    if (!type || !id)
      throw new DomainException('validation.failed', {
        errors: [
          { path: type ? 'linkId' : 'linkType', code: 'required', message: 'Both the type and the id' },
        ],
      });
    return {
      linkType: type as ErpDocLink,
      linkPublicId: id,
      linkLabel: await this.link(tx, scope, type, id),
    };
  }

  async create(scope: ErpScope, body: ErpCreateDocDto): Promise<ErpDocDto> {
    const id = await this.workspace.tx(async (tx) => {
      const file = await this.file(tx, scope, body.fileId);
      const folder = body.folderId ? await this.folder(tx, scope, body.folderId) : null;
      const link = await this.linkFields(tx, scope, body.linkType, body.linkId);
      const doc = await tx.erpDoc.create({
        data: {
          factoryId: scope.factory.id,
          folderId: folder?.id ?? null,
          title: body.title.trim(),
          category: (body.category ?? 'other') as ErpDocCategory,
          tags: [...new Set((body.tags ?? []).map((t) => t.trim()).filter(Boolean))],
          ...link,
          expiresOn: body.expiresOn ? day(body.expiresOn) : null,
          remindDays: body.remindDays ?? 30,
          note: body.note ?? null,
          createdById: scope.actor.userId,
          versions: { create: { version: 1, fileId: file.id, createdById: scope.actor.userId } },
        },
      });
      await this.workspace.record(tx, scope, 'erp_doc.created', 'erp_doc', doc.publicId, {
        category: doc.category,
      });
      return doc.publicId;
    });
    return this.get(scope, id);
  }

  async update(scope: ErpScope, publicId: string, ifMatch: string | undefined, body: ErpUpdateDocDto) {
    await this.workspace.tx(async (tx) => {
      const current = await tx.erpDoc.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!current) throw new DomainException('http.not_found');
      assertIfMatch(ifMatch, etagOf(current.publicId, current.rowVersion));
      const folderId =
        body.folderId === undefined
          ? undefined
          : body.folderId === null
            ? null
            : (await this.folder(tx, scope, body.folderId)).id;
      const link =
        body.linkType !== undefined || body.linkId !== undefined
          ? await this.linkFields(
              tx,
              scope,
              body.linkType === undefined ? current.linkType : body.linkType,
              body.linkId === undefined ? current.linkPublicId : body.linkId,
            )
          : {};
      const renewed = body.expiresOn !== undefined && iso(current.expiresOn) !== (body.expiresOn ?? null);
      await tx.erpDoc.update({
        where: { id: current.id },
        data: {
          ...(body.title !== undefined && { title: body.title.trim() }),
          ...(body.category !== undefined && { category: body.category as ErpDocCategory }),
          ...(body.tags !== undefined && {
            tags: [...new Set(body.tags.map((t) => t.trim()).filter(Boolean))],
          }),
          ...(folderId !== undefined && { folderId }),
          ...link,
          ...(body.expiresOn !== undefined && { expiresOn: body.expiresOn ? day(body.expiresOn) : null }),
          ...(body.remindDays !== undefined && { remindDays: body.remindDays }),
          ...(body.note !== undefined && { note: body.note }),
          ...(body.status !== undefined && { status: body.status as ErpRecordStatus }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (renewed || body.status === 'archived')
        await this.alerts.settle(tx, scope.factory.id, 'document_expiring', publicId);
    });
    return this.get(scope, publicId);
  }

  /** A new version (D-356): appended, never replacing; a renewed certificate may bring its new expiry. */
  async addVersion(scope: ErpScope, publicId: string, body: ErpAddDocVersionDto): Promise<ErpDocDto> {
    await this.workspace.tx(async (tx) => {
      const current = await tx.erpDoc.findFirst({ where: { factoryId: scope.factory.id, publicId } });
      if (!current) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM erp_docs WHERE id = ${current.id} FOR UPDATE`;
      const file = await this.file(tx, scope, body.fileId);
      const next = current.currentVersion + 1;
      await tx.erpDocVersion.create({
        data: {
          docId: current.id,
          version: next,
          fileId: file.id,
          note: body.note ?? null,
          createdById: scope.actor.userId,
        },
      });
      await tx.erpDoc.update({
        where: { id: current.id },
        data: {
          currentVersion: next,
          ...(body.expiresOn !== undefined && { expiresOn: body.expiresOn ? day(body.expiresOn) : null }),
          updatedById: scope.actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (body.expiresOn !== undefined)
        await this.alerts.settle(tx, scope.factory.id, 'document_expiring', publicId);
      await this.workspace.record(tx, scope, 'erp_doc.versioned', 'erp_doc', publicId, { version: next });
    });
    return this.get(scope, publicId);
  }

  // ---------------------------------------------------------------------------- daily check

  /** D-356, D-358: documents within their reminder window or expired today raise one alert per expiry date. */
  @ScheduledJob({ name: 'factory_erp.document_expiry', cron: '20 7 * * *' })
  async expiryCheck(): Promise<number> {
    const t = today();
    const docs = await this.workspace.db.erpDoc.findMany({
      where: { status: 'active', expiresOn: { not: null, lte: day(addCalendarDays(t, 365)) } },
      include: { factory: true },
    });
    let raised = 0;
    for (const d of docs) {
      const exp = iso(d.expiresOn)!;
      const state = expiryOf(exp, d.remindDays, t);
      if (state !== 'expiring' && state !== 'expired') continue;
      try {
        const fresh = await this.workspace.tx((tx) =>
          this.alerts.raise(tx, {
            factoryId: d.factoryId,
            factoryPublicId: d.factory.publicId,
            kind: 'document_expiring',
            dedupeKey: `document_expiring:${d.publicId}:${exp}:${state}`,
            subjectType: 'document',
            subjectPublicId: d.publicId,
            payload: {
              title: d.title,
              expiresOn: exp,
              expired: state === 'expired' ? 1 : 0,
              link: d.linkLabel,
            },
            dueOn: exp,
          }),
        );
        if (fresh) raised += 1;
      } catch (e) {
        this.logger.warn(`document expiry ${d.publicId}: ${(e as Error).message}`);
      }
    }
    return raised;
  }
}

function fileDto(f: FileObject): ErpDocFileDto {
  return { id: f.publicId, name: f.originalName, mimeType: f.mimeType, sizeBytes: Number(f.sizeBytes) };
}

function summary(d: DocRow): ErpDocSummaryDto {
  const current = d.versions[0]!;
  return {
    id: d.publicId,
    title: d.title,
    category: d.category,
    tags: d.tags,
    folder: d.folder ? { id: d.folder.publicId, name: d.folder.name, parentId: null, docCount: 0 } : null,
    link:
      d.linkType && d.linkPublicId
        ? { type: d.linkType, id: d.linkPublicId, label: d.linkLabel ?? '' }
        : null,
    expiresOn: iso(d.expiresOn),
    expiry: expiryOf(iso(d.expiresOn), d.remindDays),
    currentVersion: d.currentVersion,
    file: fileDto(current.file),
    status: d.status,
    updatedAt: toBangkokIso(d.updatedAt),
  };
}

function docDto(d: DocRow): ErpDocDto {
  return {
    ...summary(d),
    note: d.note,
    remindDays: d.remindDays,
    versions: d.versions.map((v) => ({
      id: v.publicId,
      version: v.version,
      file: fileDto(v.file),
      note: v.note,
      createdAt: toBangkokIso(v.createdAt),
      by: v.createdBy.displayName,
    })),
    version: d.rowVersion,
  };
}
