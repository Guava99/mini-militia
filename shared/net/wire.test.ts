import { describe, expect, it } from 'vitest';
import { getMap } from '../maps';
import { emptyIntent, Sim, TICK } from '../sim/sim';
import type { FighterState } from '../sim/sim';
import type { ServerMsg } from './protocol';
import { FIGHTER_KEYS, decodeFighter, encodeFighter, parseWire, wireStringify } from './wire';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

/** Run a real match for a while so the snapshot contains bullets, grenades, kills, dead fighters, events... */
function busySnapshot(): Snap {
  const sim = new Sim(getMap('canyon-base'), { seed: 21 });
  const me = sim.addFighter('Ünï "quoted" name', false, 0x3b82f6);
  for (let i = 0; i < 3; i++) sim.addFighter(`Bot ${i}`, true, 0xef4444);
  for (let t = 0; t < 900; t++) sim.step(TICK, { [me.id]: { ...emptyIntent(), fire: t % 3 === 0, grenade: t % 100 === 0, aim: t / 50, thrust: t % 80 < 30 } });
  return {
    t: 'snap', tick: 900, time: sim.time, ack: 123, over: false, winner: null,
    fighters: sim.fighters, bullets: sim.bullets, grenades: sim.grenades,
    crates: sim.crates.map((c) => ({ id: c.id, active: c.active, weapon: c.weapon })),
    events: [{ type: 'explode', x: 1, y: 2, radius: 3 }, { type: 'die', id: 2, by: 1 }],
  };
}

const roundish = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);

describe('compact wire format', () => {
  it('FIGHTER_KEYS covers every FighterState field, so nothing is silently dropped', () => {
    const sim = new Sim(getMap('training-arena'));
    const f = sim.addFighter('x', false, 1);
    expect([...FIGHTER_KEYS].sort()).toEqual(Object.keys(f).sort());
  });

  it('round-trips a fighter exactly (booleans, null, strings, floats)', () => {
    const f = busySnapshot().fighters.find((x) => x.isBot)!;
    f.altWeapon = null;
    const back = decodeFighter(JSON.parse(JSON.stringify(encodeFighter(f))));
    expect(back).toEqual(f);
    expect(typeof back.dead).toBe('boolean');
    expect(back.altWeapon).toBeNull();
  });

  it('round-trips a whole busy snapshot (within the 0.001 rounding)', () => {
    const snap = busySnapshot();
    expect(snap.bullets.length + snap.grenades.length).toBeGreaterThan(0);
    const back = parseWire(wireStringify(snap)) as Snap;
    const expected = JSON.parse(JSON.stringify(snap, (_k, v) => roundish(v)));
    expect(JSON.parse(JSON.stringify(back))).toEqual(expected);
  });

  it('keeps non-snapshot messages as plain JSON', () => {
    const m: ServerMsg = { t: 'joined', code: 'ABCD', you: 3, mapId: 'canyon-base', killLimit: 15, resumed: false, phase: 'playing' };
    expect(parseWire(wireStringify(m))).toEqual(m);
  });

  it('is much smaller than the keyed-object encoding', () => {
    const snap = busySnapshot();
    const compact = wireStringify(snap).length;
    const keyed = JSON.stringify(snap).length;
    console.log(`snapshot: keyed ${keyed} B -> compact ${compact} B`);
    expect(compact).toBeLessThan(keyed * 0.6);
  });

  it.each(['', 'nope', '[]', '{"t":5}', '{"t":"snap"}', '{"t":"snap","f":1,"b":[],"g":[],"c":[]}'])('rejects malformed input safely: %s', (text) => {
    expect(parseWire(text)).toBeNull();
  });
});

// keep the type import used even if the test list above changes
export type { FighterState };
