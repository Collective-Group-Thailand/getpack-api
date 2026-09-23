import { type ScanVerdict, type VirusScanner } from './virus-scanner.port';

/** The EICAR test string, split so this file itself is not flagged by scanners. */
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

/** Development/test scanner: files containing the EICAR test string are infected. */
export class FakeVirusScanner implements VirusScanner {
  scan(input: { sample: Buffer }): Promise<ScanVerdict> {
    return Promise.resolve(input.sample.includes(EICAR) ? 'infected' : 'clean');
  }
}

export const EICAR_TEST_STRING = EICAR;
