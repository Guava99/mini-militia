import { describe, expect, it } from 'vitest';
import { MAPS } from '../maps';
import { emptyIntent, GRENADE_FUSE_S, HALF_H, MAX_FUEL, MAX_HP, RESPAWN_S, Sim, TICK, type Intent } from './sim';
import { WEAPONS } from './weapons';

const run = (sim: Sim, seconds: number, intents: Record<number, Intent> = {}) => {
  for (let i = 0; i < Math.round(seconds / TICK); i++) sim.step(TICK, intents);
};
const intent = (o: Partial<Intent>): Intent => ({ ...emptyIntent(), ...o });
const arena = MAPS.find((m) => m.id === 'training-arena')!;

describe('movement and collision', () => {
  it.each(MAPS.map((m) => [m.id, m] as const))('keeps bots inside %s for 30s', (_id, m) => {
    const sim = new Sim(m, { seed: 7 });
    for (let i = 0; i < 4; i++) sim.addFighter(`b${i}`, true, 0xffffff);
    run(sim, 30);
    for (const f of sim.fighters) {
      expect(f.x).toBeGreaterThan(0);
      expect(f.x).toBeLessThan(m.width);
      expect(f.y).toBeGreaterThan(0);
      expect(f.y).toBeLessThan(m.height);
    }
  });

  it('lands on the floor and stays put', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    run(sim, 2);
    expect(f.onGround).toBe(true);
    const y = f.y;
    run(sim, 1);
    expect(Math.abs(f.y - y)).toBeLessThan(0.01);
  });

  it('cannot climb through the ceiling', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    run(sim, 8, { [f.id]: intent({ thrust: true }) });
    expect(f.y).toBeGreaterThanOrEqual(HALF_H);
  });

  it('runs left and right and is stopped by walls', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    run(sim, 20, { [f.id]: intent({ left: true }) });
    expect(f.x).toBeGreaterThan(0);
    expect(f.blockedL).toBe(true);
  });
});

describe('jetpack', () => {
  it('lifts the player, drains fuel, then regenerates on the ground', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    run(sim, 2);
    const y0 = f.y;
    run(sim, 0.5, { [f.id]: intent({ thrust: true }) });
    expect(f.y).toBeLessThan(y0 - 30);
    expect(f.fuel).toBeLessThan(MAX_FUEL);
    run(sim, 6);
    expect(f.onGround).toBe(true);
    expect(f.fuel).toBe(MAX_FUEL);
  });

  it('stops thrusting when fuel is empty', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    f.fuel = 0;
    run(sim, 0.3, { [f.id]: intent({ thrust: true }) });
    expect(f.thrusting).toBe(false);
  });
});

