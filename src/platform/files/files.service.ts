import { createHash, randomUUID } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { bytes } from '@common/crypto/hashing';
import { DomainException } from '@common/errors/domain.exception';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type Attachment,
  type AttachmentSubject,
  type FileAccessChannel,
  type FileObject,
  type FileRetentionClass,
} from '@generated/prisma/client';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { parseScopeClaim, ScopeDirectory } from '@modules/iam/scope-directory';
import { ScopingService } from '@modules/iam/scoping.service';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { CustomerFileAccessService } from './customer-file-access.service';
import {
  FILE_PURPOSES,
  type FilePurpose,
  MAX_PARTS,
  MIN_PART_SIZE,
  MULTIPART_THRESHOLD,
} from './file-purposes';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/** Pending uploads not completed within this time are abandoned (housekeeping). */
const PENDING_TTL_MS = 24 * 60 * 60_000;

/**
 * Decides whether an actor may read a file through one of its attachments; owning modules register
 * one per attachment subject (e.g. claims: the claim's customer and the liable factory).
 */
/** `attachment` lets a policy honour per-file flags (e.g. photos shared with the customer). */
export type AttachmentAccessPolicy = (
  actor: Actor,
  subjectId: bigint,
  attachment?: Attachment,
) => Promise<boolean>;

/**
 * Decides whether an actor may read a file that a domain row references directly (schema-design §2.8:
 * `proofs.proof_file_id`, artwork submission files…); owning modules register one each.
 */
export type FileReadPolicy = (actor: Actor, file: FileObject) => Promise<boolean>;

export interface PresignResult {
  file: FileObject;
  upload: { url: string; headers: Record<string, string> } | null;
  multipart: { uploadId: string; partSize: number; parts: { partNumber: number; url: string }[] } | null;
  expiresAt: Date;
}

/**
 * Uploads and downloads of private files (contract §3 "Files", schema-design §2.8):
 * presign → client PUTs to S3 (single or multipart) → complete → worker scans and extracts
 * metadata → signed download after an authorisation check on the owning row, never on the key.
 * Unscanned or infected files are never served.
 */
