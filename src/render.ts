// Element -> drawing primitives. Output is backend-neutral (canvas, SVG, PNG export).
import type { El, LineEl, Page, StyleProps, SymbolEl } from './model';
import {
  boundsOf, distToSegment, hachureFill, mulberry32, roughArc, roughEllipse, roughLine, roughPolyline, roughRect,
  smoothFreehand, type Pt, type Rand,
} from './sketch';
import { getSymbol, SYMBOL_BOX } from './symbols';

export type Prim =
  | { k: 'stroke'; pts: Pt[]; color: string; width: number; opacity: number; cap?: 'round' | 'butt' }
  | { k: 'fill'; pts: Pt[]; color: string; opacity: number }
  | { k: 'text'; x: number; y: number; text: string; size: number; color: string; anchor: 'start' | 'middle'; rot: number };

export const FONT_STACK = '"Caveat","Segoe Print","Bradley Hand","Comic Sans MS","Chalkboard SE",cursive';

const stroke = (lines: Pt[][], s: StyleProps, opacity = 1, width = s.width): Prim[] =>
  lines.map((pts) => ({ k: 'stroke', pts, color: s.stroke, width, opacity }));

function shapeFill(poly: Pt[], s: StyleProps, r: Rand): Prim[] {
  if (s.fillStyle === 'none') return [];
  if (s.fillStyle === 'solid') return [{ k: 'fill', pts: poly, color: s.fill, opacity: 0.55 }];
  const hatch = hachureFill(poly, Math.max(4, s.width * 3.2), -41, r, s.roughness);
  return hatch.map((pts) => ({ k: 'stroke', pts, color: s.fill, width: Math.max(1, s.width * 0.7), opacity: 0.9 }));
}

/** Resolve a (possibly port-linked) line to concrete endpoints. */
export function lineEndpoints(el: LineEl, els: El[]): [Pt, Pt] {
  const find = (l?: { id: string; port: number }): Pt | null => {
    if (!l) return null;
    const sym = els.find((e) => e.id === l.id);
    if (!sym || sym.type !== 'symbol') return null;
    return symbolPortPosition(sym, l.port);
  };
  return [find(el.from) ?? el.p1, find(el.to) ?? el.p2];
}

/** Path of points for a line, honouring elbow routing. */
export function linePath(a: Pt, b: Pt, route: 'straight' | 'elbow'): Pt[] {
  if (route === 'straight' || Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b];
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const my = (a.y + b.y) / 2;
  return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
}

export function symbolPortPosition(el: SymbolEl, port: number): Pt | null {
  const def = getSymbol(el.symbol);
  const p = def?.ports[port];
  if (!p) return null;
  return symbolToPage(el, p[0], p[1]);
}

export function symbolToPage(el: SymbolEl, sx: number, sy: number): Pt {
  const k = el.size / SYMBOL_BOX;
  const lx = (sx - SYMBOL_BOX / 2) * k;
  const ly = (sy - SYMBOL_BOX / 2) * k;
  const a = (el.rot * Math.PI) / 180;
  const cx = el.x + el.size / 2;
  const cy = el.y + el.size / 2;
  return { x: cx + lx * Math.cos(a) - ly * Math.sin(a), y: cy + lx * Math.sin(a) + ly * Math.cos(a) };
}

function symbolPrims(el: SymbolEl): Prim[] {
  const def = getSymbol(el.symbol);
  const out: Prim[] = [];
  if (!def) return out;
  const r = mulberry32(el.seed);
  const k = el.size / SYMBOL_BOX;
  const rough = el.style.roughness * 0.55; // symbols stay legible
  const w = Math.max(1, el.style.width * Math.min(1, Math.max(0.6, k)));
  const tp = (x: number, y: number) => symbolToPage(el, x, y);
  const style = { ...el.style, roughness: rough, width: w };
  for (const p of def.prims) {
    switch (p.k) {
      case 'l':
        out.push(...stroke(roughLine(tp(p.x1, p.y1), tp(p.x2, p.y2), r, rough), style));
        break;
      case 'r': {
        const c = [tp(p.x, p.y), tp(p.x + p.w, p.y), tp(p.x + p.w, p.y + p.h), tp(p.x, p.y + p.h)];
        out.push(...shapeFill(c, el.style, r));
        out.push(...stroke(roughPolyline(c, r, rough, true), style));
        break;
      }
      case 'e': {
        const pts = ellipseOutline(p.cx, p.cy, p.rx, p.ry, 28).map((q) => tp(q.x, q.y));
        if (p.filled) out.push({ k: 'fill', pts, color: el.style.stroke, opacity: 1 });
        else {
          out.push(...shapeFill(pts, el.style, r));
          out.push(...stroke([...roughEllipseLocal(p.cx, p.cy, p.rx, p.ry, r, rough).map((l) => l.map((q) => tp(q.x, q.y)))], style));
        }
        break;
      }
      case 'a':
        out.push(...stroke(roughArc(p.cx, p.cy, p.rx, p.ry, p.a0, p.a1, r, rough).map((l) => l.map((q) => tp(q.x, q.y))), style));
        break;
      case 'p': {
        const pts: Pt[] = [];
        for (let i = 0; i < p.pts.length; i += 2) pts.push(tp(p.pts[i], p.pts[i + 1]));
        if (p.filled) out.push({ k: 'fill', pts, color: el.style.stroke, opacity: 1 });
        else {
          if (p.closed) out.push(...shapeFill(pts, el.style, r));
          out.push(...stroke(roughPolyline(pts, r, rough, p.closed), style));
        }
        break;
      }
      case 't': {
        if (!p.text) break;
        const pos = tp(p.x, p.y);
        out.push({ k: 'text', x: pos.x, y: pos.y, text: p.text, size: p.size * k, color: el.style.stroke, anchor: 'middle', rot: el.rot });
        break;
      }
    }
  }
  if (el.label) {
    const below = symbolToPage(el, SYMBOL_BOX / 2, SYMBOL_BOX);
    out.push({ k: 'text', x: el.x + el.size / 2, y: Math.max(below.y, el.y + el.size) + 6 + 14, text: el.label, size: 16, color: el.style.stroke, anchor: 'middle', rot: 0 });
  }
  return out;
}

