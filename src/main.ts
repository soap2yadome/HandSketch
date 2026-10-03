import '@fontsource/caveat/500.css';
import './styles.css';
import { ExportError, exportPdf, overlayScale, pageToSvg, rasterizePage, type CanvasFactory } from './export';
import {
  DEFAULT_STYLE, History, blankPage, cloneElements, cloneForPaste, moveElements, newId, newSeed, pruneLinks, removeElements,
  type BoxEl, type Doc, type El, type FillStyle, type LineEl, type Page, type StyleProps, type SymbolEl,
} from './model';
import { paintCanvas } from './paint';
import { PdfSource } from './pdf';
import { parseProject, serializeProject, validateDoc } from './project';
import { elementBounds, hitTest, lineEndpoints, renderElement, symbolPortPosition } from './render';
import { dist, type Pt } from './sketch';
import { kvDelete, kvGet, kvSet } from './store';
import { DOMAINS, getSymbol, searchSymbols, type Domain } from './symbols';

type Tool = 'select' | 'pen' | 'marker' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'cloud' | 'highlight' | 'text' | 'stamp' | 'symbol';

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select / move', key: 'V', icon: '<path d="M5 3l12 8-6 1.5L8 19z"/>' },
  { id: 'pen', label: 'Pen', key: 'P', icon: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>' },
  { id: 'marker', label: 'Highlighter pen', key: 'M', icon: '<path d="M9 18l-4 2 1-4 9-10 3 3z"/><path d="M5 21h14" opacity=".5"/>' },
  { id: 'line', label: 'Line / connector', key: 'L', icon: '<path d="M5 19L19 5"/>' },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: '<path d="M5 19L19 5M10 5h9v9"/>' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: '<ellipse cx="12" cy="12" rx="8" ry="6"/>' },
  { id: 'cloud', label: 'Revision cloud', key: 'C', icon: '<path d="M7 17a3 3 0 010-6 4 4 0 017-2 3.5 3.5 0 013 5.5 2.5 2.5 0 01-1 2.5z"/>' },
  { id: 'highlight', label: 'Highlight box', key: 'H', icon: '<rect x="4" y="8" width="16" height="8" fill="currentColor" opacity=".25"/><path d="M4 8h16v8H4z"/>' },
  { id: 'text', label: 'Text', key: 'T', icon: '<path d="M6 6h12M12 6v13M9 19h6"/>' },
  { id: 'stamp', label: 'Stamp', key: 'S', icon: '<rect x="4" y="9" width="16" height="9" rx="1"/><path d="M8 13h8"/>' },
];

const SWATCHES = ['#1f2a44', '#c92a2a', '#2b8a3e', '#1971c2', '#e67700', '#7048e8', '#000000'];
const STAMPS: { text: string; color: string }[] = [
  { text: 'APPROVED', color: '#2b8a3e' },
  { text: 'REJECTED', color: '#c92a2a' },
  { text: 'REVISE', color: '#e67700' },
  { text: 'FOR REVIEW', color: '#1971c2' },
  { text: 'DRAFT', color: '#6b7280' },
  { text: 'VOID', color: '#c92a2a' },
  { text: 'AS-BUILT', color: '#7048e8' },
  { text: 'CONFIDENTIAL', color: '#c92a2a' },
];
const GRID = 12;
const SNAP_PORT = 16;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

// ---------------------------------------------------------------- state
const S = {
  doc: { pages: [blankPage()] } as Doc,
  pdf: null as PdfSource | null,
  pageIdx: 0,
  tool: 'select' as Tool,
  style: { ...DEFAULT_STYLE } as StyleProps,
  route: 'straight' as 'straight' | 'elbow',
  snap: true,
  stamp: STAMPS[0],
  armed: null as string | null,
  armedRot: 0,
  selection: [] as string[],
  zoom: 1,
  editingId: null as string | null,
  hasDoc: false,
  clipboard: [] as El[],
  symDomain: null as Domain | null,
  symQuery: '',
};

let histories = new WeakMap<Page, History>();
const stage = $('stage');
const wrap = $('page-wrap');
const pdfCanvas = $<HTMLCanvasElement>('pdf-canvas');
const ink = $<HTMLCanvasElement>('ink-canvas');
const inkCtx = ink.getContext('2d')!;
const statusEl = $('status');

const page = (): Page => S.doc.pages[S.pageIdx];
const hist = (): History => {
  const pg = page();
  let h = histories.get(pg);
  if (!h) histories.set(pg, (h = new History()));
  return h;
};
const selectedEls = () => page().elements.filter((e) => S.selection.includes(e.id));
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
/** Backing-store pixels per page unit for the ink canvas, capped so huge pages can't exceed canvas limits. */
const inkScale = (): number => {
  const p = page();
  return Math.min(S.zoom * dpr(), Math.sqrt(60_000_000 / (p.width * p.height)), 8192 / Math.max(p.width, p.height));
};

function say(msg: string): void {
  statusEl.textContent = msg;
}

// ------------------------------------------------------------ rendering
let raf = 0;
function redraw(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    drawInk();
  });
}

let draft: El | null = null;
let hoverPort: Pt | null = null;
let marquee: { a: Pt; b: Pt } | null = null;

function drawInk(): void {
  const p = page();
  const k = inkScale();
  inkCtx.setTransform(1, 0, 0, 1, 0, 0);
  inkCtx.clearRect(0, 0, ink.width, ink.height);
  inkCtx.setTransform(k, 0, 0, k, 0, 0);
  const els = p.elements.filter((e) => e.id !== S.editingId);
  const prims = els.flatMap((e) => renderElement(e, p.elements));
  paintCanvas(inkCtx, prims);
  if (draft) paintCanvas(inkCtx, renderElement(draft, p.elements));
  if (S.tool === 'symbol' && S.armed && lastPointer) {
    inkCtx.globalAlpha = 0.55;
    paintCanvas(inkCtx, renderElement(ghostSymbol(lastPointer), p.elements));
    inkCtx.globalAlpha = 1;
  }
  drawSelection();
  if (hoverPort) {
    inkCtx.strokeStyle = '#d9480f';
    inkCtx.lineWidth = 2 / S.zoom;
    inkCtx.beginPath();
    inkCtx.arc(hoverPort.x, hoverPort.y, 7 / S.zoom, 0, Math.PI * 2);
    inkCtx.stroke();
  }
  if (marquee) {
    inkCtx.strokeStyle = '#1971c2';
    inkCtx.fillStyle = 'rgba(25,113,194,.08)';
    inkCtx.lineWidth = 1 / S.zoom;
    const r = rectOf(marquee.a, marquee.b);
    inkCtx.fillRect(r.x, r.y, r.w, r.h);
    inkCtx.strokeRect(r.x, r.y, r.w, r.h);
  }
}

