import type Phaser from 'phaser';
import { el } from './ui/dom';
import { applyTokens } from './ui/tokens';
import './ui/touch.css';

/** Only the stick zones below this fraction of the screen height react, so the top HUD stays tappable. */
const ZONE_TOP = 0.22;
/** Left part of the screen that belongs to the move stick; the rest is the aim stick. */
const MOVE_ZONE = 0.42;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  jet: svg('<path fill="currentColor" stroke="none" d="M12 2c1 4-3 6-3 10a3 3 0 0 0 6 0c0-1.5-.6-2.6-1.2-3.5C16.5 10 18 12.6 18 15a6 6 0 0 1-12 0c0-5 5-7 6-13z"/>'),
  reload: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9M4 13a8 8 0 0 0 14.3 4.9"/><path d="M5 2.5v4h4M19 21.5v-4h-4"/>'),
  swap: svg('<path d="M4 8h15l-4-4M20 16H5l4 4"/>'),
  nade: svg('<circle cx="11" cy="14.5" r="6.5" fill="currentColor" stroke="none"/><path d="M8.5 8V5h5v3M13.5 5l4-2.5"/>'),
};

interface Stick {
  base: HTMLElement;
  knob: HTMLElement;
  id: number | null; // pointer currently holding it
  ox: number; // where the finger came down (CSS px)
  oy: number;
  dx: number; // how far it has moved since
  dy: number;
}

/**
 * On-screen controls for phones, drawn in HTML over the canvas:
 * left stick = move (push up also fires the jetpack), right stick = aim and fire,
 * plus jetpack (hold), grenade, reload and swap buttons. Several fingers work at once.
 * The public fields are what InputReader turns into an Intent, exactly as before.
 */
export class TouchControls {
  enabled = false;
  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;
  firing = false;
  jetHeld = false;
  reloadPressed = false;
  swapPressed = false;
  grenadePressed = false;
  private suspended = false;
  private root: HTMLDivElement;
  private move: Stick;
  private aim: Stick;
  private jet: HTMLButtonElement;
  private nades: HTMLElement;
  private nadeBtn: HTMLButtonElement;
  private fuel = -1;
  private off: (() => void)[] = [];

