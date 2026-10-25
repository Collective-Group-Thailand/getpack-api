import { Readable } from 'node:stream';

import { PDFDocument } from 'pdf-lib';

import { ProductionCopiesService } from './production-copies.service';
import { approvedProofName, originalCopyName, safeExtension } from './production-copy-names';

/** Obviously fake data (CLAUDE.md). */
const CUSTOMER = 'Fake Customer Somchai Co (fake)';

describe('production copies of customer originals (D-442, DECISIONS-STAGE-A §1)', () => {
  it('names files by the order code, never by the uploaded name', () => {
    expect(
      originalCopyName({
        orderCode: 'DEVOR-2609-00001',
        submissionVersion: 2,
        index: 1,
        total: 1,
        originalName: `${CUSTOMER} final artwork.PDF`,
      }),
    ).toBe('DEVOR-2609-00001-original-v2.pdf');
    expect(
      originalCopyName({
        orderCode: 'DEVOR-2609-00001',
        submissionVersion: 1,
        index: 3,
        total: 4,
        originalName: 'no extension',
        format: 'jpeg',
      }),
    ).toBe('DEVOR-2609-00001-original-v1-3.jpg');
    expect(approvedProofName('DEVOR-2609-00001', 4, `proof for ${CUSTOMER}.pdf`)).toBe(
      'DEVOR-2609-00001-proof-v4.pdf',
    );
    expect(safeExtension('x.tar.gz')).toBe('gz');
    expect(safeExtension('weird.ext with space')).toBe('bin');
  });

  function service(source: { body: Buffer; originalName: string; status?: string; sizeBytes?: number }) {
    const stored: { body: Buffer; fileName: string; ownerUserId: bigint | null }[] = [];
    const updates: Record<string, unknown>[] = [];
    const audits: { action: string }[] = [];
    const events: { type: string }[] = [];
    const tx = {
      fileObject: { update: jest.fn().mockResolvedValue({}) },
      artworkProductionCopy: {
        updateMany: jest.fn((args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const svc = new ProductionCopiesService(
      {
        artworkProductionCopy: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 1n,
            publicId: 'copy-1',
            status: 'pending',
            attempts: 1,
            submissionFileId: 11n,
            sourceFile: {
              storageKey: 'customer_content/2026/10/src',
              originalName: source.originalName,
              mimeType: 'application/pdf',
              sizeBytes: BigInt(source.sizeBytes ?? source.body.length),
              uploadStatus: 'uploaded',
              scanStatus: source.status ?? 'clean',
              purgedAt: null,
              retentionClass: 'customer_content',
            },
            submissionFile: {
              sort: 0,
              submission: {
                id: 5n,
                versionNo: 1,
                order: { orderCode: 'DEVOR-2609-00001' },
                files: [{ id: 11n }],
              },
            },
          }),
        },
        withTx: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      } as never,
      {
        storeSystem: jest.fn((input: { body: Buffer; fileName: string; ownerUserId: bigint | null }) => {
          stored.push(input);
          return Promise.resolve({ id: 99n, publicId: 'file-99' });
        }),
      } as never,
      { record: jest.fn((_tx: unknown, entry: { action: string }) => audits.push(entry)) } as never,
      { record: jest.fn((_tx: unknown, event: { type: string }) => events.push(event)) } as never,
      { getStream: jest.fn(() => Promise.resolve(Readable.from([source.body]))) } as never,
    );
    return { svc, stored, updates, audits, events };
  }

  it('makes a scrubbed copy named by the order code, with no owner, audited and evented', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.setAuthor(CUSTOMER);
    doc.setTitle(CUSTOMER);
    const body = Buffer.from(await doc.save({ useObjectStreams: false }));
    const { svc, stored, updates, audits, events } = service({ body, originalName: `${CUSTOMER}.pdf` });
    await svc.makeOne(1n);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.fileName).toBe('DEVOR-2609-00001-original-v1.pdf');
    expect(stored[0]!.ownerUserId).toBeNull();
    expect(stored[0]!.body.toString('latin1')).not.toContain(CUSTOMER);
    expect(updates[0]).toMatchObject({ status: 'ready', copyFileId: 99n });
    expect(audits.map((a) => a.action)).toEqual(['artwork.production_copy_ready']);
    expect(events.map((e) => e.type)).toEqual(['artwork.production_copy_ready']);
  });

  it.each([
    ['%!PS-Adobe-3.0 EPSF-3.0', 'logo.eps', 'unsupported_format'],
    ['8BPS photoshop', 'logo.psd', 'unsupported_format'],
    ['PK\x03\x04 zip', 'files.zip', 'unsupported_format'],
  ])('offers nothing for a format it cannot clean safely (%s)', async (content, name, reason) => {
    const { svc, stored, updates } = service({ body: Buffer.from(content, 'latin1'), originalName: name });
    await svc.makeOne(1n);
    expect(stored).toHaveLength(0);
    expect(updates[0]).toMatchObject({ status: 'unsupported', failureReason: reason });
  });

  it('offers nothing for a source that is not clean', async () => {
    const { svc, stored, updates } = service({
      body: Buffer.from('%PDF-1.4'),
      originalName: 'a.pdf',
      status: 'pending',
    });
    await svc.makeOne(1n);
    expect(stored).toHaveLength(0);
    expect(updates[0]).toMatchObject({ status: 'unsupported', failureReason: 'source_unavailable' });
  });
});
