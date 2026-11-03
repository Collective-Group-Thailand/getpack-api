import { createHash } from 'node:crypto';

import { DomainException } from '@common/errors/domain.exception';

import { DielineDownloadsService } from './dieline-downloads.service';

/**
 * D-471: the first dieline download needs no sign-in; from the next one a free sign-in is asked (401
 * `dielines.sign_in_required`, never a payment). The browser is counted by the SHA-256 of its device id only.
 */
describe('free dieline download without sign-in (D-471)', () => {
  const input = {
    variantCode: 'PK-TE-01-K7QD',
    lengthMm: 60,
    widthMm: 40,
    heightMm: 120,
    materialClass: 'paperboard',
    format: 'pdf' as const,
  };
  const deviceId = '0192F3A0-7C1E-7D2A-9B1F-00000000D702';

  function service(free: number, used: number) {
    const count = jest.fn().mockResolvedValue(used);
    const prisma = { dielineDownload: { count } };
    const settings = { at: jest.fn().mockResolvedValue({ value: free }) };
    const s = new DielineDownloadsService(
      prisma as never,
      {} as never,
      settings as never,
      {} as never,
      // Drawing is past the gate: the engine says it is not ready, so a passing gate shows as this error.
      { ready: () => Promise.resolve(false) } as never,
      {} as never,
    );
    return { s, count, settings };
  }

  it('lets a browser take its first download (the gate passes on to the drawing)', async () => {
    const { s } = service(1, 0);
    await expect(s.downloadFree(deviceId, input)).rejects.toMatchObject({
      code: 'drawing.engine_unavailable',
    });
  });

  it('asks for a free sign-in from the second download', async () => {
    const { s } = service(1, 1);
    const error = await s.downloadFree(deviceId, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('dielines.sign_in_required');
  });

  it('asks for sign-in every time when the setting is 0 (the pre-D-471 behaviour)', async () => {
    const { s, count } = service(0, 0);
    await expect(s.downloadFree(deviceId, input)).rejects.toMatchObject({
      code: 'dielines.sign_in_required',
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('counts by the SHA-256 of the device id (case-insensitive), never the id itself', async () => {
    const { s, count } = service(1, 0);
    await s.downloadFree(deviceId, input).catch(() => undefined);
    const where = (count.mock.calls[0] as [{ where: { deviceHash: Uint8Array } }])[0].where;
    const expected = createHash('sha256').update(`dieline-device:${deviceId.toLowerCase()}`).digest();
    expect(Buffer.from(where.deviceHash).equals(expected)).toBe(true);
    expect(JSON.stringify(count.mock.calls)).not.toContain(deviceId.toLowerCase());
  });
});