describe('weapons', () => {
  it('fires, consumes ammo, respects fire delay and reloads', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    const fire = { [f.id]: intent({ fire: true, aim: 0 }) };
    sim.step(TICK, fire);
    expect(f.ammo).toBe(WEAPONS.pistol.mag - 1);
    expect(sim.bullets.length).toBe(1);
    sim.step(TICK, fire); // too soon
    expect(f.ammo).toBe(WEAPONS.pistol.mag - 1);
    run(sim, WEAPONS.pistol.fireDelay + 0.05, fire);
    expect(f.ammo).toBeLessThan(WEAPONS.pistol.mag - 1);
    sim.step(TICK, { [f.id]: intent({ reload: true }) });
    expect(f.reloadUntil).toBeGreaterThan(0);
    run(sim, WEAPONS.pistol.reloadS + 0.1);
    expect(f.ammo).toBe(WEAPONS.pistol.mag);
  });

  it('shotgun fires several pellets', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    f.weapon = 'shotgun'; f.ammo = WEAPONS.shotgun.mag;
    sim.step(TICK, { [f.id]: intent({ fire: true }) });
    expect(sim.bullets.length).toBe(WEAPONS.shotgun.pellets);
  });

  it('damages an enemy, scores the kill, and respawns the victim', () => {
    const sim = new Sim(arena);
    const a = sim.addFighter('a', false, 0);
    const b = sim.addFighter('b', false, 0);
    a.x = 300; a.y = 927; b.x = 500; b.y = 927;
    run(sim, 0.2);
    const fire = { [a.id]: intent({ fire: true, aim: Math.atan2(b.y - a.y, b.x - a.x) }) };
    run(sim, 6, fire);
    expect(b.deaths).toBeGreaterThanOrEqual(1);
    expect(a.kills).toBeGreaterThanOrEqual(1);
    expect(sim.drainEvents().some((e) => e.type === 'die' && e.id === b.id)).toBe(true);
    expect(b.dead === false || b.respawnAt - sim.time <= RESPAWN_S).toBe(true);
  });

  it('never hurts the shooter with their own bullets', () => {
    const sim = new Sim(arena);
    const a = sim.addFighter('a', false, 0);
    run(sim, 1);
    run(sim, 3, { [a.id]: intent({ fire: true, aim: Math.PI }) });
    expect(a.hp).toBe(MAX_HP);
  });

  it('rocket explosions damage and knock back nearby fighters', () => {
    const sim = new Sim(arena);
    const a = sim.addFighter('a', false, 0);
    const b = sim.addFighter('b', false, 0);
    a.x = 300; a.y = 927; b.x = 420; b.y = 927;
    run(sim, 0.2);
    a.weapon = 'rocket'; a.ammo = 2;
    sim.step(TICK, { [a.id]: intent({ fire: true, aim: 0 }) });
    run(sim, 1);
    expect(b.hp).toBeLessThan(MAX_HP);
    expect(sim.drainEvents().some((e) => e.type === 'explode')).toBe(true);
  });

  it('grenades bounce then explode after the fuse', () => {
    const sim = new Sim(arena);
    const a = sim.addFighter('a', false, 0);
    run(sim, 0.5);
    sim.step(TICK, { [a.id]: intent({ grenade: true, aim: -0.5 }) });
    expect(sim.grenades.length).toBe(1);
    expect(a.grenades).toBe(2);
    run(sim, GRENADE_FUSE_S + 0.2);
    expect(sim.grenades.length).toBe(0);
    expect(sim.drainEvents().some((e) => e.type === 'explode')).toBe(true);
  });
});

describe('pickups and weapon slots', () => {
  it('picking up a crate fills the second slot and swapping works', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    const crate = sim.crates[0];
    f.x = crate.x; f.y = crate.y;
    sim.step(TICK);
    expect(crate.active).toBe(false);
    expect(f.weapon).toBe(crate.weapon);
    expect(f.altWeapon).toBe('pistol');
    sim.step(TICK, { [f.id]: intent({ swap: true }) });
    expect(f.weapon).toBe('pistol');
    expect(f.altWeapon).toBe(crate.weapon);
  });

  it('crates come back after the respawn delay', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    const crate = sim.crates[0];
    f.x = crate.x; f.y = crate.y;
    sim.step(TICK);
    f.x = 50; f.y = 927;
    run(sim, 13);
    expect(crate.active).toBe(true);
  });
});

describe('match flow and determinism', () => {
  it('a bots-only match ends with a winner who reached the kill limit', () => {
    const sim = new Sim(arena, { seed: 3, killLimit: 5 });
    for (let i = 0; i < 4; i++) sim.addFighter(`b${i}`, true, 0);
    for (let i = 0; i < 60 * 60 * 20 && !sim.over; i++) sim.step(TICK);
    expect(sim.over).toBe(true);
    const w = sim.getFighter(sim.winner!)!;
    expect(w.kills).toBeGreaterThanOrEqual(5);
  });

  it('same seed and inputs give identical results', () => {
    const make = () => {
      const s = new Sim(MAPS[1], { seed: 99 });
      for (let i = 0; i < 3; i++) s.addFighter(`b${i}`, true, 0);
      run(s, 15);
      return JSON.stringify(s.snapshot());
    };
    expect(make()).toBe(make());
  });

  it('removing a fighter removes their bullets', () => {
    const sim = new Sim(arena);
    const f = sim.addFighter('p', false, 0);
    sim.step(TICK, { [f.id]: intent({ fire: true }) });
    expect(sim.bullets.length).toBe(1);
    sim.removeFighter(f.id);
    expect(sim.bullets.length).toBe(0);
    expect(sim.fighters.length).toBe(0);
  });
});
