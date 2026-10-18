// Wire format. Snapshots dominate traffic, so fighters/bullets/grenades/crates travel as positional
// arrays instead of keyed objects (the repeated field names were about half the bytes). Everything
// above this layer keeps using the readable objects: encode on the way out, decode on the way in.

import type { BulletState, FighterState, GrenadeState } from '../sim/sim';
import type { ServerMsg } from './protocol';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

/** Order matters: it is the wire layout. A test asserts this list covers every FighterState field. */
export const FIGHTER_KEYS = [
  'id', 'name', 'isBot', 'color', 'x', 'y', 'vx', 'vy', 'hp', 'fuel', 'weapon', 'ammo', 'altWeapon', 'altAmmo', 'grenades',
  'nextFire', 'reloadUntil', 'nextGrenade', 'kills', 'deaths', 'dead', 'aim', 'respawnAt', 'onGround', 'blockedL', 'blockedR',
  'thrusting', 'lastShot', 'nextBotThink',
] as const satisfies readonly (keyof FighterState)[];

const BOOL_KEYS = new Set<string>(['isBot', 'dead', 'onGround', 'blockedL', 'blockedR', 'thrusting']);

export function encodeFighter(f: FighterState): unknown[] {
  return FIGHTER_KEYS.map((k) => (BOOL_KEYS.has(k) ? (f[k] ? 1 : 0) : f[k]));
}

export function decodeFighter(a: unknown[]): FighterState {
  const o: Record<string, unknown> = {};
  FIGHTER_KEYS.forEach((k, i) => { o[k] = BOOL_KEYS.has(k) ? a[i] === 1 : a[i]; });
  return o as unknown as FighterState;
}

/** The wire shape of a snapshot. Short keys on purpose. */
interface WireSnap {
  t: 'snap';
  tick: number;
  time: number;
  ack: number;
  over: boolean;
  winner: number | null;
  f: unknown[][]; // fighters
  b: number[][]; // bullets: id,x,y,vx,vy,owner,dmg,boom,born
  g: number[][]; // grenades: id,x,y,vx,vy,owner,born
  c: [number, number, string][]; // crates: id,active,weapon
  events: Snap['events'];
}

export function encodeSnap(m: Snap): WireSnap {
  return {
    t: 'snap', tick: m.tick, time: m.time, ack: m.ack, over: m.over, winner: m.winner,
    f: m.fighters.map(encodeFighter),
    b: m.bullets.map((b) => [b.id, b.x, b.y, b.vx, b.vy, b.owner, b.dmg, b.boom, b.born]),
    g: m.grenades.map((g) => [g.id, g.x, g.y, g.vx, g.vy, g.owner, g.born]),
    c: m.crates.map((c) => [c.id, c.active ? 1 : 0, c.weapon]),
    events: m.events,
  };
}

export function decodeSnap(w: WireSnap): Snap {
  return {
    t: 'snap', tick: w.tick, time: w.time, ack: w.ack, over: w.over, winner: w.winner,
    fighters: w.f.map(decodeFighter),
    bullets: w.b.map(([id, x, y, vx, vy, owner, dmg, boom, born]): BulletState => ({ id, x, y, vx, vy, owner, dmg, boom, born })),
    grenades: w.g.map(([id, x, y, vx, vy, owner, born]): GrenadeState => ({ id, x, y, vx, vy, owner, born })),
    crates: w.c.map(([id, active, weapon]) => ({ id, active: active === 1, weapon })),
    events: w.events,
  };
}

/**
 * JSON for the wire. Non-integers are rounded to 3 decimals (0.001 px): floating-point noise such as
 * 920.0000000000002 costs bytes and carries no meaning. The simulation itself keeps full precision.
 */
export function wireStringify(msg: ServerMsg | Record<string, unknown>): string {
  const body = (msg as ServerMsg).t === 'snap' ? encodeSnap(msg as Snap) : msg;
  return JSON.stringify(body, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
}

/** Parse a server message, decoding snapshots. Returns null for anything malformed. */
export function parseWire(text: string): ServerMsg | null {
  try {
    const m = JSON.parse(text);
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
    if (m.t === 'snap') {
      if (!Array.isArray(m.f) || !Array.isArray(m.b) || !Array.isArray(m.g) || !Array.isArray(m.c)) return null;
      return decodeSnap(m as WireSnap);
    }
    return m as ServerMsg;
  } catch {
    return null;
  }
}
