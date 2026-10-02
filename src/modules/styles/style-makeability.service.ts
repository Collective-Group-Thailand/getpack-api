import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

export interface MakeabilityQuery {
  variantId: bigint;
  baseId: bigint;
  category: string;
  family: string;
  materialClass: string;
  options: Record<string, unknown>;
  /** Processes the base's current recipe declares (empty = use the process rules). */
  recipeProcesses: string[];
}

/**
 * Which variants at least one active partner can make (D-243, D-244). U3.B1 has no process capability yet, so no
 * variant is makeable; U3.B3 answers from verified factory process capabilities.
 */
@Injectable()
export class StyleMakeabilityService {
  makeable(_tx: Tx, variants: MakeabilityQuery[]): Promise<Map<bigint, boolean>> {
    return Promise.resolve(new Map(variants.map((v) => [v.variantId, false])));
  }
}
