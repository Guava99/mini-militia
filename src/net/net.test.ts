import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMap } from '../../shared/maps';
import type { ServerMsg } from '../../shared/net/protocol';
import { emptyIntent, TICK } from '../../shared/sim/sim';
import type { FighterState, Intent } from '../../shared/sim/sim';
import { createServer } from '../../server/index';
import type { GameServer } from '../../server/index';
import { Room } from '../../server/room';
import { NetClient } from './client';
import { Predictor } from './predictor';
import type { Snap } from './predictor';
import { lerpAngle, SnapshotBuffer } from './snapshots';

const intent = (o: Partial<Intent>): Intent => ({ ...emptyIntent(), ...o });
const arena = getMap('training-arena');

const fighter = (id: number, x: number, y: number, aim = 0): FighterState => ({
  id, name: `f${id}`, isBot: false, color: 0, x, y, vx: 0, vy: 0, hp: 100, fuel: 100, weapon: 'pistol', ammo: 12, altWeapon: null, altAmmo: 0,
  grenades: 3, nextFire: 0, reloadUntil: 0, nextGrenade: 0, kills: 0, deaths: 0, dead: false, aim, respawnAt: 0, onGround: true,
  blockedL: false, blockedR: false, thrusting: false, lastShot: -1, nextBotThink: 0,
});
const snapOf = (fighters: FighterState[], extra: Partial<Snap> = {}): Snap => ({
  t: 'snap', tick: 0, time: 0, ack: 0, over: false, winner: null, fighters, bullets: [], grenades: [], crates: [], events: [], ...extra,
});

describe('snapshot interpolation', () => {
  it('blends remote fighters between the two snapshots around the render time', () => {
    const buf = new SnapshotBuffer();
    buf.push(1000, snapOf([fighter(1, 0, 0)]));
    buf.push(1100, snapOf([fighter(1, 100, 50)]));
    const mid = buf.fighters(1050)[0];
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(25);
  });

  it('holds the newest state when there is nothing newer, and the oldest when too early', () => {
    const buf = new SnapshotBuffer();
    buf.push(1000, snapOf([fighter(1, 0, 0)]));
    buf.push(1100, snapOf([fighter(1, 100, 0)]));
    expect(buf.fighters(5000)[0].x).toBe(100);
    expect(buf.fighters(10)[0].x).toBe(0);
  });

  it('does not blend a fighter that just respawned or just appeared', () => {
    const buf = new SnapshotBuffer();
    buf.push(1000, snapOf([fighter(1, 0, 0)]));
    buf.push(1100, snapOf([fighter(1, 900, 900), fighter(2, 40, 40)]));
    const out = buf.fighters(1050);
    expect(out.find((f) => f.id === 2)!.x).toBe(40);
  });

  it('turns angles the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 1);
  });

  it('extrapolates bullets briefly from the newest snapshot', () => {
    const buf = new SnapshotBuffer();
    buf.push(1000, snapOf([], { bullets: [{ id: 1, x: 0, y: 0, vx: 1000, vy: 0, owner: 1, dmg: 1, boom: 0, born: 0 }] }));
    expect(buf.bullets(1050)[0].x).toBeCloseTo(50);
    expect(buf.bullets(9999)[0].x).toBeCloseTo(100); // capped at 100ms
  });
});

