import { getMap, MAPS } from '../shared/maps';
import { MATCH_RESTART_MS, MAX_PLAYERS, RECONNECT_GRACE_MS, SNAPSHOT_EVERY_TICKS } from '../shared/net/protocol';
import type { ServerMsg } from '../shared/net/protocol';
import { Sim, TICK, emptyIntent } from '../shared/sim/sim';
import type { Intent, SimEvent } from '../shared/sim/sim';

/** The room only needs a way to send. Real sockets and test fakes both fit. */
export interface Conn {
  send(msg: ServerMsg): void;
}

export interface RoomOptions {
  mapId?: string;
  killLimit?: number;
  bots?: number;
  isPublic?: boolean;
  seed?: number;
  /** Start in a waiting room; the host presses Start. Private rooms use this, quick match does not. */
  lobby?: boolean;
}

const COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xeab308, 0xa855f7, 0xf97316, 0x06b6d4, 0xec4899];
const MAX_QUEUE = 6;

type QueuedInput = Intent & { seq: number };

export class Member {
  fighterId = 0;
  lastSeq = 0;
  ack = 0;
  queue: QueuedInput[] = [];
  last: Intent = emptyIntent();
  disconnectedAt: number | null = null;
  constructor(
    readonly token: string,
    public name: string,
    public conn: Conn | null,
    readonly colorIdx: number,
  ) {}
}

export class Room {
  sim!: Sim;
  members = new Map<string, Member>();
  tick = 0;
  mapId: string;
  readonly killLimit: number;
  readonly bots: number;
  readonly isPublic: boolean;
  idleSince: number | null;
  phase: 'lobby' | 'playing' = 'playing';
  hostToken: string | null = null;
  private lobbyDirty = true;
  private resetAt: number | null = null;
  private pendingEvents: SimEvent[] = [];
  private matchCount = 0;

  constructor(
    readonly code: string,
    readonly opts: RoomOptions = {},
    private now: () => number = Date.now,
  ) {
    this.mapId = getMap(opts.mapId ?? MAPS[Math.floor(Math.random() * MAPS.length)].id).id;
    this.killLimit = Math.max(1, Math.min(50, Math.floor(opts.killLimit ?? 15)));
    this.bots = Math.max(0, Math.min(3, Math.floor(opts.bots ?? 0)));
    this.isPublic = !!opts.isPublic;
    this.idleSince = this.now();
    this.startMatch(false);
    this.phase = opts.lobby ? 'lobby' : 'playing';
  }

