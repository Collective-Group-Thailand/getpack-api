import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type CatalogOptionKind } from '@generated/prisma/client';

/** Public ids of polymorphic option references, keyed by `kind:id`. */
export type OptionPublicIds = Map<string, string>;
export const optionKey = (kind: string, id: bigint) => `${kind}:${id}`;

interface OptionTable {
  findMany(args: {
    where: { id?: { in: bigint[] }; publicId?: { in: string[] } };
    select: { id: true; publicId: true };
  }): Promise<{ id: bigint; publicId: string }[]>;
}

/**
 * Definition table behind each option kind (mirrors `catalog_option_exists()` in the catalogue
 * migration). `print_side` and `process` have no table yet (schema-design §7 A-19).
 */
export function optionTable(db: Tx, kind: CatalogOptionKind): OptionTable | null {
  const tables: Partial<Record<CatalogOptionKind, unknown>> = {
    material: db.material,
    finish: db.finish,
    coating: db.finish,
    ink_colour: db.inkColour,
    diecut: db.diecutType,
    assembly: db.assembly,
    print_type: db.printType,
    pattern: db.pattern,
  };
  return (tables[kind] as OptionTable | undefined) ?? null;
}

/** Public ids of polymorphic option references, keyed by {@link optionKey}. */
export async function optionPublicIds(
  db: Tx,
  refs: readonly { optionKind: CatalogOptionKind; optionId: bigint }[],
): Promise<OptionPublicIds> {
  const byKind = new Map<CatalogOptionKind, bigint[]>();
  for (const ref of refs) byKind.set(ref.optionKind, [...(byKind.get(ref.optionKind) ?? []), ref.optionId]);
  const result: OptionPublicIds = new Map();
  for (const [kind, ids] of byKind) {
    const table = optionTable(db, kind);
    if (!table) continue;
    const rows = await table.findMany({ where: { id: { in: ids } }, select: { id: true, publicId: true } });
    for (const row of rows) result.set(optionKey(kind, row.id), row.publicId);
  }
  return result;
}

/**
 * Internal ids of offered options, in input order. Unknown ids (or a finish that is not a coating
 * offered as `coating`) are a 422 on `<path>[i].optionId`.
 */
export async function resolveOptionIds(
  db: Tx,
  options: readonly { kind: CatalogOptionKind; optionId: string }[],
  path: string,
): Promise<bigint[]> {
  const ids: bigint[] = [];
  for (const [index, option] of options.entries()) {
    const table = optionTable(db, option.kind);
    const [row] = table
      ? await table.findMany({
          where: { publicId: { in: [option.optionId] } },
          select: { id: true, publicId: true },
        })
      : [];
    const coatingOk =
      option.kind !== 'coating' ||
      (row !== undefined &&
        (await db.finish.count({ where: { id: row.id, finishKind: { in: ['coating', 'lamination'] } } })) >
          0);
    if (!row || !coatingOk) {
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: `${path}[${index}].optionId`,
            code: 'exists',
            message: `no ${option.kind} with this id`,
          },
        ],
      });
    }
    ids.push(row.id);
  }
  return ids;
}
