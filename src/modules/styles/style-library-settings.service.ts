import { type Readable } from 'node:stream';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { Inject, Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';
import { SettingsAdminService } from '@platform/settings/settings-admin.service';

import {
  contentOf,
  EMPTY_STYLE_LIBRARY_CONTENT,
  publicContent,
  publicFileIds,
  referencedFiles,
  STYLE_LIBRARY_SETTING,
  type StyleLibraryContent,
} from './style-library-content';
import {
  type AdminStyleLibrarySettingsDto,
  type StoreStyleLibrarySettingsDto,
  type StyleLibraryContentDto,
} from './style-library-settings.dto';

/**
 * C1c (DECISIONS-STAGE-A §11.5, D-448): the style library page's staff-managed content in the effective-dated, audited
 * setting `storefront.style_library`. Customers read what is in force (expired certificates and logo consent
 * references left out); Admin and Marketing (`styles.curate`, D-246) change it from the back office — a new version
 * through the settings platform (validated against the setting's schema, audited `setting.changed`, evented).
 */
@Injectable()
export class StyleLibrarySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly settingsAdmin: SettingsAdminService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async forStore(now = new Date()): Promise<StoreStyleLibrarySettingsDto> {
    return publicContent(await this.content(), bangkokDate(now));
  }

  async forAdmin(): Promise<AdminStyleLibrarySettingsDto> {
    const setting = await this.prisma.setting.findFirst({
      where: { key: STYLE_LIBRARY_SETTING, scopeType: 'platform', scopeId: null },
      select: { publicId: true },
    });
    try {
      const resolved = await this.settings.at(STYLE_LIBRARY_SETTING);
      return {
        content: contentOf(resolved.value),
        versionNo: resolved.versionNo,
        effectiveFrom: toBangkokIso(resolved.effectiveFrom),
        settingId: setting?.publicId ?? null,
      };
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
      return {
        content: EMPTY_STYLE_LIBRARY_CONTENT,
        versionNo: null,
        effectiveFrom: null,
        settingId: setting?.publicId ?? null,
      };
    }
  }

  async update(
    actor: UserActor,
    input: { content: StyleLibraryContentDto; reason: string; effectiveFrom?: string },
  ): Promise<AdminStyleLibrarySettingsDto> {
    const value = normalise(input.content);
    await this.assertFiles(value);
    await this.settingsAdmin.changeFromEditor(actor, STYLE_LIBRARY_SETTING, {
      value,
      reason: input.reason.trim(),
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
    });
    return this.forAdmin();
  }

  /**
   * C1e (§13.3): a document customers open from the trust section — an uploaded file the content in force publishes
   * (an expired certificate's document is not), uploaded, scanned clean and not purged; anything else is 404.
   * C1f (§14.3): only a published purpose (`published_document` / `image`) whose metadata the worker has stripped —
   * a file uploaded as a financial-record `document`, or one whose metadata could not be removed, is never served.
   */
  async document(fileId: string, now = new Date()): Promise<StyleLibraryDocument> {
    const { documents } = publicFileIds(await this.content(), bangkokDate(now));
    if (!documents.includes(fileId)) throw new DomainException('http.not_found');
    const file = await this.prisma.fileObject.findFirst({
      where: {
        publicId: fileId,
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        purgedAt: null,
        purpose: { in: [...DOCUMENT_PURPOSES] },
        metadataStrippedAt: { not: null },
      },
      select: { storageKey: true, mimeType: true, sizeBytes: true, sha256: true, publicId: true },
    });
    if (!file || !DOCUMENT_MIME.test(file.mimeType)) throw new DomainException('http.not_found');
    return {
      stream: await this.storage.getStream(file.storageKey),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      etag: `"${file.sha256 ? Buffer.from(file.sha256).toString('hex') : file.publicId}"`,
    };
  }

  /**
   * C1e (§13.3): every uploaded file the content references must be ready to publish — uploaded, not infected, of the
   * right kind (pictures: purpose `image`, PNG / JPEG / WebP; documents: purpose `published_document` (C1f, §14.3:
   * metadata stripped like images) or `image`, PDF or a picture). External https links stay allowed for documents only
   * (the setting's schema).
   */
  private async assertFiles(content: StyleLibraryContent): Promise<void> {
    const refs = referencedFiles(content);
    if (refs.length === 0) return;
    const files = await this.prisma.fileObject.findMany({
      where: { publicId: { in: [...new Set(refs.map((r) => r.fileId))] } },
      select: {
        publicId: true,
        uploadStatus: true,
        scanStatus: true,
        purgedAt: true,
        mimeType: true,
        purpose: true,
      },
    });
    const byId = new Map(files.map((f) => [f.publicId, f]));
    const errors = refs.flatMap((ref) => {
      const f = byId.get(ref.fileId);
      const ready =
        !!f && f.uploadStatus === 'uploaded' && f.scanStatus !== 'infected' && f.purgedAt === null;
      const kind =
        ref.kind === 'image'
          ? !!f && f.purpose === 'image' && IMAGE_MIME.test(f.mimeType)
          : !!f && DOCUMENT_PURPOSES.has(f.purpose ?? '') && DOCUMENT_MIME.test(f.mimeType);
      return ready && kind
        ? []
        : [
            {
              path: ref.path,
              code: 'fileReady',
              message:
                ref.kind === 'image'
                  ? 'not an uploaded picture (purpose image: PNG, JPEG or WebP)'
                  : 'not an uploaded document (purpose published_document or image: PDF or a picture)',
            },
          ];
    });
    if (errors.length) throw new DomainException('validation.failed', { errors });
  }

  private async content(): Promise<StyleLibraryContent> {
    try {
      return contentOf((await this.settings.at(STYLE_LIBRARY_SETTING)).value);
    } catch (error) {
      if (error instanceof SettingNotFoundError) return EMPTY_STYLE_LIBRARY_CONTENT;
      throw error;
    }
  }
}