  get connectedCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.conn) n++;
    return n;
  }

  get isFull() {
    return this.members.size >= MAX_PLAYERS;
  }

  // ---------- membership ----------

  addMember(token: string, name: string, conn: Conn): Member | null {
    if (this.isFull) return null;
    const used = new Set([...this.members.values()].map((m) => m.colorIdx));
    let colorIdx = 0;
    while (used.has(colorIdx)) colorIdx++;
    const m = new Member(token, name, conn, colorIdx);
    m.fighterId = this.sim.addFighter(name, false, COLORS[colorIdx % COLORS.length]).id;
    this.members.set(token, m);
    this.hostToken ??= token;
    this.lobbyDirty = true;
    this.idleSince = null;
    return m;
  }

  /** Reattach a returning player to their existing fighter. */
  reattach(token: string, conn: Conn): Member | null {
    const m = this.members.get(token);
    if (!m) return null;
    m.conn = conn;
    m.disconnectedAt = null;
    m.queue = [];
    this.lobbyDirty = true;
    this.idleSince = null;
    return m;
  }

  /** Socket dropped: keep the fighter for a grace period so the player can come back. */
  detach(token: string) {
    const m = this.members.get(token);
    if (!m) return;
    m.conn = null;
    m.disconnectedAt = this.now();
    this.lobbyDirty = true;
    if (token === this.hostToken) this.passHost(token);
    if (this.connectedCount === 0) this.idleSince = this.now();
  }

  removeMember(token: string) {
    const m = this.members.get(token);
    if (!m) return;
    this.sim.removeFighter(m.fighterId);
    this.members.delete(token);
    this.lobbyDirty = true;
    if (token === this.hostToken) this.passHost(token);
    if (this.connectedCount === 0) this.idleSince = this.now();
  }

  // ---------- input ----------

  pushInput(token: string, seq: number, intent: Intent) {
    const m = this.members.get(token);
    if (!m || seq <= m.lastSeq) return; // stale or duplicate
    m.lastSeq = seq;
    m.queue.push({ ...intent, seq });
    if (m.queue.length > MAX_QUEUE) m.queue.splice(0, m.queue.length - MAX_QUEUE);
  }

  // ---------- simulation ----------

  /** Host leaves or drops: the longest-present connected member takes over. */
  private passHost(leaving: string) {
    const next = [...this.members.values()].find((m) => m.token !== leaving && m.conn) ?? [...this.members.values()].find((m) => m.token !== leaving);
    this.hostToken = next?.token ?? null;
  }

  /** Host only: leave the lobby and begin the match. */
  start(token: string): boolean {
    if (this.phase !== 'lobby' || token !== this.hostToken) return false;
    this.phase = 'playing';
    this.startMatch();
    return true;
  }

  /** Host only, lobby only: change the map for the next match. */
  setMap(token: string, mapId: string): boolean {
    if (this.phase !== 'lobby' || token !== this.hostToken || !MAPS.some((m) => m.id === mapId)) return false;
    this.mapId = mapId;
    this.lobbyDirty = true;
    return true;
  }

  private broadcastLobby() {
    this.lobbyDirty = false;
    const players = [...this.members.values()].map((m) => ({ name: m.name, host: m.token === this.hostToken, connected: !!m.conn }));
    for (const m of this.members.values()) {
      m.conn?.send({ t: 'lobby', code: this.code, mapId: this.mapId, killLimit: this.killLimit, youAreHost: m.token === this.hostToken, players });
    }
  }

  private prune() {
    for (const m of [...this.members.values()]) {
      if (m.disconnectedAt !== null && this.now() - m.disconnectedAt > RECONNECT_GRACE_MS) this.removeMember(m.token);
    }
  }

  tickOnce() {
    if (this.phase === 'lobby') {
      this.tick++;
      if (this.lobbyDirty || this.tick % 60 === 0) this.broadcastLobby();
      if (this.tick % 60 === 0) this.prune();
      return;
    }
    const intents: Record<number, Intent> = {};
    for (const m of this.members.values()) {
      if (!m.conn) { intents[m.fighterId] = emptyIntent(); continue; } // disconnected fighters stand still
      const next = m.queue.shift();
      if (next) {
        const { seq, ...intent } = next;
        m.ack = seq;
        m.last = intent;
        intents[m.fighterId] = intent;
      } else {
        // no new input this tick: repeat the held keys, but never repeat one-shot buttons
        intents[m.fighterId] = { ...m.last, reload: false, swap: false, grenade: false };
      }
    }
    this.sim.step(TICK, intents);
    this.pendingEvents.push(...this.sim.drainEvents());
    this.tick++;

    if (this.tick % SNAPSHOT_EVERY_TICKS === 0) this.broadcastSnapshot();

    if (this.sim.over) {
      this.resetAt ??= this.now() + MATCH_RESTART_MS;
      if (this.now() >= this.resetAt) {
        this.resetAt = null;
        if (this.opts.lobby) {
          this.phase = 'lobby'; // private rooms go back to the waiting room
          this.lobbyDirty = true;
        } else this.startMatch();
      }
    }
    if (this.tick % 60 === 0) this.prune();
  }

  private startMatch(announce = true) {
    const rotate = this.isPublic && this.matchCount > 0;
    if (rotate) this.mapId = MAPS[(MAPS.findIndex((m) => m.id === this.mapId) + 1) % MAPS.length].id;
    this.matchCount++;
    this.sim = new Sim(getMap(this.mapId), { killLimit: this.killLimit, seed: (this.opts.seed ?? Math.floor(Math.random() * 2 ** 31)) + this.matchCount });
    for (let i = 0; i < this.bots; i++) this.sim.addFighter(`Bot ${i + 1}`, true, COLORS[(i + 4) % COLORS.length]);
    for (const m of this.members.values()) {
      m.fighterId = this.sim.addFighter(m.name, false, COLORS[m.colorIdx % COLORS.length]).id;
      m.queue = [];
      m.lastSeq = 0;
      m.ack = 0;
      m.last = emptyIntent();
      if (announce) m.conn?.send({ t: 'match', you: m.fighterId, mapId: this.mapId, killLimit: this.killLimit });
    }
    this.pendingEvents = [];
  }

  private broadcastSnapshot() {
    const s = this.sim;
    const base = {
      t: 'snap' as const,
      tick: this.tick,
      time: s.time,
      over: s.over,
      winner: s.winner,
      fighters: s.fighters,
      bullets: s.bullets,
      grenades: s.grenades,
      crates: s.crates.map((c) => ({ id: c.id, active: c.active, weapon: c.weapon })),
      events: this.pendingEvents,
    };
    for (const m of this.members.values()) m.conn?.send({ ...base, ack: m.ack });
    this.pendingEvents = [];
  }
}
