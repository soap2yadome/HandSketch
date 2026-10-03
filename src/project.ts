import type { Doc, El, Page } from './model';

export interface ProjectFile {
  app: 'handsketch';
  version: 1;
  doc: Doc;
  /** Original PDF, base64 */
  pdf?: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serializeProject(doc: Doc, pdfBytes?: Uint8Array): string {
  const file: ProjectFile = { app: 'handsketch', version: 1, doc, ...(pdfBytes ? { pdf: bytesToBase64(pdfBytes) } : {}) };
  return JSON.stringify(file);
}

const ELEMENT_TYPES = new Set(['line', 'arrow', 'rect', 'ellipse', 'highlight', 'cloud', 'free', 'text', 'symbol', 'stamp']);

function validPage(p: unknown): p is Page {
  if (!p || typeof p !== 'object') return false;
  const o = p as Partial<Page>;
  return (
    (o.kind === 'pdf' || o.kind === 'blank') &&
    typeof o.width === 'number' && o.width > 0 &&
    typeof o.height === 'number' && o.height > 0 &&
    Array.isArray(o.elements) &&
    o.elements.every((e) => !!e && typeof e === 'object' && ELEMENT_TYPES.has((e as El).type) && typeof (e as El).id === 'string')
  );
}

export function parseProject(text: string): { doc: Doc; pdfBytes?: Uint8Array } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a HandSketch project file (invalid JSON).');
  }
  const f = raw as Partial<ProjectFile>;
  if (!f || f.app !== 'handsketch' || f.version !== 1 || !f.doc || !Array.isArray(f.doc.pages) || !f.doc.pages.length) {
    throw new Error('Not a HandSketch project file.');
  }
  if (!f.doc.pages.every(validPage)) throw new Error('Project file contains an invalid page.');
  return { doc: f.doc, pdfBytes: f.pdf ? base64ToBytes(f.pdf) : undefined };
}
