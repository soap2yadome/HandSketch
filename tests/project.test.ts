import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, History, blankPage, cloneElements, moveElement, pruneLinks, type El } from '../src/model';
import { parseProject, serializeProject } from '../src/project';
import { hitTest, lineEndpoints, linePath, symbolPortPosition } from '../src/render';

const sym = (id: string, x: number, y: number): El => ({ id, seed: 1, style: DEFAULT_STYLE, type: 'symbol', symbol: 'switch', x, y, size: 96, rot: 0 });

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
    expect(() => parseProject(JSON.stringify({ app: 'handsketch', version: 1, doc: { pages: [{ kind: 'blank', width: 1, height: 1, elements: [{ type: 'evil', id: 'x' }] }] } }))).toThrow(/invalid page/);
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
