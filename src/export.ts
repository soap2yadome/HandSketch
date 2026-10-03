// Export pipeline. Annotations are rasterised per page (transparent PNG) and embedded over
// the original page content, so the output matches the on-screen hand-drawn look exactly.
import { PDFDocument, degrees, type PDFPage } from 'pdf-lib';
import type { Doc, Page } from './model';
import { paintCanvas, primsToSvg } from './paint';
import { renderPage } from './render';

export interface RasterCanvas {
  ctx: CanvasRenderingContext2D;
  toPng(): Promise<Uint8Array>;
}
export type CanvasFactory = (width: number, height: number) => RasterCanvas;

export const hasInk = (page: Page) => page.elements.length > 0;

export function overlayScale(page: Page): number {
  return Math.max(1.5, Math.min(3, 3000 / Math.max(page.width, page.height)));
}

/** Rasterise a page's annotations. `background` paints under the ink (blank pages). */
export async function rasterizePage(page: Page, make: CanvasFactory, background?: string, scale = overlayScale(page)): Promise<Uint8Array> {
  const c = make(Math.ceil(page.width * scale), Math.ceil(page.height * scale));
  if (background) {
    c.ctx.fillStyle = background;
    c.ctx.fillRect(0, 0, page.width * scale, page.height * scale);
  }
  c.ctx.save();
  c.ctx.scale(scale, scale);
  paintCanvas(c.ctx, renderPage(page));
  c.ctx.restore();
  return c.toPng();
}

export function pageToSvg(page: Page, background = '#ffffff'): string {
  return primsToSvg(renderPage(page), page.width, page.height, background);
}

const norm = (deg: number) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;

/** Draw an overlay PNG covering the page's visible (rotated, cropped) area. */
async function placeOverlay(out: PDFDocument, page: PDFPage, png: Uint8Array): Promise<void> {
  const img = await out.embedPng(png);
  const { x, y, width: w, height: h } = page.getCropBox();
  const rot = norm(page.getRotation().angle);
  const vw = rot === 90 || rot === 270 ? h : w;
  const vh = rot === 90 || rot === 270 ? w : h;
  const anchor = rot === 0 ? { x, y } : rot === 90 ? { x: x + w, y } : rot === 180 ? { x: x + w, y: y + h } : { x, y: y + h };
  page.drawImage(img, { x: anchor.x, y: anchor.y, width: vw, height: vh, rotate: degrees(rot) });
}

/** Visual (rotation-applied) size of a PDF page in points, matching pdf.js `getViewport({scale:1})`. */
export function visualSize(page: PDFPage): { width: number; height: number } {
  const { width, height } = page.getCropBox();
  const rot = norm(page.getRotation().angle);
  return rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
}

export interface ExportInput {
  doc: Doc;
  /** Original PDF bytes when the document was opened from a PDF */
  pdfBytes?: Uint8Array;
  make: CanvasFactory;
}

/** Build the annotated PDF. Preserves the original file in place when pages are untouched. */
export async function exportPdf({ doc, pdfBytes, make }: ExportInput): Promise<Uint8Array> {
  const src = pdfBytes ? await PDFDocument.load(pdfBytes, { ignoreEncryption: true }) : undefined;
  const pdfPages = doc.pages.filter((p) => p.kind === 'pdf');
  const untouched =
    !!src && doc.pages.length === src.getPageCount() && doc.pages.every((p, i) => p.kind === 'pdf' && p.pdfIndex === i);

  let out: PDFDocument;
  if (untouched && src) {
    out = src;
    for (let i = 0; i < doc.pages.length; i++) {
      const p = doc.pages[i];
      if (!hasInk(p)) continue;
      await placeOverlay(out, out.getPage(i), await rasterizePage(p, make));
    }
  } else {
    out = await PDFDocument.create();
    for (const p of doc.pages) {
      if (p.kind === 'pdf' && src && p.pdfIndex !== undefined) {
        const [copied] = await out.copyPages(src, [p.pdfIndex]);
        const page = out.addPage(copied);
        if (hasInk(p)) await placeOverlay(out, page, await rasterizePage(p, make));
      } else {
        const page = out.addPage([p.width, p.height]);
        const png = await rasterizePage(p, make, '#ffffff');
        const img = await out.embedPng(png);
        page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
      }
    }
  }
  void pdfPages;
  out.setProducer('HandSketch');
  out.setCreator('HandSketch');
  return out.save();
}
