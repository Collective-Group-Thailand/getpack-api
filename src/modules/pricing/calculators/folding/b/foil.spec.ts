import { foilArea, type FoilLayout } from './foil';

const standard: FoilLayout = {
  layoutStandard: true,
  c: 0,
  gap: 3,
  dw: 180,
  dl: 250,
  trim: 2,
  layPw: 2,
  layPl: 3,
};

describe('engine B foil strips (legacy Object/Foil, Point, Rectangle)', () => {
  it('prices one location from its size alone: the position cancels out', () => {
    const at = (x: number, y: number) => foilArea([{ x, y, width: 30, length: 60 }], standard)!;
    expect(at(0, 0)).toEqual(at(55, 120));
    const a = at(0, 0);
    // CD from the x strip: run (2 − 1)(180 + 3) + (30 + 4) mm, width (60 + 4) × 3 blanks.
    expect(a.cd.areaM2).toBeCloseTo((64 * 3 * (183 + 34)) / 1e6, 12);
    // MD from the y strip: run (3 − 1)(250 + 3) + (60 + 4) mm, width (30 + 4) × 2 blanks.
    expect(a.md.areaM2).toBeCloseTo((34 * 2 * (506 + 64)) / 1e6, 12);
    expect([a.md.totalLine, a.cd.totalLine]).toEqual([2, 3]);
  });

  it('merges locations that strictly overlap along a direction, never ones that only touch (QB23)', () => {
    const overlapping = foilArea(
      [
        { x: 0, y: 0, width: 20, length: 40 },
        { x: 30, y: 50, width: 20, length: 40 },
      ],
      standard,
    )!;
    // Along x the grown rectangles [−2, 42] and [28, 72] overlap: one CD strip; along y [−2, 22], [48, 72] do not.
    expect([overlapping.cd.lineAmount, overlapping.md.lineAmount]).toEqual([1, 2]);
    const touching = foilArea(
      [
        { x: 0, y: 0, width: 20, length: 40 },
        { x: 44, y: 0, width: 20, length: 40 },
      ],
      standard,
    )!;
    // [−2, 42] and [42, 86] touch: two CD strips; along y they overlap fully: one MD strip.
    expect([touching.cd.lineAmount, touching.md.lineAmount]).toEqual([2, 1]);
    expect([touching.cd.totalLine, touching.md.totalLine]).toEqual([6, 2]);
  });

  it('swaps the axes on a rotated layout and shortens only the dw runs of interlocked blanks', () => {
    const one = [{ x: 0, y: 0, width: 30, length: 60 }];
    const rotated = foilArea(one, { ...standard, layoutStandard: false })!;
    expect(rotated.md.areaM2).toBeCloseTo((64 * 2 * (2 * 183 + 34)) / 1e6, 12);
    expect(rotated.cd.areaM2).toBeCloseTo((34 * 3 * (253 + 64)) / 1e6, 12);
    const interlocked = foilArea(one, { ...standard, c: 12 })!;
    expect(interlocked.cd.areaM2).toBeCloseTo((64 * 3 * (183 - 12 + 34)) / 1e6, 12);
    expect(interlocked.md.areaM2).toBeCloseTo(foilArea(one, standard)!.md.areaM2, 12);
  });

  it('has no area without a location (legacy dd(), QB20)', () => {
    expect(foilArea([], standard)).toBeNull();
  });
});
