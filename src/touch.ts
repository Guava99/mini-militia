import Phaser from 'phaser';

const RADIUS = 70;

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

// Dual virtual sticks: left = move (push up for jetpack), right = aim (fires while held).
export class TouchControls {
  enabled = false;
  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;
  firing = false;
  reloadPressed = false;
  swapPressed = false;
  grenadePressed = false;
  private left: Stick | null = null;
  private right: Stick | null = null;
  private gfx: Phaser.GameObjects.Graphics;
  private reloadBtn: Phaser.GameObjects.Text;
  private extraBtns: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene) {
    scene.input.addPointer(3);
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(40);
    this.reloadBtn = scene.add
      .text(1210, 40, 'R', { fontFamily: 'monospace', fontSize: '30px', color: '#fff', backgroundColor: '#00000088', padding: { x: 16, y: 8 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(false);

    const mk = (y: number, label: string) =>
      scene.add
        .text(1210, y, label, { fontFamily: 'monospace', fontSize: '30px', color: '#fff', backgroundColor: '#00000088', padding: { x: 16, y: 8 } })
        .setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(false);
    this.extraBtns = [mk(110, 'S'), mk(180, 'G')];

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) return;
      if (p.y < 60 && Math.abs(p.x - 640) < 50) return; // the pause button, not a stick
      this.enabled = true;
      this.reloadBtn.setVisible(true);
      this.extraBtns.forEach((b) => b.setVisible(true));
      if (Phaser.Math.Distance.Between(p.x, p.y, this.reloadBtn.x, this.reloadBtn.y) < 45) {
        this.reloadPressed = true;
        return;
      }
      if (Phaser.Math.Distance.Between(p.x, p.y, 1210, 110) < 45) { this.swapPressed = true; return; }
      if (Phaser.Math.Distance.Between(p.x, p.y, 1210, 180) < 45) { this.grenadePressed = true; return; }
      const s: Stick = { id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
      if (p.x < 640 && !this.left) this.left = s;
      else if (p.x >= 640 && !this.right) this.right = s;
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      for (const s of [this.left, this.right]) if (s && s.id === p.id) { s.x = p.x; s.y = p.y; }
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (this.left?.id === p.id) this.left = null;
      if (this.right?.id === p.id) this.right = null;
    };
    scene.input.on('pointerup', up);
    scene.input.on('pointerupoutside', up);
  }

  private axis(s: Stick | null): [number, number] {
    if (!s) return [0, 0];
    const dx = s.x - s.ox;
    const dy = s.y - s.oy;
    const m = Math.min(1, Math.hypot(dx, dy) / RADIUS);
    const a = Math.atan2(dy, dx);
    return [Math.cos(a) * m, Math.sin(a) * m];
  }

  update() {
    [this.moveX, this.moveY] = this.axis(this.left);
    [this.aimX, this.aimY] = this.axis(this.right);
    this.firing = Math.hypot(this.aimX, this.aimY) > 0.3;
    const g = this.gfx;
    g.clear();
    for (const [s, c] of [[this.left, 0xffffff], [this.right, 0xff7755]] as const) {
      if (!s) continue;
      const [ax, ay] = this.axis(s);
      g.lineStyle(3, c, 0.5).strokeCircle(s.ox, s.oy, RADIUS);
      g.fillStyle(c, 0.5).fillCircle(s.ox + ax * RADIUS, s.oy + ay * RADIUS, 28);
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
}
