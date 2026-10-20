import Phaser from 'phaser';
import type { MapDef, PlatformDef } from '../shared/mapTypes';
import { mulberry32 } from '../shared/sim/sim';
import { color as tok } from './ui/tokens';

// Draws the static world once per match: sky, parallax scenery, platforms and decorations.
// Two looks, chosen by map.theme.style: 'sunset' (synthwave canyon with floating rock islands)
// and 'neon' (rainy night city with hazard-striped steel). Colours come from the map's theme.
// Everything is drawn into Graphics objects; keep the shape count modest, phones redraw them every frame.

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;
const lerp = (a: number, b: number, t: number) => Phaser.Display.Color.Interpolate.ColorWithColor(
  Phaser.Display.Color.IntegerToColor(a), Phaser.Display.Color.IntegerToColor(b), 100, Math.round(t * 100),
);
const mix = (a: number, b: number, t: number) => { const c = lerp(a, b, t); return (c.r << 16) | (c.g << 8) | c.b; };

const CYAN = hex(tok.cyan);
const MAGENTA = hex(tok.magenta);
const AMBER = hex(tok.amber);
const INK = hex(tok.ink);

/** Where a layer's far content ends. Parallax layers slide up as the camera climbs, so fills run well below the screen. */
const FLOOR = 1700;

export function buildScenery(scene: Phaser.Scene, map: MapDef) {
  const neon = map.theme.style === 'neon';
  if (neon) neonSky(scene, map); else sunsetSky(scene, map);
  const g = scene.add.graphics().setDepth(1);
  for (const d of map.decor) decor(scene, d, neon);
  for (const p of map.platforms) {
    if (p.x + p.w <= 0 || p.x >= map.width || p.y + p.h <= 0) continue; // the invisible arena boundary
    if (neon) neonPlatform(g, p); else sunsetPlatform(g, p);
  }
}

// ---------- skies ----------

/** Vertical gradient in up to three stops, drawn as two stacked rectangles. */
function sky(scene: Phaser.Scene, top: number, mid: number, bottom: number) {
  const g = scene.add.graphics().setDepth(-10).setScrollFactor(0);
  g.fillGradientStyle(top, top, mid, mid, 1).fillRect(0, 0, 1280, 400);
  g.fillGradientStyle(mid, mid, bottom, bottom, 1).fillRect(0, 399, 1280, 330);
  return g;
}

function stars(scene: Phaser.Scene, count: number, rand: () => number, maxY: number) {
  const g = scene.add.graphics().setDepth(-10).setScrollFactor(0);
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.15;
    g.fillStyle(0xffffff, 0.25 + rand() * 0.6).fillCircle(rand() * 1280, rand() * maxY, big ? 1.8 : 1);
  }
}

/** A ridge line as a filled polygon. Peaks and valleys alternate; `sharp` makes pointy mountains. */
function ridge(g: Phaser.GameObjects.Graphics, rand: () => number, width: number, baseY: number, amp: number, step: number) {
  const pts: Phaser.Types.Math.Vector2Like[] = [{ x: -50, y: FLOOR }];
  let up = true;
  for (let x = -50; x < width + 120; x += step * (0.7 + rand() * 0.6)) {
    pts.push({ x, y: baseY - (up ? amp * (0.5 + rand() * 0.5) : amp * rand() * 0.25) });
    up = !up;
  }
  pts.push({ x: width + 120, y: FLOOR });
  g.fillPoints(pts, true);
}

