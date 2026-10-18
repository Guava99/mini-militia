import Phaser from 'phaser';
import { ART_SCALE, artImage } from '../assets';
import type { FighterState } from '../../shared/sim/sim';
import { WEAPONS } from '../../shared/sim/weapons';
import {
  ARM_STRETCH, FOREARM_LEN, UPPER_ARM_LEN, add, airLegs, approach, clamp, hipHeight, idleLegs, rot, runCycle, solveArm,
} from './pose';
import type { LegAngles, Vec } from './pose';
import { weaponArt } from './weaponArt';

type Img = Phaser.GameObjects.Image;

/** The rig is authored taller than the 44 px hitbox; this brings it to the hitbox height. Feet stay on the ground line. */
export const RIG_SCALE = 0.8;
const FEET_Y = 22; // hitbox centre to feet
const SHOULDER: Vec = { x: 0.9, y: -15 };
const NECK: Vec = { x: -0.3, y: -17.4 };
const JETPACK_AT: Vec = { x: -5.0, y: -10.5 };
const NOZZLES: Vec[] = [{ x: -6.8, y: 11.4 }, { x: -2.6, y: 11.0 }];
const GUN_FROM_SHOULDER: Vec = { x: 4.8, y: 3.2 };
const FAR_TINT = 0x8a8a8a; // limbs on the far side of the body are darker, which separates them from the near ones

/**
 * One soldier built from separate sprites. Everything is driven by the simulation state (position, velocity,
 * aim, thrust, reload...), so the animation can never disagree with the physics.
 */
export class SoldierRig {
  readonly root: Phaser.GameObjects.Container;
  private jetpack: Img;
  private flames: Img[];
  private farThigh: Img;
  private farShin: Img;
  private farUpper: Img;
  private farFore: Img;
  private torso: Img;
  private torsoAccent: Img;
  private nearThigh: Img;
  private nearShin: Img;
  private head: Img;
  private headAccent: Img;
  private weapon: Img;
  private weaponKey = '';
  private flash: Img;
  private nearUpper: Img;
  private nearFore: Img;
  private all: Img[];
  private accents: Img[];

  private phase = 0;
  private breath = Math.random() * 6;
  private legs: LegAngles = idleLegs(0);
  private wasGround = true;
  private landT = 0;
  private kick = 0;
  private lastShotSeen = -1;
  private prevHp = 100;
  private hitT = 0;
  private flashingWhite = false;
  private deathT = -1;
  private lean = 0;
  private headTurn = 0;
  private wasThrusting = false;
  private ignite = 0;

  constructor(scene: Phaser.Scene, private color: number) {
    const s = scene;
    this.jetpack = artImage(s, 'jetpack', 10, 7);
    this.flames = [artImage(s, 'flame', 4, 0).setBlendMode(Phaser.BlendModes.ADD), artImage(s, 'flame', 4, 0).setBlendMode(Phaser.BlendModes.ADD)];
    this.farThigh = artImage(s, 'thigh', 3.5, 1);
    this.farShin = artImage(s, 'shin', 3.6, 0.8);
    this.farUpper = artImage(s, 'upper_arm', 2.5, 0.8).setScale(1 / ART_SCALE, ARM_STRETCH / ART_SCALE);
    this.farFore = artImage(s, 'forearm', 2.5, 0.6).setScale(1 / ART_SCALE, ARM_STRETCH / ART_SCALE);
    this.torso = artImage(s, 'torso', 7.5, 18.2);
    this.torsoAccent = artImage(s, 'torso_accent', 7.5, 18.2);
    this.nearThigh = artImage(s, 'thigh', 3.5, 1);
    this.nearShin = artImage(s, 'shin', 3.6, 0.8);
    this.head = artImage(s, 'head', 6.9, 14.4);
    this.headAccent = artImage(s, 'head_accent', 6.9, 14.4);
    this.weapon = artImage(s, 'pistol', 4, 6);
    this.flash = artImage(s, 'muzzle_flash', 0, 7).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.nearUpper = artImage(s, 'upper_arm', 2.5, 0.8).setScale(1 / ART_SCALE, ARM_STRETCH / ART_SCALE);
    this.nearFore = artImage(s, 'forearm', 2.5, 0.6).setScale(1 / ART_SCALE, ARM_STRETCH / ART_SCALE);

    // draw order, back to front
    this.root = s.add.container(0, 0, [
      this.jetpack, this.flames[0], this.flames[1], this.farThigh, this.farShin, this.farUpper, this.farFore,
      this.torso, this.torsoAccent, this.nearThigh, this.nearShin, this.head, this.headAccent,
      this.weapon, this.flash, this.nearUpper, this.nearFore,
    ]);
    this.accents = [this.torsoAccent, this.headAccent];
    this.all = [
      this.jetpack, this.farThigh, this.farShin, this.farUpper, this.farFore, this.torso, this.torsoAccent,
      this.nearThigh, this.nearShin, this.head, this.headAccent, this.weapon, this.nearUpper, this.nearFore,
    ];
    this.applyTints();
  }

