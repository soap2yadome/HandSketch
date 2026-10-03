// Browser-side PDF rendering (pdf.js). Export lives in export.ts and only needs pdf-lib.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Page } from './model';
import { newId } from './model';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfSource {
  private constructor(
    readonly bytes: Uint8Array,
    private readonly doc: pdfjs.PDFDocumentProxy,
  ) {}

  static async load(bytes: Uint8Array): Promise<PdfSource> {
    // pdf.js transfers the buffer to its worker, so hand it a copy and keep ours for export.
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    return new PdfSource(bytes, doc);
  }

  get numPages(): number {
    return this.doc.numPages;
  }

  async pages(): Promise<Page[]> {
    const out: Page[] = [];
    for (let i = 0; i < this.doc.numPages; i++) {
      const pg = await this.doc.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      out.push({ id: newId('p'), kind: 'pdf', width: vp.width, height: vp.height, pdfIndex: i, elements: [] });
    }
    return out;
  }

  private task: pdfjs.RenderTask | null = null;

  /** Render a page to a canvas at `scale` css-pixels-per-point (callers include devicePixelRatio). */
  async render(index: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    this.task?.cancel();
    const pg = await this.doc.getPage(index + 1);
    const vp = pg.getViewport({ scale });
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const task = pg.render({ canvas, viewport: vp });
    this.task = task;
    try {
      await task.promise;
    } catch (e) {
      if ((e as Error).name !== 'RenderingCancelledException') throw e;
    }
  }
}
