import { describe, expect, it } from 'vitest';
import { MAPS } from './index';
import type { MapDef } from '../mapTypes';

const HALF_W = 9;
const HALF_H = 22;

const overlaps = (m: MapDef, cx: number, cy: number, hw: number, hh: number) =>
  m.platforms.some((p) => cx + hw > p.x && cx - hw < p.x + p.w && cy + hh > p.y && cy - hh < p.y + p.h);

describe.each(MAPS.map((m) => [m.id, m] as const))('map %s', (_id, m) => {
  it('has the three required maps', () => {
    expect(MAPS.map((x) => x.id).sort()).toEqual(['canyon-base', 'industrial-zone', 'training-arena']);
  });

  it('has enough spawns and pickups', () => {
    expect(m.spawns.length).toBeGreaterThanOrEqual(8);
    expect(m.pickups.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps every spawn inside the world, free of geometry, and standing on something', () => {
    for (const s of m.spawns) {
      expect(s.x, `spawn ${s.x},${s.y} x`).toBeGreaterThan(0);
      expect(s.x, `spawn ${s.x},${s.y} x`).toBeLessThan(m.width);
      expect(s.y, `spawn ${s.x},${s.y} y`).toBeLessThan(m.height);
      expect(overlaps(m, s.x, s.y, HALF_W, HALF_H), `spawn ${s.x},${s.y} is inside geometry`).toBe(false);
      // a solid surface within 6px below the feet
      expect(overlaps(m, s.x, s.y + 6, HALF_W - 1, HALF_H), `spawn ${s.x},${s.y} is floating`).toBe(true);
    }
  });

  it('keeps pickups inside the world and out of geometry', () => {
    for (const p of m.pickups) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(m.width);
      expect(overlaps(m, p.x, p.y, 14, 11), `pickup ${p.x},${p.y} is inside geometry`).toBe(false);
    }
  });

  it('keeps pickups away from spawn points', () => {
    for (const p of m.pickups) {
      const close = m.spawns.some((s) => Math.abs(s.x - p.x) < 50 && Math.abs(s.y - p.y) < 40);
      expect(close, `pickup ${p.x},${p.y} sits on a spawn`).toBe(false);
    }
  });

  it('has a floor, side walls and a ceiling', () => {
    expect(m.platforms.some((p) => p.y >= m.height - 50 && p.w >= m.width)).toBe(true);
    expect(m.platforms.some((p) => p.x <= -40 + 1 && p.h >= m.height)).toBe(true);
    expect(m.platforms.some((p) => p.x >= m.width && p.h >= m.height)).toBe(true);
    expect(m.platforms.some((p) => p.y <= -40 + 1 && p.w >= m.width)).toBe(true);
  });
});
