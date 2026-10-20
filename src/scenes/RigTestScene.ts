import Phaser from 'phaser';
import { SoldierRig } from '../rig/soldier';
import type { FighterState } from '../../shared/sim/sim';

interface Pose {
  label: string;
  color: number;
  state: Partial<FighterState>;
  animate?: (t: number, f: FighterState) => void;
}

const GROUND_Y = 300;

/** Developer-only model viewer: every soldier pose side by side, magnified. Open with ?auto=rigtest[&zoom=2.2]. */
export class RigTestScene extends Phaser.Scene {
  private rigs: { rig: SoldierRig; f: FighterState; pose: Pose }[] = [];
  private clock = 0;

  constructor() {
    super('rigtest');
  }

  create() {
    const zoom = Number(new URLSearchParams(window.location.search).get('zoom')) || 2.1;
    this.cameras.main.setBackgroundColor('#3a2078');
    const poses: Pose[] = [
      { label: 'idle / pistol', color: 0x2de2e6, state: { weapon: 'pistol', aim: 0.05 } },
      { label: 'run / smg', color: 0xff3d9a, state: { weapon: 'smg', vx: 200, aim: 0.15 }, animate: (t, f) => { f.lastShot = t - ((t * 8) % 1) * 0.08; } },
      { label: 'run back / shotgun', color: 0x6dff8a, state: { weapon: 'shotgun', vx: 200, aim: Math.PI - 0.1 } },
      { label: 'jetpack / sniper', color: 0xffb02e, state: { weapon: 'sniper', onGround: false, thrusting: true, vy: -200, vx: 80, aim: -0.6 } },
      { label: 'falling / rocket', color: 0x8a6cff, state: { weapon: 'rocket', onGround: false, vy: 420, aim: 0.7 } },
      { label: 'reload / smg', color: 0xff6a3d, state: { weapon: 'smg', aim: 0 }, animate: (t, f) => { f.reloadUntil = t + 0.6 + ((t % 2.4) / 2.4) * 0; const p = (t % 2.4) / 2.4; f.reloadUntil = t + 1.3 * (1 - p); } },
      { label: 'hit / death', color: 0x06b6d4, state: { weapon: 'pistol', aim: 0 }, animate: (t, f) => { const c = t % 3.2; f.dead = c > 1.2; f.hp = c > 0.9 && c < 1.2 ? 40 : c <= 0.9 ? 100 : 0; } },
    ];
    const spacing = 82;
    const x0 = 120;
    this.add.rectangle(640, GROUND_Y + 40, 4000, 80, 0x2b1760).setDepth(0);
    poses.forEach((pose, i) => {
      const x = x0 + i * spacing;
      const f: FighterState = {
        id: i + 1, name: pose.label, isBot: false, color: pose.color, x, y: GROUND_Y - 22, vx: 0, vy: 0, hp: 100, fuel: 100, weapon: 'pistol',
        ammo: 12, altWeapon: null, altAmmo: 0, grenades: 3, nextFire: 0, reloadUntil: 0, nextGrenade: 0, kills: 0, deaths: 0, dead: false,
        aim: 0, respawnAt: 0, onGround: true, blockedL: false, blockedR: false, thrusting: false, lastShot: -1, nextBotThink: 0, ...pose.state,
      };
      const rig = new SoldierRig(this, pose.color);
      this.rigs.push({ rig, f, pose });
      this.add.text(x, GROUND_Y + 14, pose.label, { fontFamily: 'Rajdhani, sans-serif', fontSize: '9px', color: '#e8edf2' }).setOrigin(0.5).setDepth(5);
    });
    this.cameras.main.setZoom(zoom).centerOn(x0 + ((poses.length - 1) * spacing) / 2, GROUND_Y - 40);
  }

  update(_t: number, delta: number) {
    const dt = delta / 1000;
    this.clock += dt;
    for (const { rig, f, pose } of this.rigs) {
      pose.animate?.(this.clock, f);
      rig.update(f, this.clock, dt);
    }
  }
}
