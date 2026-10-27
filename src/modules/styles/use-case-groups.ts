/**
 * The `useCase` list filter (styles redesign C0, the "ช่วยเลือกให้หน่อย" wizard): `a,b;c` = (a or b) and c.
 * A single value is one group of one, as before.
 */
export function useCaseGroupsOf(value: string | undefined): string[][] {
  return (value ?? '')
    .split(';')
    .filter(Boolean)
    .map((group) => group.split(',').filter(Boolean));
}

/** True when the style's use cases meet every group (no groups: always). */
export function matchesUseCaseGroups(codes: readonly string[], groups: readonly string[][]): boolean {
  return groups.every((group) => group.some((code) => codes.includes(code)));
}