  destroy() {
    this.root.destroy();
  }

  private applyTints() {
    for (const i of this.all) i.clearTint();
    for (const i of [this.farThigh, this.farShin, this.farUpper, this.farFore]) i.setTint(FAR_TINT);
    for (const i of this.accents) i.setTint(this.color);
    this.flashingWhite = false;
  }

  update(f: FighterState, time: number, dt: number) {
    dt = Math.min(dt, 0.05);
    const left = Math.cos(f.aim) < 0;
    const dir = left ? -1 : 1;
    let aim = left ? Math.PI - f.aim : f.aim;
    aim = Math.atan2(Math.sin(aim), Math.cos(aim)); // [-pi, pi], in the right-facing frame
    const vxL = f.vx * dir;

    // ----- state changes -----
    if (f.hp < this.prevHp - 0.5 && !f.dead) this.hitT = 0.18;
    if (f.hp > this.prevHp) this.hitT = 0;
    this.prevHp = f.hp;
    this.hitT = Math.max(0, this.hitT - dt);
    if (f.dead) { if (this.deathT < 0) this.deathT = 0; this.deathT += dt; } else this.deathT = -1;
    if (f.onGround && !this.wasGround && !f.dead) this.landT = 0.2;
    this.wasGround = f.onGround;
    this.landT = Math.max(0, this.landT - dt);
    if (f.thrusting && !this.wasThrusting) this.ignite = 0.12;
    this.wasThrusting = f.thrusting;
    this.ignite = Math.max(0, this.ignite - dt);
    if (f.lastShot > this.lastShotSeen + 1e-6 && f.lastShot >= 0 && time - f.lastShot < 0.1) this.kick = 1;
    this.lastShotSeen = f.lastShot;
    this.kick = Math.max(0, this.kick - dt / 0.12);

    // ----- legs -----
    this.breath += dt;
    const running = f.onGround && Math.abs(f.vx) > 25;
    if (running) this.phase += vxL * dt * 0.0625;
    let target: LegAngles;
    if (f.onGround) target = running ? runCycle(this.phase) : idleLegs(Math.sin(this.breath * 2.4));
    else target = airLegs(vxL, f.vy / 500, f.thrusting);
    const sq = this.landT / 0.2;
    const rate = running ? 40 : 18;
    this.legs = {
      nearS: approach(this.legs.nearS, target.nearS, rate, dt),
      nearK: approach(this.legs.nearK, target.nearK + sq * 0.55, rate, dt),
      farS: approach(this.legs.farS, target.farS, rate, dt),
      farK: approach(this.legs.farK, target.farK + sq * 0.55, rate, dt),
    };
    const hip = hipHeight(this.legs);
    const H: Vec = { x: 0, y: -hip };

    // ----- torso lean, head turn -----
    const runLean = running ? clamp(vxL / 200, -1, 1) * 0.1 : 0;
    const thrustLean = f.thrusting ? 0.12 + (this.ignite > 0 ? 0.08 : 0) : 0;
    const hitLean = -0.25 * (this.hitT / 0.18);
    const targetLean = 0.04 + runLean + thrustLean + clamp(aim, -1.2, 1.2) * 0.1 + hitLean;
    this.lean = approach(this.lean, targetLean, 22, dt);
    this.headTurn = approach(this.headTurn, clamp(aim * 0.32, -0.45, 0.5), 20, dt);
    const lean = this.lean;
    const breathe = f.onGround && !running ? 1 + 0.012 * Math.sin(this.breath * 2.4) : 1;

    this.torso.setPosition(H.x, H.y).setRotation(lean).setScale(1 / ART_SCALE, breathe / ART_SCALE);
    this.torsoAccent.setPosition(H.x, H.y).setRotation(lean).setScale(1 / ART_SCALE, breathe / ART_SCALE);
    const S = add(H, rot(SHOULDER, lean));
    const N = add(H, rot(NECK, lean));
    this.head.setPosition(N.x, N.y).setRotation(lean + this.headTurn);
    this.headAccent.setPosition(N.x, N.y).setRotation(lean + this.headTurn);

    // legs: the thigh swings from the hip, the shin from the knee
    const place = (thigh: Img, shin: Img, s: number, k: number, hx: number) => {
      thigh.setPosition(H.x + hx, H.y).setRotation(-s);
      const kx = H.x + hx + 10.2 * Math.sin(s);
      const ky = H.y + 10.2 * Math.cos(s);
      shin.setPosition(kx, ky).setRotation(k - s);
    };
    place(this.farThigh, this.farShin, this.legs.farS, this.legs.farK, -0.8);
    place(this.nearThigh, this.nearShin, this.legs.nearS, this.legs.nearK, 0.6);

    // ----- jetpack + flames -----
    const J = add(H, rot(JETPACK_AT, lean));
    this.jetpack.setPosition(J.x, J.y).setRotation(lean);
    const flameOn = f.thrusting && !f.dead;
    for (let i = 0; i < 2; i++) {
      const fl = this.flames[i];
      fl.setVisible(flameOn);
      if (!flameOn) continue;
      const n = add(J, rot(NOZZLES[i], lean));
      const flick = 0.75 + Math.random() * 0.55 + (this.ignite > 0 ? 0.4 : 0);
      fl.setPosition(n.x, n.y).setRotation(lean - clamp(vxL / 900, -0.25, 0.25)).setScale((0.8 + Math.random() * 0.25) / ART_SCALE, (flick * (i === 0 ? 1 : 0.85) * 1.0) / ART_SCALE);
      fl.setAlpha(0.85 + Math.random() * 0.15);
    }

    // ----- weapon and arms -----
    if (this.weaponKey !== f.weapon) {
      const art = weaponArt(f.weapon);
      this.weapon.setTexture(art.key).setOrigin(art.grip.x / art.w, art.grip.y / art.h);
      this.weaponKey = f.weapon;
    }
    const art = weaponArt(f.weapon);
    const def = WEAPONS[f.weapon] ?? WEAPONS.pistol;
    let reloadP = 0;
    if (f.reloadUntil > 0) reloadP = clamp(1 - (f.reloadUntil - time) / def.reloadS, 0, 1);
    const dip = f.reloadUntil > 0 ? 0.42 * Math.sin(Math.PI * clamp(reloadP * 1.15, 0, 1)) : 0;
    const wRot = aim + dip + this.kick * 0.05;
    const kickBack = rot({ x: -2.6 * this.kick, y: 0 }, aim);
    const G: Vec = { x: S.x + GUN_FROM_SHOULDER.x + kickBack.x, y: S.y + GUN_FROM_SHOULDER.y + kickBack.y };
    this.weapon.setPosition(G.x, G.y).setRotation(wRot);
    const showGun = !f.dead || this.deathT < 0.12;
    this.weapon.setVisible(showGun);

    // support hand: on the foregrip, or down at the magazine well while reloading
    let foreLocal: Vec = { x: art.fore.x - art.grip.x, y: art.fore.y - art.grip.y };
    if (f.reloadUntil > 0) {
      const m = Math.sin(Math.PI * clamp((reloadP - 0.15) / 0.55, 0, 1));
      foreLocal = { x: foreLocal.x * (1 - 0.55 * m), y: foreLocal.y + 8 * m };
    }
    const farTarget = add(G, rot(foreLocal, wRot));
    const nearArm = solveArm(S, G);
    const farArm = solveArm({ x: S.x - 0.6, y: S.y + 0.2 }, farTarget);
    this.nearUpper.setPosition(S.x, S.y).setRotation(nearArm.th1 - Math.PI / 2);
    this.nearFore.setPosition(nearArm.elbow.x, nearArm.elbow.y).setRotation(nearArm.th2 - Math.PI / 2);
    this.farUpper.setPosition(S.x - 0.6, S.y + 0.2).setRotation(farArm.th1 - Math.PI / 2);
    this.farFore.setPosition(farArm.elbow.x, farArm.elbow.y).setRotation(farArm.th2 - Math.PI / 2);

    // muzzle flash at the barrel tip
    const fresh = f.lastShot >= 0 && time - f.lastShot < 0.055 && !f.dead;
    this.flash.setVisible(fresh);
    if (fresh) {
      const tip = add(G, rot({ x: art.muzzle.x - art.grip.x, y: art.muzzle.y - art.grip.y }, wRot));
      const sc = (0.6 + Math.random() * 0.4) * (def.explosive > 0 || f.weapon === 'shotgun' ? 1.4 : 1);
      this.flash.setPosition(tip.x, tip.y).setRotation(wRot).setScale(sc / ART_SCALE, (sc * 0.85) / ART_SCALE);
    }

    // ----- hit flash (white) -----
    const flashNow = this.hitT > 0.1;
    if (flashNow !== this.flashingWhite) {
      if (flashNow) for (const i of this.all) i.setTintFill(0xffffff);
      else this.applyTints();
      this.flashingWhite = flashNow;
    }

    // ----- container: position, facing, death -----
    let rotation = 0;
    let alpha = 1;
    if (this.deathT >= 0) {
      const q = clamp(this.deathT / 0.45, 0, 1);
      const eased = 1 - Math.pow(1 - q, 3);
      rotation = -dir * (Math.PI / 2 - 0.12) * eased;
      alpha = 1 - clamp((this.deathT - 1.4) / 0.7, 0, 1);
    }
    this.root.setPosition(f.x, f.y + FEET_Y).setScale(dir * RIG_SCALE, RIG_SCALE).setRotation(rotation).setAlpha(alpha);
    this.root.setVisible(alpha > 0.01);
  }

