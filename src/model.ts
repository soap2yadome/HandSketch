import { lineEndpoints } from './render';
import type { Pt } from './sketch';

export type FillStyle = 'none' | 'hachure' | 'solid';

export interface StyleProps {
  stroke: string;
  fill: string;
  fillStyle: FillStyle;
  width: number;
  roughness: number;
}

export interface Link {
  /** id of the symbol element this end is attached to */
  id: string;
  /** index into that symbol's ports */
  port: number;
}

interface Base {
  id: string;
  seed: number;
  style: StyleProps;
}

export interface LineEl extends Base {
  type: 'line' | 'arrow';
  p1: Pt;
  p2: Pt;
  route: 'straight' | 'elbow';
  from?: Link;
  to?: Link;
  /** Optional label drawn at the midpoint (cable ID, circuit number, etc.) */
  label?: string;
}

export interface BoxEl extends Base {
  type: 'rect' | 'ellipse' | 'highlight' | 'cloud';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FreeEl extends Base {
  type: 'free';
  pts: Pt[];
  /** Highlighter-style translucent wide stroke */
  marker?: boolean;
}

export interface TextEl extends Base {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
}

export interface SymbolEl extends Base {
  type: 'symbol';
  symbol: string;
  x: number;
  y: number;
  /** Rendered edge length in page units (symbols are drawn in a 48x48 box) */
  size: number;
  rot: number;
  label?: string;
}

export interface StampEl extends Base {
  type: 'stamp';
  x: number;
  y: number;
  text: string;
  size: number;
  rot: number;
}

export type El = LineEl | BoxEl | FreeEl | TextEl | SymbolEl | StampEl;
export type ElType = El['type'];

export interface Page {
  id: string;
  kind: 'pdf' | 'blank';
  /** Page size in PDF points (blank pages default to 1200x800). */
  width: number;
  height: number;
  /** 0-based index into the loaded PDF when kind === 'pdf'. */
  pdfIndex?: number;
  elements: El[];
}

export interface Doc {
  pages: Page[];
}

export const DEFAULT_STYLE: StyleProps = {
  stroke: '#1f2a44',
  fill: '#f2c94c',
  fillStyle: 'none',
  width: 2,
  roughness: 1,
};

let counter = 0;
export function newId(prefix = 'e'): string {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function blankPage(width = 1200, height = 800): Page {
  return { id: newId('p'), kind: 'blank', width, height, elements: [] };
}

export function cloneElements(els: El[]): El[] {
  return JSON.parse(JSON.stringify(els)) as El[];
}

/** Freeze a connector's resolved endpoints into p1/p2 so it keeps its place once links are dropped. */
export function bakeLine(el: LineEl, els: El[]): void {
  const [a, b] = lineEndpoints(el, els);
  el.p1 = a;
  el.p2 = b;
}

/** Translate an element in place (connectors keep their current visual position, then lose links). */
export function moveElement(el: El, dx: number, dy: number, context: El[] = []): void {
  switch (el.type) {
    case 'line':
    case 'arrow':
      bakeLine(el, context);
      el.p1 = { x: el.p1.x + dx, y: el.p1.y + dy };
      el.p2 = { x: el.p2.x + dx, y: el.p2.y + dy };
      delete el.from;
      delete el.to;
      break;
    case 'free':
      el.pts = el.pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
    default:
      el.x += dx;
      el.y += dy;
  }
}

/**
 * Move a selection. A connector whose end is attached to a symbol that moves with it stays attached;
 * an end attached to something that stays behind is detached and travels with the connector.
 */
export function moveElements(all: El[], ids: Set<string>, dx: number, dy: number): void {
  const targets = all.filter((e) => ids.has(e.id));
  // Resolve connector ends against the pre-move layout before anything shifts.
  const resolved = new Map<string, [Pt, Pt]>();
  for (const e of targets) if (e.type === 'line' || e.type === 'arrow') resolved.set(e.id, lineEndpoints(e, all));
  for (const e of targets) {
    if (e.type === 'line' || e.type === 'arrow') {
      const [a, b] = resolved.get(e.id)!;
      const keepFrom = !!e.from && ids.has(e.from.id);
      const keepTo = !!e.to && ids.has(e.to.id);
      e.p1 = { x: a.x + dx, y: a.y + dy };
      e.p2 = { x: b.x + dx, y: b.y + dy };
      if (!keepFrom) delete e.from;
      if (!keepTo) delete e.to;
    } else moveElement(e, dx, dy, all);
  }
}

/** Delete elements, first freezing any connector ends that were attached to them. */
export function removeElements(all: El[], ids: Set<string>): El[] {
  for (const e of all) {
    if ((e.type === 'line' || e.type === 'arrow') && !ids.has(e.id) && ((e.from && ids.has(e.from.id)) || (e.to && ids.has(e.to.id)))) {
      bakeLine(e, all);
      if (e.from && ids.has(e.from.id)) delete e.from;
      if (e.to && ids.has(e.to.id)) delete e.to;
    }
  }
  return all.filter((e) => !ids.has(e.id));
}

/** Remove link references to elements that no longer exist. */
export function pruneLinks(els: El[]): void {
  const ids = new Set(els.map((e) => e.id));
  for (const e of els) {
    if (e.type === 'line' || e.type === 'arrow') {
      if (e.from && !ids.has(e.from.id)) delete e.from;
      if (e.to && !ids.has(e.to.id)) delete e.to;
    }
  }
}

/** Linear undo/redo over page element snapshots. */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  constructor(private limit = 100) {}

  push(snapshot: El[]): void {
    this.undoStack.push(JSON.stringify(snapshot));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: El[]): El[] | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(prev) as El[];
  }

  redo(current: El[]): El[] | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(next) as El[];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/** Deep-copy elements for paste/duplicate: fresh ids and seeds, links kept only inside the set. */
export function cloneForPaste(els: El[], dx = 0, dy = 0, context: El[] = els): El[] {
  const copies = cloneElements(els);
  // Freeze connector geometry from the originals so dropped links don't snap back to stale points.
  copies.forEach((c, i) => {
    const o = els[i];
    if ((c.type === 'line' || c.type === 'arrow') && (o.type === 'line' || o.type === 'arrow')) {
      const [a, b] = lineEndpoints(o, context);
      c.p1 = a;
      c.p2 = b;
    }
  });
  const map = new Map<string, string>();
  for (const e of copies) {
    const id = newId();
    map.set(e.id, id);
    e.id = id;
    e.seed = newSeed();
  }
  for (const e of copies) {
    if (e.type === 'line' || e.type === 'arrow') {
      const from = e.from && map.get(e.from.id);
      const to = e.to && map.get(e.to.id);
      if (e.from) (from ? (e.from.id = from) : delete e.from);
      if (e.to) (to ? (e.to.id = to) : delete e.to);
      e.p1 = { x: e.p1.x + dx, y: e.p1.y + dy };
      e.p2 = { x: e.p2.x + dx, y: e.p2.y + dy };
    } else moveElement(e, dx, dy);
  }
  return copies;
}
