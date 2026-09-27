/**
 * The dieline drawing engine (`@packio/dieline`, published by `packio-web`, D-002). It turns a pattern's
 * `dieline_key` and the box dimensions into a flat dieline drawing. Until the package is published the
 * engine is unavailable and the API answers `501 drawing.engine_unavailable` (B4.1).
 */
export const DIELINE_ENGINE = Symbol('DIELINE_ENGINE');

export type DielineFormat = 'svg' | 'dxf' | 'pdf';

export interface DielineRequest {
  dielineKey: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  format: DielineFormat;
}

export interface DielineDrawing {
  body: Buffer;
  mimeType: string;
  fileName: string;
  engineVersion: string;
}

export class DielineEngineUnavailableError extends Error {
  constructor(reason: string) {
    super(`dieline engine unavailable: ${reason}`);
    this.name = 'DielineEngineUnavailableError';
  }
}

export interface DielineEngine {
  /** Loads the engine when needed; false when it is not installed. */
  available(): Promise<boolean>;
  draw(request: DielineRequest): Promise<DielineDrawing>;
}
