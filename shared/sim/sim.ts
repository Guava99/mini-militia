// Deterministic, renderer-free game rules. The same module runs in the browser (for prediction
// and offline play) and on the server (authoritative). No Phaser, DOM or Node APIs in here.

import type { MapDef } from '../mapTypes';
import { PICKUP_KEYS, WEAPONS } from './weapons';

export const TICK = 1 / 60;
export const HALF_W = 9;
export const HALF_H = 22;
export const MAX_HP = 100;
export const MAX_FUEL = 100;
export const GRAVITY = 900;
export const RESPAWN_S = 2.5;
export const CRATE_RESPAWN_S = 12;
export const GRENADE_FUSE_S = 2;

export interface Intent {
  left: boolean;
  right: boolean;
  thrust: boolean;
  aim: number; // radians
  fire: boolean;
  reload: boolean;
  swap: boolean;
  grenade: boolean;
}

export const emptyIntent = (): Intent => ({ left: false, right: false, thrust: false, aim: 0, fire: false, reload: false, swap: false, grenade: false });

export interface FighterState {
  id: number;
  name: string;
  isBot: boolean;
  color: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  fuel: number;
  weapon: string;
  ammo: number;
  altWeapon: string | null;
  altAmmo: number;
  grenades: number;
  nextFire: number;
  reloadUntil: number; // 0 = not reloading
  nextGrenade: number;
  kills: number;
  deaths: number;
  dead: boolean;
  aim: number;
  respawnAt: number;
  onGround: boolean;
  blockedL: boolean;
  blockedR: boolean;
  thrusting: boolean;
  lastShot: number;
  nextBotThink: number;
}

export interface BulletState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  dmg: number;
  boom: number;
  born: number;
}

export interface GrenadeState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  born: number;
}

export interface CrateState {
  id: number;
  x: number;
  y: number;
  weapon: string; // resolved weapon key
  spec: string; // map weapon spec ('random' or a key)
  active: boolean;
  respawnAt: number;
}

export type SimEvent =
  | { type: 'shoot'; id: number; heavy: boolean }
  | { type: 'explode'; x: number; y: number; radius: number }
  | { type: 'spark'; x: number; y: number; color: number }
  | { type: 'hit'; id: number }
  | { type: 'die'; id: number; by: number }
  | { type: 'reload'; id: number }
  | { type: 'pickup'; id: number; weapon: string }
  | { type: 'respawn'; id: number }
  | { type: 'gameover'; winner: number };

export interface SimSnapshot {
  time: number;
  over: boolean;
  winner: number | null;
  fighters: FighterState[];
  bullets: BulletState[];
  grenades: GrenadeState[];
  crates: CrateState[];
}

export interface SimOptions {
  killLimit?: number;
  seed?: number;
}