function sunsetSky(scene: Phaser.Scene, map: MapDef) {
  const t = map.theme;
  const rand = mulberry32(map.width * 31 + map.height);
  const top = hex(t.skyTop);
  const bottom = hex(t.skyBottom);
  const mid = t.skyMid ? hex(t.skyMid) : mix(top, bottom, 0.55);
  sky(scene, top, mid, bottom);
  stars(scene, 70, rand, 330);

  // the striped sun: a disc cut into slices, with gaps growing toward the bottom
  const sun = scene.add.graphics().setDepth(-10).setScrollFactor(0);
  const cx = 930, cy = 470, r = 190;
  const sunTop = hex(t.sun);
  const sunBottom = MAGENTA;
  sun.fillStyle(sunTop, 0.07).fillCircle(cx, cy, r * 1.25);
  // thin slices keep the outline round; below the middle, bands get thinner and the gaps wider
  const edge = (yy: number) => Math.sqrt(Math.max(0, r * r - (yy - cy) * (yy - cy)));
  /** A horizontal band of the disc whose left and right sides follow the circle exactly (sampled every 2px). */
  const band = (y0: number, y1: number, col: number) => {
    const left: Phaser.Types.Math.Vector2Like[] = [];
    const right: Phaser.Types.Math.Vector2Like[] = [];
    for (let yy = y0; ; yy = Math.min(y1, yy + 2)) {
      left.push({ x: cx - edge(yy), y: yy });
      right.unshift({ x: cx + edge(yy), y: yy });
      if (yy >= y1) break;
    }
    sun.fillStyle(col, 1).fillPoints([...left, ...right], true);
  };
  let y = cy - r;
  let n = 0;
  while (y < cy + r) {
    const lower = y > cy - r * 0.05;
    const h = lower ? Math.max(5, 20 - n * 2.2) : 10;
    const yc = Math.min(cy + r, y + h);
    band(y, yc, mix(sunTop, sunBottom, ((y + yc) / 2 - (cy - r)) / (2 * r)));
    y = yc + (lower ? 3 + n * 1.6 : 0);
    if (lower) n++;
  }

  // three mountain layers, each darker and closer, each sliding at its own speed
  const layers: [number, number, number, number, number][] = [
    // scrollFactor, baseY, amplitude, step, colour
    [0.1, 560, 230, 190, mix(hex(t.far), top, 0.35)],
    [0.22, 640, 190, 150, hex(t.far)],
    [0.4, 740, 170, 120, hex(t.near)],
  ];
  layers.forEach(([f, baseY, amp, step, col], i) => {
    const g = scene.add.graphics().setDepth(-9 + i * 0.1).setScrollFactor(f);
    g.fillStyle(col);
    ridge(g, rand, map.width * f + 1400, baseY, amp, step);
  });
  // drifting haze bands, drawn once
  const haze = scene.add.graphics().setDepth(-8).setScrollFactor(0.15);
  for (let i = 0; i < 6; i++) haze.fillStyle(0xffffff, 0.05).fillEllipse(i * 700 + 200, 180 + (i % 3) * 70, 520, 26);
}

function neonSky(scene: Phaser.Scene, map: MapDef) {
  const t = map.theme;
  const rand = mulberry32(map.width * 17 + 5);
  const top = hex(t.skyTop);
  const bottom = hex(t.skyBottom);
  sky(scene, top, mix(top, bottom, 0.6), bottom);
  stars(scene, 40, rand, 260);

  // moon with a soft halo and two craters
  const moon = scene.add.graphics().setDepth(-10).setScrollFactor(0);
  const m = hex(t.sun);
  moon.fillStyle(m, 0.07).fillCircle(1090, 170, 120).fillStyle(m, 0.12).fillCircle(1090, 170, 90).fillStyle(m, 1).fillCircle(1090, 170, 62);
  moon.fillStyle(0xcfc9ee, 0.7).fillCircle(1070, 160, 11).fillCircle(1108, 192, 8);

  // skyline in three depths: dim and far, then brighter with lit windows
  const depths: [number, number, number, number, number][] = [
    // scrollFactor, ground y, max height, window density, body colour
    [0.1, 700, 330, 0.12, mix(hex(t.far), top, 0.5)],
    [0.22, 760, 300, 0.22, hex(t.far)],
    [0.4, 840, 260, 0.3, hex(t.near)],
  ];
  const windowColors = [0xffd86b, CYAN, MAGENTA, 0xffffff];
  depths.forEach(([f, ground, maxH, density, body], layer) => {
    const g = scene.add.graphics().setDepth(-9 + layer * 0.1).setScrollFactor(f);
    const span = map.width * f + 1400;
    for (let x = -40; x < span; ) {
      const w = 70 + rand() * 90;
      const h = 90 + rand() * maxH;
      g.fillStyle(body).fillRect(x, ground - h, w, FLOOR);
      if (rand() < 0.35) g.fillStyle(body).fillRect(x + w * 0.35, ground - h - 22, w * 0.3, 22); // roof box
      if (rand() < 0.3) g.lineStyle(2, CYAN, 0.55).lineBetween(x + 6, ground - h + 4, x + w - 6, ground - h + 4); // neon roof trim
      // lit windows on a grid; the density sets how many are on
      for (let wy = ground - h + 16; wy < ground - 8; wy += 22) {
        for (let wx = x + 9; wx < x + w - 10; wx += 17) {
          if (rand() > density) continue;
          g.fillStyle(windowColors[Math.floor(rand() * windowColors.length)], 0.5 + rand() * 0.45).fillRect(wx, wy, 8, 11);
        }
      }
      x += w + 6 + rand() * 18;
    }
  });
  // rain: faint diagonal streaks across the whole sky
  const rain = scene.add.graphics().setDepth(-7).setScrollFactor(0);
  rain.lineStyle(1, 0xaab8ff, 0.22);
  for (let i = 0; i < 90; i++) {
    const x = rand() * 1380;
    const y = rand() * 720;
    rain.lineBetween(x, y, x - 8, y + 26);
  }
}

