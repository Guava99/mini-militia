import Phaser from 'phaser';
import { sfx } from '../audio';
import { CameraSplit } from '../camera';
import { InputReader } from '../input';
import { PauseMenu } from '../ui';
import { NetClient, defaultServerUrl } from '../net/client';
import { Predictor } from '../net/predictor';
import type { Snap } from '../net/predictor';
import { INTERP_DELAY_MS, SnapshotBuffer } from '../net/snapshots';
import { getPlayerName, sessionStore } from '../prefs';
import { Fx, Renderer, buildWorld } from '../render';
import { getMap, MAPS } from '../../shared/maps';
import type { MapDef } from '../../shared/mapTypes';
import type { JoinedInfo, ServerMsg } from '../../shared/net/protocol';
import { TICK } from '../../shared/sim/sim';
import { WEAPONS } from '../../shared/sim/weapons';

interface StartData {
  mode?: 'quick' | 'create' | 'join';
  mapId?: string;
  code?: string;
  name?: string;
  joined?: JoinedInfo; // set when the scene restarts for a new match
}

/**
 * Online play. The server is the authority. This scene:
 *  - predicts the local player with the shared rules so controls feel instant,
 *  - reconciles against server snapshots (replaying inputs the server has not seen),
 *  - interpolates other players 100 ms in the past so their motion is smooth.
 */
export class OnlineScene extends Phaser.Scene {
  private net!: NetClient;
  private info!: JoinedInfo;
  private map!: MapDef;
  private pred: Predictor | null = null;
  private buffer = new SnapshotBuffer();
  private fx = new Fx();
  private stage!: Renderer;
  private split: CameraSplit | null = null;
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private reader!: InputReader;
  private camTarget!: Phaser.GameObjects.Rectangle;
  private acc = 0;
  private offs: (() => void)[] = [];
  private startData: StartData = {};

  constructor() {
    super('online');
  }

  init(data: StartData) {
    this.startData = data ?? {};
  }