function ellipseOutline(cx: number, cy: number, rx: number, ry: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return pts;
}

// Local-space ellipse (so the symbol transform can be applied after wobble).
const roughEllipseLocal = (cx: number, cy: number, rx: number, ry: number, r: Rand, rough: number) =>
  roughEllipse(cx, cy, rx, ry, r, rough);

function arrowHead(from: Pt, to: Pt, size: number, r: Rand, rough: number): Pt[][] {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const len = Math.min(size, Math.hypot(to.x - from.x, to.y - from.y) * 0.6);
  const s = 0.45;
  const l = { x: to.x - Math.cos(a - s) * len, y: to.y - Math.sin(a - s) * len };
  const rr = { x: to.x - Math.cos(a + s) * len, y: to.y - Math.sin(a + s) * len };
  return [...roughLine(l, to, r, rough * 0.5).slice(0, 1), ...roughLine(rr, to, r, rough * 0.5).slice(0, 1)];
}

function cloudPath(x: number, y: number, w: number, h: number): Pt[] {
  // Revision cloud: scalloped bumps around the rectangle, as used in PDF markup.
  const bump = 18;
  const pts: Pt[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / bump));
    const nx = (y1 - y0) / len;
    const ny = -(x1 - x0) / len;
    for (let i = 0; i < n; i++) {
      for (let s = 0; s <= 8; s++) {
        const t = (i + s / 8) / n;
        const bulge = Math.sin((s / 8) * Math.PI) * (len / n) * 0.32;
        pts.push({ x: x0 + (x1 - x0) * t + nx * bulge, y: y0 + (y1 - y0) * t + ny * bulge });
      }
    }
  };
  edge(x, y, x + w, y);
  edge(x + w, y, x + w, y + h);
  edge(x + w, y + h, x, y + h);
  edge(x, y + h, x, y);
  return pts;
}

