import { type CorrugatePackInput, packCorrugate } from './corrugate-packing';
import { type CartonSpec, type FoldingPackInput, packFolding } from './folding-packing';
import { type LabelPackInput, packLabel } from './label-packing';
import { type PackedPart } from './shipment';

/**
 * One part of a shipment to pack, tagged with the packer that knows its shape (B2.4, D-013): each
 * calculator's adapter describes its parts, the shipping quote packs them for a quantity. The other types
 * add their kind with their calculator session (U-B6).
 */
export type ShipmentPart =
  | ({ kind: 'folding' } & Omit<FoldingPackInput, 'qty'>)
  | ({ kind: 'corrugate' } & Omit<CorrugatePackInput, 'qty'>)
  | ({ kind: 'label' } & Omit<LabelPackInput, 'qty'>);

/** Packs `qty` pieces of a part: weight always, cartons when the carton spec is set. */
export function packPart(part: ShipmentPart, qty: number, carton: CartonSpec | null): PackedPart {
  switch (part.kind) {
    case 'folding': {
      const { kind: _kind, ...input } = part;
      return packFolding({ ...input, qty }, carton);
    }
    case 'corrugate': {
      const { kind: _kind, ...input } = part;
      return packCorrugate({ ...input, qty }, carton);
    }
    case 'label': {
      const { kind: _kind, ...input } = part;
      return packLabel({ ...input, qty }, carton);
    }
  }
}
