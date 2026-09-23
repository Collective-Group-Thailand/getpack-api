export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Private object storage (S3). B1.3 adds presign, multipart and signed downloads. */
export interface ObjectStorage {
  /** Resolves when the bucket is reachable; used by `/health`. */
  ping(signal?: AbortSignal): Promise<void>;
}
