// Wire protocol between clients and the authoritative server. JSON over WebSocket.
// Clients only send INPUT. The server runs shared/sim and sends back the resulting state.

import type { BulletState, CrateState, FighterState, GrenadeState, Intent, SimEvent } from '../sim/sim';

export const TICK_HZ = 60;
export const SNAPSHOT_EVERY_TICKS = 3; // 20 snapshots per second
export const MAX_PLAYERS = 8;
export const RECONNECT_GRACE_MS = 30_000;
export const MATCH_RESTART_MS = 8_000;
export const DEFAULT_PORT = 2567;

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'create'; mapId?: string; killLimit?: number; bots?: number }
  | { t: 'join'; code: string }
  | { t: 'quick' }
  | { t: 'leave' }
  | { t: 'start' } // host only: leave the lobby and begin the match
  | { t: 'setmap'; mapId: string } // host only, lobby only
  | { t: 'input'; seq: number; intent: Intent }
  | { t: 'ping'; c: number };

export interface JoinedInfo {
  code: string;
  you: number; // your fighter id in the current match
  mapId: string;
  killLimit: number;
  resumed: boolean;
  phase: 'lobby' | 'playing';
}

export interface LobbyPlayer {
  name: string;
  host: boolean;
  connected: boolean;
}

export type ServerMsg =
  | { t: 'welcome'; token: string }
  | ({ t: 'joined' } & JoinedInfo)
  | { t: 'match'; you: number; mapId: string; killLimit: number } // a new match started in your room
  | { t: 'error'; message: string }
  | { t: 'lobby'; code: string; mapId: string; killLimit: number; youAreHost: boolean; players: LobbyPlayer[] }
  | { t: 'pong'; c: number; s: number }
  | {
      t: 'snap';
      tick: number;
      time: number;
      ack: number; // last input seq the server applied for you
      over: boolean;
      winner: number | null;
      fighters: FighterState[];
      bullets: BulletState[];
      grenades: GrenadeState[];
      crates: Pick<CrateState, 'id' | 'active' | 'weapon'>[];
      events: SimEvent[];
    };
