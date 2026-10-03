// Hand-drawn geometry engine. Pure functions only: everything returns polylines so the
// same output can be painted to canvas, serialised to SVG, or embedded in a PDF.

export interface Pt {
  x: number;
  y: number;
}

export type Rand = () => number;

/** Small fast seeded PRNG so a shape looks identical on every redraw and export. */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

const signed = (r: Rand) => r() * 2 - 1;

/**
 * One wobbly pass between two points. A gentle bow plus low-frequency jitter keeps it
 * looking like a pen stroke rather than noise; endpoints overshoot slightly.
 */
function linePass(a: Pt, b: Pt, r: Rand, roughness: number): Pt[] {
  const len = dist(a, b);
  if (len < 0.01) return [a, b];
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  // Wobble amplitude grows with length but saturates so long lines stay controlled.
  const amp = Math.min(2.2, 0.35 + len * 0.008) * roughness;
  const bow = signed(r) * amp;
  const endJitter = 0.8 * roughness;
  const sx = a.x + signed(r) * endJitter - ux * r() * endJitter;
  const sy = a.y + signed(r) * endJitter - uy * r() * endJitter;
  const ex = b.x + signed(r) * endJitter + ux * r() * endJitter;
  const ey = b.y + signed(r) * endJitter + uy * r() * endJitter;
  const steps = Math.max(2, Math.ceil(len / 7));
  const phase = r() * Math.PI * 2;
  const wobbleAmp = amp * 0.35;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = bow * Math.sin(Math.PI * t) + wobbleAmp * Math.sin(phase + t * len * 0.045) * Math.sin(Math.PI * t);
    pts.push({
      x: sx + (ex - sx) * t + nx * off,
      y: sy + (ey - sy) * t + ny * off,
    });
  }
  return pts;
}

/** A sketchy line: two overlapping passes, as drawn by a quick pen. */
export function roughLine(a: Pt, b: Pt, r: Rand, roughness = 1): Pt[][] {
  if (roughness <= 0) return [[a, b]];
  return [linePass(a, b, r, roughness), linePass(a, b, r, roughness * 0.8)];
}

export function roughPolyline(points: Pt[], r: Rand, roughness = 1, closed = false): Pt[][] {
  const out: Pt[][] = [];
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    out.push(...roughLine(points[i], points[(i + 1) % n], r, roughness));
  }
  return out;
}

export function roughRect(x: number, y: number, w: number, h: number, r: Rand, roughness = 1): Pt[][] {
  const p = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return roughPolyline(p, r, roughness, true);
}

/** Points on an ellipse. */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, steps: number, start = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return pts;
}

/** Hand-drawn ellipse: two slightly offset, slightly overshooting loops. */
export function roughEllipse(cx: number, cy: number, rx: number, ry: number, r: Rand, roughness = 1): Pt[][] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (roughness <= 0) return [ellipsePoints(cx, cy, rx, ry, Math.max(24, Math.ceil(Math.max(rx, ry))))];
  const steps = Math.max(20, Math.min(72, Math.ceil((rx + ry) / 2.5)));
  const loops: Pt[][] = [];
  for (let k = 0; k < 2; k++) {
    const jr = (0.012 + 0.01 * k) * roughness;
    const start = r() * Math.PI * 2;
    const overshoot = 1 + Math.floor(steps * 0.08);
    const pts: Pt[] = [];
    const phase = r() * Math.PI * 2;
    for (let i = 0; i <= steps + overshoot; i++) {
      const t = start + (i / steps) * Math.PI * 2;
      const wob = 1 + jr * 2 * Math.sin(phase + t * 2) + jr * signed(r);
      pts.push({ x: cx + Math.cos(t) * rx * wob, y: cy + Math.sin(t) * ry * wob });
    }
    loops.push(pts);
  }
  return loops;
}

/** Elliptical arc as a rough polyline. Angles in radians. */
export function roughArc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, r: Rand, roughness = 1): Pt[][] {
  const sweep = a1 - a0;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) * Math.max(rx, ry)) / 4));
  const pass = (j: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = a0 + (sweep * i) / steps;
      const w = 1 + signed(r) * 0.012 * roughness * (1 + j);
      pts.push({ x: cx + Math.cos(t) * rx * w, y: cy + Math.sin(t) * ry * w });
    }
    return pts;
  };
  return roughness <= 0 ? [pass(0)] : [pass(0), pass(1)];
}

/** Freehand stroke: light smoothing + low-amplitude tremor. */
export function smoothFreehand(points: Pt[], r: Rand, roughness = 0.5): Pt[] {
  if (points.length < 3) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    out.push({
      x: (p0.x + 2 * p1.x + p2.x) / 4 + signed(r) * 0.25 * roughness,
      y: (p0.y + 2 * p1.y + p2.y) / 4 + signed(r) * 0.25 * roughness,
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Ray-cast point in polygon. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Hachure (diagonal pencil shading) clipped to a convex-or-concave polygon.
 * Scanline approach: rotate the polygon so hatch lines are horizontal, intersect, rotate back.
 */
export function hachureFill(poly: Pt[], gap: number, angleDeg: number, r: Rand, roughness = 1): Pt[][] {
  if (poly.length < 3) return [];
  const ang = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-ang);
  const sin = Math.sin(-ang);
  const rot = (p: Pt): Pt => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const cosb = Math.cos(ang);
  const sinb = Math.sin(ang);
  const unrot = (p: Pt): Pt => ({ x: p.x * cosb - p.y * sinb, y: p.x * sinb + p.y * cosb });
  const rp = poly.map(rot);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of rp) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const lines: Pt[][] = [];
  for (let y = minY + gap / 2; y < maxY; y += gap) {
    const xs: number[] = [];
    for (let i = 0; i < rp.length; i++) {
      const a = rp[i];
      const b = rp[(i + 1) % rp.length];
      if (a.y === b.y) continue;
      if ((y >= a.y && y < b.y) || (y >= b.y && y < a.y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const pad = 1.5;
      const x0 = xs[i] + pad;
      const x1 = xs[i + 1] - pad;
      if (x1 - x0 < 1) continue;
      lines.push(...roughLine(unrot({ x: x0, y }), unrot({ x: x1, y }), r, roughness * 0.6).slice(0, 1));
    }
  }
  return lines;
}

/** Axis-aligned bounds of a set of polylines. */
export function boundsOf(lines: Pt[][]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of lines) {
    for (const p of l) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Distance from p to segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
