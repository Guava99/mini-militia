import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '../shared/net/protocol';
import { wireStringify } from '../shared/net/wire';
import { emptyIntent } from '../shared/sim/sim';
import type { Intent } from '../shared/sim/sim';
import { Room } from './room';

/** A full room: 8 humans all moving and shooting, plus 3 bots. Serialises like a real socket would. */
function fullRoom(mapId: string) {
  const room = new Room('PERF', { mapId, bots: 3, seed: 11 });
  let bytes = 0;
  let snaps = 0;
  const tokens: string[] = [];
  for (let i = 0; i < 8; i++) {
    const tok = `t${i}`;
    tokens.push(tok);
    room.addMember(tok, `P${i}`, { send: (m: ServerMsg) => { const s = wireStringify(m); if (i === 0 && m.t === 'snap') { bytes += s.length; snaps++; } } });
  }
  return { room, tokens, stats: () => ({ bytes, snaps }) };
}

describe('performance with a full room (8 players + 3 bots)', () => {
  it.each(['training-arena', 'industrial-zone', 'canyon-base'])('%s: a server tick stays well under the 16.7 ms budget', (mapId) => {
    const { room, tokens } = fullRoom(mapId);
    let seq = 0;
    const ticks = 1200; // 20 seconds of play
    const t0 = performance.now();
    const times: number[] = [];
    for (let t = 0; t < ticks; t++) {
      for (const [i, tok] of tokens.entries()) {
        const intent: Intent = { ...emptyIntent(), right: (t >> 5) % 2 === 0, left: (t >> 5) % 2 === 1, thrust: (t + i * 7) % 90 < 40, fire: t % 4 === 0, aim: ((t + i * 30) / 40) % 6.28, grenade: t % 200 === i };
        room.pushInput(tok, ++seq, intent);
      }
      const a = performance.now();
      room.tickOnce();
      times.push(performance.now() - a);
    }
    const avg = (performance.now() - t0) / ticks;
    times.sort((x, y) => x - y);
    const p99 = times[Math.floor(times.length * 0.99)];
    console.log(`${mapId}: avg ${avg.toFixed(3)} ms/tick, p99 ${p99.toFixed(2)} ms, max ${times.at(-1)!.toFixed(2)} ms`);
    expect(avg).toBeLessThan(4);
    expect(p99).toBeLessThan(8); // a single GC/JIT pause must not fail the build, but sustained slowness must
  });

  it('keeps bandwidth per player at a sane level', () => {
    const { room, stats } = fullRoom('training-arena');
    for (let t = 0; t < 600; t++) room.tickOnce();
    const { bytes, snaps } = stats();
    const perSnap = bytes / snaps;
    const kbPerSec = (perSnap * 20) / 1024; // 20 snapshots per second
    console.log(`snapshot ${perSnap.toFixed(0)} bytes, ~${kbPerSec.toFixed(1)} KB/s per player`);
    expect(kbPerSec).toBeLessThan(45); // fine on a phone connection; revisit if it grows
  });
});