/** Small fast seeded PRNG so a match is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Sim {
  readonly map: MapDef;
  readonly killLimit: number;
  time = 0;
  over = false;
  winner: number | null = null;
  fighters: FighterState[] = [];
  bullets: BulletState[] = [];
  grenades: GrenadeState[] = [];
  crates: CrateState[] = [];
  private events: SimEvent[] = [];
  private botIntents = new Map<number, Intent>();
  private nextId = 1;
  private rng: () => number;

  constructor(map: MapDef, opts: SimOptions = {}) {
    this.map = map;
    this.killLimit = opts.killLimit ?? 15;
    this.rng = mulberry32(opts.seed ?? 1);
    for (const p of map.pickups) {
      this.crates.push({ id: this.nextId++, x: p.x, y: p.y, weapon: this.resolveWeapon(p.weapon), spec: p.weapon, active: true, respawnAt: 0 });
    }
  }

  // ---------- public API ----------

  addFighter(name: string, isBot: boolean, color: number): FighterState {
    const f: FighterState = {
      id: this.nextId++, name, isBot, color,
      x: 0, y: 0, vx: 0, vy: 0, hp: MAX_HP, fuel: MAX_FUEL,
      weapon: 'pistol', ammo: WEAPONS.pistol.mag, altWeapon: null, altAmmo: 0, grenades: 3,
      nextFire: 0, reloadUntil: 0, nextGrenade: 0, kills: 0, deaths: 0, dead: false, aim: 0, respawnAt: 0,
      onGround: false, blockedL: false, blockedR: false, thrusting: false, lastShot: -1, nextBotThink: 0,
    };
    this.placeAtSpawn(f);
    this.fighters.push(f);
    return f;
  }

  removeFighter(id: number) {
    this.fighters = this.fighters.filter((f) => f.id !== id);
    this.botIntents.delete(id);
    this.bullets = this.bullets.filter((b) => b.owner !== id);
  }

  getFighter(id: number): FighterState | undefined {
    return this.fighters.find((f) => f.id === id);
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): SimSnapshot {
    return structuredClone({
      time: this.time, over: this.over, winner: this.winner,
      fighters: this.fighters, bullets: this.bullets, grenades: this.grenades, crates: this.crates,
    });
  }

  /** Advance one fixed step. `intents` holds input for human fighters keyed by fighter id. */
  step(dt: number, intents: Record<number, Intent> = {}) {
    if (this.over) return;
    this.time += dt;
    for (const f of this.fighters) {
      if (f.dead) {
        if (this.time >= f.respawnAt) this.respawn(f);
        continue;
      }
      const bot = f.isBot;
      const intent = bot ? this.botIntent(f) : (intents[f.id] ?? emptyIntent());
      this.applyIntent(f, intent, dt);
      if (bot) { intent.grenade = false; intent.swap = false; }
      this.collide(f, dt);
      this.pickCrates(f);
    }
    this.updateBullets(dt);
    this.updateGrenades(dt);
    for (const c of this.crates) {
      if (!c.active && this.time >= c.respawnAt) {
        c.active = true;
        c.weapon = this.resolveWeapon(c.spec);
      }
    }
  }

  // ---------- helpers ----------

  private rand(min: number, max: number) { return min + this.rng() * (max - min); }
  private pick<T>(arr: T[]): T { return arr[Math.floor(this.rng() * arr.length)]; }

  private resolveWeapon(spec: string): string {
    return spec === 'random' || !WEAPONS[spec] ? this.pick(PICKUP_KEYS) : spec;
  }

  private placeAtSpawn(f: FighterState) {
    // best of three random spawns: the one farthest from any living enemy
    let best = this.map.spawns[0];
    let bestScore = -1;
    for (let i = 0; i < 3; i++) {
      const s = this.pick(this.map.spawns);
      let nearest = Infinity;
      for (const o of this.fighters) {
        if (o === f || o.dead) continue;
        nearest = Math.min(nearest, Math.hypot(o.x - s.x, o.y - s.y));
      }
      if (nearest > bestScore) { bestScore = nearest; best = s; }
    }
    f.x = best.x; f.y = best.y; f.vx = 0; f.vy = 0;
  }

  private equip(f: FighterState, key: string) {
    f.weapon = key;
    f.ammo = WEAPONS[key].mag;
    f.reloadUntil = 0;
  }

  private respawn(f: FighterState) {
    this.placeAtSpawn(f);
    f.hp = MAX_HP; f.fuel = MAX_FUEL; f.dead = false; f.altWeapon = null; f.grenades = 3;
    this.equip(f, 'pistol');
    this.events.push({ type: 'respawn', id: f.id });
  }

  // ---------- fighters ----------

  private applyIntent(f: FighterState, i: Intent, dt: number) {
    if (i.left) f.vx = -200;
    else if (i.right) f.vx = 200;
    else f.vx *= Math.pow(f.onGround ? 0.7 : 0.97, dt * 60);

    f.thrusting = i.thrust && f.fuel > 0;
    if (f.thrusting) {
      f.vy = Math.max(f.vy - 2200 * dt, -300);
      f.fuel = Math.max(0, f.fuel - 38 * dt);
    } else if (!i.thrust) { // no regen while thrust is held, so an empty tank doesn't stutter
      f.fuel = Math.min(MAX_FUEL, f.fuel + (f.onGround ? 55 : 8) * dt);
    }
    f.vy = Math.min(f.vy + GRAVITY * dt, 600);
    f.vx = Math.max(-300, Math.min(300, f.vx));
    f.aim = i.aim;

    if (f.reloadUntil > 0 && this.time >= f.reloadUntil) {
      f.ammo = WEAPONS[f.weapon].mag;
      f.reloadUntil = 0;
    }
    if (i.swap) this.swapWeapon(f);
    if (i.grenade) this.throwGrenade(f);
    if (i.reload && f.reloadUntil === 0 && f.ammo < WEAPONS[f.weapon].mag) this.startReload(f);
    if (i.fire && f.reloadUntil === 0 && this.time >= f.nextFire) {
      if (f.ammo <= 0) this.startReload(f);
      else this.shoot(f);
    }
  }

  private startReload(f: FighterState) {
    f.reloadUntil = this.time + WEAPONS[f.weapon].reloadS;
    this.events.push({ type: 'reload', id: f.id });
  }

  private swapWeapon(f: FighterState) {
    if (!f.altWeapon) return;
    const w = f.weapon; const am = f.ammo;
    f.weapon = f.altWeapon; f.ammo = f.altAmmo;
    f.altWeapon = w; f.altAmmo = am;
    f.reloadUntil = 0;
    f.nextFire = this.time + 0.25;
  }

  private throwGrenade(f: FighterState) {
    if (f.grenades <= 0 || this.time < f.nextGrenade) return;
    f.grenades--;
    f.nextGrenade = this.time + 0.6;
    this.grenades.push({
      id: this.nextId++, x: f.x, y: f.y - 4,
      vx: Math.cos(f.aim) * 480 + f.vx * 0.5, vy: Math.sin(f.aim) * 480 - 60,
      owner: f.id, born: this.time,
    });
    this.events.push({ type: 'shoot', id: f.id, heavy: false });
  }

  private overlaps(f: FighterState, p: { x: number; y: number; w: number; h: number }) {
    return f.x + HALF_W > p.x && f.x - HALF_W < p.x + p.w && f.y + HALF_H > p.y && f.y - HALF_H < p.y + p.h;
  }

  private collide(f: FighterState, dt: number) {
    f.blockedL = false; f.blockedR = false;
    f.x += f.vx * dt;
    for (const p of this.map.platforms) {
      if (!this.overlaps(f, p)) continue;
      if (f.vx > 0) { f.x = p.x - HALF_W; f.blockedR = true; }
      else if (f.vx < 0) { f.x = p.x + p.w + HALF_W; f.blockedL = true; }
    }
    f.y += f.vy * dt;
    f.onGround = false;
    for (const p of this.map.platforms) {
      if (!this.overlaps(f, p)) continue;
      if (f.vy > 0) { f.y = p.y - HALF_H; f.onGround = true; }
      else if (f.vy < 0) { f.y = p.y + p.h + HALF_H; }
      f.vy = 0;
    }
  }

  private pickCrates(f: FighterState) {
    for (const c of this.crates) {
      if (!c.active) continue;
      if (Math.abs(c.x - f.x) < HALF_W + 14 && Math.abs(c.y - f.y) < HALF_H + 11) {
        if (c.weapon === f.weapon) f.ammo = WEAPONS[f.weapon].mag;
        else {
          if (!f.altWeapon) { f.altWeapon = f.weapon; f.altAmmo = f.ammo; }
          this.equip(f, c.weapon);
        }
        f.hp = Math.min(MAX_HP, f.hp + 25);
        c.active = false;
        c.respawnAt = this.time + CRATE_RESPAWN_S;
        this.events.push({ type: 'pickup', id: f.id, weapon: c.weapon });
      }
    }
  }

  private shoot(f: FighterState) {
    const w = WEAPONS[f.weapon];
    f.nextFire = this.time + w.fireDelay;
    f.lastShot = this.time;
    f.ammo--;
    this.events.push({ type: 'shoot', id: f.id, heavy: w.pellets > 1 || w.explosive > 0 || w.key === 'sniper' });
    const muzzle = w.length + 2;
    const mx = f.x + Math.cos(f.aim) * muzzle;
    const my = f.y + 4 + Math.sin(f.aim) * muzzle;
    for (let n = 0; n < w.pellets; n++) {
      const a = f.aim + (this.rng() * 2 - 1) * w.spread;
      this.bullets.push({ id: this.nextId++, x: mx, y: my, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, owner: f.id, dmg: w.damage, boom: w.explosive, born: this.time });
    }
    if (w.key === 'sniper' || w.explosive > 0) f.vx -= Math.cos(f.aim) * 120; // recoil
  }

  // ---------- bullets & grenades ----------

  private updateBullets(dt: number) {
    this.bullets = this.bullets.filter((b) => !this.stepBullet(b, dt));
  }

  /** Returns true when the bullet is spent. */
  private stepBullet(b: BulletState, dt: number): boolean {
    if (this.time - b.born > 1.6) {
      if (b.boom > 0) this.explode(b.x, b.y, b.owner, b.dmg, b.boom);
      return true;
    }
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 8));
    const sx = (b.vx * dt) / steps;
    const sy = (b.vy * dt) / steps;
    for (let n = 0; n < steps; n++) {
      b.x += sx; b.y += sy;
      for (const p of this.map.platforms) {
        if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
          if (b.boom > 0) this.explode(b.x, b.y, b.owner, b.dmg, b.boom);
          else this.events.push({ type: 'spark', x: b.x, y: b.y, color: 0xffee88 });
          return true;
        }
      }
      for (const f of this.fighters) {
        if (f.dead || f.id === b.owner) continue;
        if (Math.abs(b.x - f.x) < HALF_W && Math.abs(b.y - f.y) < HALF_H) {
          if (b.boom > 0) this.explode(b.x, b.y, b.owner, b.dmg, b.boom);
          else {
            this.damage(f, b.dmg, b.owner);
            this.events.push({ type: 'spark', x: b.x, y: b.y, color: 0xff3333 });
          }
          return true;
        }
      }
    }
    return false;
  }

  private solidAt(x: number, y: number) {
    return this.map.platforms.some((p) => x + 4 > p.x && x - 4 < p.x + p.w && y + 4 > p.y && y - 4 < p.y + p.h);
  }

  private updateGrenades(dt: number) {
    const keep: GrenadeState[] = [];
    for (const g of this.grenades) {
      if (this.time - g.born > GRENADE_FUSE_S) {
        this.explode(g.x, g.y, g.owner, 80, 90);
        continue;
      }
      g.vy += GRAVITY * dt;
      const nx = g.x + g.vx * dt;
      if (this.solidAt(nx, g.y)) g.vx = -g.vx * 0.5; else g.x = nx;
      const ny = g.y + g.vy * dt;
      if (this.solidAt(g.x, ny)) {
        g.vy = -g.vy * 0.45;
        g.vx *= 0.8;
        if (Math.abs(g.vy) < 30) g.vy = 0;
      } else g.y = ny;
      keep.push(g);
    }
    this.grenades = keep;
  }

  private explode(x: number, y: number, owner: number, dmg: number, radius: number) {
    this.events.push({ type: 'explode', x, y, radius });
    for (const f of this.fighters) {
      if (f.dead) continue;
      const d = Math.hypot(x - f.x, y - f.y);
      if (d > radius) continue;
      this.damage(f, Math.trunc(dmg * (1 - (d / radius) * 0.7)), owner);
      const a = Math.atan2(f.y - y, f.x - x);
      f.vx = Math.cos(a) * 400;
      f.vy = Math.sin(a) * 400 - 150;
    }
  }

  private damage(target: FighterState, amount: number, byId: number) {
    if (target.dead || this.over) return;
    target.hp -= amount;
    this.events.push({ type: 'hit', id: target.id });
    if (target.hp > 0) return;
    target.dead = true;
    target.deaths++;
    const by = this.getFighter(byId);
    if (by) { if (by === target) by.kills--; else by.kills++; }
    this.events.push({ type: 'die', id: target.id, by: byId });
    this.events.push({ type: 'spark', x: target.x, y: target.y, color: target.color });
    target.respawnAt = this.time + RESPAWN_S;
    if (by && by.kills >= this.killLimit) {
      this.over = true;
      this.winner = by.id;
      this.events.push({ type: 'gameover', winner: by.id });
    }
  }

  // ---------- bots ----------

  private botIntent(f: FighterState): Intent {
    let i = this.botIntents.get(f.id);
    if (!i) { i = emptyIntent(); this.botIntents.set(f.id, i); }
    if (this.time < f.nextBotThink) return i;
    f.nextBotThink = this.time + this.rand(0.12, 0.26);
    let target: FighterState | null = null;
    let best = Infinity;
    for (const o of this.fighters) {
      if (o === f || o.dead) continue;
      const d = Math.hypot(f.x - o.x, f.y - o.y);
      if (d < best) { best = d; target = o; }
    }
    i.left = false; i.right = false; i.thrust = false; i.fire = false; i.swap = false; i.grenade = false;
    i.reload = f.ammo === 0;
    if (target) {
      const dx = target.x - f.x;
      const dy = target.y - f.y;
      if (Math.abs(dx) > 320) { i.right = dx > 0; i.left = dx < 0; }
      else if (Math.abs(dx) < 140) { i.right = dx < 0; i.left = dx > 0; }
      else if (this.rng() < 0.3) { i.right = this.rng() < 0.5; i.left = !i.right; }
      i.thrust = (dy < -40 && f.fuel > 5) || f.blockedL || f.blockedR;
      i.aim = Math.atan2(dy - 4, dx) + this.rand(-0.25, 0.25);
      i.fire = best < 750 && this.rng() < 0.5;
      i.grenade = best >= 250 && best <= 500 && this.rng() < 0.06;
    } else {
      i.aim = f.aim;
    }
    return i;
  }
}
