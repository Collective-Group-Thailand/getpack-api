import { type ScanVerdict, type VirusScanner } from './virus-scanner.port';

/**
 * Real-mode placeholder until the production scanner is chosen (open question in
 * docs/PROGRESS.md: GuardDuty Malware Protection for S3 or ClamAV). Files stay `pending` and are
 * therefore not downloadable — the conservative default.
 */
export class ExternalScanPending implements VirusScanner {
  scan(): Promise<ScanVerdict> {
    return Promise.resolve('pending');
  }
}
