import { FileCheckRetention } from './file-check-retention';

/** D-459 (C11): unordered file-check files go after the retention, audited, idempotent, objects after the commit. */
describe('file check retention (D-459)', () => {
  const now = new Date('2027-03-01T00:00:00Z');

  function setup(file: Record<string, unknown> | null, days: unknown = 90) {
    const calls: string[] = [];
    const tx = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(file),
        update: jest.fn(() => Promise.resolve(calls.push('purge'))),
        updateMany: jest.fn(() => Promise.resolve(calls.push('purge-thumbs'))),
      },
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(file ? [{ id: 7n }] : []),
      withTx: jest.fn(async (fn: (t: typeof tx) => unknown) => {
        const out = await fn(tx);
        calls.push('commit');
        return out;
      }),
    };
    const settings = { at: jest.fn().mockResolvedValue({ value: days }) };
    const audit = { record: jest.fn(() => Promise.resolve(calls.push('audit'))) };
    const storage = { delete: jest.fn((key: string) => Promise.resolve(calls.push(`delete ${key}`))) };
    const job = new FileCheckRetention(prisma as never, settings as never, audit as never, storage as never);
    return { job, prisma, tx, audit, storage, calls, settings };
  }

  const FILE = {
    id: 7n,
    publicId: 'f-1',
    storageKey: 'k/original.pdf',
    purgedAt: null,
    legalHold: false,
    thumbnails: [{ id: 8n, storageKey: 'k/original.pdf.thumb.webp' }],
    fileCheckVersions: [{ fileCheck: { publicId: 'c-1' } }, { fileCheck: { publicId: 'c-1' } }],
  };

  it('purges a qualifying file: row marked, one audit row, storage deleted after the commit', async () => {
    const { job, tx, audit, calls, settings } = setup(FILE);
    await expect(job.run(now)).resolves.toBe(1);
    expect(settings.at).toHaveBeenCalledWith('artwork.file_check_retention_days', { at: now });
    expect(tx.fileObject.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { purgedAt: now } });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        category: 'data_access',
        action: 'file_check.file_purged',
        resourcePublicId: 'f-1',
        data: { reason: 'unordered_retention', retentionDays: 90, fileChecks: ['c-1'] },
      }),
    );
    // No file name in the audit row (PDPA); the bytes leave storage only once the rows are committed.
    expect(JSON.stringify((audit.record.mock.calls[0] as unknown[])[1])).not.toContain('original');
    expect(calls).toEqual([
      'purge',
      'purge-thumbs',
      'audit',
      'commit',
      'delete k/original.pdf',
      'delete k/original.pdf.thumb.webp',
    ]);
  });

  it('skips a file purged or put on legal hold meanwhile (idempotent)', async () => {
    for (const changed of [{ purgedAt: now }, { legalHold: true }]) {
      const { job, tx, storage } = setup({ ...FILE, ...changed });
      await expect(job.run(now)).resolves.toBe(0);
      expect(tx.fileObject.update).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    }
  });

  it('does nothing without a usable retention value', async () => {
    const { job, prisma } = setup(FILE, null);
    await expect(job.run(now)).resolves.toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
