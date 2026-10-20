import { spawn } from 'node:child_process';

export interface RunOptions {
  /** Killed (SIGKILL) after this long. */
  timeoutMs: number;
  /** Bytes of standard output kept at most; more is an error (a runaway tool). */
  maxOutputBytes?: number;
  input?: Buffer;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export class ToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = 'ToolError';
  }
}

/**
 * Runs a reader tool (pdftotext, pdftoppm, tesseract) on a file the malware scan passed: no shell, a hard time
 * limit, a cap on what it may print, one OCR thread (the worker runs files one after another).
 */
export function run(cmd: string, args: string[], options: RunOptions): Promise<Buffer> {
  const max = options.maxOutputBytes ?? 64 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', OMP_THREAD_LIMIT: '1', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let size = 0;
    let err = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new ToolError(cmd, `timed out after ${options.timeoutMs} ms`)));
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        child.kill('SIGKILL');
        finish(() => reject(new ToolError(cmd, `output over ${max} bytes`)));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 4000) err += chunk.toString('utf8');
    });
    child.on('error', (e) => finish(() => reject(new ToolError(cmd, e.message))));
    child.on('close', (code) =>
      finish(() =>
        code === 0
          ? resolve(Buffer.concat(out))
          : reject(
              new ToolError(cmd, `exit ${code ?? 'signal'}: ${err.trim().split('\n').slice(-3).join(' | ')}`),
            ),
      ),
    );
    child.stdin.on('error', () => undefined);
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
