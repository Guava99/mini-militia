import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/net/protocol';
import { parseWire } from '../shared/net/wire';
import { emptyIntent } from '../shared/sim/sim';
import { createServer } from './index';
import type { GameServer } from './index';

let server: GameServer;
beforeAll(async () => { server = await createServer(0); });
afterAll(async () => { await server.close(); });

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  token = '';
  constructor(readonly port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.on('message', (d) => {
      const m = parseWire(d.toString());
      if (!m) return;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }
  open() { return new Promise<void>((res) => (this.ws.readyState === WebSocket.OPEN ? res() : this.ws.once('open', () => res()))); }
  send(m: ClientMsg | Record<string, unknown>) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMsg['t']>(t: T, timeout = 3000): Promise<Extract<ServerMsg, { t: T }>> {
    const hit = this.msgs.find((m) => m.t === t);
    if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit as Extract<ServerMsg, { t: T }>); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeout);
      this.waiters.push({ pred: (m) => m.t === t, resolve: (m) => { clearTimeout(timer); this.msgs.splice(this.msgs.indexOf(m), 1); resolve(m as Extract<ServerMsg, { t: T }>); } });
    });
  }
  async hello(name: string, token?: string) {
    await this.open();
    this.send({ t: 'hello', name, token });
    this.token = (await this.next('welcome')).token;
  }
  close() { this.ws.close(); }
}

const connect = async (name: string) => { const c = new Client(server.port); await c.hello(name); return c; };

describe('rooms over real websockets', () => {
  it('creates a private room, lets a friend join by code, and streams snapshots with both players', async () => {
    const a = await connect('Ann');
    a.send({ t: 'create', mapId: 'canyon-base' });
    const joinedA = await a.next('joined');
    expect(joinedA.code).toMatch(/^[A-Z]{4}$/);
    expect(joinedA.mapId).toBe('canyon-base');

    const b = await connect('Bob');
    b.send({ t: 'join', code: joinedA.code.toLowerCase() }); // codes are case-insensitive
    const joinedB = await b.next('joined');
    expect(joinedB.code).toBe(joinedA.code);
    expect(joinedB.you).not.toBe(joinedA.you);
    expect(joinedA.phase).toBe('lobby'); // private rooms wait for the host

    a.send({ t: 'start' });
    await a.next('match');
    const snap = await a.next('snap');
    expect(snap.fighters.map((f) => f.name).sort()).toEqual(['Ann', 'Bob']);
    a.close(); b.close();
  });

  it('lobby: the host picks the map and starts; a non-host cannot; both players get the match', async () => {
    const a = await connect('Ann');
    a.send({ t: 'create', mapId: 'training-arena' });
    const ja = await a.next('joined');
    const b = await connect('Bob');
    b.send({ t: 'join', code: ja.code });
    expect((await b.next('joined')).phase).toBe('lobby');

    let lobby = await b.next('lobby');
    while (lobby.players.length < 2) lobby = await b.next('lobby');
    expect(lobby.youAreHost).toBe(false);
    expect(lobby.players.find((p) => p.host)!.name).toBe('Ann');

    b.send({ t: 'start' }); // Bob is not the host
    expect((await b.next('error')).message).toMatch(/host/);
    a.send({ t: 'setmap', mapId: 'canyon-base' });
    a.send({ t: 'start' });
    const [ma, mb] = await Promise.all([a.next('match'), b.next('match')]);
    expect(ma.mapId).toBe('canyon-base');
    expect(mb.you).not.toBe(ma.you);
    expect((await a.next('snap')).fighters.length).toBe(2);
    a.close(); b.close();
  });

  it('rejects unknown room codes and double joins', async () => {
    const a = await connect('Ann');
    a.send({ t: 'join', code: 'ZZZZ' });
    expect((await a.next('error')).message).toMatch(/no such room/);
    a.send({ t: 'create' });
    await a.next('joined');
    a.send({ t: 'create' });
    expect((await a.next('error')).message).toMatch(/already/);
    a.close();
  });

  it('quick match puts two players in the same public room with bots', async () => {
    const a = await connect('Ann');
    a.send({ t: 'quick' });
    const ja = await a.next('joined');
    const b = await connect('Bob');
    b.send({ t: 'quick' });
    const jb = await b.next('joined');
    expect(jb.code).toBe(ja.code);
    const snap = await b.next('snap');
    expect(snap.fighters.filter((f) => f.isBot).length).toBe(2);
    a.close(); b.close();
  });

  it('applies a client\'s inputs on the server and acknowledges them', async () => {
    const a = await connect('Ann');
    a.send({ t: 'create', mapId: 'training-arena' });
    await a.next('joined');
    a.send({ t: 'start' });
    const j = await a.next('match'); // the match assigns the real fighter id
    await new Promise((r) => setTimeout(r, 700)); // let the fighter land
    const first = await a.next('snap');
    const x0 = first.fighters.find((f) => f.id === j.you)!.x;
    let seq = 0;
    const timer = setInterval(() => a.send({ t: 'input', seq: ++seq, intent: { ...emptyIntent(), right: true } }), 16);
    await new Promise((r) => setTimeout(r, 600));
    clearInterval(timer);
    let last = await a.next('snap');
    while (a.msgs.some((m) => m.t === 'snap')) last = await a.next('snap');
    const me = last.fighters.find((f) => f.id === j.you)!;
    expect(Math.abs(me.x - x0)).toBeGreaterThan(30);
    expect(last.ack).toBeGreaterThan(5);
    a.close();
  });

  it('survives garbage, oversized and malicious messages without crashing', async () => {
    const a = await connect('Ann');
    a.send({ t: 'create' });
    await a.next('joined');
    a.send({ t: 'start' });
    const j = await a.next('match');
    a.ws.send('not json at all');
    a.ws.send(JSON.stringify([1, 2, 3]));
    a.ws.send(JSON.stringify({ t: 'input', seq: 1, intent: { left: 'yes', aim: 'NaN', fire: { x: 1 } } }));
    a.ws.send(JSON.stringify({ t: 'input', seq: 1.5, intent: {} }));
    a.send({ t: 'ping', c: 42 });
    const pong = await a.next('pong');
    expect(pong.c).toBe(42);
    const snap = await a.next('snap');
    expect(snap.fighters.find((f) => f.id === j.you)!.aim).toBe(0);
    a.close();
  });

  it('requires hello before anything else', async () => {
    const c = new Client(server.port);
    await c.open();
    c.send({ t: 'create' });
    expect((await c.next('error')).message).toMatch(/hello/);
    c.close();
  });

  it('lets a dropped player reconnect with their token and keep the same fighter', async () => {
    const a = await connect('Ann');
    a.send({ t: 'create' });
    const created = await a.next('joined');
    a.send({ t: 'start' });
    const j = await a.next('match');
    const token = a.token;
    a.close();
    await new Promise((r) => setTimeout(r, 200));

    const again = new Client(server.port);
    await again.hello('Ann', token);
    const rejoined = await again.next('joined');
    expect(rejoined.resumed).toBe(true);
    expect(rejoined.phase).toBe('playing');
    expect(rejoined.code).toBe(created.code);
    expect(rejoined.you).toBe(j.you);
    const snap = await again.next('snap');
    expect(snap.fighters.some((f) => f.id === j.you)).toBe(true);
    again.close();
  });

  it('reports health', async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect((await res.json()).ok).toBe(true);
  });
});
