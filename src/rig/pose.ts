// Pure pose math for the soldier rig. No Phaser here, so it is unit-tested.
// Coordinates are y-down. Angles are radians. For limbs drawn pointing down, sprite rotation 0 means "down".

export interface Vec {
  x: number;
  y: number;
}

export const rot = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const THIGH_LEN = 10.2;
export const SHIN_LEN = 13.9;
/** Arms are drawn 20% longer than the base art so a support hand can reach a rifle's handguard. */
export const ARM_STRETCH = 1.2;
export const UPPER_ARM_LEN = 7.0 * ARM_STRETCH;
export const FOREARM_LEN = 7.4 * ARM_STRETCH;

/**
 * Two-bone inverse kinematics. Returns the elbow and both bones' absolute angles (from the +x axis).
 * `bend` +1 puts the elbow below the shoulder-to-target line (the natural pose for a right-facing arm).
 */
export function solveArm(shoulder: Vec, target: Vec, l1 = UPPER_ARM_LEN, l2 = FOREARM_LEN, bend: 1 | -1 = 1) {
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
  const a = Math.atan2(dy, dx);
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const th1 = a + bend * A;
  const elbow = { x: shoulder.x + l1 * Math.cos(th1), y: shoulder.y + l1 * Math.sin(th1) };
  const th2 = Math.atan2(target.y - elbow.y, target.x - elbow.x);
  return { elbow, th1, th2 };
}

/**
 * A leg relative to the hip. `s` swings the thigh forward (+x) and `k` flexes the knee so the shin folds backward.
 */
export function legPose(s: number, k: number) {
  const knee = { x: THIGH_LEN * Math.sin(s), y: THIGH_LEN * Math.cos(s) };
  const foot = { x: knee.x + SHIN_LEN * Math.sin(s - k), y: knee.y + SHIN_LEN * Math.cos(s - k) };
  return { knee, foot };
}

export interface LegAngles {
  nearS: number;
  nearK: number;
  farS: number;
  farK: number;
}

/** Run cycle. `phase` advances with ground speed; the two legs are half a cycle apart. */
export function runCycle(phase: number): LegAngles {
  const swing = 0.66;
  const leg = (p: number) => ({ s: swing * Math.sin(p), k: 0.1 + 0.95 * Math.max(0, Math.cos(p - 0.35)) * (1 - 0.25 * Math.abs(Math.sin(p))) });
  const n = leg(phase);
  const f = leg(phase + Math.PI);
  return { nearS: n.s, nearK: n.k, farS: f.s, farK: f.k };
}

export const idleLegs = (breath: number): LegAngles => ({ nearS: 0.09, nearK: 0.07 + 0.01 * breath, farS: -0.08, farK: 0.05 });

/** Airborne. `vyN` is vertical speed normalised to roughly -1 (rising fast) .. +1 (falling fast). */
export function airLegs(vxLocal: number, vyN: number, thrusting: boolean): LegAngles {
  const trail = clamp(-vxLocal / 260, -1, 1); // legs trail behind the direction of travel
  if (thrusting) return { nearS: -0.22 + trail * 0.25, nearK: 0.55, farS: -0.42 + trail * 0.25, farK: 0.75 };
  const fall = clamp(vyN, 0, 1);
  return { nearS: 0.3 * fall + trail * 0.2, nearK: 0.3 + 0.2 * (1 - fall), farS: -0.28 * fall + trail * 0.2, farK: 0.4 };
}

/**
 * Hip height above the ground (positive up) so that the lower foot just touches y = 0.
 * Planting the feet this way gives the run its natural bob and makes landings squash for free.
 */
export function hipHeight(a: LegAngles): number {
  const near = legPose(a.nearS, a.nearK).foot.y;
  const far = legPose(a.farS, a.farK).foot.y;
  return Math.max(near, far);
}

/** Smoothly move `cur` toward `target`; frame-rate independent. */
export const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
