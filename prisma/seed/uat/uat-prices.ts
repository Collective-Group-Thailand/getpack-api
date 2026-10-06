import { type Prisma } from '../../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  type PriceComponentDescriptor,
  PriceComponentRegistry,
  type PriceValues,
} from '../../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../../src/modules/partners/pricing/price-list-builder';
import { CORRUGATE_PRICE_COMPONENTS } from '../../../src/modules/pricing/calculators/corrugate/price-components';
import { FOLDING_PRICE_COMPONENTS } from '../../../src/modules/pricing/calculators/folding/price-components';
import { LABEL_PRICE_COMPONENTS } from '../../../src/modules/pricing/calculators/label/price-components';
import { POUCH_PRICE_COMPONENTS } from '../../../src/modules/pricing/calculators/pouch/price-components';
import { SERVICE_PRICE_COMPONENTS } from '../../../src/modules/pricing/calculators/service/price-components';
import { STANDARD_PRODUCT_PRICE_COMPONENTS } from '../../../src/modules/pricing/calculators/standard-product/price-components';

type Tx = Prisma.TransactionClient;

/** The rehearsal versions apply the day after the dev versions (both before any UAT activity). */
export const UAT_EFFECTIVE_FROM = new Date('2026-01-02T00:00:00+07:00');

/**
 * Which price components each product type's price list holds — as the dev seeds register them: tags & sleeves
 * price on the folding engine, corrugate and labels add their own components to the shared folding ones. A
 * component left out here would be dropped from the new version (populate copies registered tables only).
 */
const COMPONENTS_BY_TYPE: Record<string, readonly PriceComponentDescriptor[]> = {
  folding_carton: FOLDING_PRICE_COMPONENTS,
  tag_sleeve: FOLDING_PRICE_COMPONENTS,
  corrugated: [...FOLDING_PRICE_COMPONENTS, ...CORRUGATE_PRICE_COMPONENTS],
  label_sticker: [...FOLDING_PRICE_COMPONENTS, ...LABEL_PRICE_COMPONENTS],
  flexible_pouch: POUCH_PRICE_COMPONENTS,
  standard_product: STANDARD_PRODUCT_PRICE_COMPONENTS,
  service: SERVICE_PRICE_COMPONENTS,
};

export function registryFor(typeCode: string): PriceComponentRegistry {
  const registry = new PriceComponentRegistry();
  for (const d of COMPONENTS_BY_TYPE[typeCode] ?? []) registry.register(d);
  return registry;
}

/** A new line in API form (refs as public ids), checked like the dev seeds check theirs. */
export function newLine(typeCode: string, component: FinalLine['component'], raw: PriceValues): FinalLine {
  const d = registryFor(typeCode).get(component)!;
  const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
  if (errors.length > 0) throw new Error(`uat ${typeCode} ${component}: ${JSON.stringify(errors)}`);
  return { component, action: 'add', lineKey: lineKeyOf(d, values), values };
}

/**
 * Gives the rehearsal master data prices **without inventing any**: every line of the factory's current approved
 * price list that references a dev entity named in `alike` (source public id → rehearsal public ids) is copied once
 * per combination of rehearsal alternatives, values unchanged. A rehearsal art card 400 gsm therefore costs what the
 * dev art card costs per kg (the engine prices paper by weight, so it is dearer per piece), a BC board what the dev
 * B board costs, and so on. `extra` adds new lines per product type (stock products scaled from dev tiers). Each
 * price list that gains lines gets a new approved version effective `UAT_EFFECTIVE_FROM`; history is kept.
 * Returns the number of lines added per product type.
 */
export async function cloneFactoryPriceLines(
  tx: Tx,
  factoryCode: string,
  alike: ReadonlyMap<string, readonly string[]>,
  extra: Record<string, FinalLine[]> = {},
): Promise<Record<string, number>> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: factoryCode } });
  const lists = await tx.priceList.findMany({
    where: { factoryId: factory.id },
    include: { productType: true },
  });
  const added: Record<string, number> = {};
  for (const list of lists) {
    const typeCode = list.productType.code;
    const registry = registryFor(typeCode);
    if (registry.all().length === 0) continue;
    const base = await tx.priceListVersion.findFirst({
      where: { priceListId: list.id, status: 'approved' },
      orderBy: { versionNo: 'desc' },
    });
    if (!base) continue;
    const builder = new PriceListBuilder(registry);
    const lines = new Map<string, FinalLine>();
    for (const d of registry.all()) {
      const { rows } = await builder.rows(tx, base.id, d.component);
      const existing = new Set(rows.map((r) => r.lineKey));
      const refs = [...d.dimensions, ...d.values].filter((c) => c.type === 'ref').map((c) => c.key);
      for (const row of rows) {
        const swappable = refs.filter((k) => typeof row.values[k] === 'string' && alike.has(row.values[k]));
        if (swappable.length === 0) continue;
        let combos: PriceValues[] = [row.values];
        for (const key of swappable) {
          const next: PriceValues[] = [];
          for (const combo of combos) {
            next.push(combo);
            for (const target of alike.get(row.values[key] as string)!)
              next.push({ ...combo, [key]: target });
          }
          combos = next;
        }
        for (const values of combos.slice(1)) {
          const lineKey = lineKeyOf(d, values);
          if (existing.has(lineKey)) continue;
          lines.set(`${d.component}|${lineKey}`, { component: d.component, action: 'add', lineKey, values });
        }
      }
    }
    for (const line of extra[typeCode] ?? []) lines.set(`${line.component}|${line.lineKey}`, line);
    if (lines.size === 0) continue;
    const version = await tx.priceListVersion.create({
      data: {
        priceListId: list.id,
        versionNo: base.versionNo + 1,
        origin: base.origin,
        basedOnVersionId: base.id,
        effectiveFrom: UAT_EFFECTIVE_FROM,
        reason: 'UAT rehearsal seed: dev fake prices copied to the rehearsal catalogue (not real prices)',
      },
    });
    const { lineCount, contentSha256 } = await builder.populate(tx, version.id, base.id, [...lines.values()]);
    await tx.priceListVersion.update({
      where: { id: version.id },
      data: { lineCount, contentSha256, status: 'approved', decidedAt: new Date() },
    });
    added[typeCode] = lines.size;
  }
  return added;
}
