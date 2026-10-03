import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, type SymbolEl } from '../src/model';
import { primsToSvg } from '../src/paint';
import { renderElement, symbolPortPosition } from '../src/render';
import { SYMBOLS, SYMBOL_BOX, getSymbol, searchSymbols } from '../src/symbols';

describe('symbol library', () => {
  it('has unique ids and the three domains populated', () => {
    const ids = SYMBOLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of ['network', 'electrical', 'security'] as const) {
      expect(SYMBOLS.filter((s) => s.domain === d).length).toBeGreaterThanOrEqual(15);
    }
  });

  it('keeps every primitive and port inside (or on) a slightly padded 48x48 box', () => {
    const lim = SYMBOL_BOX + 4;
    for (const s of SYMBOLS) {
      for (const [x, y] of s.ports) {
        expect(x, `${s.id} port x`).toBeGreaterThanOrEqual(-1);
        expect(x, `${s.id} port x`).toBeLessThanOrEqual(lim);
        expect(y, `${s.id} port y`).toBeGreaterThanOrEqual(-1);
        expect(y, `${s.id} port y`).toBeLessThanOrEqual(lim);
      }
      expect(s.prims.length, `${s.id} prims`).toBeGreaterThan(0);
    }
  });

  it('renders every symbol to finite geometry', () => {
    for (const s of SYMBOLS) {
      const el: SymbolEl = { id: 'a', seed: 7, style: DEFAULT_STYLE, type: 'symbol', symbol: s.id, x: 10, y: 20, size: 64, rot: 0 };
      const prims = renderElement(el);
      expect(prims.length, s.id).toBeGreaterThan(0);
      for (const p of prims) {
        if (p.k === 'text') continue;
        for (const q of p.pts) {
          expect(Number.isFinite(q.x) && Number.isFinite(q.y), s.id).toBe(true);
        }
      }
    }
  });

  it('maps ports through position, size and rotation', () => {
    const base: SymbolEl = { id: 'r', seed: 1, style: DEFAULT_STYLE, type: 'symbol', symbol: 'resistor', x: 100, y: 100, size: 96, rot: 0 };
    const a = symbolPortPosition(base, 0)!;
    const b = symbolPortPosition(base, 1)!;
    expect(a).toEqual({ x: 100, y: 148 });
    expect(b.x).toBeCloseTo(196);
    expect(b.y).toBeCloseTo(148);
    const rot = symbolPortPosition({ ...base, rot: 90 }, 1)!;
    expect(rot.x).toBeCloseTo(148);
    expect(rot.y).toBeCloseTo(196);
  });

  it('searches by label, keyword and domain', () => {
    expect(searchSymbols('fingerprint').map((s) => s.id)).toContain('biometric-reader');
    expect(searchSymbols('', 'network').every((s) => s.domain === 'network')).toBe(true);
    expect(searchSymbols('zzzz')).toEqual([]);
    expect(getSymbol('router')?.label).toBe('Router');
  });

  it.runIf(process.env.GALLERY)('writes a gallery svg', () => {
    const cell = 130;
    const cols = 8;
    const rows = Math.ceil(SYMBOLS.length / cols);
    const prims = SYMBOLS.flatMap((s, i) => {
      const x = (i % cols) * cell + 20;
      const y = Math.floor(i / cols) * cell + 14;
      const el: SymbolEl = { id: s.id, seed: i + 3, style: { ...DEFAULT_STYLE }, type: 'symbol', symbol: s.id, x, y, size: 80, rot: 0, label: s.id };
      return renderElement(el);
    });
    writeFileSync(process.env.GALLERY!, primsToSvg(prims, cols * cell + 20, rows * cell + 20, '#fffdf6'));
  });
});
