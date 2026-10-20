import type { MapDef } from '../../shared/mapTypes';
import { el } from './dom';
import { color } from './tokens';

export interface MapDot {
  id: number;
  x: number;
  y: number;
  dead: boolean;
}

const REDRAW_MS = 66; // ~15 times a second: smooth enough for dots, cheap on low-end phones

/** A small overview of the whole map: platforms as lines, you in cyan, everyone else in magenta. */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private next = 0;

  constructor(parent: HTMLElement, private map: MapDef) {
    const box = el('div', 'ui-panel hud-minimap', parent);
    box.style.aspectRatio = `${map.width} / ${map.height}`;
    this.canvas = el('canvas', '', box);
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(dots: readonly MapDot[], youId: number) {
    const now = performance.now();
    if (now < this.next) return;
    this.next = now + REDRAW_MS;

    // match the backing store to the real pixel size, so lines stay sharp on high-density screens
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }

    const c = this.ctx;
    const pad = 4 * dpr;
    const s = Math.min((w - pad * 2) / this.map.width, (h - pad * 2) / this.map.height);
    const ox = (w - this.map.width * s) / 2;
    const oy = (h - this.map.height * s) / 2;
    c.clearRect(0, 0, w, h);

    c.fillStyle = color.textDim;
    c.globalAlpha = 0.7;
    for (const p of this.map.platforms) {
      const x0 = Math.max(0, p.x);
      const x1 = Math.min(this.map.width, p.x + p.w);
      if (x1 <= x0 || p.h > p.w * 2) continue; // skip the invisible side walls
      c.fillRect(ox + x0 * s, oy + p.y * s, (x1 - x0) * s, Math.max(1.5 * dpr, Math.min(p.h * s, 3 * dpr)));
    }
    c.globalAlpha = 1;

    const r = 2.6 * dpr;
    let you: MapDot | undefined;
    for (const d of dots) {
      if (d.dead) continue;
      if (d.id === youId) { you = d; continue; }
      this.dot(ox + d.x * s, oy + d.y * s, r, color.magenta);
    }
    if (you) this.dot(ox + you.x * s, oy + you.y * s, r * 1.3, color.cyan); // drawn last so it is never hidden
  }

  private dot(x: number, y: number, r: number, fill: string) {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
  }
}
