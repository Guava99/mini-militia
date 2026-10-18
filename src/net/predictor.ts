import type { MapDef } from '../../shared/mapTypes';
import type { ServerMsg } from '../../shared/net/protocol';
import { Sim, TICK } from '../../shared/sim/sim';
import type { FighterState, Intent } from '../../shared/sim/sim';

export type Snap = Extract<ServerMsg, { t: 'snap' }>;

/**
 * Client-side prediction for the local player. A private one-fighter Sim runs the same shared rules,
 * so movement and the jetpack feel instant. Each server snapshot tells us the last input it applied
 * (`ack`); we adopt the server's state and replay every input it has not seen yet.
 */
export class Predictor {
  readonly sim: Sim;
  readonly me: FighterState;
  seq = 0;
  pending: { seq: number; intent: Intent }[] = [];
  /** Visual offset that hides small corrections; decays to zero. */
  corr = { x: 0, y: 0 };

  constructor(map: MapDef, readonly youId: number, initial?: FighterState) {
    this.sim = new Sim(map);
    this.me = this.sim.addFighter('me', false, initial?.color ?? 0xffffff);
    if (initial) this.adopt(initial);
  }

  /** Record an input, apply it locally right away, and return the message to send to the server. */
  nextInput(intent: Intent): { seq: number; intent: Intent } {
    const seq = ++this.seq;
    this.pending.push({ seq, intent });
    this.apply(intent);
    return { seq, intent };
  }

  reconcile(snap: Snap) {
    const s = snap.fighters.find((f) => f.id === this.youId);
    if (!s) return;
    this.pending = this.pending.filter((p) => p.seq > snap.ack);
    const shownX = this.me.x + this.corr.x;
    const shownY = this.me.y + this.corr.y;
    this.adopt(s);
    this.sim.time = snap.time;
    snap.crates.forEach((c, i) => {
      const sc = this.sim.crates[i];
      if (!sc) return;
      sc.active = c.active;
      sc.weapon = c.weapon;
      sc.respawnAt = snap.time + 999; // the server decides when crates come back
    });
    if (!this.me.dead) for (const p of this.pending) this.apply(p.intent);
    const cx = shownX - this.me.x;
    const cy = shownY - this.me.y;
    if (Math.hypot(cx, cy) > 60) this.corr = { x: 0, y: 0 }; // too big to smooth: snap
    else this.corr = { x: cx, y: cy };
  }

  decay(dt: number) {
    const k = Math.pow(0.85, dt * 60);
    this.corr.x *= k;
    this.corr.y *= k;
  }

  private adopt(s: FighterState) {
    const id = this.me.id;
    Object.assign(this.me, structuredClone(s));
    this.me.id = id;
  }

  private apply(intent: Intent) {
    if (this.me.dead) return;
    this.sim.step(TICK, { [this.me.id]: intent });
    // bullets and grenades are drawn from server state only
    this.sim.bullets.length = 0;
    this.sim.grenades.length = 0;
    this.sim.drainEvents();
  }
}
