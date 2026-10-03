import { newId, type Doc, type El, type Page } from './model';

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

const MAX_PAGES = 2000;
const MAX_ELEMENTS = 20_000;
const MAX_POINTS = 50_000;
const MAX_COORD = 1e5;
const MAX_PAGE = 20_000;
const MAX_TEXT = 5_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lim = MAX_COORD): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const pt = (v: unknown): boolean => isObj(v) && num(v.x) && num(v.y);
const link = (v: unknown): boolean => v === undefined || (isObj(v) && str(v.id, 100) && Number.isInteger(v.port) && (v.port as number) >= 0 && (v.port as number) < 64);

function validStyle(v: unknown): boolean {
  return (
    isObj(v) &&
    str(v.stroke, 40) && str(v.fill, 40) &&
    (v.fillStyle === 'none' || v.fillStyle === 'hachure' || v.fillStyle === 'solid') &&
    num(v.width, 100) && (v.width as number) > 0 &&
    num(v.roughness, 20) && (v.roughness as number) >= 0
  );
}

function validElement(e: unknown): e is El {
  if (!isObj(e) || !str(e.id, 100) || !num(e.seed, 2 ** 32) || !validStyle(e.style)) return false;
  switch (e.type) {
    case 'line':
    case 'arrow':
      return pt(e.p1) && pt(e.p2) && (e.route === 'straight' || e.route === 'elbow') && link(e.from) && link(e.to) && (e.label === undefined || str(e.label));
    case 'rect': case 'ellipse': case 'highlight': case 'cloud':
      return num(e.x) && num(e.y) && num(e.w) && num(e.h);
    case 'free':
      return Array.isArray(e.pts) && e.pts.length <= MAX_POINTS && e.pts.every(pt);
    case 'text':
      return num(e.x) && num(e.y) && str(e.text) && num(e.size, 1000) && (e.size as number) > 0;
    case 'symbol':
      return str(e.symbol, 100) && num(e.x) && num(e.y) && num(e.size, 5000) && (e.size as number) > 0 && num(e.rot, 3600) && (e.label === undefined || str(e.label));
    case 'stamp':
      return num(e.x) && num(e.y) && str(e.text, 200) && num(e.size, 1000) && (e.size as number) > 0 && num(e.rot, 3600);
    default:
      return false;
  }
}

function validPage(p: unknown): p is Page {
  if (!isObj(p)) return false;
  if (p.kind !== 'pdf' && p.kind !== 'blank') return false;
  if (!str(p.id, 100) || !num(p.width, MAX_PAGE) || !num(p.height, MAX_PAGE) || (p.width as number) <= 0 || (p.height as number) <= 0) return false;
  if (p.kind === 'pdf' && !(Number.isInteger(p.pdfIndex) && (p.pdfIndex as number) >= 0)) return false;
  return Array.isArray(p.elements) && p.elements.length <= MAX_ELEMENTS && p.elements.every(validElement);
}

/** Throws a user-readable error unless `doc` is structurally safe to render. Used for files and autosave. */
export function validateDoc(doc: unknown): asserts doc is Doc {
  if (!isObj(doc) || !Array.isArray(doc.pages) || !doc.pages.length) throw new Error('Not a HandSketch project file.');
  if (doc.pages.length > MAX_PAGES) throw new Error('Project has too many pages.');
  doc.pages.forEach((p, i) => {
    if (!validPage(p)) throw new Error(`Project file contains an invalid page (page ${i + 1}).`);
  });
}

export function parseProject(text: string): { doc: Doc; pdfBytes?: Uint8Array } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a HandSketch project file (invalid JSON).');
  }
  if (!isObj(raw) || raw.app !== 'handsketch' || raw.version !== 1) throw new Error('Not a HandSketch project file.');
  validateDoc(raw.doc);
  const doc = raw.doc as Doc;
  if (raw.pdf !== undefined && typeof raw.pdf !== 'string') throw new Error('Project file has an invalid PDF payload.');
  let pdfBytes: Uint8Array | undefined;
  if (raw.pdf) {
    try {
      pdfBytes = base64ToBytes(raw.pdf as string);
    } catch {
      throw new Error('Project file has a corrupt embedded PDF.');
    }
  }
  // Duplicate ids would alias selection/links; make them unique.
  const seen = new Set<string>();
  for (const p of doc.pages) {
    if (seen.has(p.id)) p.id = newId('p');
    seen.add(p.id);
  }
  return { doc, pdfBytes };
}
