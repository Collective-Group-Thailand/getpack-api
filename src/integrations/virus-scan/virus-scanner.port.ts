/** Malware scanning of uploaded objects (B1.3 "async virus-scan interface + fake"). */
export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');

export type ScanVerdict = 'clean' | 'infected' | 'pending';

export interface VirusScanner {
  /**
   * `key` names the stored object (real scanners read it themselves); `sample` holds up to the
   * first 64 MiB for in-process scanners. `pending` = the verdict arrives later (external scanner).
   */
  scan(input: { key: string; sample: Buffer; sizeBytes: number }): Promise<ScanVerdict>;
}
