import type Phaser from 'phaser';
import type { MapDef } from '../../shared/mapTypes';
import { MAX_FUEL, MAX_HP } from '../../shared/sim/sim';
import type { FighterState } from '../../shared/sim/sim';
import { WEAPONS } from '../../shared/sim/weapons';
import { artUrl } from '../assets';
import { el, setFill, setText } from './dom';
import { feedEntry, ordinal, scoreboard } from './hudModel';
import type { FeedName, ScoreFighter } from './hudModel';
import { Minimap } from './minimap';
import type { MapDot } from './minimap';
import { applyTokens } from './tokens';
import './hud.css';

const FEED_MS = 5000;
const FEED_MAX = 4;

const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.4-4.5-9.9-9.1C.4 8.6 2.3 4 6.4 4c2.3 0 3.9 1.3 5.6 3.4C13.7 5.3 15.3 4 17.6 4c4.1 0 6 4.6 4.3 7.9C19.4 16.5 12 21 12 21z"/></svg>';

/** Everything the HUD shows, filled in by the scene each frame. The HUD never reads the sim or the network itself. */
export interface HudView {
  /** Round-trip time to the server in ms, or null when offline. */
  ping: number | null;
  youId: number;
  /** Everyone's name, colour and kills, for the score bar. */
  fighters: readonly ScoreFighter[];
  killLimit: number;
  /** Where everyone is drawn right now, for the minimap. */
  dots: readonly MapDot[];
  /** Your own fighter: health, fuel, weapons, grenades. */
  me: FighterState;
  /** Sim time in seconds, to show how long a reload has left. */
  time: number;
}