function rectOf(a: Pt, b: Pt) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function drawSelection(): void {
  if (S.tool !== 'select') return;
  const p = page();
  const z = S.zoom;
  inkCtx.save();
  inkCtx.strokeStyle = '#1971c2';
  inkCtx.fillStyle = '#fff';
  inkCtx.lineWidth = 1.2 / z;
  inkCtx.setLineDash([5 / z, 4 / z]);
  for (const e of selectedEls()) {
    const b = elementBounds(e, p.elements);
    inkCtx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
  }
  inkCtx.setLineDash([]);
  const sel = selectedEls();
  if (sel.length === 1) {
    for (const h of handlesFor(sel[0])) {
      inkCtx.beginPath();
      inkCtx.rect(h.pt.x - 4 / z, h.pt.y - 4 / z, 8 / z, 8 / z);
      inkCtx.fill();
      inkCtx.stroke();
    }
    if (sel[0].type === 'symbol') {
      const sym = getSymbol(sel[0].symbol);
      inkCtx.fillStyle = '#d9480f';
      sym?.ports.forEach((_, i) => {
        const pp = symbolPortPosition(sel[0] as SymbolEl, i);
        if (!pp) return;
        inkCtx.beginPath();
        inkCtx.arc(pp.x, pp.y, 2.6 / z, 0, Math.PI * 2);
        inkCtx.fill();
      });
    }
  }
  inkCtx.restore();
}

interface Handle {
  kind: 'resize' | 'p1' | 'p2';
  pt: Pt;
}
function handlesFor(e: El): Handle[] {
  switch (e.type) {
    case 'rect': case 'ellipse': case 'highlight': case 'cloud':
      return [{ kind: 'resize', pt: { x: e.x + e.w, y: e.y + e.h } }];
    case 'symbol': {
      const b = elementBounds(e, page().elements);
      return [{ kind: 'resize', pt: { x: b.x + b.w + 3, y: b.y + b.h + 3 } }];
    }
    case 'line': case 'arrow': {
      const [a, b] = endpoints(e);
      return [{ kind: 'p1', pt: a }, { kind: 'p2', pt: b }];
    }
    default:
      return [];
  }
}

const endpoints = (e: LineEl): [Pt, Pt] => lineEndpoints(e, page().elements);

// ---------------------------------------------------------------- layout
let pdfRenderToken = 0;
let pdfTimer = 0;

