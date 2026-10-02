/**
 * Foil strips of engine B (legacy `app/Libraries/Folding/Object/{Foil,Point,Rectangle}.php`, port map §6). Each foil
 * location on the blank grows by the foil trim (`Point::getPoint`), locations overlapping along one direction merge into
 * a strip (`Rectangle::checkRectangleOverlapX/Y`), and every strip runs across the lay-out of the sheet in the machine
 * direction (MD) or across it (CD) (`Foil::calAreaFoilAll`). The cost then picks one axis (`B/CalculateCost.php:838-873`).
 */

export interface FoilLocation {
  /** mm from the left of the blank (legacy `x`). */
  x: number;
  /** mm from the top of the blank (legacy `y`). */
  y: number;
  /** Extent top-to-bottom, mm (legacy `width`). */
  width: number;
  /** Extent left-to-right, mm (legacy `length`). */
  length: number;
}

export interface FoilLayout {
  layoutStandard: boolean;
  /** Overlap of the blanks (legacy `c`; 0 = not interlocked). */
  c: number;
  gap: number;
  dw: number;
  dl: number;
  /** Legacy `trim_foil_mm`, added on every side of a location. */
  trim: number;
  /** Blanks across the sheet's width / length (legacy `slotW` / `slotL`). */
  layPw: number;
  layPl: number;
}

interface Strip {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AxisArea {
  /** Foil m² per sheet on the axis (`sumAreaFoilByAxis`). */
  areaM2: number;
  /** Foil lines per sheet on the axis (`total_line`). */
  totalLine: number;
  /** Strips found along the direction that feeds the axis (`line_amount_*`). */
  lineAmount: number;
}

export interface FoilArea {
  md: AxisArea;
  cd: AxisArea;
}

/** `Point::getPoint`: the location grown by the trim. */
const grown = (f: FoilLocation, t: number): Strip => ({
  left: f.x - t,
  top: f.y - t,
  right: f.x + f.length + t,
  bottom: f.y + f.width + t,
});

/**
 * `checkRectangleOverlapX` (sorted by x, then y) and `checkRectangleOverlapY` (sorted by y; legacy's secondary key is
 * the x list sorted for the other pass, QB22, which cannot change a union of intervals). A strip merges the next
 * location only when they strictly overlap (`diff < 0`): touching locations stay apart (QB23).
 */
function merge(strips: Strip[], along: 'x' | 'y'): Strip[] {
  const sorted = [...strips].sort((a, b) =>
    along === 'x' ? a.left - b.left || a.top - b.top : a.top - b.top || a.left - b.left,
  );
  const result: Strip[] = [];
  for (const s of sorted) {
    const last = result[result.length - 1];
    const diff = last ? (along === 'x' ? s.left - last.right : s.top - last.bottom) : 0;
    if (last && diff < 0) {
      last.left = Math.min(last.left, s.left);
      last.top = Math.min(last.top, s.top);
      last.right = Math.max(last.right, s.right);
      last.bottom = Math.max(last.bottom, s.bottom);
    } else {
      result.push({ ...s });
    }
  }
  return result;
}

/**
 * `Foil::calAreaFoil` for the locations of one finish on one lay-out, or null when legacy cannot compute it (no
 * location; legacy then calls `dd()`, QB20).
 */
export function foilArea(locations: readonly FoilLocation[], layout: FoilLayout): FoilArea | null {
  if (locations.length === 0) return null;
  const rects = locations.map((f) => grown(f, layout.trim));
  // X strips: `widthFoil` = x-span, `lengthFoil` = y-span; Y strips: the reverse.
  const xStrips = merge(rects, 'x').map((s) => ({ width: s.right - s.left, length: s.bottom - s.top }));
  const yStrips = merge(rects, 'y').map((s) => ({ width: s.bottom - s.top, length: s.right - s.left }));
  const { layPw, layPl, dw, dl, gap, c } = layout;
  // `c` (interlocked blanks) shortens only the runs laid along dw (`:279-280`, `:324-326`).
  const overlap = (lay: number): number => (c === 0 ? 0 : (lay - 1) * c);
  const axis = (
    strips: { width: number; length: number }[],
    run: (s: { length: number }) => number,
    across: number,
    lines: number,
  ): AxisArea => ({
    areaM2: strips.reduce((a, s) => a + (s.width * across * run(s)) / 1000000, 0),
    totalLine: strips.length * lines,
    lineAmount: strips.length,
  });
  if (layout.layoutStandard) {
    return {
      cd: axis(xStrips, (s) => (layPw - 1) * (dw + gap) - overlap(layPw) + s.length, layPl, layPl),
      md: axis(yStrips, (s) => (layPl - 1) * (dl + gap) + s.length, layPw, layPw),
    };
  }
  return {
    md: axis(xStrips, (s) => (layPl - 1) * (dw + gap) - overlap(layPl) + s.length, layPw, layPw),
    cd: axis(yStrips, (s) => (layPw - 1) * (dl + gap) + s.length, layPl, layPl),
  };
}
