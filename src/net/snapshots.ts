import type { BulletState, FighterState } from '../../shared/sim/sim';
import type { Snap } from './predictor';

export const INTERP_DELAY_MS = 100; // remote players are drawn this far in the past so there is always a pair to blend

export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface Stamped {
  t: number; // local receive time, ms
  snap: Snap;
}

export class SnapshotBuffer {
  private buf: Stamped[] = [];

  push(t: number, snap: Snap) {
    this.buf.push({ t, snap });
    if (this.buf.length > 30) this.buf.shift();
  }

  clear() {
    this.buf = [];
  }

  get latest(): Snap | null {
    return this.buf.at(-1)?.snap ?? null;
  }

  get latestTime(): number {
    return this.buf.at(-1)?.t ?? 0;
  }

  /** Fighters blended between the two snapshots around `renderAt`. */
  fighters(renderAt: number): FighterState[] {
    const n = this.buf.length;
    if (n === 0) return [];
    if (n === 1 || renderAt <= this.buf[0].t) return this.buf[0].snap.fighters;
    if (renderAt >= this.buf[n - 1].t) return this.buf[n - 1].snap.fighters;
    let i = 0;
    while (i < n - 2 && this.buf[i + 1].t < renderAt) i++;
    const a = this.buf[i];
    const b = this.buf[i + 1];
    const k = (renderAt - a.t) / Math.max(1, b.t - a.t);
    const prev = new Map(a.snap.fighters.map((f) => [f.id, f]));
    return b.snap.fighters.map((f1) => {
      const f0 = prev.get(f1.id);
      if (!f0 || f0.dead || f1.dead) return f1;
      return { ...f1, x: f0.x + (f1.x - f0.x) * k, y: f0.y + (f1.y - f0.y) * k, aim: lerpAngle(f0.aim, f1.aim, k) };
    });
  }

  /** Bullets from the newest snapshot, advanced along their path for the time since it arrived. */
  bullets(now: number): BulletState[] {
    const s = this.latest;
    if (!s) return [];
    const dt = Math.max(0, Math.min(0.1, (now - this.latestTime) / 1000));
    return s.bullets.map((b) => ({ ...b, x: b.x + b.vx * dt, y: b.y + b.vy * dt }));
  }
}
