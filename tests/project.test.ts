import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, History, blankPage, cloneElements, cloneForPaste, moveElement, moveElements, pruneLinks, removeElements, type El, type LineEl, type SymbolEl } from '../src/model';
import { parseProject, serializeProject } from '../src/project';
import { hitTest, lineEndpoints, linePath, symbolPortPosition } from '../src/render';

const sym = (id: string, x: number, y: number): SymbolEl => ({ id, seed: 1, style: DEFAULT_STYLE, type: 'symbol', symbol: 'switch', x, y, size: 96, rot: 0 });

describe('project files', () => {
  it('round-trips a document and embedded PDF bytes', () => {
    const page = blankPage();
    page.elements.push(sym('a', 10, 10));
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 255]);
    const parsed = parseProject(serializeProject({ pages: [page] }, bytes));
    expect(parsed.doc.pages[0].elements[0].id).toBe('a');
    expect(Array.from(parsed.pdfBytes!)).toEqual(Array.from(bytes));
  });

  it('rejects junk', () => {
    expect(() => parseProject('nope')).toThrow(/invalid JSON/);
    expect(() => parseProject('{"app":"other"}')).toThrow(/Not a HandSketch/);
    expect(() => parseProject(JSON.stringify({ app: 'handsketch', version: 1, doc: { pages: [{ id: 'p', kind: 'blank', width: 1, height: 1, elements: [{ type: 'evil', id: 'x' }] }] } }))).toThrow(/invalid page/);
  });

  it('rejects hostile or malformed values that would freeze or crash the renderer', () => {
    const base = (el: unknown, page: Record<string, unknown> = {}) =>
      JSON.stringify({ app: 'handsketch', version: 1, doc: { pages: [{ id: 'p', kind: 'blank', width: 600, height: 400, elements: [el], ...page }] } });
    const style = { stroke: '#000', fill: '#fff', fillStyle: 'hachure', width: 2, roughness: 1 };
    const ok = { id: 'a', seed: 1, style, type: 'cloud', x: 0, y: 0, w: 100, h: 50 };
    expect(() => parseProject(base(ok))).not.toThrow();
    expect(() => parseProject(base({ ...ok, w: 1e9 }))).toThrow(/invalid page/); // would allocate hundreds of millions of points
    expect(() => parseProject(base({ ...ok, x: null }))).toThrow(/invalid page/);
    expect(() => parseProject(base({ ...ok, style: undefined }))).toThrow(/invalid page/);
    expect(() => parseProject(base({ ...ok, style: { ...style, width: -1 } }))).toThrow(/invalid page/);
    expect(() => parseProject(base(ok, { width: 1e999 }))).toThrow(/invalid page/);
    expect(() => parseProject(base(ok, { width: 5e5 }))).toThrow(/invalid page/);
    expect(() => parseProject(base({ id: 't', seed: 1, style, type: 'text', x: 0, y: 0, text: 5, size: 20 }))).toThrow(/invalid page/);
    expect(() => parseProject(base({ id: 'l', seed: 1, style, type: 'line', p1: { x: 0, y: 0 }, route: 'straight' }))).toThrow(/invalid page/);
    expect(() => parseProject(base(ok, { kind: 'pdf' }))).toThrow(/invalid page/); // pdf page without pdfIndex
  });

  it('re-ids duplicate page ids', () => {
    const style = { stroke: '#000', fill: '#fff', fillStyle: 'none', width: 2, roughness: 1 };
    const pg = { id: 'same', kind: 'blank', width: 10, height: 10, elements: [{ id: 'a', seed: 1, style, type: 'rect', x: 0, y: 0, w: 5, h: 5 }] };
    const { doc } = parseProject(JSON.stringify({ app: 'handsketch', version: 1, doc: { pages: [pg, pg] } }));
    expect(doc.pages[0].id).not.toBe(doc.pages[1].id);
  });
});

describe('connectors', () => {
  it('follow a linked symbol when it moves, and detach when moved themselves', () => {
    const a = sym('a', 0, 0);
    const b = sym('b', 300, 0);
    const wire: El = { id: 'w', seed: 1, style: DEFAULT_STYLE, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, route: 'straight', from: { id: 'a', port: 1 }, to: { id: 'b', port: 0 } };
    const els = [a, b, wire];
    let [p, q] = lineEndpoints(wire as never, els);
    expect(p).toEqual(symbolPortPosition(a as never, 1));
    expect(q).toEqual(symbolPortPosition(b as never, 0));
    moveElement(b, 0, 100);
    [p, q] = lineEndpoints(wire as never, els);
    expect(q.y).toBeCloseTo(100 + 48);
    moveElement(wire, 5, 5);
    expect((wire as { from?: unknown }).from).toBeUndefined();
  });

  it('prunes links to deleted symbols', () => {
    const wire: El = { id: 'w', seed: 1, style: DEFAULT_STYLE, type: 'arrow', p1: { x: 0, y: 0 }, p2: { x: 5, y: 5 }, route: 'straight', from: { id: 'gone', port: 0 } };
    pruneLinks([wire]);
    expect((wire as { from?: unknown }).from).toBeUndefined();
  });

  it('routes elbows orthogonally', () => {
    const path = linePath({ x: 0, y: 0 }, { x: 100, y: 40 }, 'elbow');
    expect(path).toHaveLength(4);
    for (let i = 0; i + 1 < path.length; i++) expect(path[i].x === path[i + 1].x || path[i].y === path[i + 1].y).toBe(true);
  });
});

