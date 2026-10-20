import Phaser from 'phaser';
import { emptyIntent } from '../shared/sim/sim';
import type { Intent } from '../shared/sim/sim';
import { TouchControls } from './touch';

/** Keyboard + mouse + touch, turned into one Intent per frame. Shared by offline and online play. */
export class InputReader {
  readonly touch: TouchControls;
  private keys: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(private scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,RIGHT,R,Q,E,G,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    scene.input.mouse?.disableContextMenu();
    this.touch = new TouchControls(scene);
  }

  get touchActive() {
    return this.touch.enabled;
  }

  update() {
    this.touch.update();
  }

  read(me: { x: number; y: number; aim: number }): Intent {
    const i = emptyIntent();
    const t = this.touch;
    const k = this.keys;
    if (t.enabled) {
      const aiming = Math.hypot(t.aimX, t.aimY) > 0.1;
      i.left = t.moveX < -0.25;
      i.right = t.moveX > 0.25;
      i.thrust = t.moveY < -0.5 || t.jetHeld; // push the move stick up, or hold the jetpack button
      i.aim = aiming ? Math.atan2(t.aimY, t.aimX) : me.aim;
      i.fire = t.firing;
      i.reload = t.consumeReload();
      i.swap = t.consumeSwap();
      i.grenade = t.consumeGrenade();
      return i;
    }
    const p = this.scene.input.activePointer;
    const wp = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    i.left = k.A.isDown || k.LEFT.isDown;
    i.right = k.D.isDown || k.RIGHT.isDown;
    i.thrust = k.W.isDown || k.UP.isDown || k.SPACE.isDown;
    i.aim = Math.atan2(wp.y - (me.y + 4), wp.x - me.x);
    i.fire = p.isDown;
    i.reload = Phaser.Input.Keyboard.JustDown(k.R);
    i.swap = Phaser.Input.Keyboard.JustDown(k.Q) || Phaser.Input.Keyboard.JustDown(k.E);
    i.grenade = Phaser.Input.Keyboard.JustDown(k.G);
    return i;
  }

  /** World position of the mouse, or null on touch devices. */
  crosshair(): { x: number; y: number } | null {
    if (this.touch.enabled) return null;
    const p = this.scene.input.activePointer;
    return this.scene.cameras.main.getWorldPoint(p.x, p.y);
  }
}