export function renderElement(el: El, els: El[] = []): Prim[] {
  const r = mulberry32(el.seed);
  const s = el.style;
  switch (el.type) {
    case 'line':
    case 'arrow': {
      const [a, b] = lineEndpoints(el, els);
      const path = linePath(a, b, el.route);
      const out = stroke(roughPolyline(path, r, s.roughness * 0.8), s);
      if (el.type === 'arrow') {
        const prev = path[path.length - 2];
        out.push(...stroke(arrowHead(prev, b, 8 + s.width * 3, r, s.roughness), s));
      }
      if (el.label) {
        const mid = path.length === 2 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: (path[1].x + path[2].x) / 2, y: (path[1].y + path[2].y) / 2 };
        out.push({ k: 'text', x: mid.x, y: mid.y - 6, text: el.label, size: 16, color: s.stroke, anchor: 'middle', rot: 0 });
      }
      return out;
    }
    case 'rect': {
      const c = [{ x: el.x, y: el.y }, { x: el.x + el.w, y: el.y }, { x: el.x + el.w, y: el.y + el.h }, { x: el.x, y: el.y + el.h }];
      return [...shapeFill(c, s, r), ...stroke(roughRect(el.x, el.y, el.w, el.h, r, s.roughness), s)];
    }
    case 'ellipse': {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      return [
        ...shapeFill(ellipseOutline(cx, cy, el.w / 2, el.h / 2, 36), s, r),
        ...stroke(roughEllipse(cx, cy, el.w / 2, el.h / 2, r, s.roughness), s),
      ];
    }
    case 'highlight':
      return [{ k: 'fill', pts: [{ x: el.x, y: el.y }, { x: el.x + el.w, y: el.y }, { x: el.x + el.w, y: el.y + el.h }, { x: el.x, y: el.y + el.h }], color: s.fill, opacity: 0.4 }];
    case 'cloud': {
      const pts = cloudPath(el.x, el.y, el.w, el.h);
      return [...shapeFill(pts, s, r), { k: 'stroke', pts: [...pts, pts[0]], color: s.stroke, width: s.width, opacity: 1 }];
    }
    case 'free': {
      if (el.marker) return [{ k: 'stroke', pts: el.pts, color: s.fill, width: Math.max(10, s.width * 6), opacity: 0.38, cap: 'butt' }];
      return [{ k: 'stroke', pts: smoothFreehand(el.pts, r, s.roughness), color: s.stroke, width: s.width, opacity: 1 }];
    }
    case 'text':
      return el.text.split('\n').map((line, i) => ({
        k: 'text' as const, x: el.x, y: el.y + el.size + i * el.size * 1.15, text: line, size: el.size, color: s.stroke, anchor: 'start' as const, rot: 0,
      }));
    case 'symbol':
      return symbolPrims(el);
    case 'stamp': {
      const w = el.text.length * el.size * 0.62 + el.size;
      const h = el.size * 1.5;
      const cx = el.x;
      const cy = el.y;
      const a = (el.rot * Math.PI) / 180;
      const rot = (px: number, py: number): Pt => ({ x: cx + px * Math.cos(a) - py * Math.sin(a), y: cy + px * Math.sin(a) + py * Math.cos(a) });
      const c = [rot(-w / 2, -h / 2), rot(w / 2, -h / 2), rot(w / 2, h / 2), rot(-w / 2, h / 2)];
      return [
        ...stroke(roughPolyline(c, r, s.roughness, true), s, 1, Math.max(3, s.width * 1.6)),
        ...stroke(roughPolyline(c.map((p, i) => ({ x: p.x + (i % 2 ? -4 : 4), y: p.y + (i < 2 ? 4 : -4) })), r, s.roughness, true), s, 0.6, Math.max(1, s.width * 0.6)),
        { k: 'text', x: cx, y: cy + el.size * 0.34, text: el.text, size: el.size, color: s.stroke, anchor: 'middle', rot: el.rot },
      ];
    }
  }
}

export function textWidth(text: string, size: number): number {
  return Math.max(...text.split('\n').map((l) => l.length)) * size * 0.5;
}

/** Bounding box of an element in page coordinates. */
export function elementBounds(el: El, els: El[] = []): { x: number; y: number; w: number; h: number } {
  switch (el.type) {
    case 'rect': case 'ellipse': case 'highlight': case 'cloud':
      return { x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h) };
    case 'symbol': {
      const b = boundsOf(renderElement({ ...el, label: undefined }, els).filter((p) => p.k !== 'text').map((p) => (p as { pts: Pt[] }).pts));
      const pad = 2;
      return b.w ? { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 } : { x: el.x, y: el.y, w: el.size, h: el.size };
    }
    case 'text': {
      const lines = el.text.split('\n').length;
      return { x: el.x, y: el.y, w: textWidth(el.text, el.size), h: el.size * 1.15 * lines + el.size * 0.2 };
    }
    case 'stamp': {
      const w = el.text.length * el.size * 0.62 + el.size;
      const h = el.size * 1.5;
      const m = Math.max(w, h) * 0.75;
      return { x: el.x - m, y: el.y - m, w: m * 2, h: m * 2 };
    }
    default: {
      const prims = renderElement(el, els).filter((p) => p.k === 'stroke').map((p) => (p as { pts: Pt[] }).pts);
      return boundsOf(prims);
    }
  }
}

/** Does a page point hit this element? `tol` is in page units. */
export function hitTest(el: El, p: Pt, els: El[], tol = 6): boolean {
  if (el.type === 'line' || el.type === 'arrow') {
    const [a, b] = lineEndpoints(el, els);
    const path = linePath(a, b, el.route);
    for (let i = 0; i + 1 < path.length; i++) if (distToSegment(p, path[i], path[i + 1]) <= tol + el.style.width) return true;
    return false;
  }
  if (el.type === 'free') {
    for (let i = 0; i + 1 < el.pts.length; i++) if (distToSegment(p, el.pts[i], el.pts[i + 1]) <= tol + el.style.width) return true;
    return el.pts.length === 1 && Math.hypot(p.x - el.pts[0].x, p.y - el.pts[0].y) <= tol;
  }
  const b = elementBounds(el, els);
  return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
}

export function renderPage(page: Page): Prim[] {
  return page.elements.flatMap((e) => renderElement(e, page.elements));
}
