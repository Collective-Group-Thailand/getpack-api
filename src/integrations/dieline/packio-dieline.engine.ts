import {
  type DielineDrawing,
  type DielineEngine,
  DielineEngineUnavailableError,
  type DielineRequest,
} from './dieline-engine.port';

/** What `@packio/dieline` is expected to export (the package is pinned from GitHub Packages once published). */
interface DielinePackage {
  version?: string;
  draw(input: DielineRequest): Promise<{ body: Uint8Array; mimeType: string }>;
}

const PACKAGE = '@packio/dieline';

/**
 * Adapter over `@packio/dieline`, loaded on first use. The package is not published yet (D-002): the
 * import fails and the engine reports itself unavailable, so callers answer 501 instead of crashing.
 */
export class PackioDielineEngine implements DielineEngine {
  private loaded: Promise<DielinePackage | null> | null = null;

  async available(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async draw(request: DielineRequest): Promise<DielineDrawing> {
    const engine = await this.load();
    if (!engine) throw new DielineEngineUnavailableError(`${PACKAGE} is not installed`);
    const out = await engine.draw(request);
    return {
      body: Buffer.from(out.body),
      mimeType: out.mimeType,
      fileName: `dieline-${request.dielineKey}-${request.lengthMm}x${request.widthMm}x${request.heightMm}.${request.format}`,
      engineVersion: `${PACKAGE}@${engine.version ?? 'unknown'}`,
    };
  }

  private load(): Promise<DielinePackage | null> {
    this.loaded ??= (import(PACKAGE) as Promise<DielinePackage>).catch(() => null);
    return this.loaded;
  }
}
