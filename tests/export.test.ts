import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { exportPdf, pageToSvg } from '../src/export';
import { DEFAULT_STYLE, blankPage, type BoxEl, type Doc, type Page } from '../src/model';
import { make, makeTestPdf, renderPdfPage } from './helpers';

const redBox = (x: number, y: number, size = 40): BoxEl => ({
  id: 'b' + x + y, seed: 1, type: 'highlight', x, y, w: size, h: size,
  style: { ...DEFAULT_STYLE, fill: '#ff0000' },
});

function pdfPages(sizes: [number, number][]): Page[] {
  return sizes.map(([w, h], i) => ({ id: 'p' + i, kind: 'pdf', width: w, height: h, pdfIndex: i, elements: [] }));
}

const isRed = (p: number[]) => p[0] > 200 && p[1] < 120 && p[2] < 120;

describe('annotated PDF export', () => {
  it('puts a mark at the visual top-left on plain, rotated and offset-cropbox pages', async () => {
    const bytes = await makeTestPdf();
    // Visual sizes: 300x200, rotated => 200x300, cropbox 300x200
    const pages = pdfPages([[300, 200], [200, 300], [300, 200]]);
    pages.forEach((p) => p.elements.push(redBox(0, 0)));
    const out = await exportPdf({ doc: { pages }, pdfBytes: bytes, make });

    for (let i = 0; i < 3; i++) {
      const r = await renderPdfPage(out, i);
      expect(r.width).toBe(pages[i].width);
      expect(r.height).toBe(pages[i].height);
      // highlight is 40% opaque red over white: check it differs from a blank corner
      const inside = r.pixel(20, 20);
      const outside = r.pixel(pages[i].width - 10, pages[i].height - 10);
      expect(inside[0], `page ${i} inside`).toBeGreaterThan(200);
      expect(inside[1], `page ${i} inside tinted`).toBeLessThan(outside[1] - 50);
      expect(outside.slice(0, 3)).not.toEqual(inside.slice(0, 3));
    }
  });

  it('does not tint the opposite corners (marks land where they were drawn)', async () => {
    const bytes = await makeTestPdf();
    const pages = pdfPages([[300, 200], [200, 300], [300, 200]]);
    pages.forEach((p) => p.elements.push(redBox(pages[0].width - 60, 0, 40)));
    pages[1].elements = [redBox(200 - 60, 0, 40)];
    pages[2].elements = [redBox(300 - 60, 0, 40)];
    const out = await exportPdf({ doc: { pages }, pdfBytes: bytes, make });
    for (let i = 0; i < 3; i++) {
      const r = await renderPdfPage(out, i);
      const w = pages[i].width;
      expect(r.pixel(w - 40, 20)[1], `page ${i} top-right tinted`).toBeLessThan(180);
      expect(r.pixel(20, 20)[1], `page ${i} top-left clean`).toBeGreaterThan(240);
    }
  });

  it('keeps the original pages untouched when nothing is annotated', async () => {
    const bytes = await makeTestPdf();
    const out = await exportPdf({ doc: { pages: pdfPages([[300, 200], [200, 300], [300, 200]]) }, pdfBytes: bytes, make });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    const r = await renderPdfPage(out, 0);
    expect(isRed(r.pixel(20, 20))).toBe(false);
  });

  it('rebuilds when pages are reordered, deleted or added', async () => {
    const bytes = await makeTestPdf();
    const [p0, , p2] = pdfPages([[300, 200], [200, 300], [300, 200]]);
    const blank = blankPage(400, 300);
    blank.elements.push(redBox(0, 0));
    const doc: Doc = { pages: [p2, blank, p0] };
    const out = await exportPdf({ doc, pdfBytes: bytes, make });
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBe(3);
    const mid = await renderPdfPage(out, 1);
    expect(mid.width).toBe(400);
    expect(mid.height).toBe(300);
    expect(mid.pixel(20, 20)[1]).toBeLessThan(180);
    expect(mid.pixel(390, 290).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('exports a diagram-only document with no source PDF', async () => {
    const page = blankPage(600, 400);
    page.elements.push({ id: 's', seed: 3, style: DEFAULT_STYLE, type: 'symbol', symbol: 'router', x: 100, y: 100, size: 96, rot: 0 });
    const out = await exportPdf({ doc: { pages: [page] }, make });
    const r = await renderPdfPage(out, 0);
    expect(r.width).toBe(600);
    // router circle outline is dark ink near its left edge
    let dark = 0;
    for (let x = 100; x < 200; x++) for (let y = 100; y < 200; y++) if (r.pixel(x, y)[0] < 120) dark++;
    expect(dark).toBeGreaterThan(200);
  });

  it('produces valid standalone SVG', () => {
    const page = blankPage(300, 200);
    page.elements.push(redBox(10, 10));
    const svg = pageToSvg(page);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 300 200"');
    expect(svg).toContain('fill-opacity="0.4"');
  });
});
