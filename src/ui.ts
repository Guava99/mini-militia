import Phaser from 'phaser';
import { audio } from './audio';

/**
 * Text entry on top of the canvas. A real <input> works with desktop and mobile keyboards,
 * unlike drawing letters ourselves. Resolves with the text, or null if cancelled.
 */
export function askText(title: string, initial = '', maxLen = 16, transform: (s: string) => string = (s) => s): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10', fontFamily: 'monospace',
    });
    const box = document.createElement('div');
    Object.assign(box.style, { background: '#1e293b', color: '#fff', padding: '24px', borderRadius: '12px', minWidth: '280px', textAlign: 'center' });
    const label = document.createElement('div');
    label.textContent = title;
    label.style.marginBottom = '12px';
    label.style.fontSize = '18px';
    const input = document.createElement('input');
    input.value = initial;
    input.maxLength = maxLen;
    input.autocomplete = 'off';
    Object.assign(input.style, { width: '100%', boxSizing: 'border-box', fontSize: '24px', padding: '8px', textAlign: 'center', fontFamily: 'monospace' });
    const row = document.createElement('div');
    row.style.marginTop = '14px';
    const mkBtn = (text: string) => {
      const b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, { fontSize: '18px', margin: '0 8px', padding: '8px 18px', fontFamily: 'monospace', cursor: 'pointer' });
      return b;
    };
    const ok = mkBtn('OK');
    const cancel = mkBtn('Cancel');
    const done = (v: string | null) => {
      overlay.remove();
      resolve(v === null ? null : transform(v.trim()));
    };
    ok.onclick = () => done(input.value);
    cancel.onclick = () => done(null);
    input.onkeydown = (e) => {
      e.stopPropagation(); // keep game hotkeys out of the text box
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
    };
    input.oninput = () => { input.value = transform(input.value); };
    row.append(ok, cancel);
    box.append(label, input, row);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

/** In-game pause/settings panel. Escape toggles it. */
export class PauseMenu {
  private items: Phaser.GameObjects.GameObject[] = [];
  private muteLabel!: Phaser.GameObjects.Text;
  open = false;

  constructor(
    private scene: Phaser.Scene,
    private opts: { title?: string; note?: string; onLeave: () => void; onToggle?: (open: boolean) => void },
  ) {
    const s = scene;
    const dim = s.add.rectangle(640, 360, 1280, 720, 0x000000, 0.55).setScrollFactor(0).setDepth(100);
    const title = s.add.text(640, 190, opts.title ?? 'Paused', { fontFamily: 'monospace', fontSize: '48px', color: '#fff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const note = s.add.text(640, 240, opts.note ?? '', { fontFamily: 'monospace', fontSize: '18px', color: '#cbd5e1' }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
    const resume = this.button(320, 'Resume', () => this.toggle());
    this.muteLabel = this.button(400, '', () => { audio.toggleMute(); this.refresh(); });
    const leave = this.button(480, 'Leave to menu', () => opts.onLeave());
    this.items = [dim, title, note, resume, this.muteLabel, leave];
    this.refresh();
    this.items.forEach((i) => (i as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject).setVisible?.(false));
    s.input.keyboard!.on('keydown-ESC', () => this.toggle());
    // the on-screen pause button for phones lives in the HUD (src/ui/hud.ts)
  }

  toggle() {
    this.open = !this.open;
    this.items.forEach((i) => (i as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject).setVisible?.(this.open));
    this.opts.onToggle?.(this.open);
  }

  private refresh() {
    this.muteLabel.setText(audio.muted ? 'Sound: OFF' : 'Sound: ON');
  }

  private button(y: number, label: string, onClick: () => void) {
    const t = this.scene.add
      .text(640, y, label, { fontFamily: 'monospace', fontSize: '28px', color: '#fff', backgroundColor: '#1e293b', padding: { x: 24, y: 10 } })
      .setOrigin(0.5).setScrollFactor(0).setDepth(101).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setBackgroundColor('#334155'));
    t.on('pointerout', () => t.setBackgroundColor('#1e293b'));
    t.on('pointerup', () => { if (this.open) onClick(); });
    return t;
  }
}
