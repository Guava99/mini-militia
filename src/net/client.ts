import { DEFAULT_PORT, RECONNECT_GRACE_MS } from '../../shared/net/protocol';
import { parseWire } from '../../shared/net/wire';
import type { ClientMsg, ServerMsg } from '../../shared/net/protocol';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export const defaultServerUrl = () => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('server') : null;
  if (q) return q;
  if (typeof location === 'undefined' || !location.hostname) return `ws://localhost:${DEFAULT_PORT}`;
  // `npm run dev` serves the page from Vite, so the game server is on its own port. In production the
  // game server serves the page itself, so the WebSocket lives on the same origin.
  if (import.meta.env?.DEV) return `ws://${location.hostname}:${DEFAULT_PORT}`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
};

/** WebSocket wrapper: hello/token handshake, ping/RTT, and automatic reconnect into the same slot. */
export class NetClient {
  status: NetStatus = 'closed';
  /** Close code of the last dropped socket; 4000 means another connection took over this player. */
  lastCloseCode = 0;
  rtt = 0;
  token: string | null;
  private ws: WebSocket | null = null;
  private intentional = false;
  private handlers = new Set<(m: ServerMsg) => void>();
  private statusHandlers = new Set<(s: NetStatus) => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private dropAt = 0;
  private attempt = 0;
  private firstWelcome: (() => void) | null = null;

  constructor(
    readonly url: string,
    public name: string,
    private storage?: KeyValueStore,
  ) {
    this.token = this.storage?.getItem('mm_token') ?? null;
  }

  onMessage(h: (m: ServerMsg) => void) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: (s: NetStatus) => void) {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  /** Resolves once the server has said welcome; rejects if it cannot be reached. */
  connect(): Promise<void> {
    this.intentional = false;
    return new Promise((resolve, reject) => {
      this.firstWelcome = resolve;
      const timer = setTimeout(() => reject(new Error('could not reach the game server')), 6000);
      const off = this.onStatus((s) => {
        if (s === 'open') { clearTimeout(timer); off(); }
      });
      this.open('connecting');
    });
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.intentional = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPing();
    this.ws?.close();
    this.setStatus('closed');
  }

  /** Test helper: drop the socket the way a network failure would. */
  simulateDrop() {
    this.ws?.close();
  }

  private setStatus(s: NetStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const h of [...this.statusHandlers]) h(s);
  }

  private open(status: NetStatus) {
    this.setStatus(status);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => this.send({ t: 'hello', name: this.name, token: this.token ?? undefined });
    ws.onmessage = (ev) => {
      const m = parseWire(String(ev.data));
      if (!m) return;
      if (m.t === 'welcome') {
        this.token = m.token;
        try { this.storage?.setItem('mm_token', m.token); } catch { /* storage may be blocked */ }
        this.attempt = 0;
        this.setStatus('open');
        this.startPing();
        this.firstWelcome?.();
        this.firstWelcome = null;
      } else if (m.t === 'pong') {
        const sample = Date.now() - m.c;
        this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
      }
      // iterate a copy: a handler that registers another handler must not see the message it is handling
      for (const h of [...this.handlers]) h(m);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.lastCloseCode = ev.code;
      this.stopPing();
      if (ev.code === 4000) { this.setStatus('closed'); return; } // replaced by a newer connection: do not fight it
      if (this.intentional) { this.setStatus('closed'); return; }
      if (this.status !== 'reconnecting') this.dropAt = Date.now();
      if (Date.now() - this.dropAt > RECONNECT_GRACE_MS) { this.setStatus('closed'); return; }
      this.setStatus('reconnecting');
      this.retryTimer = setTimeout(() => this.open('reconnecting'), Math.min(500 * ++this.attempt, 3000));
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private startPing() {
    this.stopPing();
    const ping = () => this.send({ t: 'ping', c: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