function layout(): void {
  const p = page();
  const w = Math.round(p.width * S.zoom);
  const h = Math.round(p.height * S.zoom);
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
  const k = inkScale();
  const iw = Math.ceil(p.width * k);
  const ih = Math.ceil(p.height * k);
  if (ink.width !== iw || ink.height !== ih) {
    ink.width = iw;
    ink.height = ih;
  }
  for (const c of [ink, pdfCanvas]) {
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  const isPdf = p.kind === 'pdf' && !!S.pdf;
  pdfCanvas.style.display = isPdf ? 'block' : 'none';
  wrap.classList.toggle('grid', !isPdf);
  wrap.style.backgroundSize = `${GRID * 2 * S.zoom}px ${GRID * 2 * S.zoom}px`;
  $('zoom-label').textContent = `${Math.round(S.zoom * 100)}%`;
  stage.classList.toggle('has-doc', S.hasDoc);
  wrap.style.display = S.hasDoc ? 'block' : 'none';
  if (isPdf) schedulePdf();
  redraw();
}

function schedulePdf(): void {
  window.clearTimeout(pdfTimer);
  pdfTimer = window.setTimeout(async () => {
    const token = ++pdfRenderToken;
    const p = page();
    if (!S.pdf || p.kind !== 'pdf' || p.pdfIndex === undefined) return;
    const scale = Math.min(S.zoom * dpr(), 4096 / Math.max(p.width, p.height));
    try {
      await S.pdf.render(p.pdfIndex, pdfCanvas, scale);
      if (token !== pdfRenderToken) return;
      pdfCanvas.style.width = `${Math.round(p.width * S.zoom)}px`;
      pdfCanvas.style.height = `${Math.round(p.height * S.zoom)}px`;
      pdfCanvas.dataset.rendered = String(p.pdfIndex);
    } catch (e) {
      say(`Could not render page: ${(e as Error).message}`);
    }
  }, 60);
}

function fitWidth(): void {
  const p = page();
  const avail = stage.clientWidth - 44;
  S.zoom = Math.max(0.2, Math.min(4, avail / p.width));
  layout();
}

function setZoom(z: number, anchor?: Pt): void {
  const old = S.zoom;
  S.zoom = Math.max(0.2, Math.min(5, z, 12000 / Math.max(page().width, page().height)));
  layout();
  if (anchor && old !== S.zoom) {
    stage.scrollLeft += anchor.x * (S.zoom - old);
    stage.scrollTop += anchor.y * (S.zoom - old);
  }
}

// ------------------------------------------------------------ mutations
function mutate(fn: () => void): void {
  hist().push(cloneElements(page().elements));
  fn();
  pruneLinks(page().elements);
  afterChange();
}

function afterChange(): void {
  syncProps();
  updateButtons();
  redraw();
  scheduleAutosave();
}

function undo(): void {
  const r = hist().undo(page().elements);
  if (r) {
    page().elements = r;
    S.selection = S.selection.filter((id) => r.some((e) => e.id === id));
    afterChange();
  }
}
function redo(): void {
  const r = hist().redo(page().elements);
  if (r) {
    page().elements = r;
    S.selection = S.selection.filter((id) => r.some((e) => e.id === id));
    afterChange();
  }
}

function addElement(el: El): void {
  mutate(() => page().elements.push(el));
}

function snapPt(p: Pt, free = false): Pt {
  if (!S.snap || free || page().kind === 'pdf') return p;
  return { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
}

function findPort(p: Pt): { pt: Pt; id: string; port: number } | null {
  let best: { pt: Pt; id: string; port: number } | null = null;
  let bd = SNAP_PORT / S.zoom;
  for (const e of page().elements) {
    if (e.type !== 'symbol') continue;
    const def = getSymbol(e.symbol);
    def?.ports.forEach((_, i) => {
      const pp = symbolPortPosition(e, i);
      if (!pp) return;
      const d = dist(pp, p);
      if (d < bd) {
        bd = d;
        best = { pt: pp, id: e.id, port: i };
      }
    });
  }
  return best;
}

function newStyle(): StyleProps {
  return { ...S.style };
}

function ghostSymbol(at: Pt): SymbolEl {
  const size = symbolSize();
  const c = snapPt(at);
  return { id: 'ghost', seed: 11, style: newStyle(), type: 'symbol', symbol: S.armed!, x: c.x - size / 2, y: c.y - size / 2, size, rot: S.armedRot };
}

function symbolSize(): number {
  return page().kind === 'pdf' ? 48 : 72;
}

// ------------------------------------------------------------ pointer
let lastPointer: Pt | null = null;
type Drag =
  | { kind: 'draw'; start: Pt; fromLink?: { id: string; port: number } }
  | { kind: 'move'; last: Pt; moved: boolean }
  | { kind: 'resize'; el: El; moved: boolean }
  | { kind: 'end'; el: LineEl; which: 'p1' | 'p2'; moved: boolean }
  | { kind: 'marquee'; additive: boolean }
  | { kind: 'pan'; sx: number; sy: number; left: number; top: number };
let drag: Drag | null = null;
let spaceDown = false;
/** Pre-drag copy of the page: pushed to history when the drag completes, restored if it is cancelled. */
let pendingSnap: El[] | null = null;
let activePointer: number | null = null;
function markChanged(d: { moved: boolean }): void {
  d.moved = true;
}

/** Abort the current gesture, discarding any in-progress shape and undoing partial moves. */
function cancelDrag(): void {
  const d = drag;
  if (d && 'moved' in d && d.moved && pendingSnap) page().elements = pendingSnap;
  drag = null;
  draft = null;
  marquee = null;
  hoverPort = null;
  pendingSnap = null;
  activePointer = null;
  syncProps();
  redraw();
}

function toPage(e: PointerEvent | MouseEvent): Pt {
  const r = ink.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
}

ink.addEventListener('pointerdown', (e) => {
  if (!S.hasDoc) return;
  if (activePointer !== null || drag) return; // ignore a second finger/pen while a gesture is running
  activePointer = e.pointerId;
  ink.setPointerCapture(e.pointerId);
  if (S.editingId) commitText();
  if (e.button === 1 || spaceDown) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    return;
  }
  if (e.button !== 0) return;
  const raw = toPage(e);
  const p = snapPt(raw, e.altKey);
  const pg = page();
  switch (S.tool) {
    case 'select': {
      const single = selectedEls();
      if (single.length === 1) {
        for (const h of handlesFor(single[0])) {
          if (dist(h.pt, raw) <= 9 / S.zoom) {
            pendingSnap = cloneElements(pg.elements);
            drag = h.kind === 'resize' ? { kind: 'resize', el: single[0], moved: false } : { kind: 'end', el: single[0] as LineEl, which: h.kind, moved: false };
            return;
          }
        }
      }
      const hit = [...pg.elements].reverse().find((el) => hitTest(el, raw, pg.elements, 5 / S.zoom));
      if (hit) {
        if (e.shiftKey) S.selection = S.selection.includes(hit.id) ? S.selection.filter((i) => i !== hit.id) : [...S.selection, hit.id];
        else if (!S.selection.includes(hit.id)) S.selection = [hit.id];
        pendingSnap = cloneElements(pg.elements);
        drag = { kind: 'move', last: raw, moved: false };
      } else {
        if (!e.shiftKey) S.selection = [];
        drag = { kind: 'marquee', additive: e.shiftKey };
        marquee = { a: raw, b: raw };
      }
      syncProps();
      redraw();
      return;
    }
    case 'pen':
    case 'marker':
      draft = { id: newId(), seed: newSeed(), style: newStyle(), type: 'free', pts: [raw], marker: S.tool === 'marker' };
      drag = { kind: 'draw', start: raw };
      break;
    case 'line':
    case 'arrow': {
      const port = findPort(raw);
      const a = port ? port.pt : p;
      draft = { id: newId(), seed: newSeed(), style: newStyle(), type: S.tool, p1: a, p2: a, route: S.route, ...(port ? { from: { id: port.id, port: port.port } } : {}) } as LineEl;
      drag = { kind: 'draw', start: a, fromLink: port ? { id: port.id, port: port.port } : undefined };
      break;
    }
    case 'rect': case 'ellipse': case 'cloud': case 'highlight':
      draft = { id: newId(), seed: newSeed(), style: newStyle(), type: S.tool, x: p.x, y: p.y, w: 0, h: 0 } as BoxEl;
      drag = { kind: 'draw', start: p };
      break;
    case 'text':
      beginText(raw, null);
      return;
    case 'stamp': {
      const el: El = {
        id: newId(), seed: newSeed(), type: 'stamp', x: raw.x, y: raw.y, text: S.stamp.text, size: 34, rot: -8 + Math.round(Math.random() * 6),
        style: { ...newStyle(), stroke: S.stamp.color, width: 3 },
      };
      addElement(el);
      return;
    }
    case 'symbol': {
      if (!S.armed) return;
      const g = ghostSymbol(raw);
      addElement({ ...g, id: newId(), seed: newSeed() });
      return;
    }
  }
  redraw();
});

ink.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId !== activePointer) return;
  const raw = toPage(e);
  lastPointer = raw;
  if (!drag) {
    const wasHover = hoverPort;
    hoverPort = S.tool === 'line' || S.tool === 'arrow' ? findPort(raw)?.pt ?? null : null;
    if (S.tool === 'symbol' || wasHover !== hoverPort) redraw();
    if (S.tool === 'select') ink.style.cursor = selectedEls().length === 1 && handlesFor(selectedEls()[0]).some((h) => dist(h.pt, raw) <= 9 / S.zoom) ? 'nwse-resize' : 'default';
    return;
  }
  const p = snapPt(raw, e.altKey);
  switch (drag.kind) {
    case 'pan':
      stage.scrollLeft = drag.left - (e.clientX - drag.sx);
      stage.scrollTop = drag.top - (e.clientY - drag.sy);
      return;
    case 'draw': {
      if (!draft) return;
      if (draft.type === 'free') draft.pts.push(raw);
      else if (draft.type === 'line' || draft.type === 'arrow') {
        const port = findPort(raw);
        hoverPort = port?.pt ?? null;
        draft.p2 = port ? port.pt : e.shiftKey ? constrain(draft.p1, p) : p;
        if (port) draft.to = { id: port.id, port: port.port };
        else delete draft.to;
      } else if (draft.type === 'rect' || draft.type === 'ellipse' || draft.type === 'cloud' || draft.type === 'highlight') {
        let w = p.x - drag.start.x;
        let h = p.y - drag.start.y;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        draft.x = Math.min(drag.start.x, drag.start.x + w);
        draft.y = Math.min(drag.start.y, drag.start.y + h);
        draft.w = Math.abs(w);
        draft.h = Math.abs(h);
      }
      break;
    }
    case 'move': {
      const dx = raw.x - drag.last.x;
      const dy = raw.y - drag.last.y;
      if (!drag.moved && Math.hypot(dx, dy) * S.zoom < 3) return;
      markChanged(drag);
      moveElements(page().elements, new Set(S.selection), dx, dy);
      drag.last = raw;
      break;
    }
    case 'resize': {
      markChanged(drag);
      const el = drag.el;
      if (el.type === 'symbol') el.size = Math.max(20, Math.round(Math.max(p.x - el.x, p.y - el.y)));
      else if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'highlight' || el.type === 'cloud') {
        el.w = Math.max(6, p.x - el.x);
        el.h = Math.max(6, p.y - el.y);
      }
      break;
    }
    case 'end': {
      markChanged(drag);
      const port = findPort(raw);
      hoverPort = port?.pt ?? null;
      const el = drag.el;
      const pos = port ? port.pt : p;
      if (drag.which === 'p1') {
        el.p1 = pos;
        if (port) el.from = { id: port.id, port: port.port };
        else delete el.from;
      } else {
        el.p2 = pos;
        if (port) el.to = { id: port.id, port: port.port };
        else delete el.to;
      }
      break;
    }
    case 'marquee':
      if (marquee) marquee.b = raw;
      break;
  }
  redraw();
});

