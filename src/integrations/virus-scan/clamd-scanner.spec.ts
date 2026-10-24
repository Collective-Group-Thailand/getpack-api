import { createServer, type Server, type Socket } from 'node:net';
import { Readable } from 'node:stream';

import { type ObjectStorage } from '../s3/object-storage.port';
import { ClamdScanner } from './clamd-scanner';
import { EICAR_TEST_STRING } from './fake-virus-scanner';

/** A minimal clamd: parses INSTREAM chunks and answers like the real daemon. */
function fakeClamd(
  onStream?: (bytes: Buffer) => string,
): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    let command: string | null = null;
    const body: Buffer[] = [];
    socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === 'zPING') return void socket.end('PONG\0');
      }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const bytes = Buffer.concat(body);
          received.push(bytes);
          const verdict =
            onStream?.(bytes) ??
            (bytes.includes(EICAR_TEST_STRING) ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK');
          return void socket.end(`${verdict}\0`);
        }
        if (buffer.length < 4 + length) return;
        body.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0, received });
    }),
  );
}

const storageWith = (bytes: Buffer): ObjectStorage =>
  ({
    getStream: () => Promise.resolve(Readable.from([bytes.subarray(0, 3), bytes.subarray(3)])),
  }) as unknown as ObjectStorage;

describe('ClamdScanner', () => {
  let clamd: Awaited<ReturnType<typeof fakeClamd>>;
  afterEach(() => new Promise<void>((done) => clamd.server.close(() => done())));

  const scanner = (storage: ObjectStorage = storageWith(Buffer.alloc(0)), maxBytes = 1024) =>
    new ClamdScanner({ host: '127.0.0.1', port: clamd.port, maxBytes, timeoutMs: 2000 }, storage);

  it('reports a clean file from the sample and an infected one as infected', async () => {
    clamd = await fakeClamd();
    const clean = Buffer.from('%PDF-1.7 artwork');
    expect(await scanner().scan({ key: 'k', sample: clean, sizeBytes: clean.length })).toBe('clean');
    const eicar = Buffer.from(EICAR_TEST_STRING);
    expect(await scanner().scan({ key: 'k', sample: eicar, sizeBytes: eicar.length })).toBe('infected');
    expect(clamd.received[0]).toEqual(clean);
  });

  it('streams an object larger than the sample from storage, capped at maxBytes', async () => {
    clamd = await fakeClamd();
    const object = Buffer.from('0123456789abcdef');
    const verdict = await scanner(storageWith(object), 10).scan({
      key: 'k',
      sample: object.subarray(0, 4),
      sizeBytes: object.length,
    });
    expect(verdict).toBe('clean');
    expect(clamd.received[0]?.toString()).toBe('0123456789');
  });

  it('throws on an unexpected reply or an unreachable daemon, so the file job retries', async () => {
    clamd = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    const sample = Buffer.from('x');
    await expect(scanner().scan({ key: 'k', sample, sizeBytes: 1 })).rejects.toThrow(
      'unexpected clamd reply',
    );
    const down = new ClamdScanner(
      { host: '127.0.0.1', port: 1, maxBytes: 10, timeoutMs: 500 },
      storageWith(sample),
    );
    await expect(down.scan({ key: 'k', sample, sizeBytes: 1 })).rejects.toThrow('clamav');
  });

  it('answers ping', async () => {
    clamd = await fakeClamd();
    expect(await scanner().ping()).toBe(true);
  });
});
