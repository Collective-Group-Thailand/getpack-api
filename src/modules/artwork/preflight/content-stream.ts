import { type ColourFamily, type ColourSpaceInfo, type ImageFact } from './facts';

/**
 * A small PDF content-stream interpreter (ADR-0009): just enough of ISO 32000-1 §8–9 to know what is
 * painted where — the transformation matrix (`q Q cm`), stroke widths (`w` + stroking operators), colour
 * operators and spaces, placed images (`Do`, inline `BI … ID … EI`), form XObjects (recursively, with their
 * `/Matrix`), extended graphics states (`gs`, overprint) and text origins (`BT Tm Td TD T* Tj TJ ' "`).
 * Everything else is skipped. It never renders.
 */

export type Operand =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str' }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'arr'; v: Operand[] }
  | { t: 'dict'; v: Map<string, Operand> };

export interface Instruction {
  op: string;
  args: Operand[];
  /** For inline images (`BI`): the image dictionary. */
  inline?: Map<string, Operand>;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** Tokenises a decoded content stream into instructions (operands followed by their operator). */
export function parseContent(bytes: Uint8Array): Instruction[] {
  const out: Instruction[] = [];
  let pos = 0;
  const n = bytes.length;

  const skipWs = () => {
    while (pos < n) {
      const c = bytes[pos]!;
      if (WS.has(c)) pos++;
      else if (c === 0x25) {
        while (pos < n && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
      } else break;
    }
  };
  const regular = () => {
    const start = pos;
    while (pos < n && !WS.has(bytes[pos]!) && !DELIM.has(bytes[pos]!)) pos++;
    return Buffer.from(bytes.subarray(start, pos)).toString('latin1');
  };

  function value(): Operand | { t: 'op'; v: string } | { t: 'end'; v: string } | null {
    skipWs();
    if (pos >= n) return null;
    const c = bytes[pos]!;
    if (c === 0x2f) {
      pos++;
      return { t: 'name', v: decodeName(regular()) };
    }
    if (c === 0x28) {
      let depth = 0;
      while (pos < n) {
        const d = bytes[pos++]!;
        if (d === 0x5c) pos++;
        else if (d === 0x28) depth++;
        else if (d === 0x29 && --depth === 0) break;
      }
      return { t: 'str' };
    }
    if (c === 0x3c && bytes[pos + 1] === 0x3c) {
      pos += 2;
      const entries = new Map<string, Operand>();
      for (;;) {
        const key = value();
        if (key === null || (key.t === 'end' && key.v === '>>')) break;
        if (key.t !== 'name') continue;
        const val = value();
        if (val === null || val.t === 'end' || val.t === 'op') break;
        entries.set(key.v, val);
      }
      return { t: 'dict', v: entries };
    }
    if (c === 0x3e && bytes[pos + 1] === 0x3e) {
      pos += 2;
      return { t: 'end', v: '>>' };
    }
    if (c === 0x3c) {
      while (pos < n && bytes[pos] !== 0x3e) pos++;
      pos++;
      return { t: 'str' };
    }
    if (c === 0x5b) {
      pos++;
      const items: Operand[] = [];
      for (;;) {
        const item = value();
        if (item === null || (item.t === 'end' && item.v === ']')) break;
        if (item.t === 'end' || item.t === 'op') continue;
        items.push(item);
      }
      return { t: 'arr', v: items };
    }
    if (c === 0x5d) {
      pos++;
      return { t: 'end', v: ']' };
    }
    if (c === 0x7b || c === 0x7d || c === 0x29 || c === 0x3e) {
      pos++;
      return value();
    }
    const word = regular();
    if (word === '') {
      pos++;
      return value();
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: Number(word) };
    if (word === 'true' || word === 'false') return { t: 'bool', v: word === 'true' };
    if (word === 'null') return { t: 'null' };
    return { t: 'op', v: word };
  }

  let args: Operand[] = [];
  for (;;) {
    const token = value();
    if (token === null) break;
    if (token.t === 'end') continue;
    if (token.t !== 'op') {
      args.push(token);
      continue;
    }
    if (token.v === 'BI') {
      const dict = new Map<string, Operand>();
      for (;;) {
        const key = value();
        if (key === null || (key.t === 'op' && key.v === 'ID')) break;
        if (key.t !== 'name') continue;
        const val = value();
        if (val === null || val.t === 'end' || val.t === 'op') break;
        dict.set(key.v, val);
      }
      pos++; // the single white-space byte after ID
      // Binary data up to `EI` surrounded by white space.
      while (pos < n) {
        if (
          bytes[pos] === 0x45 &&
          bytes[pos + 1] === 0x49 &&
          WS.has(bytes[pos - 1] ?? 0x20) &&
          (pos + 2 >= n || WS.has(bytes[pos + 2]!) || DELIM.has(bytes[pos + 2]!))
        ) {
          pos += 2;
          break;
        }
        pos++;
      }
      out.push({ op: 'BI', args: [], inline: dict });
      args = [];
      continue;
    }
    out.push({ op: token.v, args });
    args = [];
  }
  return out;
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// --- interpretation ------------------------------------------------------------------------------------

/** `[a b c d e f]` (ISO 32000-1 §8.3.3). */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m × n` (apply `m` first, then `n`). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export type XObjectInfo =
  | { kind: 'image'; widthPx: number; heightPx: number; colour: ColourSpaceInfo; imageMask: boolean }
  | { kind: 'form'; key: string; matrix: Matrix; resources: ResourceResolver; content: Uint8Array };

/** What the interpreter needs from the page (or form) resources. */
export interface ResourceResolver {
  colourSpace(name: string): ColourSpaceInfo | null;
  xObject(name: string): XObjectInfo | null;
  extGState(name: string): { overprint: boolean } | null;
}

export interface PaintFacts {
  images: ImageFact[];
  rgbPaintOps: number;
  spotNames: Set<string>;
  minStrokeWidthPt: number | null;
  overprint: boolean;
  textOrigins: { x: number; y: number }[];
}

/** Bounds against hostile files (technical, not business values). */
const MAX_FORM_DEPTH = 12;
const MAX_TEXT_ORIGINS = 2_000;

interface GState {
  ctm: Matrix;
  lineWidth: number;
  fill: ColourSpaceInfo;
  stroke: ColourSpaceInfo;
  overprint: boolean;
}

const DEVICE: Record<string, ColourFamily> = {
  DeviceRGB: 'rgb',
  RGB: 'rgb',
  CalRGB: 'rgb',
  DeviceCMYK: 'cmyk',
  CMYK: 'cmyk',
  DeviceGray: 'gray',
  G: 'gray',
  CalGray: 'gray',
  Pattern: 'pattern',
};

const STROKE_OPS = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

/** Runs a content stream (and the forms it paints) and collects what the rules need. */
export function interpret(
  content: Uint8Array,
  resources: ResourceResolver,
  facts: PaintFacts = emptyPaintFacts(),
  initial: Matrix = IDENTITY,
  depth = 0,
  visiting: Set<string> = new Set(),
): PaintFacts {
  const stack: GState[] = [];
  let gs: GState = {
    ctm: initial,
    lineWidth: 1,
    fill: { family: 'gray' },
    stroke: { family: 'gray' },
    overprint: false,
  };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;

  const num = (a: Operand | undefined) => (a?.t === 'num' ? a.v : 0);
  const space = (name: string): ColourSpaceInfo => {
    const device = DEVICE[name];
    if (device) return { family: device };
    return resources.colourSpace(name) ?? { family: 'other' };
  };
  const paint = (colour: ColourSpaceInfo) => {
    if (colour.family === 'rgb') facts.rgbPaintOps++;
    for (const s of colour.spotNames ?? []) facts.spotNames.add(s);
  };
  const scale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const showText = () => {
    if (facts.textOrigins.length < MAX_TEXT_ORIGINS)
      facts.textOrigins.push(apply(multiply(tm, gs.ctm), 0, 0));
    paint(gs.fill);
  };
  const placeImage = (name: string, widthPx: number, heightPx: number, colour: ColourSpaceInfo) => {
    const m = gs.ctm;
    facts.images.push({
      name,
      widthPx,
      heightPx,
      placedWidthPt: Math.hypot(m[0], m[1]),
      placedHeightPt: Math.hypot(m[2], m[3]),
      colour: colour.family,
    });
    paint(colour);
  };

  for (const { op, args, inline } of parseContent(content)) {
    switch (op) {
      case 'q':
        stack.push({ ...gs });
        break;
      case 'Q':
        gs = stack.pop() ?? gs;
        break;
      case 'cm':
        gs = { ...gs, ctm: multiply(args.map(num) as unknown as Matrix, gs.ctm) };
        break;
      case 'w':
        gs = { ...gs, lineWidth: Math.abs(num(args[0])) };
        break;
      case 'gs': {
        const name = args[0]?.t === 'name' ? args[0].v : '';
        const state = resources.extGState(name);
        if (state?.overprint) {
          gs = { ...gs, overprint: true };
          facts.overprint = true;
        }
        break;
      }
      case 'rg':
        gs = { ...gs, fill: { family: 'rgb' } };
        paint(gs.fill);
        break;
      case 'RG':
        gs = { ...gs, stroke: { family: 'rgb' } };
        paint(gs.stroke);
        break;
      case 'k':
        gs = { ...gs, fill: { family: 'cmyk' } };
        break;
      case 'K':
        gs = { ...gs, stroke: { family: 'cmyk' } };
        break;
      case 'g':
        gs = { ...gs, fill: { family: 'gray' } };
        break;
      case 'G':
        gs = { ...gs, stroke: { family: 'gray' } };
        break;
      case 'cs':
        gs = { ...gs, fill: space(args[0]?.t === 'name' ? args[0].v : '') };
        break;
      case 'CS':
        gs = { ...gs, stroke: space(args[0]?.t === 'name' ? args[0].v : '') };
        break;
      case 'sc':
      case 'scn':
        paint(gs.fill);
        break;
      case 'SC':
      case 'SCN':
        paint(gs.stroke);
        break;
      case 'f':
      case 'F':
      case 'f*':
        paint(gs.fill);
        break;
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'Tm':
        tm = args.map(num) as unknown as Matrix;
        tlm = tm;
        break;
      case 'TL':
        leading = num(args[0]);
        break;
      case 'Td':
      case 'TD':
        if (op === 'TD') leading = -num(args[1]);
        tlm = multiply([1, 0, 0, 1, num(args[0]), num(args[1])], tlm);
        tm = tlm;
        break;
      case 'T*':
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case "'":
      case '"':
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        showText();
        break;
      case 'Tj':
      case 'TJ':
        showText();
        break;
      case 'Do': {
        const name = args[0]?.t === 'name' ? args[0].v : '';
        const x = resources.xObject(name);
        if (!x) break;
        if (x.kind === 'image') {
          if (!x.imageMask) placeImage(name, x.widthPx, x.heightPx, x.colour);
        } else if (depth < MAX_FORM_DEPTH && !visiting.has(x.key)) {
          visiting.add(x.key);
          interpret(x.content, x.resources, facts, multiply(x.matrix, gs.ctm), depth + 1, visiting);
          visiting.delete(x.key);
        }
        break;
      }
      case 'BI': {
        const dict = inline ?? new Map<string, Operand>();
        const numOf = (...keys: string[]) => {
          for (const k of keys) {
            const v = dict.get(k);
            if (v?.t === 'num') return v.v;
          }
          return 0;
        };
        const mask = dict.get('IM') ?? dict.get('ImageMask');
        if (mask?.t === 'bool' && mask.v) break;
        const cs = dict.get('CS') ?? dict.get('ColorSpace');
        const colour = cs?.t === 'name' ? space(cs.v) : { family: 'other' as const };
        placeImage('inline', numOf('W', 'Width'), numOf('H', 'Height'), colour);
        break;
      }
      default:
        if (STROKE_OPS.has(op)) {
          const width = gs.lineWidth * scale(gs.ctm);
          facts.minStrokeWidthPt =
            facts.minStrokeWidthPt === null ? width : Math.min(facts.minStrokeWidthPt, width);
          paint(gs.stroke);
          if (op !== 'S' && op !== 's') paint(gs.fill);
        }
    }
  }
  return facts;
}

export function emptyPaintFacts(): PaintFacts {
  return {
    images: [],
    rgbPaintOps: 0,
    spotNames: new Set(),
    minStrokeWidthPt: null,
    overprint: false,
    textOrigins: [],
  };
}