function constrain(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

function finishDrag(e?: PointerEvent): void {
  if (e && e.pointerId !== activePointer) return;
  const d = drag;
  drag = null;
  activePointer = null;
  if (!d) return;
  const pg = page();
  if (d.kind === 'draw' && draft) {
    const el = draft;
    draft = null;
    hoverPort = null;
    let keep = true;
    if (el.type === 'line' || el.type === 'arrow') keep = dist(el.p1, el.p2) > 4;
    else if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'cloud' || el.type === 'highlight') keep = el.w > 3 && el.h > 3;
    if (keep) addElement(el);
    else redraw();
  } else if (d.kind === 'move' || d.kind === 'resize' || d.kind === 'end') {
    hoverPort = null;
    if (d.moved && pendingSnap) {
      hist().push(pendingSnap);
      pruneLinks(pg.elements);
      afterChange();
    }
    pendingSnap = null;
    redraw();
  } else if (d.kind === 'marquee' && marquee) {
    const r = rectOf(marquee.a, marquee.b);
    marquee = null;
    if (r.w > 3 || r.h > 3) {
      const ids = pg.elements
        .filter((el) => {
          const b = elementBounds(el, pg.elements);
          return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
        })
        .map((el) => el.id);
      S.selection = d.additive ? [...new Set([...S.selection, ...ids])] : ids;
    }
    syncProps();
    redraw();
  }
}
ink.addEventListener('pointerup', (e) => finishDrag(e));
ink.addEventListener('pointercancel', (e) => {
  if (e.pointerId === activePointer) cancelDrag();
});
ink.addEventListener('pointerleave', () => {
  lastPointer = null;
  if (!drag) {
    hoverPort = null;
    redraw();
  }
});

ink.addEventListener('dblclick', (e) => {
  if (S.tool !== 'select') return;
  const raw = toPage(e);
  const hit = [...page().elements].reverse().find((el) => hitTest(el, raw, page().elements, 5 / S.zoom));
  if (hit?.type === 'text') beginText(null, hit);
});

stage.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: (e.clientX - r.left + stage.scrollLeft - wrap.offsetLeft) / S.zoom, y: (e.clientY - r.top + stage.scrollTop - wrap.offsetTop) / S.zoom });
}, { passive: false });

// ---------------------------------------------------------------- text
let editor: HTMLTextAreaElement | null = null;

function beginText(at: Pt | null, existing: El | null): void {
  commitText();
  const size = existing && existing.type === 'text' ? existing.size : 26;
  const x = existing && existing.type === 'text' ? existing.x : at!.x;
  const y = existing && existing.type === 'text' ? existing.y : at!.y - size / 2;
  const ta = document.createElement('textarea');
  ta.className = 'text-editor';
  ta.setAttribute('aria-label', 'Text');
  ta.dataset.testid = 'text-editor';
  ta.value = existing && existing.type === 'text' ? existing.text : '';
  ta.rows = Math.max(1, ta.value.split('\n').length);
  ta.style.left = `${x * S.zoom}px`;
  ta.style.top = `${y * S.zoom}px`;
  ta.style.fontSize = `${size * S.zoom}px`;
  ta.style.color = existing?.style.stroke ?? S.style.stroke;
  ta.style.minWidth = `${120 * S.zoom}px`;
  ta.style.height = `${size * 1.3 * S.zoom}px`;
  ta.addEventListener('input', () => {
    ta.rows = ta.value.split('\n').length;
    ta.style.height = `${ta.rows * size * 1.2 * S.zoom}px`;
  });
  ta.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ta.value = existing && existing.type === 'text' ? existing.text : '';
      commitText();
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) commitText();
  });
  ta.addEventListener('blur', () => commitText());
  wrap.appendChild(ta);
  editor = ta;
  S.editingId = existing?.id ?? '__new__';
  editorMeta = { x, y, size, existing: existing && existing.type === 'text' ? existing : null };
  setTimeout(() => {
    ta.focus();
    ta.select();
  }, 0);
  redraw();
}
let editorMeta: { x: number; y: number; size: number; existing: Extract<El, { type: 'text' }> | null } | null = null;