  /** World position of the nozzles, for smoke trails. */
  nozzleWorld(f: FighterState): Vec[] {
    const dir = Math.cos(f.aim) < 0 ? -1 : 1;
    const J = add({ x: 0, y: -hipHeight(this.legs) }, rot(JETPACK_AT, this.lean));
    return NOZZLES.map((n) => {
      const p = add(J, rot(n, this.lean));
      return { x: f.x + dir * p.x * RIG_SCALE, y: f.y + FEET_Y + p.y * RIG_SCALE };
    });
  }
}

/** Keeps one rig per fighter and removes rigs for fighters that left. */
export class CharacterLayer {
  private rigs = new Map<number, SoldierRig>();

  constructor(private scene: Phaser.Scene) {}

  rig(id: number): SoldierRig | undefined {
    return this.rigs.get(id);
  }

  sync(fighters: FighterState[], localId: number, time: number, dt: number) {
    const seen = new Set<number>();
    for (const f of fighters) {
      seen.add(f.id);
      let r = this.rigs.get(f.id);
      if (!r) {
        r = new SoldierRig(this.scene, f.color);
        this.rigs.set(f.id, r);
      }
      r.root.setDepth(f.id === localId ? 12 : 10);
      r.update(f, time, dt);
    }
    for (const [id, r] of this.rigs) {
      if (seen.has(id)) continue;
      r.destroy();
      this.rigs.delete(id);
    }
  }
}

// keep these referenced so tree-shaking never drops the geometry constants the tests rely on
export const RIG_GEOMETRY = { UPPER_ARM_LEN, FOREARM_LEN };
