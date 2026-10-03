import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { CanvasFactory } from '../src/export';

export const make: CanvasFactory = (w, h) => {
  const c = createCanvas(w, h);
  return {
    ctx: c.getContext('2d') as unknown as CanvasRenderingContext2D,
    toPng: async () => new Uint8Array(c.toBuffer('image/png')),
  };
};

/** Three pages: plain, /Rotate 90, and a MediaBox with a non-zero origin. */
export async function makeTestPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const p1 = pdf.addPage([300, 200]);
  p1.drawRectangle({ x: 120, y: 100, width: 40, height: 20, color: rgb(0.8, 0.8, 0.8) });
  const p2 = pdf.addPage([300, 200]);
  p2.setRotation(degrees(90));
  p2.drawRectangle({ x: 120, y: 100, width: 40, height: 20, color: rgb(0.8, 0.8, 0.8) });
  const p3 = pdf.addPage([400, 300]);
  p3.setMediaBox(50, 40, 300, 200);
  p3.setCropBox(50, 40, 300, 200);
  p3.drawRectangle({ x: 60, y: 50, width: 20, height: 20, color: rgb(0, 0, 1) });
  return pdf.save();
}

/** Render page `index` (0-based) with the legacy pdf.js build and return RGBA pixels. */
export async function renderPdfPage(bytes: Uint8Array, index: number, scale = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: process.cwd() + '/node_modules/pdfjs-dist/standard_fonts/',
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport: vp }).promise;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    pixel: (x: number, y: number) => {
      const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
      return [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]];
    },
    numPages: doc.numPages,
  };
}