describe('client-side prediction against a real Room under latency and jitter', () => {
  function simulate(latencyTicks: number, jitterTicks: number, script: (tick: number) => Intent, ticks: number, seed = 1) {
    const room = new Room('SIM', { mapId: 'training-arena', seed: 3 });
    const snaps: Snap[] = [];
    const m = room.addMember('t', 'p', { send: (msg: ServerMsg) => { if (msg.t === 'snap') snaps.push(structuredClone(msg)); } })!; // clone like a socket would
    const pred = new Predictor(arena, m.fighterId, room.sim.getFighter(m.fighterId)!);
    let rnd = seed;
    const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const toServer: { at: number; seq: number; intent: Intent }[] = [];
    const toClient: { at: number; snap: Snap }[] = [];
    let lastUp = 0;
    let lastDown = 0;
    let maxErr = 0;
    let maxCorr = 0;
    let delivered = 0;
    for (let tick = 0; tick < ticks; tick++) {
      pred.decay(TICK);
      const inp = pred.nextInput(script(tick));
      lastUp = Math.max(lastUp, tick + latencyTicks + Math.floor(rand() * (jitterTicks + 1))); // TCP keeps order
      toServer.push({ at: lastUp, ...inp });
      while (toServer.length && toServer[0].at <= tick) { const x = toServer.shift()!; room.pushInput('t', x.seq, x.intent); }
      room.tickOnce();
      while (snaps.length > delivered) {
        lastDown = Math.max(lastDown, tick + latencyTicks + Math.floor(rand() * (jitterTicks + 1)));
        toClient.push({ at: lastDown, snap: snaps[delivered++] });
      }
      while (toClient.length && toClient[0].at <= tick) {
        pred.reconcile(toClient.shift()!.snap);
        if (tick > 120) maxCorr = Math.max(maxCorr, Math.hypot(pred.corr.x, pred.corr.y));
      }
      const srv = room.sim.getFighter(m.fighterId)!;
      if (tick > 120) maxErr = Math.max(maxErr, Math.hypot(pred.me.x - srv.x, pred.me.y - srv.y));
    }
    return { pred, room, id: m.fighterId, maxErr, maxCorr };
  }

  // run right, jetpack up, run left, then stand still
  const script = (t: number) => {
    if (t < 150) return intent({});
    if (t < 210) return intent({ right: true });
    if (t < 270) return intent({ right: true, thrust: true });
    if (t < 330) return intent({ left: true });
    return intent({});
  };

  it('stays close to the server at 100 ms round-trip with no jitter', () => {
    const { maxErr, maxCorr, pred, room, id } = simulate(3, 0, script, 600);
    const srv = room.sim.getFighter(id)!;
    expect(maxCorr).toBeLessThan(1); // same rules + same inputs => nothing visible to correct
    expect(maxErr).toBeLessThan(45); // by design the client leads the server by one trip: ~360 px/s x 100 ms
    expect(Math.hypot(pred.me.x - srv.x, pred.me.y - srv.y)).toBeLessThan(1);
  });

  it('stays bounded and converges with 200 ms round-trip and jitter', () => {
    const { maxErr, maxCorr, pred, room, id } = simulate(6, 3, script, 700);
    const srv = room.sim.getFighter(id)!;
    expect(maxCorr).toBeLessThan(40);
    expect(maxErr).toBeLessThan(120);
    expect(Math.hypot(pred.me.x - srv.x, pred.me.y - srv.y)).toBeLessThan(2);
  });

  it('predicts instantly: the local fighter moves on the very first input, before any server reply', () => {
    const room = new Room('SIM', { mapId: 'training-arena', seed: 3 });
    const m = room.addMember('t', 'p', { send: () => {} })!;
    const pred = new Predictor(arena, m.fighterId, room.sim.getFighter(m.fighterId)!);
    for (let i = 0; i < 90; i++) pred.nextInput(intent({}));
    const x0 = pred.me.x;
    for (let i = 0; i < 20; i++) pred.nextInput(intent({ right: true }));
    expect(pred.me.x).toBeGreaterThan(x0 + 30);
  });

  it('hides small corrections with a decaying offset and snaps big ones', () => {
    const room = new Room('SIM', { mapId: 'training-arena', seed: 3 });
    const m = room.addMember('t', 'p', { send: () => {} })!;
    const f = room.sim.getFighter(m.fighterId)!;
    const pred = new Predictor(arena, m.fighterId, f);
    pred.reconcile(snapOf([{ ...f, x: f.x + 20 }]));
    expect(Math.abs(pred.corr.x)).toBeGreaterThan(5);
    for (let i = 0; i < 120; i++) pred.decay(TICK);
    expect(Math.abs(pred.corr.x)).toBeLessThan(0.01);
    pred.reconcile(snapOf([{ ...f, x: f.x + 500 }]));
    expect(pred.corr.x).toBe(0);
  });
});

