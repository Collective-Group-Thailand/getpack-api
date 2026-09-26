/**
 * One folding part as the engines see it (B2.3, legacy `app/Libraries/Folding/PrepareRequest.php` fed
 * by `FoldingCalculator::CSCombinetoFactory:618-872`). Catalogue references are Packio ids (strings);
 * the loader has already checked that the factory offers each of them (legacy group → factory-row
 * mapping, whose misses were the "ไม่รองรับ…" errors).
 */

export interface PrintColour {
  inkColourId: string;
  /** Ink coverage in percent (legacy `percent[]`, aligned with `color[]`). */
  percent: number;
}

export interface Finish2Request {
  finishId: string;
  /** Platform finish flags (legacy per-factory `finish.required_*`). */
  requiresAmount: boolean;
  requiresWidth: boolean;
  requiresLength: boolean;
  /** Only carried when the finish requires an amount, as legacy (`CSCombinetoFactory:709-716`). */
  amount?: number;
  /** mm per location. */
  w?: readonly number[];
  l?: readonly number[];
}

export interface AssemblyRequest {
  assemblyId: string;
  requiresAmount: boolean;
  requiresWidth: boolean;
  requiresLength: boolean;
  /** Platform `assemblies.skip_waste` (legacy `assembly.skip_waste`). */
  skipWaste: boolean;
  amount?: number;
  w?: readonly number[];
  l?: readonly number[];
}

export interface PartRequest {
  materialId: string;
  difficultyLevelId: string;
  printFront?: readonly PrintColour[];
  printBack?: readonly PrintColour[];
  finish1FrontId?: string;
  finish1BackId?: string;
  finish2: readonly Finish2Request[];
  diecutTypeId?: string;
  assemblies: readonly AssemblyRequest[];
  /** CS custom cost: waste bands are ignored and the first row is taken (legacy `custom_cost.custom`). */
  customCost?: boolean;
}

/** Legacy `print_amount`: passes per ink colour, `array_count_values(color_id)` (`PrepareRequest:173-180`). */
export function printAmount(colours: readonly PrintColour[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of colours) counts.set(c.inkColourId, (counts.get(c.inkColourId) ?? 0) + 1);
  return counts;
}

export const hasPrintFront = (r: PartRequest): boolean => (r.printFront?.length ?? 0) > 0;
export const hasPrintBack = (r: PartRequest): boolean => (r.printBack?.length ?? 0) > 0;
export const hasFinish2 = (r: PartRequest): boolean => r.finish2.length > 0;
export const hasDiecut = (r: PartRequest): boolean => r.diecutTypeId !== undefined;
export const hasAssembly = (r: PartRequest): boolean => r.assemblies.length > 0;

/** A process the factory cannot run on the material (legacy `paper_cannot_do_process`). */
export type ProcessExclusion =
  | { process: 'print_front' | 'print_back' }
  | { process: 'finish'; finishId: string }
  | { process: 'assembly'; assemblyId: string };

/**
 * `PrepareRequest::validCanDoProcess` as specified (quirk Q6): legacy returns on the first flag it reads
 * and compares finishes against keys that never exist, so most exclusions were never enforced.
 */
export function excludedProcess(
  request: PartRequest,
  exclusions: readonly ProcessExclusion[],
): string | null {
  const finishes = new Set(
    [request.finish1FrontId, request.finish1BackId, ...request.finish2.map((f) => f.finishId)].filter(
      (id): id is string => id !== undefined,
    ),
  );
  const assemblies = new Set(request.assemblies.map((a) => a.assemblyId));
  for (const e of exclusions) {
    if (e.process === 'print_front' && hasPrintFront(request)) return 'print_front';
    if (e.process === 'print_back' && hasPrintBack(request)) return 'print_back';
    if (e.process === 'finish' && finishes.has(e.finishId)) return `finish:${e.finishId}`;
    if (e.process === 'assembly' && assemblies.has(e.assemblyId)) return `assembly:${e.assemblyId}`;
  }
  return null;
}

/** Why a factory cannot price a part (legacy computes with 0 or drops silently — quirks Q14, Q16). */
export class PricingError extends Error {
  constructor(
    readonly code:
      | 'price_line_missing'
      | 'process_not_possible'
      | 'no_priced_layout'
      | 'geometry_condition_missing'
      | 'geometry_band_missing'
      | 'geometry_standard_blank_missing'
      | 'geometry_no_layout',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'PricingError';
  }
}