function commitText(): void {
  const ta = editor;
  const meta = editorMeta;
  if (!ta || !meta) return;
  editor = null;
  editorMeta = null;
  S.editingId = null;
  const text = ta.value.replace(/\s+$/, '');
  ta.remove();
  if (meta.existing) {
    const target = meta.existing;
    if (!text) mutate(() => (page().elements = page().elements.filter((e) => e.id !== target.id)));
    else if (text !== target.text) mutate(() => (target.text = text));
    else redraw();
  } else if (text) {
    addElement({ id: newId(), seed: newSeed(), style: newStyle(), type: 'text', x: meta.x, y: meta.y, text, size: meta.size });
  } else redraw();
}

// ------------------------------------------------------------- toolbox
function buildToolbox(): void {
  const box = $('toolbox');
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.id;
    b.title = `${t.label} (${t.key})`;
    b.setAttribute('aria-label', t.label);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<svg viewBox="0 0 24 24">${t.icon}</svg><kbd>${t.key}</kbd>`;
    b.addEventListener('click', () => setTool(t.id));
    box.appendChild(b);
  }
  const sw = $('swatches');
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', `Ink ${c}`);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => applyStyle({ stroke: c }));
    sw.appendChild(b);
  }
  const stamp = $<HTMLSelectElement>('st-stamp');
  STAMPS.forEach((s, i) => stamp.add(new Option(s.text, String(i))));
  stamp.addEventListener('change', () => {
    S.stamp = STAMPS[+stamp.value];
    setTool('stamp');
  });
}

function setTool(t: Tool): void {
  if (S.editingId) commitText();
  S.tool = t;
  if (t !== 'symbol') S.armed = null;
  if (t !== 'select') S.selection = [];
  document.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  ink.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  hoverPort = null;
  syncSymbolSel();
  syncProps();
  redraw();
  say(t === 'symbol' ? 'Click the page to place the symbol.' : '');
}

/**
 * Apply a style change to the defaults and the selection. Slider/colour-picker drags fire many `input`
 * events; `continuous` folds one whole gesture into a single undo step.
 */
let styleGesture = false;
function applyStyle(patch: Partial<StyleProps>, continuous = false): void {
  Object.assign(S.style, patch);
  const sel = selectedEls();
  if (sel.length && S.tool === 'select') {
    const change = () => sel.forEach((e) => Object.assign(e.style, patch));
    if (continuous) {
      if (!styleGesture) {
        hist().push(cloneElements(page().elements));
        styleGesture = true;
      }
      change();
      afterChange();
    } else {
      styleGesture = false;
      mutate(change);
    }
  }
  syncStyleControls();
}

function syncStyleControls(): void {
  $<HTMLInputElement>('st-stroke').value = S.style.stroke;
  $<HTMLInputElement>('st-fill').value = S.style.fill;
  $<HTMLSelectElement>('st-fillstyle').value = S.style.fillStyle;
  $<HTMLInputElement>('st-width').value = String(S.style.width);
  $<HTMLInputElement>('st-rough').value = String(S.style.roughness);
  document.querySelectorAll<HTMLElement>('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.title === S.style.stroke)));
}

$<HTMLInputElement>('st-stroke').addEventListener('input', (e) => applyStyle({ stroke: (e.target as HTMLInputElement).value }, true));
$<HTMLInputElement>('st-fill').addEventListener('input', (e) => applyStyle({ fill: (e.target as HTMLInputElement).value }, true));
$<HTMLSelectElement>('st-fillstyle').addEventListener('change', (e) => applyStyle({ fillStyle: (e.target as HTMLSelectElement).value as FillStyle }));
$<HTMLInputElement>('st-width').addEventListener('input', (e) => applyStyle({ width: +(e.target as HTMLInputElement).value }, true));
$<HTMLInputElement>('st-rough').addEventListener('input', (e) => applyStyle({ roughness: +(e.target as HTMLInputElement).value }, true));
for (const id of ['st-stroke', 'st-fill', 'st-width', 'st-rough']) $(id).addEventListener('change', () => (styleGesture = false));
$<HTMLSelectElement>('st-route').addEventListener('change', (e) => {
  S.route = (e.target as HTMLSelectElement).value as 'straight' | 'elbow';
  const lines = selectedEls().filter((x): x is LineEl => x.type === 'line' || x.type === 'arrow');
  if (lines.length) mutate(() => lines.forEach((l) => (l.route = S.route)));
});
$<HTMLInputElement>('st-snap').addEventListener('change', (e) => (S.snap = (e.target as HTMLInputElement).checked));

// ------------------------------------------------------- symbol palette
const thumbCache = new Map<string, string>();
function thumb(id: string): string {
  let svg = thumbCache.get(id);
  if (!svg) {
    const el: SymbolEl = { id: 't', seed: 5, style: { ...DEFAULT_STYLE, width: 2.2, roughness: 0.8 }, type: 'symbol', symbol: id, x: 4, y: 4, size: 52, rot: 0 };
    const body = renderElement(el)
      .map((p) => {
        if (p.k === 'stroke') return `<path d="${p.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('')}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
        if (p.k === 'fill') return `<path d="${p.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('')}Z" fill="${p.color}"/>`;
        return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-size="${p.size.toFixed(1)}" text-anchor="middle" fill="${p.color}" font-family="Caveat, cursive">${p.text}</text>`;
      })
      .join('');
    svg = `<svg viewBox="0 0 60 60" aria-hidden="true">${body}</svg>`;
    thumbCache.set(id, svg);
  }
  return svg;
}

function buildPalette(): void {
  const chips = $('sym-chips');
  const mk = (label: string, d: Domain | null) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.dataset.domain = d ?? 'all';
    b.setAttribute('aria-pressed', String(S.symDomain === d));
    b.addEventListener('click', () => {
      S.symDomain = d;
      chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String((c as HTMLElement).dataset.domain === (d ?? 'all'))));
      renderPalette();
    });
    chips.appendChild(b);
  };
  mk('All', null);
  DOMAINS.forEach((d) => mk(d.label, d.id));
  $<HTMLInputElement>('sym-search').addEventListener('input', (e) => {
    S.symQuery = (e.target as HTMLInputElement).value;
    renderPalette();
  });
  renderPalette();
}

function renderPalette(): void {
  const grid = $('sym-grid');
  grid.innerHTML = '';
  const list = searchSymbols(S.symQuery, S.symDomain ?? undefined);
  if (!list.length) grid.innerHTML = '<p class="hint">No symbols match.</p>';
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'sym';
    b.dataset.symbol = s.id;
    b.title = `${s.label} (${s.domain})`;
    b.setAttribute('aria-pressed', String(S.armed === s.id));
    b.innerHTML = `${thumb(s.id)}<span>${s.label}</span>`;
    b.addEventListener('click', () => {
      S.armed = s.id;
      S.armedRot = 0;
      setTool('symbol');
    });
    grid.appendChild(b);
  }
}

function syncSymbolSel(): void {
  document.querySelectorAll<HTMLElement>('.sym').forEach((b) => b.setAttribute('aria-pressed', String(S.armed === b.dataset.symbol && S.tool === 'symbol')));
}

// --------------------------------------------------------- properties
function syncProps(): void {
  const box = $('props');
  const body = $('props-body');
  const sel = selectedEls();
  box.hidden = sel.length === 0 || S.tool !== 'select';
  if (box.hidden) return;
  body.innerHTML = '';
  const row = (label: string, input: HTMLElement) => {
    const r = document.createElement('div');
    r.className = 'row';
    const l = document.createElement('span');
    l.textContent = label;
    r.append(l, input);
    body.appendChild(r);
  };
  if (sel.length === 1) {
    const e = sel[0];
    if (e.type === 'symbol' || e.type === 'line' || e.type === 'arrow') {
      const i = document.createElement('input');
      i.type = 'text';
      i.id = 'prop-label';
      i.placeholder = e.type === 'symbol' ? 'e.g. SW-01' : 'e.g. cable ID';
      i.value = e.label ?? '';
      i.addEventListener('change', () => mutate(() => (e.label = i.value || undefined)));
      row('Label', i);
    }
    if (e.type === 'symbol') {
      const n = document.createElement('input');
      n.type = 'number';
      n.min = '16';
      n.max = '400';
      n.value = String(Math.round(e.size));
      n.addEventListener('change', () => mutate(() => (e.size = Math.min(400, Math.max(16, +n.value || e.size)))));
      row('Size', n);
      const def = getSymbol(e.symbol);
      const info = document.createElement('span');
      info.textContent = def ? `${def.label}` : e.symbol;
      row('Symbol', info);
    }
    if (e.type === 'text' || e.type === 'stamp') {
      const t = document.createElement('input');
      t.type = 'text';
      t.value = e.text;
      t.addEventListener('change', () => mutate(() => (e.text = t.value || e.text)));
      row('Text', t);
      const n = document.createElement('input');
      n.type = 'number';
      n.min = '8';
      n.max = '200';
      n.value = String(e.size);
      n.addEventListener('change', () => mutate(() => (e.size = Math.min(200, Math.max(8, +n.value || e.size)))));
      row('Font size', n);
    }
    if (e.type === 'line' || e.type === 'arrow') {
      const s = document.createElement('select');
      s.innerHTML = '<option value="straight">Straight</option><option value="elbow">Elbow</option>';
      s.value = e.route;
      s.addEventListener('change', () => mutate(() => (e.route = s.value as 'straight' | 'elbow')));
      row('Route', s);
    }
  } else {
    const info = document.createElement('span');
    info.textContent = `${sel.length} items`;
    row('Selected', info);
  }
  const btns = document.createElement('div');
  btns.className = 'btns';
  const add = (label: string, fn: () => void, cls = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  if (sel.some((e) => e.type === 'symbol' || e.type === 'stamp')) {
    add('⟲ Rotate', () => rotateSelection(-90));
    add('⟳ Rotate', () => rotateSelection(90));
  }
  add('Duplicate', duplicateSelection);
  add('To front', () => reorder(true));
  add('To back', () => reorder(false));
  add('Delete', deleteSelection, 'danger');
  body.appendChild(btns);
}

function rotateSelection(delta: number): void {
  if (S.tool === 'symbol') {
    S.armedRot = (S.armedRot + delta + 360) % 360;
    redraw();
    return;
  }
  const sel = selectedEls().filter((e): e is SymbolEl | Extract<El, { type: 'stamp' }> => e.type === 'symbol' || e.type === 'stamp');
  if (sel.length) mutate(() => sel.forEach((e) => (e.rot = (((e.rot + delta) % 360) + 360) % 360)));
}

function deleteSelection(): void {
  if (!S.selection.length) return;
  const ids = new Set(S.selection);
  mutate(() => (page().elements = removeElements(page().elements, ids)));
  S.selection = [];
  syncProps();
}

function duplicateSelection(): void {
  const sel = selectedEls();
  if (!sel.length) return;
  const copies = cloneForPaste(sel, 18, 18, page().elements);
  mutate(() => page().elements.push(...copies));
  S.selection = copies.map((c) => c.id);
  syncProps();
}

function reorder(front: boolean): void {
  const ids = new Set(S.selection);
  mutate(() => {
    const els = page().elements;
    const sel = els.filter((e) => ids.has(e.id));
    const rest = els.filter((e) => !ids.has(e.id));
    page().elements = front ? [...rest, ...sel] : [...sel, ...rest];
  });
}

// ------------------------------------------------------------- pages
function updateButtons(): void {
  const h = hist();
  $<HTMLButtonElement>('btn-undo').disabled = !h.canUndo;
  $<HTMLButtonElement>('btn-redo').disabled = !h.canRedo;
  $('pg-label').textContent = `Page ${S.pageIdx + 1} / ${S.doc.pages.length}`;
  $<HTMLButtonElement>('pg-prev').disabled = S.pageIdx === 0;
  $<HTMLButtonElement>('pg-next').disabled = S.pageIdx >= S.doc.pages.length - 1;
  $<HTMLButtonElement>('pg-del').disabled = S.doc.pages.length <= 1;
}

function gotoPage(i: number): void {
  if (S.editingId) commitText();
  S.pageIdx = Math.max(0, Math.min(S.doc.pages.length - 1, i));
  S.selection = [];
  draft = null;
  marquee = null;
  fitWidthIfNeeded();
  syncProps();
  updateButtons();
}

function fitWidthIfNeeded(): void {
  // keep zoom if the page fits; otherwise shrink to fit
  const p = page();
  const avail = stage.clientWidth - 44;
  if (p.width * S.zoom > avail || p.width * S.zoom < avail * 0.5) fitWidth();
  else layout();
}

$('pg-prev').addEventListener('click', () => gotoPage(S.pageIdx - 1));
$('pg-next').addEventListener('click', () => gotoPage(S.pageIdx + 1));
$('pg-add').addEventListener('click', () => {
  const ref = page();
  const np = blankPage(ref.width, ref.height);
  S.doc.pages.splice(S.pageIdx + 1, 0, np);
  S.hasDoc = true;
  gotoPage(S.pageIdx + 1);
  scheduleAutosave();
});
$('pg-del').addEventListener('click', () => {
  if (S.doc.pages.length <= 1) return;
  if (page().elements.length && !confirm('Delete this page and its markup?')) return;
  S.doc.pages.splice(S.pageIdx, 1);
  gotoPage(Math.min(S.pageIdx, S.doc.pages.length - 1));
  scheduleAutosave();
});

// ---------------------------------------------------------- documents
function hasWork(): boolean {
  return S.doc.pages.some((p) => p.elements.length > 0);
}

/** Drop every piece of in-flight UI state so nothing from the old document leaks into the new one. */
function resetTransient(): void {
  commitText();
  drag = null;
  draft = null;
  marquee = null;
  hoverPort = null;
  pendingSnap = null;
  activePointer = null;
  styleGesture = false;
  S.selection = [];
  S.editingId = null;
}

/** Single path for replacing the open document (new, open PDF, open project, restore). */
function installDoc(doc: Doc, pdf: PdfSource | null): void {
  resetTransient();
  if (S.pdf && S.pdf !== pdf) S.pdf.destroy();
  S.pdf = pdf;
  S.doc = doc;
  histories = new WeakMap();
  S.hasDoc = true;
  S.pageIdx = 0;
  fitWidth();
  syncProps();
  updateButtons();
}

async function openPdf(file: File | Blob): Promise<void> {
  try {
    if (hasWork() && !confirm('Replace the current document? Unsaved markup will be lost.')) return;
    say('Loading PDF…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const src = await PdfSource.load(bytes);
    const pages = await src.pages();
    installDoc({ pages }, src);
    say(`Opened PDF — ${pages.length} page${pages.length === 1 ? '' : 's'}. Pick a tool and mark it up.`);
    scheduleAutosave(true);
  } catch (e) {
    say(`Could not open PDF: ${(e as Error).message}`);
  }
}

function newDiagram(): void {
  if (hasWork() && !confirm('Start a new diagram? Unsaved work will be lost.')) return;
  installDoc({ pages: [blankPage()] }, null);
  setTool('select');
  say('Blank diagram ready. Pick a symbol from the palette.');
  scheduleAutosave(true);
}

/** Pages that point past the end of the loaded PDF (or have no PDF) become blank pages of the same size. */
function reconcilePages(doc: Doc, pdf: PdfSource | null): void {
  doc.pages = doc.pages.map((p) =>
    p.kind === 'pdf' && (!pdf || p.pdfIndex === undefined || p.pdfIndex >= pdf.numPages) ? { ...p, kind: 'blank' as const, pdfIndex: undefined } : p,
  );
}

async function openProject(file: File): Promise<void> {
  try {
    const { doc, pdfBytes } = parseProject(await file.text());
    if (hasWork() && !confirm('Open this project? Unsaved work in the current document will be lost.')) return;
    const pdf = pdfBytes ? await PdfSource.load(pdfBytes) : null;
    reconcilePages(doc, pdf);
    installDoc(doc, pdf);
    say('Project opened.');
    scheduleAutosave(true);
  } catch (e) {
    say(`Could not open project: ${(e as Error).message}`);
  }
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const browserCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return {
    ctx: c.getContext('2d')!,
    toPng: () => new Promise((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('PNG encoding failed'))), 'image/png')),
  };
};

async function ready(): Promise<void> {
  try {
    await document.fonts.load('500 20px Caveat');
  } catch {
    /* fallback font is fine */
  }
}

async function exportPdfFile(): Promise<void> {
  try {
    say('Building PDF…');
    await ready();
    const bytes = await exportPdf({ doc: S.doc, pdfBytes: S.pdf?.bytes, make: browserCanvas });
    download(S.pdf ? 'annotated.pdf' : 'diagram.pdf', bytes as BlobPart, 'application/pdf');
    say('Exported PDF.');
  } catch (e) {
    say(e instanceof ExportError ? e.message : `PDF export failed: ${(e as Error).message}`);
  }
}

async function exportPngFile(): Promise<void> {
  try {
    await ready();
    const p = page();
    const scale = overlayScale(p, 2);
    const c = document.createElement('canvas'); // private canvas: never shared with the on-screen render
    const ctx = c.getContext('2d')!;
    if (p.kind === 'pdf' && S.pdf && p.pdfIndex !== undefined) {
      if (!(await S.pdf.render(p.pdfIndex, c, scale))) throw new Error('page render was interrupted');
    } else {
      c.width = Math.ceil(p.width * scale);
      c.height = Math.ceil(p.height * scale);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.save();
    ctx.scale(scale, scale);
    paintCanvas(ctx, p.elements.flatMap((e) => renderElement(e, p.elements)));
    ctx.restore();
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));
    download(`page-${S.pageIdx + 1}.png`, blob, 'image/png');
    say('Exported PNG.');
  } catch (e) {
    say(`PNG export failed: ${(e as Error).message}`);
  }
}

function exportSvgFile(): void {
  download(`page-${S.pageIdx + 1}.svg`, pageToSvg(page()), 'image/svg+xml');
  say(page().kind === 'pdf' ? 'Exported SVG of the markup only (the PDF page itself is not included).' : 'Exported SVG.');
}

function saveProjectFile(): void {
  try {
    download('handsketch-project.handsketch.json', serializeProject(S.doc, S.pdf?.bytes), 'application/json');
    say('Project saved.');
  } catch (e) {
    say(`Could not save project (the PDF may be too large): ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------- autosave
const AUTOSAVE_VERSION = 2;
let saveTimer = 0;
/** The PDF bytes are large and rarely change, so they are written to their own key and only when replaced. */
let savedPdfRef: Uint8Array | null | undefined;
let autosaveOk = true;

async function flushAutosave(forcePdf = false): Promise<void> {
  window.clearTimeout(saveTimer);
  if (!S.hasDoc) return;
  const pdfBytes = S.pdf?.bytes ?? null;
  let ok = true;
  if (forcePdf || savedPdfRef !== pdfBytes) {
    ok = (await kvSet('autosave-pdf', pdfBytes)) && ok;
    if (ok) savedPdfRef = pdfBytes;
  }
  ok = (await kvSet('autosave-doc', { v: AUTOSAVE_VERSION, doc: JSON.parse(JSON.stringify(S.doc)), hasPdf: !!pdfBytes, at: Date.now() })) && ok;
  if (!ok && autosaveOk) say('Autosave failed (browser storage full or blocked). Use “Save project” to keep your work.');
  autosaveOk = ok;
}

function scheduleAutosave(forcePdf = false): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushAutosave(forcePdf), 700);
}

