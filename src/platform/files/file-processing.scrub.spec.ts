import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import sharp from 'sharp';

import { FileProcessingJobs } from './file-processing.jobs';

/** Obviously fake identity that must not survive (D-442). */
const OWNER = 'FakeFactoryCam';

async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 6, height: 6, channels: 3, background: '#777' } })
    .withExif({ IFD0: { Make: OWNER }, IFD3: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer();
}

function jobs(body: Buffer, purpose: string | null) {
  const puts: { key: string; body: Buffer }[] = [];
  const updates: Record<string, unknown>[] = [];
  const tx = {
    fileObject: {
      update: jest.fn((args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({});
      }),
    },
  };
  const svc = new FileProcessingJobs(
    {
      withTx: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      fileObject: { create: jest.fn().mockResolvedValue({}) },
    } as never,
    { record: jest.fn() } as never,
    { record: jest.fn() } as never,
    {
      getStream: jest.fn(() => Promise.resolve(Readable.from([body]))),
      put: jest.fn((key: string, data: Buffer) => {
        puts.push({ key, body: data });
        return Promise.resolve();
      }),
    } as never,
    { scan: jest.fn().mockResolvedValue('clean') },
  );
  const file = {
    id: 1n,
    publicId: 'f-1',
    storageKey: 'standard/2026/10/f-1',
    originalName: 'qc.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: BigInt(body.length),
    retentionClass: 'standard',
    purpose,
    ownerUserId: null,
    ownerFactoryId: null,
    ownerCompanyId: null,
    bucket: 'b',
  };
  return { svc, file, puts, updates };
}

describe('files worker strips metadata from shared uploads (D-442, GLOBAL-RULES §1)', () => {
  it('replaces a QC / timeline photo with its EXIF- and GPS-free bytes before marking it clean', async () => {
    const photo = await photoWithGps();
    expect(photo.toString('latin1')).toContain(OWNER);
    const { svc, file, puts, updates } = jobs(photo, 'evidence');
    await svc.processOne(file as never);
    const original = puts.find((p) => p.key === file.storageKey);
    expect(original).toBeDefined();
    expect(original!.body.toString('latin1')).not.toContain(OWNER);
    expect((await sharp(original!.body).metadata()).exif).toBeUndefined();
    expect(updates[0]).toMatchObject({
      scanStatus: 'clean',
      sizeBytes: BigInt(original!.body.length),
      metadataStrippedAt: expect.any(Date),
    });
    expect(Buffer.from(updates[0]!['sha256'] as Uint8Array).toString('hex')).toBe(
      createHash('sha256').update(original!.body).digest('hex'),
    );
  });

  it.each(['artwork', 'slip', null])('never rewrites a %s upload', async (purpose) => {
    const photo = await photoWithGps();
    const { svc, file, puts, updates } = jobs(photo, purpose);
    await svc.processOne(file as never);
    expect(puts.filter((p) => p.key === file.storageKey)).toHaveLength(0);
    expect(updates[0]).not.toHaveProperty('metadataStrippedAt');
  });
});