  constructor(scene: Phaser.Scene) {
    applyTokens();
    this.root = el('div', 'ui-layer touch');
    const safe = el('div', 'ui-safe', this.root);
    const stick = (cls: string): Stick => {
      const base = el('div', `touch-stick ${cls}`, safe);
      return { base, knob: el('div', 'touch-knob', base), id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    };
    this.move = stick('is-move');
    this.aim = stick('is-aim');

    this.jet = this.button(safe, 'is-jet', 'Jetpack', ICONS.jet, { down: () => { this.jetHeld = true; }, up: () => { this.jetHeld = false; } });
    el('span', 'touch-jet-label', this.jet).textContent = 'Jetpack';
    this.button(safe, 'is-reload', 'Reload', ICONS.reload, { down: () => { this.reloadPressed = true; } });
    this.button(safe, 'is-swap', 'Swap weapon', ICONS.swap, { down: () => { this.swapPressed = true; } });
    this.nadeBtn = this.button(safe, 'is-nade', 'Grenade', ICONS.nade, { down: () => { this.grenadePressed = true; } });
    this.nades = el('span', 'touch-count', this.nadeBtn);

    // sticks listen on the whole window: a finger can start anywhere in its zone, not just on the drawn ring
    this.listen('pointerdown', (e) => this.down(e));
    this.listen('pointermove', (e) => this.moveTo(e));
    this.listen('pointerup', (e) => this.up(e));
    this.listen('pointercancel', (e) => this.up(e));

    if (window.matchMedia?.('(pointer: coarse)').matches) this.enable(); // a phone: show the controls straight away
    document.body.append(this.root);
    scene.events.once('shutdown', () => this.destroy());
    scene.events.once('destroy', () => this.destroy());
  }

  private listen(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', fn: (e: PointerEvent) => void) {
    window.addEventListener(type, fn);
    this.off.push(() => window.removeEventListener(type, fn));
  }

  /** A round button. Pressing it never starts a stick, and holding works even if the finger slides off. */
  private button(parent: HTMLElement, cls: string, label: string, icon: string, on: { down: () => void; up?: () => void }) {
    const b = el('button', `ui-btn touch-btn ${cls}`, parent);
    b.setAttribute('aria-label', label);
    el('span', 'touch-icon', b).innerHTML = icon; // our own constant markup, never user text
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.suspended) return;
      this.enable();
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('is-down');
      on.down();
    });
    const release = () => { b.classList.remove('is-down'); on.up?.(); };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    return b;
  }

  private enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.root.classList.add('is-on');
    document.body.classList.add('touch-on');
  }

  private down(e: PointerEvent) {
    if (e.pointerType !== 'touch' || this.suspended) return;
    this.enable();
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (e.clientY < h * ZONE_TOP) return;
    const s = e.clientX < w * MOVE_ZONE ? this.move : this.aim;
    if (s.id !== null) return; // that stick already has a finger
    s.id = e.pointerId;
    s.ox = e.clientX;
    s.oy = e.clientY;
    s.dx = s.dy = 0;
    // the ring jumps to the finger, so you never have to find it by feel
    const r = s.base.getBoundingClientRect();
    s.base.style.transform = `translate(${e.clientX - (r.left + r.width / 2)}px, ${e.clientY - (r.top + r.height / 2)}px)`;
    s.base.classList.add('is-active');
    this.drawKnob(s);
  }

  private moveTo(e: PointerEvent) {
    for (const s of [this.move, this.aim]) {
      if (s.id !== e.pointerId) continue;
      s.dx = e.clientX - s.ox;
      s.dy = e.clientY - s.oy;
      this.drawKnob(s);
    }
  }

  private up(e: PointerEvent) {
    for (const s of [this.move, this.aim]) if (s.id === e.pointerId) this.release(s);
  }

  private release(s: Stick) {
    s.id = null;
    s.dx = s.dy = 0;
    s.base.style.transform = '';
    s.base.classList.remove('is-active');
    this.drawKnob(s);
  }

  private radius(s: Stick) {
    return s.base.offsetWidth / 2 || 60;
  }

  private drawKnob(s: Stick) {
    const [x, y] = this.axis(s);
    const r = this.radius(s);
    s.knob.style.transform = `translate(${x * r}px, ${y * r}px)`;
  }

  /** Stick direction with strength 0..1 (1 = pushed to the ring's edge). */
  private axis(s: Stick): [number, number] {
    if (s.id === null) return [0, 0];
    const m = Math.min(1, Math.hypot(s.dx, s.dy) / this.radius(s));
    const a = Math.atan2(s.dy, s.dx);
    return [Math.cos(a) * m, Math.sin(a) * m];
  }

  update() {
    [this.moveX, this.moveY] = this.axis(this.move);
    [this.aimX, this.aimY] = this.axis(this.aim);
    this.firing = Math.hypot(this.aimX, this.aimY) > 0.3;
  }

  /** Show jetpack fuel (0..1) on the jetpack ring and the grenade count on its button. */
  setStatus(fuel: number, grenades: number) {
    const f = Math.round(Math.max(0, Math.min(1, fuel)) * 100) / 100;
    if (f !== this.fuel) {
      this.fuel = f;
      this.jet.style.setProperty('--fuel', String(f));
    }
    const n = `×${grenades}`;
    if (this.nades.textContent !== n) this.nades.textContent = n;
    this.nadeBtn.classList.toggle('is-empty', grenades === 0);
  }

  /** While the pause menu is open: let go of everything and ignore touches. */
  setSuspended(on: boolean) {
    this.suspended = on;
    this.root.classList.toggle('is-paused', on);
    if (on) {
      this.release(this.move);
      this.release(this.aim);
      this.jetHeld = false;
    }
  }

  consumeSwap(): boolean {
    const r = this.swapPressed;
    this.swapPressed = false;
    return r;
  }

  consumeGrenade(): boolean {
    const r = this.grenadePressed;
    this.grenadePressed = false;
    return r;
  }

  consumeReload(): boolean {
    const r = this.reloadPressed;
    this.reloadPressed = false;
    return r;
  }

  destroy() {
    this.off.forEach((f) => f());
    this.off = [];
    this.root.remove();
    document.body.classList.remove('touch-on');
  }
}