async function restore(): Promise<void> {
  const saved = await kvGet<{ v: number; doc: unknown; hasPdf: boolean }>('autosave-doc');
  if (!saved || saved.v !== AUTOSAVE_VERSION) return;
  try {
    validateDoc(saved.doc);
    const doc = saved.doc as Doc;
    let pdf: PdfSource | null = null;
    if (saved.hasPdf) {
      const bytes = await kvGet<Uint8Array>('autosave-pdf');
      if (bytes) pdf = await PdfSource.load(bytes);
    }
    if (S.hasDoc) {
      pdf?.destroy(); // the user already started something; don't clobber it
      return;
    }
    reconcilePages(doc, pdf);
    installDoc(doc, pdf);
    savedPdfRef = pdf?.bytes ?? null;
    say('Restored your last session.');
  } catch {
    await kvDelete('autosave-doc');
    await kvDelete('autosave-pdf');
  }
}

// ------------------------------------------------------------ wiring
$('btn-open-pdf').addEventListener('click', () => $<HTMLInputElement>('file-pdf').click());
$('file-pdf').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void openPdf(f);
  (e.target as HTMLInputElement).value = '';
});
$('btn-new').addEventListener('click', newDiagram);
$('btn-open-project').addEventListener('click', () => $<HTMLInputElement>('file-project').click());
$('file-project').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void openProject(f);
  (e.target as HTMLInputElement).value = '';
});
$('btn-save').addEventListener('click', saveProjectFile);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('zoom-in').addEventListener('click', () => setZoom(S.zoom * 1.2));
$('zoom-out').addEventListener('click', () => setZoom(S.zoom / 1.2));
$('zoom-fit').addEventListener('click', fitWidth);
$('btn-help').addEventListener('click', () => $<HTMLDialogElement>('help').showModal());
const menu = $('export-menu');
$('btn-export').addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', () => (menu.hidden = true));
$('exp-pdf').addEventListener('click', () => void exportPdfFile());
$('exp-png').addEventListener('click', () => void exportPngFile());
$('exp-svg').addEventListener('click', exportSvgFile);

stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('dropping');
});
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dropping');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) void openPdf(f);
  else if (f.name.toLowerCase().endsWith('.json')) void openProject(f);
  else say('Drop a PDF or a HandSketch project file.');
});

const KEYS: Record<string, Tool> = { v: 'select', p: 'pen', m: 'marker', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', c: 'cloud', h: 'highlight', t: 'text', s: 'stamp' };
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, dialog')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === ' ') {
    if (t.closest('button, a, summary')) return; // let Space activate focused controls
    spaceDown = true;
    ink.style.cursor = 'grab';
    e.preventDefault();
    return;
  }
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelection();
  } else if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    setTool('select');
    S.selection = page().elements.map((x) => x.id);
    syncProps();
    redraw();
  } else if (mod && e.key.toLowerCase() === 'c') {
    S.clipboard = cloneForPaste(selectedEls(), 0, 0, page().elements);
  } else if (mod && e.key.toLowerCase() === 'v') {
    if (!S.clipboard.length) return;
    e.preventDefault();
    const copies = cloneForPaste(S.clipboard, 20, 20, S.clipboard);
    S.clipboard = cloneForPaste(copies, 0, 0, copies);
    mutate(() => page().elements.push(...copies));
    setTool('select');
    S.selection = copies.map((c) => c.id);
    syncProps();
    redraw();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (S.selection.length) {
      e.preventDefault();
      deleteSelection();
    }
  } else if (e.key === 'Escape') {
    cancelDrag();
    S.selection = [];
    if (S.tool === 'symbol') setTool('select');
    syncProps();
    redraw();
  } else if (e.key === '[' || e.key === ']') {
    rotateSelection(e.key === ']' ? 90 : -90);
  } else if (e.key.startsWith('Arrow') && S.selection.length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    mutate(() => moveElements(page().elements, new Set(S.selection), dx, dy));
  } else if (!mod && !e.altKey && KEYS[e.key.toLowerCase()]) {
    setTool(KEYS[e.key.toLowerCase()]);
  }
});
// Dropdowns keep focus after a choice, which would swallow tool shortcuts.
document.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => sel.blur()));
window.addEventListener('blur', () => {
  spaceDown = false;
  ink.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    ink.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
  }
});
window.addEventListener('resize', () => S.hasDoc && layout());
window.addEventListener('pagehide', () => void flushAutosave());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushAutosave();
});

// Test/debug hook (read-only access to state).
declare global {
  interface Window {
    __handsketch?: { state: typeof S; rasterize: () => Promise<Uint8Array> };
  }
}
window.__handsketch = { state: S, rasterize: () => rasterizePage(page(), browserCanvas, '#fff') };

buildToolbox();
buildPalette();
syncStyleControls();
setTool('select');
updateButtons();
layout();
void restore();
