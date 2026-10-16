import { S3ObjectStorage } from './s3-object-storage';

describe('S3ObjectStorage key prefix', () => {
  const options = { region: 'ap-southeast-1', bucket: 'shared-bucket', forcePathStyle: false };

  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID ??= 'AKIATESTTESTTESTTEST';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test-secret-test-secret-test-secret-test';
  });

  it('puts the prefix in front of every key it signs', async () => {
    const storage = new S3ObjectStorage({ ...options, keyPrefix: 'getpack/' });
    const { url } = await storage.presignPut('customer_content/2026/10/a', {
      contentType: 'image/png',
      contentLength: 10,
      expiresInSeconds: 60,
    });
    expect(new URL(url).pathname).toBe('/getpack/customer_content/2026/10/a');
  });

  it('keeps keys at the bucket root without a prefix', async () => {
    const storage = new S3ObjectStorage(options);
    const { url } = await storage.presignPut('customer_content/2026/10/a', {
      contentType: 'image/png',
      contentLength: 10,
      expiresInSeconds: 60,
    });
    expect(new URL(url).pathname).toBe('/customer_content/2026/10/a');
  });
});
