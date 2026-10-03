import { sha256 } from '@common/crypto/hashing';
import { canonical } from '@modules/catalog/imports/import-engine';

/**
 * The specification of a quotation, as tooling (D-289) and reorder SKUs (D-288) compare it: the product type and the
 * configuration without quantities or delivery — sha256 of its canonical JSON.
 */
export function specificationHash(
  productTypeCode: string,
  configuration: Record<string, unknown>,
): Uint8Array {
  const { quantities: _q, ...rest } = configuration;
  void _q;
  return sha256(JSON.stringify(canonical({ productTypeCode, configuration: rest })));
}
