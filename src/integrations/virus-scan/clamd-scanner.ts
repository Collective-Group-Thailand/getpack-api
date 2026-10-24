import { once } from 'node:events';
import { connect } from 'node:net';

import { ProviderUnavailableError } from '../http/resilient-http';
import { type ObjectStorage } from '../s3/object-storage.port';
import { type ScanVerdict, type VirusScanner } from './virus-scanner.port';

export interface ClamdOptions {
  host: string;
  port: number;
  /** Bytes sent to clamd per object; keep below clamd's `StreamMaxLength`. Larger objects are scanned up to here. */
  maxBytes: number;
  timeoutMs: number;
}

/** INSTREAM chunk size (clamd accepts any length up to StreamMaxLength; 1 MiB keeps socket writes small). */
const CHUNK = 1024 * 1024;

/**
 * ClamAV through clamd's INSTREAM protocol (the `clamav` container of the Collective platform, D-005 media).
 * Small objects are scanned from the sample the file job already read; larger ones are streamed from storage, up to
 * `maxBytes`. A clamd that cannot be reached or answers oddly throws, so the file job retries later — a file is never
 * marked clean without a verdict.
 */
export class ClamdScanner implements VirusScanner {
  constructor(
    private readonly options: ClamdOptions,
    private readonly storage: ObjectStorage,
  ) {}

  async scan(input: { key: string; sample: Buffer; sizeBytes: number }): Promise<ScanVerdict> {
    const source: Iterable<Buffer> | AsyncIterable<Buffer | Uint8Array> =
      input.sizeBytes <= input.sample.length ? [input.sample] : await this.storage.getStream(input.key);
    const reply = await this.command('zINSTREAM\0', source);
    if (/: OK$/.test(reply)) return 'clean';
    if (/ FOUND$/.test(reply)) return 'infected';
    throw new ProviderUnavailableError('clamav', `unexpected clamd reply: ${reply.slice(0, 200)}`);
  }

  /** `PONG` when clamd is up and its signature database is loaded. */
  async ping(): Promise<boolean> {
    return (await this.command('zPING\0')) === 'PONG';
  }

  private command(
    command: string,
    body?: Iterable<Buffer> | AsyncIterable<Buffer | Uint8Array>,
  ): Promise<string> {
    const { host, port, maxBytes, timeoutMs } = this.options;
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      const replies: Buffer[] = [];
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(
          error instanceof ProviderUnavailableError
            ? error
            : new ProviderUnavailableError('clamav', error instanceof Error ? error.message : String(error)),
        );
      };
      socket.setTimeout(timeoutMs, () =>
        fail(new ProviderUnavailableError('clamav', `no reply in ${timeoutMs} ms`)),
      );
      socket.on('error', fail);
      socket.on('data', (data: Buffer) => replies.push(data));
      socket.on('end', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(Buffer.concat(replies).toString('utf8').replaceAll('\0', '').trim());
      });
      socket.once('connect', () => {
        void (async () => {
          socket.write(command);
          if (!body) return;
          let sent = 0;
          for await (const chunk of body) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            for (let offset = 0; offset < buffer.length && sent < maxBytes;) {
              const part = buffer.subarray(offset, offset + Math.min(CHUNK, maxBytes - sent));
              const length = Buffer.alloc(4);
              length.writeUInt32BE(part.length);
              if (!socket.write(Buffer.concat([length, part]))) await once(socket, 'drain');
              offset += part.length;
              sent += part.length;
            }
            if (sent >= maxBytes) break;
          }
          socket.write(Buffer.alloc(4)); // zero-length chunk: end of stream, clamd answers and closes
        })().catch(fail);
      });
    });
  }
}
