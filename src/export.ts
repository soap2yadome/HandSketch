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

/** Raster resolution for a page: up to 3x, but never more than ~40 megapixels (browser canvas limits). */
export function overlayScale(page: Page, max = 3): number {
  const byArea = Math.sqrt(40_000_000 / (page.width * page.height));
  return Math.max(0.25, Math.min(max, byArea));
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

/** pdf.js ignores /Rotate values that aren't multiples of 90; do the same so both agree. */
const norm = (deg: number) => (deg % 90 === 0 ? ((deg % 360) + 360) % 360 : 0);

/** The visible box: CropBox clipped to the MediaBox, as pdf.js computes it. */
function visibleBox(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const m = page.getMediaBox();
  const c = page.getCropBox();
  const x0 = Math.max(Math.min(c.x, c.x + c.width), Math.min(m.x, m.x + m.width));
  const y0 = Math.max(Math.min(c.y, c.y + c.height), Math.min(m.y, m.y + m.height));
  const x1 = Math.min(Math.max(c.x, c.x + c.width), Math.max(m.x, m.x + m.width));
  const y1 = Math.min(Math.max(c.y, c.y + c.height), Math.max(m.y, m.y + m.height));
  if (x1 - x0 < 1 || y1 - y0 < 1) return { x: m.x, y: m.y, width: Math.abs(m.width), height: Math.abs(m.height) };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Draw an overlay PNG covering the page's visible (rotated, cropped) area. */
async function placeOverlay(out: PDFDocument, page: PDFPage, png: Uint8Array): Promise<void> {
  const img = await out.embedPng(png);
  const { x, y, width: w, height: h } = visibleBox(page);
  const rot = norm(page.getRotation().angle);
  // Wrap the original content in q/Q so a page that leaves a modified graphics state can't skew our overlay.
  page.translateContent(0, 0);
  const vw = rot === 90 || rot === 270 ? h : w;
  const vh = rot === 90 || rot === 270 ? w : h;
  const anchor = rot === 0 ? { x, y } : rot === 90 ? { x: x + w, y } : rot === 180 ? { x: x + w, y: y + h } : { x, y: y + h };
  page.drawImage(img, { x: anchor.x, y: anchor.y, width: vw, height: vh, rotate: degrees(rot) });
}

/** Visual (rotation-applied) size of a PDF page in default user units. */
export function visualSize(page: PDFPage): { width: number; height: number } {
  const { width, height } = visibleBox(page);
  const rot = norm(page.getRotation().angle);
  return rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
}

export interface ExportInput {
  doc: Doc;
  /** Original PDF bytes when the document was opened from a PDF */
  pdfBytes?: Uint8Array;
  make: CanvasFactory;
}

export class ExportError extends Error {}

/** Build the annotated PDF. Preserves the original file in place when pages are untouched. */
export async function exportPdf({ doc, pdfBytes, make }: ExportInput): Promise<Uint8Array> {
  let src: PDFDocument | undefined;
  if (pdfBytes) {
    try {
      src = await PDFDocument.load(pdfBytes);
    } catch (e) {
      if (/encrypt/i.test((e as Error).message)) {
        throw new ExportError('This PDF is password-protected/encrypted, so it can\'t be re-saved with markup. Remove the protection (print to a new PDF) and reopen it.');
      }
      throw new ExportError(`The original PDF could not be processed for export: ${(e as Error).message}`);
    }
  }
  for (const p of doc.pages) {
    if (p.kind === 'pdf' && (!src || p.pdfIndex === undefined || p.pdfIndex < 0 || p.pdfIndex >= src.getPageCount())) {
      throw new ExportError('A page refers to a PDF page that is not available (was the project saved without its PDF?).');
    }
  }
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
    // One copy call keeps fonts/images shared between pages instead of duplicating them per page.
    const wanted = doc.pages.filter((p) => p.kind === 'pdf').map((p) => p.pdfIndex!);
    const copied = src && wanted.length ? await out.copyPages(src, wanted) : [];
    let next = 0;
    for (const p of doc.pages) {
      if (p.kind === 'pdf') {
        const page = out.addPage(copied[next++]);
        if (hasInk(p)) await placeOverlay(out, page, await rasterizePage(p, make));
      } else {
        const page = out.addPage([p.width, p.height]);
        const png = await rasterizePage(p, make, '#ffffff');
        const img = await out.embedPng(png);
        page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
      }
    }
  }
  out.setProducer('HandSketch');
  out.setCreator('HandSketch');
  return out.save();
}
