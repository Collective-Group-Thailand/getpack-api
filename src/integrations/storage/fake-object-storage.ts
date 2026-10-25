import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  type ObjectStorage,
  type PresignedUpload,
  type StoredObjectInfo,
} from '@collective/integrations/storage';

const BASE = 'https://fake-s3.invalid';

/**
 * In-memory stand-in used by tests, `pnpm dev` and the contract build. Presigned URLs are not
 * reachable; tests "upload" with `putDirect`, which is what the client's PUT would do. With a
 * directory (`FAKE_OBJECT_STORAGE_DIR`) every object is also kept on disk, so a file a script
 * stored (`cms:home-photos`, `catalog:product-photos`) is served by the dev API after it, and
 * uploads survive a restart; tests give no directory and stay in memory.
 *
 * Kept in getpack until @collective/integrations 0.2: the shared fake has no on-disk copy (D-435).
 */
export class FakeObjectStorage implements ObjectStorage {
  readonly mode = 'fake' as const;
  available = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  private readonly dir: string | undefined;

  constructor(dir?: string) {
    this.dir = dir;
    if (dir) mkdirSync(dir, { recursive: true });
  }

  /** On-disk copy: the bytes and a sidecar with the content type, under a filesystem-safe name. */
  private paths(key: string): { body: string; meta: string } | null {
    if (!this.dir) return null;
    const name = encodeURIComponent(key);
    return { body: join(this.dir, name), meta: join(this.dir, `${name}.type`) };
  }

  private remember(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
    const paths = this.paths(key);
    if (paths) {
      writeFileSync(paths.body, body);
      writeFileSync(paths.meta, contentType);
    }
  }

  private recall(key: string): { body: Buffer; contentType: string } | undefined {
    const inMemory = this.objects.get(key);
    if (inMemory) return inMemory;
    const paths = this.paths(key);
    if (!paths || !existsSync(paths.body)) return undefined;
    const object = {
      body: readFileSync(paths.body),
      contentType: existsSync(paths.meta) ? readFileSync(paths.meta, 'utf8') : 'application/octet-stream',
    };
    this.objects.set(key, object);
    return object;
  }
  private readonly multiparts = new Map<
    string,
    { key: string; parts: Map<number, Buffer>; contentType: string }
  >();

  ping(): Promise<void> {
    return this.available ? Promise.resolve() : Promise.reject(new Error('fake object storage unavailable'));
  }

  presignPut(
    key: string,
    options: { contentType: string; expiresInSeconds: number },
  ): Promise<PresignedUpload> {
    return Promise.resolve({
      url: `${BASE}/${encodeURIComponent(key)}?op=put&expires=${options.expiresInSeconds}`,
      headers: { 'Content-Type': options.contentType },
    });
  }

  createMultipart(key: string, contentType: string): Promise<string> {
    const uploadId = randomUUID();
    this.multiparts.set(uploadId, { key, parts: new Map(), contentType });
    return Promise.resolve(uploadId);
  }

  presignPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return Promise.resolve(
      `${BASE}/${encodeURIComponent(key)}?op=part&uploadId=${uploadId}&partNumber=${partNumber}`,
    );
  }

  /** Test helper: what a client's part PUT does. Returns the ETag. */
  putPart(uploadId: string, partNumber: number, body: Buffer): string {
    this.multiparts.get(uploadId)?.parts.set(partNumber, body);
    return `"etag-${partNumber}"`;
  }

  completeMultipart(_key: string, uploadId: string, parts: { partNumber: number }[]): Promise<void> {
    const upload = this.multiparts.get(uploadId);
    if (!upload) return Promise.reject(new Error('NoSuchUpload'));
    const body = Buffer.concat(
      parts
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => upload.parts.get(p.partNumber) ?? Buffer.alloc(0)),
    );
    this.remember(upload.key, body, upload.contentType);
    this.multiparts.delete(uploadId);
    return Promise.resolve();
  }

  listParts(
    _key: string,
    uploadId: string,
  ): Promise<{ partNumber: number; etag: string; sizeBytes: number }[]> {
    const upload = this.multiparts.get(uploadId);
    if (!upload) return Promise.reject(new Error('NoSuchUpload'));
    return Promise.resolve(
      [...upload.parts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([partNumber, body]) => ({ partNumber, etag: `"etag-${partNumber}"`, sizeBytes: body.length })),
    );
  }

  abortMultipart(_key: string, uploadId: string): Promise<void> {
    this.multiparts.delete(uploadId);
    return Promise.resolve();
  }

  /** Test helper: what a client's presigned PUT does. */
  putDirect(key: string, body: Buffer, contentType: string): void {
    this.remember(key, body, contentType);
  }

  head(key: string): Promise<StoredObjectInfo | null> {
    const object = this.recall(key);
    return Promise.resolve(
      object ? { sizeBytes: object.body.length, contentType: object.contentType } : null,
    );
  }

  getStream(key: string): Promise<Readable> {
    const object = this.recall(key);
    return object ? Promise.resolve(Readable.from([object.body])) : Promise.reject(new Error('NoSuchKey'));
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.remember(key, body, contentType);
    return Promise.resolve();
  }

  copy(sourceKey: string, targetKey: string): Promise<void> {
    const object = this.recall(sourceKey);
    if (!object) return Promise.reject(new Error(`no object ${sourceKey}`));
    this.remember(targetKey, Buffer.from(object.body), object.contentType);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    const paths = this.paths(key);
    if (paths) {
      rmSync(paths.body, { force: true });
      rmSync(paths.meta, { force: true });
    }
    return Promise.resolve();
  }

  presignGet(key: string, options: { expiresInSeconds: number }): Promise<string> {
    return Promise.resolve(`${BASE}/${encodeURIComponent(key)}?op=get&expires=${options.expiresInSeconds}`);
  }
}