/**
 * The in-game heads-up display: an HTML layer over the canvas, so text is drawn at the phone's real
 * resolution (sharp) and the layout can follow safe areas. Removed automatically when the scene shuts down.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private safe: HTMLDivElement;
  private ping: HTMLSpanElement;
  private fps: HTMLSpanElement;
  private nextFps = 0;
  private feed: HTMLDivElement;
  private feedRows: { row: HTMLElement; until: number }[] = [];
  private score: { you: HTMLElement; rank: HTMLElement; goal: HTMLElement; rivalName: HTMLElement; rival: HTMLElement; rivalBox: HTMLElement };
  private minimap: Minimap;
  private vitals: { box: HTMLElement; hp: HTMLElement; fuel: HTMLElement };
  private gun: {
    box: HTMLElement; icon: HTMLImageElement; ammo: HTMLElement; mag: HTMLElement; name: HTMLElement; bar: HTMLElement;
    alt: HTMLElement; altIcon: HTMLImageElement; altAmmo: HTMLElement; nades: HTMLElement; weapon: string; altWeapon: string;
  };

  constructor(private scene: Phaser.Scene, opts: { map: MapDef; onPause: () => void }) {
    applyTokens();
    this.root = el('div', 'ui-layer hud');
    this.safe = el('div', 'ui-safe', this.root);

    // top left: minimap, then health and jetpack fuel
    const tl = el('div', 'hud-tl', this.safe);
    this.minimap = new Minimap(tl, opts.map);
    const vit = el('div', 'ui-panel hud-vitals', tl);
    el('span', 'hud-heart', vit).innerHTML = HEART_SVG;
    const meters = el('div', 'hud-meters', vit);
    const meter = (cls: string) => el('i', 'hud-fill', el('div', `hud-meter ${cls}`, meters));
    this.vitals = { box: vit, hp: meter('is-hp'), fuel: meter('is-fuel') };

    // top centre: your score | your place + goal | best opponent's score
    const bar = el('div', 'hud-score', this.safe);
    const youBox = el('div', 'hud-side is-you', bar);
    el('span', 'ui-label', youBox).textContent = 'You';
    const you = el('span', 'ui-num hud-side-num', youBox);
    const mid = el('div', 'hud-mid', bar);
    const rank = el('span', 'ui-num hud-rank', mid);
    const goal = el('span', 'ui-label', mid);
    const rivalBox = el('div', 'hud-side is-rival', bar);
    const rivalName = el('span', 'ui-label hud-rival-name', rivalBox);
    const rival = el('span', 'ui-num hud-side-num', rivalBox);
    this.score = { you, rank, goal, rivalName, rival, rivalBox };

    // top right: connection row, kill feed under it
    const tr = el('div', 'hud-tr', this.safe);
    const net = el('div', 'hud-net', tr);
    this.feed = el('div', 'hud-feed', tr);
    const pingBox = el('span', 'hud-ping', net);
    const bars = el('i', 'hud-bars', pingBox);
    bars.append(el('b', ''), el('b', ''), el('b', ''));
    this.ping = el('span', '', pingBox);
    this.fps = el('span', 'hud-fps', net);
    // bottom centre: weapon, ammo, spare weapon, grenades
    const gun = el('div', 'ui-panel hud-gun', this.safe);
    const icon = el('img', 'hud-gun-icon', gun);
    const main = el('div', 'hud-gun-main', gun);
    const count = el('div', 'hud-gun-count', main);
    const ammo = el('span', 'ui-num hud-gun-ammo', count);
    const mag = el('span', 'hud-gun-mag', count);
    const name = el('span', 'ui-label hud-gun-name', main);
    const side = el('div', 'hud-gun-side', gun);
    const alt = el('div', 'hud-gun-alt', side);
    const altIcon = el('img', '', alt);
    const altAmmo = el('span', '', alt);
    const nades = el('span', 'hud-gun-nades', side);
    const gunBar = el('i', 'hud-fill', el('div', 'hud-gun-bar', gun));
    icon.alt = altIcon.alt = '';
    this.gun = { box: gun, icon, ammo, mag, name, bar: gunBar, alt, altIcon, altAmmo, nades, weapon: '', altWeapon: '' };

    const pause = el('button', 'ui-btn hud-pause', net);
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('pointerdown', (e) => { e.stopPropagation(); opts.onPause(); });

    document.body.append(this.root);
    scene.events.once('shutdown', () => this.destroy());
    scene.events.once('destroy', () => this.destroy());
  }

  update(v: HudView) {
    const s = scoreboard(v.fighters, v.youId);
    const S = this.score;
    setText(S.you, String(s.you?.kills ?? 0));
    setText(S.rank, ordinal(s.rank));
    setText(S.goal, `First to ${v.killLimit}`);
    S.rivalBox.classList.toggle('is-empty', !s.rival); // keeps its space so the bar stays centred
    if (s.rival) {
      setText(S.rivalName, s.rival.name);
      setText(S.rival, String(s.rival.kills));
    }

    const me = v.me;
    const hp = me.hp / MAX_HP;
    setFill(this.vitals.hp, hp);
    setFill(this.vitals.fuel, me.fuel / MAX_FUEL);
    this.vitals.box.classList.toggle('is-low', hp > 0 && hp <= 0.3);
    this.minimap.draw(v.dots, v.youId);
    this.updateGun(me, v.time);

    const box = this.ping.parentElement!;
    if (v.ping === null) box.hidden = true;
    else {
      box.hidden = false;
      const ms = Math.round(v.ping);
      setText(this.ping, `${ms} ms`);
      box.dataset.q = ms < 80 ? 'good' : ms < 150 ? 'warn' : 'bad';
    }
    const now = performance.now();
    while (this.feedRows.length && this.feedRows[0].until <= now) this.feedRows.shift()!.row.remove();
    if (now >= this.nextFps) { // twice a second is plenty for a number people glance at
      this.nextFps = now + 500;
      setText(this.fps, `${Math.round(this.scene.game.loop.actualFps)} FPS`);
    }
  }

  private updateGun(me: FighterState, time: number) {
    const G = this.gun;
    const w = WEAPONS[me.weapon] ?? WEAPONS.pistol;
    if (G.weapon !== me.weapon) { // images and names only change on a swap or pickup
      G.weapon = me.weapon;
      G.icon.src = artUrl(me.weapon) ?? '';
      setText(G.name, w.name);
    }
    const reloading = me.reloadUntil > 0;
    setText(G.ammo, String(me.ammo));
    setText(G.mag, `/ ${w.mag}`);
    G.box.dataset.state = reloading ? 'reload' : me.ammo === 0 ? 'empty' : me.ammo <= w.mag / 4 ? 'low' : '';
    // the bar shows the magazine, or how far the reload has got
    setFill(G.bar, reloading ? 1 - Math.max(0, me.reloadUntil - time) / w.reloadS : me.ammo / w.mag);

    G.alt.hidden = !me.altWeapon;
    if (me.altWeapon && G.altWeapon !== me.altWeapon) {
      G.altWeapon = me.altWeapon;
      G.altIcon.src = artUrl(me.altWeapon) ?? '';
    }
    if (me.altWeapon) setText(G.altAmmo, String(me.altAmmo));
    setText(G.nades, `G ×${me.grenades}`);
  }

  /** Add a kill-feed row. Rows fade after FEED_MS; only the newest FEED_MAX stay. */
  kill(victim: ScoreFighter, by: ScoreFighter | undefined, youId: number) {
    const e = feedEntry(victim, by, youId);
    const row = el('div', `hud-feed-row${e.mine ? ' is-mine' : ''}`);
    const name = (n: FeedName) => {
      const s = el('span', 'hud-feed-name', row);
      s.textContent = n.text;
      s.style.color = n.you ? '' : n.color; // YOU is always amber, from the stylesheet
      if (n.you) s.classList.add('is-you');
    };
    if (e.killer) name(e.killer);
    el('i', e.killer ? 'hud-arrow' : 'hud-cross', row);
    name(e.victim);
    this.feed.prepend(row); // newest on top
    this.feedRows.push({ row, until: performance.now() + FEED_MS });
    while (this.feedRows.length > FEED_MAX) this.feedRows.shift()!.row.remove();
  }

  /** Dim the HUD while the pause menu is open. */
  setPaused(open: boolean) {
    this.root.classList.toggle('is-paused', open);
  }

  destroy() {
    this.root.remove();
  }
}
