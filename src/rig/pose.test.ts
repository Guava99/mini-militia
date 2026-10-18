import { describe, expect, it } from 'vitest';
import { WEAPON_ART } from './weaponArt';
import {
  FOREARM_LEN, SHIN_LEN, THIGH_LEN, UPPER_ARM_LEN, airLegs, hipHeight, idleLegs, legPose, rot, runCycle, solveArm,
} from './pose';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('two-bone arm IK', () => {
  const shoulder = { x: 0, y: 0 };

  it('puts the hand on any reachable target and keeps both bones the right length', () => {
    for (const t of [{ x: 6, y: 3 }, { x: 10, y: -4 }, { x: 4, y: 8 }, { x: -3, y: 6 }, { x: 12, y: 0 }]) {
      const { elbow, th2 } = solveArm(shoulder, t);
      const hand = { x: elbow.x + FOREARM_LEN * Math.cos(th2), y: elbow.y + FOREARM_LEN * Math.sin(th2) };
      expect(dist(shoulder, elbow)).toBeCloseTo(UPPER_ARM_LEN, 5);
      expect(dist(hand, t), `target ${t.x},${t.y}`).toBeLessThan(0.01);
    }
  });

  it('bends the elbow below the line to the target for a right-facing arm', () => {
    const { elbow } = solveArm(shoulder, { x: 8, y: 0 });
    expect(elbow.y).toBeGreaterThan(0);
  });

  it('reaches as far as it can toward an unreachable target without breaking', () => {
    const { elbow, th2 } = solveArm(shoulder, { x: 100, y: 0 });
    const hand = { x: elbow.x + FOREARM_LEN * Math.cos(th2), y: elbow.y + FOREARM_LEN * Math.sin(th2) };
    expect(hand.x).toBeGreaterThan(16);
    expect(Number.isFinite(hand.x + hand.y)).toBe(true);
  });

  it('can hold every weapon with both hands at every aim angle', () => {
    const S = { x: 0.9, y: -15 };
    const G = { x: S.x + 4.8, y: S.y + 3.2 }; // where the near hand holds the weapon (see soldier.ts)
    for (const art of Object.values(WEAPON_ART)) {
      for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.2) {
        const far = rot({ x: art.fore.x - art.grip.x, y: art.fore.y - art.grip.y }, a);
        const target = { x: G.x + far.x, y: G.y + far.y };
        const reach = dist(S, target);
        // within 1 px of full extension: the support hand stays on the handguard
        expect(reach, `${art.key} @ ${a.toFixed(2)}`).toBeLessThan(UPPER_ARM_LEN + FOREARM_LEN + 1);
      }
    }
  });
});

describe('legs and feet', () => {
  it('a straight leg is as long as the thigh plus the shin', () => {
    expect(legPose(0, 0).foot.y).toBeCloseTo(THIGH_LEN + SHIN_LEN, 5);
  });

  it('planting the lower foot at ground level never puts either foot below the ground', () => {
    for (let p = 0; p < Math.PI * 4; p += 0.05) {
      const a = runCycle(p);
      const h = hipHeight(a);
      expect(h - legPose(a.nearS, a.nearK).foot.y).toBeGreaterThanOrEqual(-1e-9);
      expect(h - legPose(a.farS, a.farK).foot.y).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('the run cycle bobs the hips by a believable amount and alternates the legs', () => {
    const heights: number[] = [];
    for (let p = 0; p < Math.PI * 2; p += 0.05) heights.push(hipHeight(runCycle(p)));
    const range = Math.max(...heights) - Math.min(...heights);
    expect(range).toBeGreaterThan(0.5);
    expect(range).toBeLessThan(8);
    const a = runCycle(0.7);
    const b = runCycle(0.7 + Math.PI);
    expect(a.nearS).toBeCloseTo(b.farS, 6);
  });

  it('flexing the knees lowers the hips, which is what makes landings squash', () => {
    expect(hipHeight({ nearS: 0, nearK: 0.9, farS: 0, farK: 0.9 })).toBeLessThan(hipHeight({ nearS: 0, nearK: 0, farS: 0, farK: 0 }));
  });

  it('idle and airborne poses are finite and sensible', () => {
    for (const a of [idleLegs(0), idleLegs(1), airLegs(0, 0, false), airLegs(200, 1, false), airLegs(-200, -1, true)]) {
      for (const v of Object.values(a)) expect(Number.isFinite(v)).toBe(true);
      expect(hipHeight(a)).toBeGreaterThan(10);
    }
  });
});