// ---------- platforms ----------

const isBlock = (p: PlatformDef) => p.h >= 40;

function sunsetPlatform(g: Phaser.GameObjects.Graphics, p: PlatformDef) {
  const { x, y, w, h } = p;
  const rock = p.kind === 'sand' ? 0x6a3a82 : 0x4b2c8a;
  if (p.kind === 'bridge') { // a lit walkway: dark plank, bright rail
    g.fillStyle(0x2a1458).fillRect(x, y, w, h).fillStyle(AMBER, 0.9).fillRect(x, y, w, 3);
    for (let px = x + 14; px < x + w; px += 34) g.fillStyle(0x1b0d3d).fillRect(px, y + 3, 3, h - 3);
    return;
  }
  if (isBlock(p)) { // cliff or ground: a solid rock mass
    g.fillGradientStyle(rock, rock, 0x1f0f48, 0x1f0f48, 1).fillRect(x, y, w, h);
    g.fillStyle(mix(rock, MAGENTA, 0.25), 0.5).fillRect(x, y, Math.min(14, w), h); // rim light on the left face
    edge(g, x, y, w);
    return;
  }
  // floating island: a slab on top of an upside-down rock
  const depth = Math.min(90, Math.max(34, w * 0.28));
  const top = y + h;
  g.fillStyle(0x2d1766).fillPoints([{ x: x + 6, y: top }, { x: x + w - 6, y: top }, { x: x + w * 0.62, y: top + depth }, { x: x + w * 0.4, y: top + depth * 0.82 }], true);
  g.fillStyle(0x3a1f7d).fillPoints([{ x: x + 6, y: top }, { x: x + w * 0.5, y: top }, { x: x + w * 0.42, y: top + depth * 0.8 }], true);
  g.fillGradientStyle(0x6b45c4, 0x6b45c4, rock, rock, 1).fillRect(x, y, w, h);
  g.fillStyle(0x1b0d3d, 0.55).fillRect(x, y + h - 3, w, 3);
  edge(g, x, y, w);
}

/** Cyan dashed light strip along a top edge. */
function edge(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number) {
  g.fillStyle(CYAN, 0.28).fillRect(x, y, w, 4);
  g.fillStyle(CYAN, 1);
  for (let dx = 10; dx < w - 14; dx += 30) g.fillRect(x + dx, y + 1, 16, 3);
}

