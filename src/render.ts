import Phaser from 'phaser';
import type { MapDef } from '../shared/mapTypes';
import { MAX_FUEL, MAX_HP } from '../shared/sim/sim';
import { CharacterLayer } from './rig/soldier';
import { buildScenery } from './scenery';
import type { BulletState, FighterState, GrenadeState } from '../shared/sim/sim';

// Everything that turns game state into pixels. Used by both the offline and online scenes.

export const shade = (c: number, f: number) => {
  const r = Math.min(255, Math.floor(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.floor(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.floor((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

// ---------- static world ----------

export function buildWorld(scene: Phaser.Scene, map: MapDef) {
  scene.cameras.main.setBounds(0, -40, map.width, map.height + 40);
  buildScenery(scene, map);
}

// ---------- effects ----------

interface Particle { x: number; y: number; vx: number; vy: number; color: number; life: number }
interface Ring { x: number; y: number; maxR: number; t: number }
interface Smoke { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }

export class Fx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private smokes: Smoke[] = [];

  /** A short-lived puff that drifts up and spreads out. Used for jetpack exhaust. */
  smoke(x: number, y: number) {
    if (this.smokes.length > 120) return; // hard cap keeps long matches cheap
    this.smokes.push({ x, y, vx: (Math.random() - 0.5) * 14, vy: 6 + Math.random() * 10, r: 2.5, life: 0.55, max: 0.55 });
  }

  spark(x: number, y: number, color: number) {
    for (let n = 0; n < 4; n++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 60;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: 0.25 });
    }
  }

  ring(x: number, y: number, maxR: number) {
    this.rings.push({ x, y, maxR, t: 0 });
  }

  update(dt: number) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.t += dt / 0.3;
    this.rings = this.rings.filter((r) => r.t < 1);
    for (const m of this.smokes) { m.x += m.vx * dt; m.y += m.vy * dt; m.r += dt * 9; m.life -= dt; }
    this.smokes = this.smokes.filter((m) => m.life > 0);
  }

  draw(g: Phaser.GameObjects.Graphics) {
    for (const m of this.smokes) g.fillStyle(0xaeb4bc, 0.32 * (m.life / m.max)).fillCircle(m.x, m.y, m.r);
    for (const p of this.particles) g.fillStyle(p.color, Math.max(0, p.life / 0.25)).fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    for (const r of this.rings) {
      const rad = 10 + (r.maxR - 10) * r.t;
      g.fillStyle(0xffaa33, 1 - r.t).fillCircle(r.x, r.y, rad);
      g.fillStyle(0xffe066, 1 - r.t).fillCircle(r.x, r.y, rad * 0.55);
    }
  }
}

// ---------- per-frame drawing ----------

export interface FrameView {
  time: number;
  fighters: FighterState[];
  bullets: BulletState[];
  grenades: GrenadeState[];
  crates: { x: number; y: number; active: boolean }[];
  localId: number;
}

/** Draws everything that moves: soldiers (rigs), pickups, projectiles, effects, bars and the crosshair. */
export class Renderer {
  readonly fx: Fx;
  private under: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private chars: CharacterLayer;
  private smokeClock = new Map<number, number>();

  constructor(scene: Phaser.Scene, fx: Fx = new Fx()) {
    this.fx = fx;
    this.under = scene.add.graphics().setDepth(9);
    this.over = scene.add.graphics().setDepth(14);
    this.chars = new CharacterLayer(scene);
  }

  frame(v: FrameView, crosshair: { x: number; y: number } | null, dt: number) {
    this.chars.sync(v.fighters, v.localId, v.time, dt);
    for (const f of v.fighters) {
      if (!f.thrusting || f.dead) continue;
      const t = (this.smokeClock.get(f.id) ?? 0) - dt;
      if (t > 0) { this.smokeClock.set(f.id, t); continue; }
      this.smokeClock.set(f.id, 0.045);
      for (const p of this.chars.rig(f.id)?.nozzleWorld(f) ?? []) this.fx.smoke(p.x, p.y + 6);
    }
    drawWorldObjects(this.under, this.over, v, this.fx, crosshair);
  }
}

function drawWorldObjects(under: Phaser.GameObjects.Graphics, g: Phaser.GameObjects.Graphics, v: FrameView, fx: Fx, crosshair: { x: number; y: number } | null) {
  under.clear();
  g.clear();
  for (const c of v.crates) {
    if (!c.active) continue;
    const y = c.y + Math.sin(v.time * 4.5 + c.x) * 3;
    // a glowing supply case: dark body, amber rim, carry handle
    under.fillStyle(0xffb02e, 0.14).fillCircle(c.x, y, 30).fillStyle(0xffb02e, 0.12).fillCircle(c.x, y, 21);
    under.fillStyle(0x24184a).fillRoundedRect(c.x - 14, y - 11, 28, 22, 4);
    under.lineStyle(2.5, 0xffb02e).strokeRoundedRect(c.x - 14, y - 11, 28, 22, 4);
    under.lineStyle(2.5, 0xffb02e).lineBetween(c.x - 6, y - 3, c.x + 6, y - 3).lineBetween(c.x, y - 3, c.x, y + 7);
  }

  for (const gr of v.grenades) {
    g.fillStyle(0x2e4a2e).fillCircle(gr.x, gr.y, 6);
    if (Math.floor((v.time - gr.born) * 6) % 2 === 0) g.fillStyle(0xff3333).fillCircle(gr.x, gr.y - 3, 2);
  }
  for (const b of v.bullets) {
    if (b.boom > 0) {
      g.lineStyle(10, 0xff6633, 0.25).lineBetween(b.x - b.vx * 0.03, b.y - b.vy * 0.03, b.x, b.y);
      g.lineStyle(5, 0xff9a4a).lineBetween(b.x - b.vx * 0.027, b.y - b.vy * 0.027, b.x, b.y);
      g.fillStyle(0xffffff).fillCircle(b.x, b.y, 3.5);
    } else { // tracer: soft cyan glow around a white core
      const tx = b.x - b.vx * 0.014;
      const ty = b.y - b.vy * 0.014;
      g.lineStyle(7, 0x2de2e6, 0.28).lineBetween(tx, ty, b.x, b.y);
      g.lineStyle(2.5, 0xffffff).lineBetween(tx, ty, b.x, b.y);
    }
  }
  fx.draw(g);
  for (const f of v.fighters) {
    if (f.dead) continue;
    const x = f.x - 20;
    const y = f.y - 40;
    g.fillStyle(0x000000, 0.6).fillRect(x, y, 40, 5);
    g.fillStyle(f.hp > 35 ? 0x22c55e : 0xef4444).fillRect(x, y, (40 * Math.max(0, f.hp)) / MAX_HP, 5);
    if (f.id === v.localId) g.fillStyle(0xf59e0b).fillRect(x, y + 7, (40 * f.fuel) / MAX_FUEL, 3);
  }
  if (crosshair) {
    g.lineStyle(2, 0xffffff, 0.9).strokeCircle(crosshair.x, crosshair.y, 9).lineBetween(crosshair.x - 14, crosshair.y, crosshair.x + 14, crosshair.y).lineBetween(crosshair.x, crosshair.y - 14, crosshair.x, crosshair.y + 14);
  }
}