const IMAGE_MIME = /^image\/(png|jpeg|webp)$/;
const DOCUMENT_MIME = /^(application\/pdf|image\/(png|jpeg|webp))$/;
/** C1f (§14.3): purposes whose metadata the worker strips (`SCRUBBED_PURPOSES`) — the only ones a document may have. */
const DOCUMENT_PURPOSES: ReadonlySet<string> = new Set(['published_document', 'image']);

export interface StyleLibraryDocument {
  stream: Readable;
  mimeType: string;
  sizeBytes: bigint;
  etag: string;
}

const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const localised = (v: { th: string; en?: string | null }) => ({ th: v.th.trim(), en: text(v.en) });

/** Trimmed, every optional field present as null (the stored shape the setting's schema requires). */
export function normalise(c: StyleLibraryContentDto): StyleLibraryContent {
  return {
    quickSearch: c.quickSearch.map((q) => ({ label: localised(q.label), query: q.query.trim() })),
    materialSwatches: c.materialSwatches.map((m) => ({
      materialClass: m.materialClass,
      colour: text(m.colour),
      imageUrl: text(m.imageUrl),
    })),
    trust: {
      certifications: c.trust.certifications.map((x) => ({
        title: localised(x.title),
        number: text(x.number),
        issuer: text(x.issuer),
        expiresOn: text(x.expiresOn),
        documentUrl: text(x.documentUrl),
      })),
      foodGrade: c.trust.foodGrade.map((x) => ({
        title: localised(x.title),
        documentUrl: text(x.documentUrl),
      })),
      productionPhotos: c.trust.productionPhotos.map((x) => ({ url: x.url.trim(), alt: localised(x.alt) })),
      customerLogos: c.trust.customerLogos.map((x) => ({
        name: x.name.trim(),
        logoUrl: x.logoUrl.trim(),
        permission: x.permission.trim(),
      })),
      taxInvoiceNote: c.trust.taxInvoiceNote ? localised(c.trust.taxInvoiceNote) : null,
    },
  };
}
