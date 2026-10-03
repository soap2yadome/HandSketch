import type { Prim } from './render';
import { FONT_STACK } from './render';

export function paintCanvas(ctx: CanvasRenderingContext2D, prims: Prim[]): void {
  ctx.lineJoin = 'round';
  for (const p of prims) {
    if (p.k === 'stroke') {
      if (p.pts.length < 2) {
        if (p.pts.length === 1) {
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.pts[0].x, p.pts[0].y, p.width / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        continue;
      }
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width;
      ctx.lineCap = p.cap ?? 'round';
      ctx.beginPath();
      ctx.moveTo(p.pts[0].x, p.pts[0].y);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
      ctx.stroke();
    } else if (p.k === 'fill') {
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.pts[0].x, p.pts[0].y);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.font = `500 ${p.size}px ${FONT_STACK}`;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.rot) ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

export function primsToSvgBody(prims: Prim[]): string {
  const parts: string[] = [];
  for (const p of prims) {
    if (p.k === 'stroke') {
      if (!p.pts.length) continue;
      const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${n(q.x)} ${n(q.y)}`).join('');
      parts.push(`<path d="${d}" fill="none" stroke="${esc(p.color)}" stroke-width="${n(p.width)}" stroke-opacity="${p.opacity}" stroke-linecap="${p.cap ?? 'round'}" stroke-linejoin="round"/>`);
    } else if (p.k === 'fill') {
      const d = p.pts.map((q, i) => `${i ? 'L' : 'M'}${n(q.x)} ${n(q.y)}`).join('') + 'Z';
      parts.push(`<path d="${d}" fill="${esc(p.color)}" fill-opacity="${p.opacity}" stroke="none"/>`);
    } else {
      const rot = p.rot ? ` transform="rotate(${n(p.rot)} ${n(p.x)} ${n(p.y)})"` : '';
      parts.push(`<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(p.size)}" font-family='${FONT_STACK.replace(/"/g, '')}' text-anchor="${p.anchor}" fill="${esc(p.color)}"${rot}>${esc(p.text)}</text>`);
    }
  }
  return parts.join('\n');
}

export function primsToSvg(prims: Prim[], width: number, height: number, background?: string): string {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${esc(background)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}\n${primsToSvgBody(prims)}\n</svg>`;
}