  create() {
    this.pred = null;
    this.split = null;
    this.buffer = new SnapshotBuffer();
    this.fx = new Fx();
    this.acc = 0;
    this.offs = [];
    this.cameras.main.setBackgroundColor('#27384d');
    this.banner = this.add.text(640, 300, '', { fontFamily: 'monospace', fontSize: '40px', color: '#fff', stroke: '#000', strokeThickness: 6, align: 'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.events.once('shutdown', () => this.offs.forEach((off) => off()));

    const d = this.startData;
    this.net = this.registry.get('net') as NetClient;
    if (d.joined && this.net && this.net.status === 'open') {
      this.begin(d.joined);
      return;
    }
    this.banner.setText('Connecting...');
    void this.connect(d);
  }

  private async connect(d: StartData) {
    if (!this.net || this.net.status === 'closed') {
      this.net = new NetClient(defaultServerUrl(), d.name ?? getPlayerName(), sessionStore());
      this.registry.set('net', this.net);
    }
    try {
      if (this.net.status !== 'open') await this.net.connect();
    } catch {
      this.fail(`Cannot reach the game server at\n${defaultServerUrl()}\n\nStart it with:  npm run server`);
      return;
    }
    const off = this.net.onMessage((m) => {
      if (m.t === 'joined') { off(); this.begin(m); }
      else if (m.t === 'error') { off(); this.fail(m.message); }
    });
    this.offs.push(off);
    if (d.mode === 'create') this.net.send({ t: 'create', mapId: d.mapId });
    else if (d.mode === 'join') this.net.send({ t: 'join', code: d.code ?? '' });
    else this.net.send({ t: 'quick' });
  }

  private fail(message: string) {
    this.banner.setText(`${message}\n\n(click to go back)`);
    this.input.once('pointerdown', () => this.scene.start('menu'));
  }

  private leave() {
    this.net?.send({ t: 'leave' });
    this.scene.start('menu');
  }

  // ---------- joined: build the world and start listening ----------

  private begin(info: JoinedInfo) {
    this.info = info;
    if (info.phase === 'lobby') {
      this.beginLobby(info);
      return;
    }
    this.map = getMap(info.mapId);
    this.banner.setText('Joining...');
    buildWorld(this, this.map);
    this.camTarget = this.add.rectangle(this.map.width / 2, this.map.height / 2, 2, 2, 0, 0);
    this.cameras.main.startFollow(this.camTarget, true, 0.12, 0.12);
    this.stage = new Renderer(this, this.fx);
    this.hud = this.add.text(16, 12, '', { fontFamily: 'monospace', fontSize: '20px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setScrollFactor(0).setDepth(30);
    this.reader = new InputReader(this);
    new PauseMenu(this, { title: `Room ${info.code}`, note: 'The match keeps running while this menu is open', onLeave: () => this.leave() });

    this.split = new CameraSplit(this); // world zoomed, interface not
    this.listen();
  }

  private listen() {
    this.offs.push(this.net.onMessage((m) => this.onMessage(m)));
    this.offs.push(
      this.net.onStatus((st) => {
        if (st !== 'closed') return;
        this.fail(this.net.lastCloseCode === 4000 ? 'This player was opened in another tab or window.' : 'Disconnected from the server.');
      }),
    );
  }

  // ---------- lobby: the waiting room of a private room ----------

  private lobby: { players?: Phaser.GameObjects.Text; map?: Phaser.GameObjects.Text; start?: Phaser.GameObjects.Text; note?: Phaser.GameObjects.Text; host: boolean; mapId: string } = { host: false, mapId: '' };

  private beginLobby(info: JoinedInfo) {
    this.lobby = { host: false, mapId: info.mapId };
    this.banner.setText('');
    this.add.graphics().fillGradientStyle(0x27384d, 0x27384d, 0x4b6a8a, 0x4b6a8a, 1).fillRect(0, 0, 1280, 720);
    this.add.text(640, 80, `ROOM  ${info.code}`, { fontFamily: 'monospace', fontSize: '64px', color: '#fff', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);
    const web = window.location.protocol.startsWith('http') ? `  or open ${window.location.origin}` : '';
    this.add.text(640, 145, `Friends: "Join private room" and enter the code${web}`, { fontFamily: 'monospace', fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5);
    const copy = this.lobbyButton(640, 195, 'Copy code', () => {
      void navigator.clipboard?.writeText(info.code).then(() => copy.setText('Copied!'), () => copy.setText(info.code));
    }, 20);
    this.lobby.players = this.add.text(640, 330, '', { fontFamily: 'monospace', fontSize: '28px', color: '#fff', align: 'center', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
    this.lobby.map = this.lobbyButton(640, 470, '', () => {
      if (!this.lobby.host) return;
      const i = MAPS.findIndex((m) => m.id === this.lobby.mapId);
      this.net.send({ t: 'setmap', mapId: MAPS[(i + 1) % MAPS.length].id });
    }, 24);
    this.lobby.start = this.lobbyButton(640, 540, 'Start match', () => this.net.send({ t: 'start' }), 32);
    this.lobby.note = this.add.text(640, 605, '', { fontFamily: 'monospace', fontSize: '20px', color: '#cbd5e1' }).setOrigin(0.5);
    this.lobbyButton(640, 665, 'Leave room', () => this.leave(), 20);
    this.updateLobby({ t: 'lobby', code: info.code, mapId: info.mapId, killLimit: info.killLimit, youAreHost: false, players: [] });
    this.listen();
  }

  private updateLobby(m: Extract<ServerMsg, { t: 'lobby' }>) {
    const L = this.lobby;
    L.host = m.youAreHost;
    L.mapId = m.mapId;
    const rows = m.players.map((p) => `${p.host ? '★ ' : '  '}${p.name}${p.connected ? '' : '  (reconnecting...)'}`);
    L.players?.setText(rows.length ? `Players (${rows.length})\n\n${rows.join('\n')}` : 'Waiting for players...');
    const mapName = getMap(m.mapId).name;
    L.map?.setText(L.host ? `Map: ${mapName}  (click to change)` : `Map: ${mapName}`);
    L.start?.setVisible(L.host);
    L.note?.setText(L.host ? `First to ${m.killLimit} kills. Start when your friends have joined.` : 'Waiting for the host to start the match...');
  }

  private lobbyButton(x: number, y: number, label: string, onClick: () => void, size: number) {
    const t = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: `${size}px`, color: '#fff', backgroundColor: '#1e293b', padding: { x: 20, y: 10 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setBackgroundColor('#334155'));
    t.on('pointerout', () => t.setBackgroundColor('#1e293b'));
    t.on('pointerup', onClick);
    return t;
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'lobby':
        // in a lobby: refresh it. Mid-match (the match ended and the room returned to the lobby): rebuild as a lobby.
        if (this.info.phase === 'lobby') this.updateLobby(m);
        else this.scene.restart({ joined: { code: this.info.code, you: this.info.you, mapId: m.mapId, killLimit: m.killLimit, resumed: false, phase: 'lobby' } });
        break;
      case 'snap':
        this.buffer.push(performance.now(), m);
        if (!this.pred) {
          const me = m.fighters.find((f) => f.id === this.info.you);
          if (me) this.pred = new Predictor(this.map, this.info.you, me);
        } else this.pred.reconcile(m);
        this.handleEvents(m);
        break;
      case 'match': // a new match started in this room: rebuild the scene
        this.scene.restart({ joined: { code: this.info.code, you: m.you, mapId: m.mapId, killLimit: m.killLimit, resumed: false, phase: 'playing' } });
        break;
      case 'joined':
        // sent again after a reconnect; if the server no longer knows us, go back to the menu
        if (!m.resumed) this.fail('Your session expired. Please join again.');
        break;
      case 'error':
        this.banner.setText(m.message);
        break;
      default:
        break;
    }
  }

  private handleEvents(snap: Snap) {
    const you = this.info.you;
    for (const e of snap.events) {
      switch (e.type) {
        case 'shoot': {
          const s = snap.fighters.find((f) => f.id === e.id);
          const me = this.pred?.me;
          if (s && me && (s.id === you || Math.hypot(s.x - me.x, s.y - me.y) < 900)) sfx.shoot(e.heavy);
          break;
        }
        case 'explode':
          sfx.explode();
          this.fx.ring(e.x, e.y, e.radius);
          this.cameras.main.shake(150, 0.006);
          break;
        case 'spark': this.fx.spark(e.x, e.y, e.color); break;
        case 'hit': sfx.hit(); break;
        case 'die': sfx.die(); break;
        case 'reload': if (e.id === you) sfx.reload(); break;
        case 'pickup': if (e.id === you) sfx.pickup(); break;
        default: break;
      }
    }
  }

  // ---------- frame loop ----------

  update(_time: number, delta: number) {
    this.split?.sync();
    if (!this.pred) return;
    const pred = this.pred;
    const open = this.net.status === 'open';
    this.reader.update();
    this.acc += Math.min(delta / 1000, 0.1);
    if (open) {
      const intent = this.reader.read(pred.me);
      let steps = 0;
      while (this.acc >= TICK && steps < 6) {
        const i = { ...intent };
        if (steps > 0) { i.reload = false; i.swap = false; i.grenade = false; } // one-shot buttons: first step only
        const msg = pred.nextInput(i);
        this.net.send({ t: 'input', seq: msg.seq, intent: msg.intent });
        this.acc -= TICK;
        steps++;
      }
      if (steps === 6) this.acc = 0;
    } else this.acc = 0; // frozen while reconnecting
    pred.decay(delta / 1000);
    this.fx.update(delta / 1000);

    const latest = this.buffer.latest;
    if (!latest) return;
    const now = performance.now();
    const local = { ...pred.me, x: pred.me.x + pred.corr.x, y: pred.me.y + pred.corr.y };
    const remote = this.buffer.fighters(now - INTERP_DELAY_MS).filter((f) => f.id !== this.info.you);
    this.camTarget.setPosition(local.x, local.y);
    this.stage.frame(
      {
        time: latest.time + (now - this.buffer.latestTime) / 1000,
        fighters: [...remote, local],
        bullets: this.buffer.bullets(now),
        grenades: latest.grenades,
        crates: this.map.pickups.map((p, i) => ({ x: p.x, y: p.y, active: latest.crates[i]?.active ?? false })),
        localId: this.info.you,
      },
      this.reader.crosshair(),
      delta / 1000,
    );
    this.updateHud(latest, local.hp);
  }

  private updateHud(latest: Snap, hp: number) {
    const p = this.pred!.me;
    const w = WEAPONS[p.weapon];
    const ammo = p.reloadUntil ? `RELOADING ${Math.max(0, p.reloadUntil - this.pred!.sim.time).toFixed(1)}s` : `${p.ammo}/${w.mag}`;
    const alt = p.altWeapon ? `  Alt: ${WEAPONS[p.altWeapon].name} ${p.altAmmo}` : '';
    const board = [...latest.fighters].sort((a, b) => b.kills - a.kills).map((f) => `${(f.id === this.info.you ? '> ' : '  ') + f.name.padEnd(8)} ${f.kills}`).join('\n');
    this.hud.setText(
      `HP ${Math.max(0, Math.ceil(hp))}  FUEL ${Math.ceil(p.fuel)}\n${w.name}  ${ammo}\nGrenades ${p.grenades}${alt}\n\n` +
      `Room ${this.info.code} - ${this.map.name}\nFirst to ${this.info.killLimit}   ping ${Math.round(this.net.rtt)} ms\n${board}`,
    );
    if (this.net.status !== 'open') this.banner.setText('Connection lost - reconnecting...');
    else if (latest.over) {
      const win = latest.fighters.find((f) => f.id === latest.winner);
      this.banner.setText(`${win?.name ?? '?'} wins!\nNext match starting...`);
    } else this.banner.setText(p.dead ? 'You died - respawning...' : '');
  }
}
