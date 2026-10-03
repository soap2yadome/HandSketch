// Symbols are described as primitives in a 48x48 box (y down) so they can be drawn with the
// same hand-drawn engine as everything else. Geometry is original line-art based on generic,
// widely used schematic conventions (IEEE 315 / IEC 60617 / NFPA 170); no vendor artwork.

export type SymPrim =
  | { k: 'l'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'r'; x: number; y: number; w: number; h: number }
  | { k: 'e'; cx: number; cy: number; rx: number; ry: number; filled?: boolean }
  | { k: 'a'; cx: number; cy: number; rx: number; ry: number; a0: number; a1: number }
  | { k: 'p'; pts: number[]; closed: boolean; filled?: boolean }
  | { k: 't'; x: number; y: number; text: string; size: number };

export type Domain = 'network' | 'electrical' | 'security';

export interface SymbolDef {
  id: string;
  label: string;
  domain: Domain;
  /** Extra search terms */
  keywords?: string;
  prims: SymPrim[];
  /** Connection ports in 48x48 symbol space */
  ports: [number, number][];
}

export const SYMBOL_BOX = 48;

export const L = (x1: number, y1: number, x2: number, y2: number): SymPrim => ({ k: 'l', x1, y1, x2, y2 });
export const R = (x: number, y: number, w: number, h: number): SymPrim => ({ k: 'r', x, y, w, h });
export const E = (cx: number, cy: number, rx: number, ry: number): SymPrim => ({ k: 'e', cx, cy, rx, ry });
/** Small solid dot (terminals, LEDs, indicator lights). */
export const D = (cx: number, cy: number, r = 1.6): SymPrim => ({ k: 'e', cx, cy, rx: r, ry: r, filled: true });
/** Circular arc; angles in degrees, 0 = east, clockwise (y down). */
export const A = (cx: number, cy: number, r: number, a0: number, a1: number): SymPrim =>
  ({ k: 'a', cx, cy, rx: r, ry: r, a0: (a0 * Math.PI) / 180, a1: (a1 * Math.PI) / 180 });
export const AE = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): SymPrim =>
  ({ k: 'a', cx, cy, rx, ry, a0: (a0 * Math.PI) / 180, a1: (a1 * Math.PI) / 180 });
export const P = (pts: number[], closed = false): SymPrim => ({ k: 'p', pts, closed });
export const PF = (pts: number[]): SymPrim => ({ k: 'p', pts, closed: true, filled: true });
export const T = (x: number, y: number, text: string, size = 11): SymPrim => ({ k: 't', x, y, text, size });

/** Chevron arrowhead whose tip sits at (x2,y2), pointing away from (x1,y1). */
export function head(x1: number, y1: number, x2: number, y2: number, size = 4.5): SymPrim {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 0.5;
  return P([
    x2 - Math.cos(a - s) * size, y2 - Math.sin(a - s) * size,
    x2, y2,
    x2 - Math.cos(a + s) * size, y2 - Math.sin(a + s) * size,
  ]);
}

/** A line with an arrowhead at its far end. */
export function arrow(x1: number, y1: number, x2: number, y2: number): SymPrim[] {
  return [L(x1, y1, x2, y2), head(x1, y1, x2, y2)];
}