@Injectable()
export class FilesService {
  private readonly policies = new Map<AttachmentSubject, AttachmentAccessPolicy>();
  private readonly readers = new Map<string, FileReadPolicy>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly permissions: PermissionResolver,
    private readonly scopes: ScopeDirectory,
    private readonly scoping: ScopingService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly customerFiles: CustomerFileAccessService,
  ) {}

  registerAttachmentPolicy(subject: AttachmentSubject, policy: AttachmentAccessPolicy): void {
    this.policies.set(subject, policy);
  }

  /** A module whose rows reference files directly decides who else may read them (by the owning row). */
  registerFileReader(key: string, policy: FileReadPolicy): void {
    this.readers.set(key, policy);
  }

  async presign(
    actor: Actor,
    input: {
      purpose: FilePurpose;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      factoryId?: string;
      companyId?: string;
    },
  ): Promise<PresignResult> {
    const rule = FILE_PURPOSES[input.purpose];
    if (!(rule.mimeTypes as readonly string[]).includes(input.mimeType)) {
      throw new DomainException('file.type_not_allowed', { params: { purpose: input.purpose } });
    }
    if (input.sizeBytes > rule.maxBytes) {
      throw new DomainException('file.too_large', {
        params: { maxMb: Math.floor(rule.maxBytes / (1024 * 1024)) },
      });
    }
    const owner = await this.ownerOf(actor, input);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000);

    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`, // replaced below with the public-id based key
        originalName: input.fileName.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        uploadStatus: 'pending',
        scanStatus: 'pending',
        retentionClass: rule.retentionClass,
        purpose: input.purpose,
        expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        ...owner,
        createdById: actor.type === 'user' ? actor.userId : null,
      },
    });
    // No personal data in object keys: retention class / year / month / public id.
    const storageKey = `${rule.retentionClass}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;

    if (input.sizeBytes <= MULTIPART_THRESHOLD) {
      const upload = await this.storage.presignPut(storageKey, {
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
      const saved = await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
      return { file: saved, upload, multipart: null, expiresAt };
    }

    const partSize = Math.max(MIN_PART_SIZE, Math.ceil(input.sizeBytes / MAX_PARTS));
    const partCount = Math.ceil(input.sizeBytes / partSize);
    const uploadId = await this.storage.createMultipart(storageKey, input.mimeType);
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => ({
        partNumber: i + 1,
        url: await this.storage.presignPart(storageKey, uploadId, i + 1, UPLOAD_URL_TTL_SECONDS * 4),
      })),
    );
    const saved = await this.prisma.fileObject.update({
      where: { id: file.id },
      data: { storageKey, multipartUploadId: uploadId },
    });
    return {
      file: saved,
      upload: null,
      multipart: { uploadId, partSize, parts },
      expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 4000),
    };
  }

  /**
   * Resumes an open multipart upload of mine (U4.B1): the parts already stored (with their ETags for `complete`) and
   * fresh signed URLs for every part, so the client re-sends only what is missing.
   */
  async resume(
    actor: Actor,
    publicId: string,
  ): Promise<{
    file: FileObject;
    partSize: number;
    uploaded: { partNumber: number; etag: string; sizeBytes: number }[];
    parts: { partNumber: number; url: string }[];
    expiresAt: Date;
  }> {
    const file = await this.ownPending(actor, publicId);
    if (!file.multipartUploadId) throw new DomainException('file.not_multipart');
    const size = Number(file.sizeBytes);
    const partSize = Math.max(MIN_PART_SIZE, Math.ceil(size / MAX_PARTS));
    const partCount = Math.ceil(size / partSize);
    const uploaded = await this.storage.listParts(file.storageKey, file.multipartUploadId);
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => ({
        partNumber: i + 1,
        url: await this.storage.presignPart(
          file.storageKey,
          file.multipartUploadId!,
          i + 1,
          UPLOAD_URL_TTL_SECONDS * 4,
        ),
      })),
    );
    return {
      file,
      partSize,
      uploaded,
      parts,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 4000),
    };
  }

  /** The client finished the PUT(s): check the stored object and queue scanning. */
  async complete(
    actor: Actor,
    publicId: string,
    parts?: { partNumber: number; etag: string }[],
  ): Promise<FileObject> {
    const file = await this.ownPending(actor, publicId);
    if (file.multipartUploadId) {
      if (!parts?.length) throw new DomainException('file.upload_incomplete');
      await this.storage.completeMultipart(file.storageKey, file.multipartUploadId, parts);
    }
    const stored = await this.storage.head(file.storageKey);
    if (!stored || BigInt(stored.sizeBytes) !== file.sizeBytes)
      throw new DomainException('file.upload_incomplete');
    return this.prisma.withTx(async (tx) => {
      const updated = await tx.fileObject.update({
        where: { id: file.id },
        data: {
          uploadStatus: 'uploaded',
          multipartUploadId: null,
          expiresAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.events.record(tx, {
        type: 'file.uploaded',
        aggregateType: 'file',
        aggregateId: updated.publicId,
        payload: {
          fileId: updated.publicId,
          retentionClass: updated.retentionClass,
          sizeBytes: updated.sizeBytes.toString(),
        },
      });
      return updated;
    });
  }

  async abort(actor: Actor, publicId: string): Promise<void> {
    const file = await this.ownPending(actor, publicId);
    if (file.multipartUploadId)
      await this.storage.abortMultipart(file.storageKey, file.multipartUploadId).catch(() => undefined);
    await this.storage.delete(file.storageKey).catch(() => undefined);
    await this.prisma.fileObject.update({
      where: { id: file.id },
      data: { uploadStatus: 'failed', multipartUploadId: null },
    });
  }

  /**
   * Stores a file the system generated from its own data (exports, templates) for `actor` and
   * returns a short-lived signed download URL. Nothing to scan: the content is ours.
   */
  async storeGenerated(
    actor: UserActor,
    input: { body: Buffer; fileName: string; mimeType: string; retentionClass: FileRetentionClass },
  ): Promise<{ fileId: string; url: string; expiresAt: Date }> {
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.body.length),
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: input.retentionClass,
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `${input.retentionClass}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, input.body, input.mimeType);
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
    const url = await this.storage.presignGet(storageKey, {
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      fileName: input.fileName,
      contentType: input.mimeType,
    });
    return {
      fileId: file.publicId,
      url,
      expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  /**
   * Stores a file the system generated in a worker (dieline drawings, B4.1) for `ownerUserId`, with its
   * SHA-256; nothing to scan (the content is ours). Returns the row; downloads go through the usual check.
   */
  async storeSystem(input: {
    body: Buffer;
    fileName: string;
    mimeType: string;
    retentionClass: FileRetentionClass;
    ownerUserId: bigint | null;
    /** A document for a factory (carton labels, packing lists): readable within its scope. */
    ownerFactoryId?: bigint | null;
  }): Promise<FileObject> {
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: input.fileName.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.body.length),
        sha256: bytes(createHash('sha256').update(input.body).digest()),
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: input.retentionClass,
        ownerUserId: input.ownerUserId,
        ownerFactoryId: input.ownerFactoryId ?? null,
      },
    });
    const storageKey = `${input.retentionClass}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, input.body, input.mimeType);
    return this.prisma.fileObject.update({ where: { id: file.id }, data: { storageKey } });
  }

  /**
   * Stores a file a staff member imports from disk (CLI tools, e.g. the home photos) as if uploaded by
   * them: `uploaded`, scan `pending` — the content is not ours, so it goes through the scan pipeline
   * (`FileProcessingJobs`) like any upload before anything serves it.
   */
  async storeImported(
    actor: UserActor,
    input: {
      body: Buffer;
      fileName: string;
      mimeType: string;
      retentionClass: FileRetentionClass;
      /** D-442: decides whether the worker strips metadata (published photos: `image`). */
      purpose?: FilePurpose;
    },
  ): Promise<FileObject> {
    const now = new Date();
    const file = await this.prisma.fileObject.create({
      data: {
        bucket: this.config.get('S3_BUCKET'),
        storageKey: `pending/${randomUUID()}`,
        originalName: input.fileName.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.body.length),
        uploadStatus: 'uploaded',
        retentionClass: input.retentionClass,
        purpose: input.purpose ?? null,
        ownerUserId: actor.userId,
        createdById: actor.userId,
      },
    });
    const storageKey = `${input.retentionClass}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${file.publicId}`;
    await this.storage.put(storageKey, input.body, input.mimeType);
    return this.prisma.withTx(async (tx) => {
      const stored = await tx.fileObject.update({ where: { id: file.id }, data: { storageKey } });
      await this.events.record(tx, {
        type: 'file.uploaded',
        aggregateType: 'file',
        aggregateId: stored.publicId,
        payload: {
          fileId: stored.publicId,
          retentionClass: stored.retentionClass,
          sizeBytes: stored.sizeBytes.toString(),
        },
      });
      return stored;
    });
  }

  /**
   * A locked copy of a clean, hashed file (the approved proof, B4.1): a new object under its own key with the
   * same SHA-256, under legal hold, that no workflow edits or replaces. Written in the caller's transaction;
   * the S3 copy happens first (a rolled-back approval leaves only an unreferenced object).
   */
  async lockedCopy(db: Tx, file: FileObject, opts: { fileName?: string } = {}): Promise<FileObject> {
    if (file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean' || !file.sha256)
      throw new DomainException('file.not_ready');
    const now = new Date();
    const created = await db.fileObject.create({
      data: {
        bucket: file.bucket,
        storageKey: `pending/${randomUUID()}`,
        // D-442: a neutral name chosen by the caller (the uploader's file name can carry a customer's name).
        originalName: opts.fileName ?? file.originalName,
        purpose: file.purpose,
        metadataStrippedAt: file.metadataStrippedAt,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        widthPx: file.widthPx,
        heightPx: file.heightPx,
        pageCount: file.pageCount,
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: now,
        retentionClass: file.retentionClass,
        legalHold: true,
        ownerUserId: file.ownerUserId,
        ownerFactoryId: file.ownerFactoryId,
        ownerCompanyId: file.ownerCompanyId,
      },
    });
    const storageKey = `${file.retentionClass}/locked/${now.getUTCFullYear()}/${created.publicId}`;
    await this.storage.copy(file.storageKey, storageKey);
    return db.fileObject.update({ where: { id: created.id }, data: { storageKey } });
  }

  /** Metadata, after the same access check as downloads. */
  async get(actor: Actor, publicId: string): Promise<FileObject> {
    const file = await this.prisma.fileObject.findUnique({ where: { publicId } });
    if (!file || file.purgedAt || !(await this.canRead(actor, file)))
      throw new DomainException('http.not_found');
    return file;
  }

  /**
   * D-444: a URL for a customer's artwork / original, a production copy or an approved proof copy (or a thumbnail of
   * one) is logged in `customer_file_access_logs` in this request, after the URL is signed and before it is returned.
   */
  async downloadUrl(
    actor: Actor,
    publicId: string,
    channel: FileAccessChannel = channelOf(actor),
  ): Promise<{ url: string; expiresAt: Date }> {
    const file = await this.get(actor, publicId);
    if (file.uploadStatus !== 'uploaded') throw new DomainException('file.not_ready');
    if (file.scanStatus === 'infected') throw new DomainException('file.infected');
    if (file.scanStatus !== 'clean') throw new DomainException('file.not_ready');
    const url = await this.storage.presignGet(file.storageKey, {
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: file.mimeType,
    });
    const subject =
      file.thumbnailOfFileId === null
        ? file
        : await this.prisma.fileObject.findUnique({ where: { id: file.thumbnailOfFileId } });
    let ref = subject ? await this.customerFiles.classify(subject) : null;
    // B-API-7: a Studio render's preview is logged against the order it was read for.
    if (ref && subject && ref.orderId === null && file.thumbnailOfFileId !== null && isStaff(actor))
      ref = (await this.customerFiles.staffMayPreview(actor.userId, subject.id)) ?? ref;
    if (ref) {
      await this.customerFiles.record(actor, {
        fileObjectId: file.id,
        ref,
        channel,
        purpose: file.thumbnailOfFileId === null ? 'download' : 'thumbnail',
      });
    }
    if (file.retentionClass === 'financial_record') {
      await this.audit.recordStandalone({
        category: 'data_access',
        action: 'file.downloaded',
        resourceType: 'file',
        resourcePublicId: file.publicId,
      });
    }
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
  }

  /**
   * A signed download URL for a file the caller already authorised through its owning row (a design's assets,
   * a shared design); null while it is not uploaded, scanned clean and unpurged.
   */
  async signedUrl(file: FileObject): Promise<{ url: string; expiresAt: Date } | null> {
    if (file.uploadStatus !== 'uploaded' || file.scanStatus !== 'clean' || file.purgedAt) return null;
    const url = await this.storage.presignGet(file.storageKey, {
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      fileName: file.originalName,
      contentType: file.mimeType,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
  }

  /**
   * Owner (uploader), staff with `files.read`, principals whose factory/company scope owns the
   * file, or an attachment policy of the owning module. A thumbnail follows its original.
   * D-444: a customer's artwork / original or a production copy of one is read on staff only by Prepress
   * (`customer_files.read`) and by support handling the order (`customer_files.read_handled`), not by `files.read`.
   * B-API-7: the thumbnail (preview) of a Studio render is also read by support handling an order made from it.
   */
  async canRead(actor: Actor, file: FileObject): Promise<boolean> {
    if (file.thumbnailOfFileId !== null) {
      const original = await this.prisma.fileObject.findUnique({ where: { id: file.thumbnailOfFileId } });
      if (!original) return false;
      if (await this.canRead(actor, original)) return true;
      // B-API-7: the low-resolution preview of a Studio render, for staff handling an order made from it.
      return isStaff(actor) && (await this.customerFiles.staffMayPreview(actor.userId, original.id)) !== null;
    }
    if (actor.type === 'system') return true;
    if (actor.type === 'user') {
      if (file.ownerUserId === actor.userId) return true;
      if (actor.audience === 'staff') {
        const ref = await this.customerFiles.classify(file);
        if (ref) return this.customerFiles.staffMayRead(actor.userId, ref);
        return (await this.permissions.forUser(actor.userId)).permissions.has('files.read');
      }
    }
    if (actor.type === 'user' || actor.type === 'api_client') {
      if (file.ownerFactoryId !== null && (await this.inScope(actor, 'factory', file.ownerFactoryId)))
        return true;
      if (file.ownerCompanyId !== null && (await this.inScope(actor, 'company', file.ownerCompanyId)))
        return true;
    }
    const attachments = await this.prisma.attachment.findMany({ where: { fileObjectId: file.id } });
    for (const attachment of attachments) {
      const policy = this.policies.get(attachment.subjectType);
      if (policy && (await policy(actor, attachment.subjectId, attachment))) return true;
    }
    for (const reader of this.readers.values()) {
      if (await reader(actor, file)) return true;
    }
    return false;
  }

  private async inScope(actor: Actor, type: 'factory' | 'company', id: bigint): Promise<boolean> {
    const scope = await this.scoping.scopeOf(actor, type);
    return scope !== 'all' && scope.includes(id);
  }

  /** Files uploaded by partners/company members belong to their scope as well as to them. */
  private async ownerOf(actor: Actor, input: { factoryId?: string; companyId?: string }) {
    const owner: { ownerUserId?: bigint; ownerFactoryId?: bigint; ownerCompanyId?: bigint } = {};
    if (actor.type === 'user') owner.ownerUserId = actor.userId;
    if (actor.type !== 'user' && actor.type !== 'api_client') return owner;
    const claims = actor.scopes.map(parseScopeClaim).filter((c): c is NonNullable<typeof c> => c !== null);
    for (const [type, requested] of [
      ['factory', input.factoryId],
      ['company', input.companyId],
    ] as const) {
      const own = claims.filter((c) => c.type === type).map((c) => c.publicId);
      const chosen = requested ?? (own.length === 1 ? own[0] : undefined);
      if (!chosen) continue;
      if (!own.includes(chosen)) throw new DomainException('http.not_found');
      const id = (await this.scopes.internalIds(type, [chosen])).get(chosen);
      if (id !== undefined) owner[type === 'factory' ? 'ownerFactoryId' : 'ownerCompanyId'] = id;
    }
    return owner;
  }

  /** Only the uploader (a machine client: its factory) completes or aborts a pending upload. */
  private async ownPending(actor: Actor, publicId: string): Promise<FileObject> {
    const file = await this.prisma.fileObject.findUnique({ where: { publicId } });
    const isUploader =
      file !== null &&
      (actor.type === 'user'
        ? file.createdById === actor.userId
        : actor.type === 'api_client' &&
          file.createdById === null &&
          file.ownerFactoryId !== null &&
          (await this.inScope(actor, 'factory', file.ownerFactoryId)));
    if (!file || !isUploader) throw new DomainException('http.not_found');
    if (file.uploadStatus !== 'pending') throw new DomainException('http.conflict');
    return file;
  }
}

const isStaff = (actor: Actor): actor is Extract<Actor, { type: 'user' }> =>
  actor.type === 'user' && actor.audience === 'staff';

/** The surface a URL is issued through when the caller does not say (the actor's own zone). */
function channelOf(actor: Actor): FileAccessChannel {
  if (actor.type === 'user')
    return actor.audience === 'staff' ? 'admin' : actor.audience === 'customer' ? 'store' : 'partner';
  return 'partner';
}
