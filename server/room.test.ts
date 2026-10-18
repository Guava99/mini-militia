import { describe, expect, it } from 'vitest';
import { MATCH_RESTART_MS, RECONNECT_GRACE_MS, SNAPSHOT_EVERY_TICKS } from '../shared/net/protocol';
import type { ServerMsg } from '../shared/net/protocol';
import { emptyIntent, MAX_HP } from '../shared/sim/sim';
import type { Intent } from '../shared/sim/sim';
import { Room } from './room';

class FakeConn {
  msgs: ServerMsg[] = [];
  send(m: ServerMsg) { this.msgs.push(m); }
  snaps() { return this.msgs.filter((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap'); }
}

const intent = (o: Partial<Intent>): Intent => ({ ...emptyIntent(), ...o });

function makeRoom(opts = {}) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => { t += ms; } };
  const room = new Room('TEST', { mapId: 'training-arena', seed: 5, ...opts }, () => t);
  return { room, clock };
}
const ticks = (room: Room, n: number) => { for (let i = 0; i < n; i++) room.tickOnce(); };

describe('room membership and snapshots', () => {
  it('sends snapshots at the configured rate containing every fighter', () => {
    const { room } = makeRoom();
    const a = new FakeConn();
    room.addMember('ta', 'Ann', a);
    room.addMember('tb', 'Bob', new FakeConn());
    ticks(room, SNAPSHOT_EVERY_TICKS * 4);
    expect(a.snaps().length).toBe(4);
    expect(a.snaps()[0].fighters.map((f) => f.name).sort()).toEqual(['Ann', 'Bob']);
  });

  it('gives each player a unique colour and refuses to overfill', () => {
    const { room } = makeRoom();
    for (let i = 0; i < 8; i++) expect(room.addMember(`t${i}`, `p${i}`, new FakeConn())).not.toBeNull();
    expect(room.addMember('extra', 'x', new FakeConn())).toBeNull();
    expect(new Set([...room.members.values()].map((m) => m.colorIdx)).size).toBe(8);
  });

  it('spawns configured bots', () => {
    const { room } = makeRoom({ bots: 2 });
    expect(room.sim.fighters.filter((f) => f.isBot).length).toBe(2);
  });
});

describe('authoritative input handling', () => {
  it('moves a fighter from queued inputs and acknowledges the sequence numbers', () => {
    const { room } = makeRoom();
    const conn = new FakeConn();
    const m = room.addMember('ta', 'Ann', conn)!;
    ticks(room, 120); // settle on the floor
    const x0 = room.sim.getFighter(m.fighterId)!.x;
    for (let seq = 1; seq <= 30; seq++) room.pushInput('ta', seq, intent({ right: true }));
    ticks(room, 30);
    expect(room.sim.getFighter(m.fighterId)!.x).toBeGreaterThan(x0 + 20);
    expect(conn.snaps().at(-1)!.ack).toBeGreaterThan(0);
  });

  it('ignores stale and duplicate sequence numbers', () => {
    const { room } = makeRoom();
    const m = room.addMember('ta', 'Ann', new FakeConn())!;
    room.pushInput('ta', 5, intent({}));
    room.pushInput('ta', 5, intent({}));
    room.pushInput('ta', 3, intent({}));
    expect(m.queue.length).toBe(1);
  });

  it('caps the input queue so a lagging client cannot build up delay', () => {
    const { room } = makeRoom();
    const m = room.addMember('ta', 'Ann', new FakeConn())!;
    for (let seq = 1; seq <= 100; seq++) room.pushInput('ta', seq, intent({}));
    expect(m.queue.length).toBeLessThanOrEqual(6);
    expect(m.queue.at(-1)!.seq).toBe(100);
  });

  it('does not repeat one-shot buttons when no new input arrives', () => {
    const { room } = makeRoom();
    const m = room.addMember('ta', 'Ann', new FakeConn())!;
    ticks(room, 60);
    room.pushInput('ta', 1, intent({ grenade: true }));
    ticks(room, 30); // only the first tick had input; the rest repeat held keys
    expect(room.sim.getFighter(m.fighterId)!.grenades).toBe(2);
  });

  it('lets a shooter damage and kill another player, server-side', () => {
    const { room } = makeRoom();
    const a = room.addMember('ta', 'Ann', new FakeConn())!;
    const b = room.addMember('tb', 'Bob', new FakeConn())!;
    const fa = room.sim.getFighter(a.fighterId)!;
    const fb = room.sim.getFighter(b.fighterId)!;
    fa.x = 300; fa.y = 927; fb.x = 520; fb.y = 927;
    ticks(room, 10);
    let seq = 0;
    for (let i = 0; i < 400 && !fb.dead; i++) {
      room.pushInput('ta', ++seq, intent({ fire: true, aim: Math.atan2(fb.y - fa.y, fb.x - fa.x) }));
      room.tickOnce();
    }
    expect(fb.hp).toBeLessThan(MAX_HP);
    expect(fa.kills).toBeGreaterThanOrEqual(1);
    expect(fb.dead).toBe(true);
  });
});

describe('disconnect and reconnect', () => {
  it('keeps the fighter during the grace period and resumes the same one', () => {
    const { room, clock } = makeRoom();
    const m = room.addMember('ta', 'Ann', new FakeConn())!;
    const id = m.fighterId;
    room.detach('ta');
    clock.advance(5000);
    ticks(room, 60);
    expect(room.sim.getFighter(id)).toBeDefined();
    const back = new FakeConn();
    expect(room.reattach('ta', back)!.fighterId).toBe(id);
    ticks(room, SNAPSHOT_EVERY_TICKS);
    expect(back.snaps().length).toBe(1);
  });

  it('removes the fighter after the grace period', () => {
    const { room, clock } = makeRoom();
    const m = room.addMember('ta', 'Ann', new FakeConn())!;
    room.addMember('tb', 'Bob', new FakeConn());
    room.detach('ta');
    clock.advance(RECONNECT_GRACE_MS + 1000);
    ticks(room, 60);
    expect(room.members.has('ta')).toBe(false);
    expect(room.sim.getFighter(m.fighterId)).toBeUndefined();
  });

  it('marks the room idle when everyone has left', () => {
    const { room } = makeRoom();
    room.addMember('ta', 'Ann', new FakeConn());
    expect(room.idleSince).toBeNull();
    room.detach('ta');
    expect(room.idleSince).not.toBeNull();
  });
});

describe('match lifecycle', () => {
  it('starts a fresh match after the winner is decided, and tells each player their new fighter id', () => {
    const { room, clock } = makeRoom({ killLimit: 1 });
    const a = new FakeConn();
    const ma = room.addMember('ta', 'Ann', a)!;
    const mb = room.addMember('tb', 'Bob', new FakeConn())!;
    const fa = room.sim.getFighter(ma.fighterId)!;
    const fb = room.sim.getFighter(mb.fighterId)!;
    fa.x = 300; fa.y = 927; fb.x = 520; fb.y = 927;
    ticks(room, 10);
    for (let i = 0; i < 600 && !room.sim.over; i++) {
      room.pushInput('ta', i + 1, intent({ fire: true, aim: 0 }));
      room.tickOnce();
    }
    expect(room.sim.over).toBe(true);
    clock.advance(MATCH_RESTART_MS + 100);
    ticks(room, 2);
    expect(room.sim.over).toBe(false);
    expect(a.msgs.some((m) => m.t === 'match')).toBe(true);
    expect(room.sim.fighters.length).toBe(2);
    expect(room.sim.getFighter(ma.fighterId)!.kills).toBe(0);
  });
});


describe('lobby (private rooms)', () => {
  const lobbyTypes = (c: FakeConn) => c.msgs.filter((m) => m.t === 'lobby') as Extract<ServerMsg, { t: 'lobby' }>[];

  it('starts in a waiting room that does not run the simulation', () => {
    const { room } = makeRoom({ lobby: true });
    const m = room.addMember('ta', 'Ann', new FakeConn())!;
    expect(room.phase).toBe('lobby');
    const t0 = room.sim.time;
    ticks(room, 120);
    expect(room.sim.time).toBe(t0);
    const f = room.sim.getFighter(m.fighterId)!;
    expect(f.vy).toBe(0); // nobody falls while waiting
  });

  it('shows everyone in the lobby and who the host is, and tells each player if they are the host', () => {
    const { room } = makeRoom({ lobby: true });
    const a = new FakeConn();
    const b = new FakeConn();
    room.addMember('ta', 'Ann', a);
    room.addMember('tb', 'Bob', b);
    ticks(room, 2);
    const la = lobbyTypes(a).at(-1)!;
    expect(la.players.map((p) => `${p.name}${p.host ? '*' : ''}`)).toEqual(['Ann*', 'Bob']);
    expect(la.youAreHost).toBe(true);
    expect(lobbyTypes(b).at(-1)!.youAreHost).toBe(false);
  });

  it('only the host can start, and starting sends every player a match message', () => {
    const { room } = makeRoom({ lobby: true });
    const a = new FakeConn();
    const b = new FakeConn();
    room.addMember('ta', 'Ann', a);
    room.addMember('tb', 'Bob', b);
    expect(room.start('tb')).toBe(false);
    expect(room.phase).toBe('lobby');
    expect(room.start('ta')).toBe(true);
    expect(room.phase).toBe('playing');
    expect(a.msgs.some((m) => m.t === 'match')).toBe(true);
    expect(b.msgs.some((m) => m.t === 'match')).toBe(true);
    const t0 = room.sim.time;
    ticks(room, 30);
    expect(room.sim.time).toBeGreaterThan(t0);
    expect(room.start('ta')).toBe(false); // already playing
  });

  it('only the host can change the map, only to a real map, only in the lobby', () => {
    const { room } = makeRoom({ lobby: true });
    room.addMember('ta', 'Ann', new FakeConn());
    room.addMember('tb', 'Bob', new FakeConn());
    expect(room.setMap('tb', 'canyon-base')).toBe(false);
    expect(room.setMap('ta', 'not-a-map')).toBe(false);
    expect(room.setMap('ta', 'canyon-base')).toBe(true);
    room.start('ta');
    expect(room.sim.map.id).toBe('canyon-base');
    expect(room.setMap('ta', 'training-arena')).toBe(false); // match already running
  });

  it('hands the host role to the next player when the host leaves or drops', () => {
    const { room } = makeRoom({ lobby: true });
    const b = new FakeConn();
    room.addMember('ta', 'Ann', new FakeConn());
    room.addMember('tb', 'Bob', b);
    room.detach('ta');
    expect(room.hostToken).toBe('tb');
    ticks(room, 2);
    expect(lobbyTypes(b).at(-1)!.youAreHost).toBe(true);
    room.removeMember('tb'); // Ann is still inside her reconnect grace period, so she is host again
    expect(room.hostToken).toBe('ta');
    room.removeMember('ta');
    expect(room.hostToken).toBeNull();
  });

  it('returns to the lobby after a match instead of auto-restarting', () => {
    const { room, clock } = makeRoom({ lobby: true, killLimit: 1 });
    const a = new FakeConn();
    const ma = room.addMember('ta', 'Ann', a)!;
    const mb = room.addMember('tb', 'Bob', new FakeConn())!;
    room.start('ta');
    const fa = room.sim.getFighter(ma.fighterId)!;
    const fb = room.sim.getFighter(mb.fighterId)!;
    fa.x = 300; fa.y = 927; fb.x = 520; fb.y = 927;
    ticks(room, 10);
    for (let i = 0; i < 600 && !room.sim.over; i++) {
      room.pushInput('ta', i + 1, intent({ fire: true, aim: 0 }));
      room.tickOnce();
    }
    expect(room.sim.over).toBe(true);
    clock.advance(MATCH_RESTART_MS + 100);
    ticks(room, 3);
    expect(room.phase).toBe('lobby');
    expect(lobbyTypes(a).length).toBeGreaterThan(0);
  });

  it('quick-match style rooms skip the lobby entirely', () => {
    const { room } = makeRoom({});
    expect(room.phase).toBe('playing');
  });
});
