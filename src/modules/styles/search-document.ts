/**
 * D-245: the text a style is found by — codes, names, family, category, material class, synonyms, use cases and a
 * reference code once verified (D-211) — lower-cased, searched with `simple` full text and trigram similarity.
 */
export function searchDocument(
  base: {
    code: string;
    nameTh: string;
    nameEn: string;
    family: string;
    category: string;
    materialClass: string;
    referenceCode: string | null;
    referenceVerifiedAt: Date | null;
  },
  synonyms: string[],
  useCases: string[],
): string {
  return [
    base.code,
    base.nameTh,
    base.nameEn,
    base.family,
    base.category,
    base.materialClass,
    base.referenceVerifiedAt ? base.referenceCode : null,
    ...synonyms,
    ...useCases,
  ]
    .filter((x): x is string => Boolean(x))
    .join(' ')
    .toLowerCase();
}
