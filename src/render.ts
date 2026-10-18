import Phaser from 'phaser';
import type { MapDef, PlatformKind } from '../shared/mapTypes';
import { MAX_FUEL, MAX_HP } from '../shared/sim/sim';
import { CharacterLayer } from './rig/soldier';
import type { BulletState, FighterState, GrenadeState } from '../shared/sim/sim';

// Everything that turns game state into pixels. Used by both the offline and online scenes.

// [fill, stroke, cap] colours per platform material
const KIND_COLORS: Record<PlatformKind, [number, number, number]> = {
  earth: [0x7a5230, 0x3b2814, 0x4fa03a],
  stone: [0x8a8f98, 0x4b5058, 0xa8adb5],
  metal: [0x5a6572, 0x2b323a, 0x8c99a6],
  snow: [0x7fa6cc, 0x456a8f, 0xffffff],
  sand: [0xd9b26a, 0x8f6e33, 0xebcb8b],
  bridge: [0x8a5a2b, 0x4a2f14, 0xb98147],
};

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;
export const shade = (c: number, f: number) => {
  const r = Math.min(255, Math.floor(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.floor(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.floor((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

// ---------- static world ----------

export function buildWorld(scene: Phaser.Scene, map: MapDef) {
  scene.cameras.main.setBounds(0, -40, map.width, map.height + 40);
  drawBackground(scene, map);
  drawStaticWorld(scene, map);
}

function drawBackground(scene: Phaser.Scene, map: MapDef) {
  const t = map.theme;
  const sky = scene.add.graphics().setDepth(-10).setScrollFactor(0);
  sky.fillGradientStyle(hex(t.skyTop), hex(t.skyTop), hex(t.skyBottom), hex(t.skyBottom), 1).fillRect(0, 0, 1280, 720);
  sky.fillStyle(hex(t.sun), 0.35).fillCircle(1000, 130, 80).fillStyle(hex(t.sun), 1).fillCircle(1000, 130, 42);
  const far = scene.add.graphics().setDepth(-9).setScrollFactor(0.2);
  far.fillStyle(hex(t.far));
  for (let i = 0; i < 18; i++) far.fillTriangle(i * 260 - 120, 720, i * 260 + 130, 720, i * 260 + 5, 430 + (i % 4) * 40);
  const near = scene.add.graphics().setDepth(-8).setScrollFactor(0.4);
  near.fillStyle(hex(t.near));
  for (let i = 0; i < 20; i++) near.fillCircle(i * 300, 800 + (i % 3) * 30, 260);
  const clouds = scene.add.graphics().setDepth(-7).setScrollFactor(0.15);
  clouds.fillStyle(0xffffff, 0.8);
  for (let i = 0; i < 10; i++) {
    const cx = i * 420 + 100;
    const cy = 90 + (i % 3) * 60;
    clouds.fillEllipse(cx, cy, 160, 50).fillEllipse(cx + 50, cy - 15, 100, 45);
  }
}

function drawStaticWorld(scene: Phaser.Scene, map: MapDef) {
  const g = scene.add.graphics().setDepth(1);
  for (const d of map.decor) drawDecor(scene, d);
  for (const { x, y, w, h, kind } of map.platforms) {
    const [fill, stroke, cap] = KIND_COLORS[kind];
    g.fillStyle(fill).fillRect(x, y, w, h);
    g.fillStyle(cap).fillRect(x, y, w, Math.min(10, h / 2));
    g.lineStyle(3, stroke).strokeRect(x, y, w, h);
  }
}

function drawDecor(scene: Phaser.Scene, d: { kind: string; x: number; y: number; scale: number }) {
  const g = scene.add.graphics({ x: d.x, y: d.y }).setDepth(0).setScale(d.scale);
  switch (d.kind) {
    case 'tree':
      g.fillStyle(0x6b4423).fillRect(-6, -55, 12, 55).fillStyle(0x2e7d32).fillCircle(0, -78, 30).fillCircle(-22, -58, 22).fillCircle(22, -58, 22).fillStyle(0x43a047).fillCircle(-8, -86, 15);
      break;
    case 'bush':
      g.fillStyle(0x3e8e41).fillCircle(-14, -10, 13).fillCircle(8, -13, 16).fillCircle(24, -8, 11);
      break;
    case 'cactus':
      g.fillStyle(0x3f8f3f).fillRoundedRect(-7, -64, 14, 64, 7).fillRoundedRect(-24, -42, 18, 11, 5).fillRoundedRect(-24, -56, 9, 22, 5).fillRoundedRect(6, -50, 18, 11, 5).fillRoundedRect(15, -62, 9, 20, 5);
      break;
    default: // rock
      g.fillStyle(0x8d939b).fillEllipse(0, -10, 40, 20).fillStyle(0xb4bac2).fillEllipse(-4, -13, 16, 9);
  }
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
    under.fillStyle(0xc89b3c).fillRect(c.x - 14, y - 11, 28, 22);
    under.lineStyle(2, 0x5a4210).strokeRect(c.x - 14, y - 11, 28, 22).lineBetween(c.x - 14, y - 11, c.x + 14, y + 11).lineBetween(c.x + 14, y - 11, c.x - 14, y + 11);
  }

  for (const gr of v.grenades) {
    g.fillStyle(0x2e4a2e).fillCircle(gr.x, gr.y, 6);
    if (Math.floor((v.time - gr.born) * 6) % 2 === 0) g.fillStyle(0xff3333).fillCircle(gr.x, gr.y - 3, 2);
  }
  for (const b of v.bullets) {
    if (b.boom > 0) {
      g.lineStyle(6, 0xff6633).lineBetween(b.x - b.vx * 0.027, b.y - b.vy * 0.027, b.x, b.y);
      g.fillStyle(0xcccccc).fillCircle(b.x, b.y, 3);
    } else {
      g.lineStyle(3, 0xffff99).lineBetween(b.x - b.vx * 0.012, b.y - b.vy * 0.012, b.x, b.y);
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
