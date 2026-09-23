import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { type ObjectStorage } from './object-storage.port';

export interface S3Options {
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3Options) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      maxAttempts: 3,
    });
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }), { abortSignal: signal });
  }
}