describe('connector editing keeps lines where they are drawn', () => {
  const setup = () => {
    const a = sym('a', 0, 0);
    const b = sym('b', 300, 0);
    const wire: LineEl = { id: 'w', seed: 1, style: DEFAULT_STYLE, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, route: 'straight', from: { id: 'a', port: 1 }, to: { id: 'b', port: 0 } };
    return { a, b, wire, els: [a, b, wire] as El[] };
  };

  it('deleting a symbol freezes the connector end at the symbol\'s last position', () => {
    const { b, wire, els } = setup();
    moveElement(b, 0, 200); // b has moved; wire.p2 is still the stale creation point
    const before = lineEndpoints(wire, els)[1];
    const rest = removeElements(els, new Set(['b']));
    expect(rest).toHaveLength(2);
    expect(wire.to).toBeUndefined();
    expect(wire.p2).toEqual(before);
    expect(lineEndpoints(wire, rest)[1]).toEqual(before);
  });

  it('dragging only the connector detaches it without jumping', () => {
    const { b, wire, els } = setup();
    moveElement(b, 0, 200);
    const [a0, b0] = lineEndpoints(wire, els);
    moveElements(els, new Set(['w']), 10, 20);
    expect(wire.from).toBeUndefined();
    expect(wire.to).toBeUndefined();
    expect(wire.p1).toEqual({ x: a0.x + 10, y: a0.y + 20 });
    expect(wire.p2).toEqual({ x: b0.x + 10, y: b0.y + 20 });
  });

  it('moving connector and both symbols together keeps the links', () => {
    const { a, b, wire, els } = setup();
    moveElements(els, new Set(['a', 'b', 'w']), 50, 0);
    expect(wire.from).toBeDefined();
    expect(wire.to).toBeDefined();
    expect(a.x).toBe(50);
    expect(b.x).toBe(350);
    const [p, q] = lineEndpoints(wire, els);
    expect(p.x).toBeCloseTo(symbolPortPosition(a as never, 1)!.x);
    expect(q.x).toBeCloseTo(symbolPortPosition(b as never, 0)!.x);
  });

  it('pasting a connector without its symbols freezes its geometry at the offset', () => {
    const { b, wire, els } = setup();
    moveElement(b, 0, 200);
    const [a0, b0] = lineEndpoints(wire, els);
    const [copy] = cloneForPaste([wire], 20, 20, els) as LineEl[];
    expect(copy.from).toBeUndefined();
    expect(copy.p1).toEqual({ x: a0.x + 20, y: a0.y + 20 });
    expect(copy.p2).toEqual({ x: b0.x + 20, y: b0.y + 20 });
    expect(copy.id).not.toBe(wire.id);
  });

  it('pasting symbols together with their connector remaps the links', () => {
    const { a, b, wire, els } = setup();
    const copies = cloneForPaste([a, b, wire], 0, 100, els);
    const w2 = copies.find((c) => c.type === 'line') as LineEl;
    const ids = copies.filter((c) => c.type === 'symbol').map((c) => c.id);
    expect(ids).toContain(w2.from!.id);
    expect(ids).toContain(w2.to!.id);
    expect(ids).not.toContain(a.id);
  });
});

describe('hit testing and history', () => {
  it('hits lines near the stroke only', () => {
    const l: El = { id: 'l', seed: 1, style: DEFAULT_STYLE, type: 'line', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, route: 'straight' };
    expect(hitTest(l, { x: 50, y: 3 }, [l])).toBe(true);
    expect(hitTest(l, { x: 50, y: 30 }, [l])).toBe(false);
  });

  it('undoes and redoes snapshots', () => {
    const h = new History();
    const s0: El[] = [];
    const s1 = [sym('a', 0, 0)];
    h.push(cloneElements(s0));
    expect(h.undo(s1)).toEqual([]);
    expect(h.redo(s0)?.[0].id).toBe('a');
    expect(h.canRedo).toBe(false);
  });
});