describe('NetClient reconnect (real server, real sockets)', () => {
  let server: GameServer;
  beforeAll(async () => { server = await createServer(0); });
  afterAll(async () => { await server.close(); });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const nextMsg = <T extends ServerMsg['t']>(c: NetClient, t: T, timeout = 4000) =>
    new Promise<Extract<ServerMsg, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${t}`)); }, timeout);
      const off = c.onMessage((m) => { if (m.t === t) { clearTimeout(timer); off(); resolve(m as Extract<ServerMsg, { t: T }>); } });
    });

  it('connects, joins a room, measures ping, and resumes the same fighter after a dropped connection', async () => {
    const store = new Map<string, string>();
    const c = new NetClient(`ws://localhost:${server.port}`, 'Ann', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    await c.connect();
    expect(c.token).toBeTruthy();
    expect(store.get('mm_token')).toBe(c.token);

    const joinedP = nextMsg(c, 'joined');
    c.send({ t: 'create', mapId: 'industrial-zone' });
    const joined = await joinedP;
    await wait(100);
    expect(c.rtt).toBeGreaterThan(0);

    const statuses: string[] = [];
    c.onStatus((s) => statuses.push(s));
    const resumedP = nextMsg(c, 'joined');
    c.simulateDrop();
    const resumed = await resumedP;
    expect(statuses).toContain('reconnecting');
    expect(resumed.resumed).toBe(true);
    expect(resumed.you).toBe(joined.you);
    expect(resumed.code).toBe(joined.code);
    expect(c.status).toBe('open');
    c.close();
    expect(c.status).toBe('closed');
  });

  it('stops reconnecting when another connection takes over the same player', async () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const first = new NetClient(`ws://localhost:${server.port}`, 'Ann', kv);
    await first.connect();
    const joined = nextMsg(first, 'joined');
    first.send({ t: 'create' });
    await joined;

    const second = new NetClient(`ws://localhost:${server.port}`, 'Ann', kv); // same token = same player
    const resumed = nextMsg(second, 'joined');
    await second.connect();
    expect((await resumed).resumed).toBe(true);

    await wait(1500); // long enough for a reconnect attempt if there were one
    expect(first.status).toBe('closed');
    expect(first.lastCloseCode).toBe(4000);
    expect(second.status).toBe('open');
    second.close();
  });

  it('a handler registered while a message is being handled does not receive that same message', async () => {
    const c = new NetClient(`ws://localhost:${server.port}`, 'Ann', undefined);
    const seenByLateHandler: string[] = [];
    let registered = false;
    c.onMessage((m) => {
      if (m.t === 'welcome' && !registered) {
        registered = true;
        c.onMessage((m2) => seenByLateHandler.push(m2.t)); // registered during dispatch of 'welcome'
      }
    });
    await c.connect();
    await wait(200);
    expect(registered).toBe(true);
    expect(seenByLateHandler).not.toContain('welcome');
    expect(seenByLateHandler).toContain('pong'); // but it does get later messages
    c.close();
  });

  it('keeps two separate tabs (separate tokens) as two different players', async () => {
    const a = new NetClient(`ws://localhost:${server.port}`, 'A', undefined);
    const b = new NetClient(`ws://localhost:${server.port}`, 'B', undefined);
    await a.connect();
    await b.connect();
    expect(a.token).not.toBe(b.token);
    const ja = nextMsg(a, 'joined');
    a.send({ t: 'create' });
    const roomA = await ja;
    const jb = nextMsg(b, 'joined');
    b.send({ t: 'join', code: roomA.code });
    const roomB = await jb;
    expect(roomB.you).not.toBe(roomA.you);
    await wait(300);
    expect(a.status).toBe('open');
    expect(b.status).toBe('open');
    a.close();
    b.close();
  });
});