function neonPlatform(g: Phaser.GameObjects.Graphics, p: PlatformDef) {
  const { x, y, w, h } = p;
  const steel = 0x2a2f5c;
  if (isBlock(p)) { // ground slabs and pillars: dark steel with a hazard cap
    g.fillGradientStyle(0x353b72, 0x353b72, 0x14173a, 0x14173a, 1).fillRect(x, y, w, h);
    if (w > h) hazard(g, x, y, w, Math.min(h, 14));
    else g.fillStyle(MAGENTA, 0.5).fillRect(x + w - 3, y, 3, h); // pillar: glow down one edge
    g.fillStyle(MAGENTA, 0.9).fillRect(x, y + Math.min(h, 14), w, 3);
    return;
  }
  // girders under a floating deck, so it reads as scaffolding rather than a floating plank
  const leg = Math.min(46, w * 0.18);
  g.lineStyle(3, 0x4a508f, 0.9);
  g.lineBetween(x + 12, y + h, x + 12 + leg, y + h + 34).lineBetween(x + 12 + leg, y + h, x + 12, y + h + 34);
  g.lineBetween(x + w - 12, y + h, x + w - 12 - leg, y + h + 34).lineBetween(x + w - 12 - leg, y + h, x + w - 12, y + h + 34);
  g.fillStyle(steel).fillRect(x, y, w, h);
  hazard(g, x, y, w, 9);
  g.fillStyle(MAGENTA, 0.35).fillRect(x, y + h, w, 7); // under-glow
  g.fillStyle(MAGENTA, 1).fillRect(x, y + h - 3, w, 3);
  g.fillStyle(0x8b93d9, 0.8);
  for (let rx = x + 14; rx < x + w - 6; rx += 34) g.fillCircle(rx, y + h - 9, 1.6); // rivets
}

/** Yellow and dark diagonal warning stripes. */
function hazard(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
  g.fillStyle(0x1a1830).fillRect(x, y, w, h);
  g.fillStyle(0xffc62e);
  const s = 14;
  for (let dx = 0; dx < w; dx += s * 2) {
    const x0 = x + dx;
    const x1 = Math.min(x + w, x0 + s);
    if (x1 <= x0) break;
    g.fillPoints([{ x: x0, y: y + h }, { x: x0 + h, y }, { x: Math.min(x + w, x0 + h + s), y }, { x: x1, y: y + h }], true);
  }
}

// ---------- decoration ----------

/** Map decor kinds ('tree', 'bush', 'cactus', 'rock') are re-skinned per style. */
function decor(scene: Phaser.Scene, d: { kind: string; x: number; y: number; scale: number }, neon: boolean) {
  const g = scene.add.graphics({ x: d.x, y: d.y }).setDepth(0).setScale(d.scale);
  if (neon) {
    switch (d.kind) {
      case 'rock': // barrel
        g.fillStyle(0x3a3f78).fillRoundedRect(-13, -32, 26, 32, 4).fillStyle(MAGENTA).fillRect(-13, -22, 26, 3).fillRect(-13, -10, 26, 3);
        break;
      default: // lamp post with a cyan glow
        g.fillStyle(0x4a508f).fillRect(-2, -110, 4, 110).fillRect(-2, -110, 22, 4).fillStyle(CYAN, 0.25).fillCircle(20, -102, 18).fillStyle(CYAN).fillCircle(20, -102, 5);
    }
    return;
  }
  const crystal = (cx: number, h: number, w: number, col: number) =>
    g.fillStyle(col).fillTriangle(cx - w, 0, cx + w, 0, cx, -h).fillStyle(0xffffff, 0.25).fillTriangle(cx - w, 0, cx, 0, cx, -h);
  switch (d.kind) {
    case 'rock':
      g.fillStyle(0x3a2272).fillEllipse(0, -12, 46, 24).fillStyle(0x5b3aa0).fillEllipse(-5, -16, 20, 10);
      break;
    case 'cactus': // tall magenta crystal cluster
      crystal(0, 70, 10, MAGENTA); crystal(-16, 42, 8, mix(MAGENTA, 0xffffff, 0.2)); crystal(15, 50, 8, MAGENTA);
      break;
    default: // teal crystals
      crystal(0, 48, 8, CYAN); crystal(-13, 30, 6, mix(CYAN, INK, 0.3)); crystal(12, 34, 6, CYAN);
  }
}
