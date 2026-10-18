import Phaser from 'phaser';
import { MAPS } from '../../shared/maps';
import { defaultServerUrl } from '../net/client';
import { getPlayerName, setPlayerName } from '../prefs';
import { askText } from '../ui';

export class MenuScene extends Phaser.Scene {
  private mapIdx = 0;
  private name = getPlayerName();

  constructor() {
    super('menu');
  }

  create() {
    this.cameras.main.setBackgroundColor('#27384d');
    const g = this.add.graphics();
    g.fillGradientStyle(0x27384d, 0x27384d, 0x4b6a8a, 0x4b6a8a, 1).fillRect(0, 0, 1280, 720);

    this.add.text(640, 90, 'JETPACK ARENA', { fontFamily: 'monospace', fontSize: '64px', color: '#ffffff', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);
    this.add.text(640, 150, '2D jetpack shooter - original game', { fontFamily: 'monospace', fontSize: '20px', color: '#cbd5e1' }).setOrigin(0.5);

    const nameBtn = this.button(640, 230, `Name: ${this.name}  (click to change)`, () => {
      void askText('Your name', this.name, 16).then((n) => {
        if (!n) return;
        this.name = n;
        setPlayerName(this.name);
        nameBtn.setText(`Name: ${this.name}  (click to change)`);
      });
    }, 22);

    this.button(640, 310, 'Play offline vs bots', () => this.scene.start('game'));
    this.button(640, 380, 'Quick match (online)', () => this.startOnline({ mode: 'quick' }));
    const mapBtn = this.button(640, 450, '', () => {
      this.mapIdx = (this.mapIdx + 1) % MAPS.length;
      mapBtn.setText(this.createLabel());
    });
    mapBtn.setText(this.createLabel());
    // clicking the label cycles the map; the second button creates the room
    this.button(640, 520, 'Create private room', () => this.startOnline({ mode: 'create', mapId: MAPS[this.mapIdx].id }));
    this.button(640, 590, 'Join private room (enter code)', () => {
      void askText('Room code (4 letters)', '', 4, (v) => v.toUpperCase().replace(/[^A-Z]/g, '')).then((code) => {
        if (code) this.startOnline({ mode: 'join', code });
      });
    });

    this.add.text(640, 670, `WASD/arrows move, Space or W jetpack, mouse aim+fire, R reload, Q swap, G grenade, Esc pause   |   server: ${defaultServerUrl()}`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#94a3b8',
    }).setOrigin(0.5);

    // ?auto=offline | quick | create:<mapId> | join:<CODE>  (handy for sharing links and automated tests)
    const auto = new URLSearchParams(window.location.search).get('auto');
    if (auto === 'rigtest') this.scene.start('rigtest');
    else if (auto === 'offline') this.scene.start('game');
    else if (auto === 'quick') this.startOnline({ mode: 'quick' });
    else if (auto?.startsWith('create')) this.startOnline({ mode: 'create', mapId: auto.split(':')[1] });
    else if (auto?.startsWith('join:')) this.startOnline({ mode: 'join', code: auto.split(':')[1].toUpperCase() });
  }

  private createLabel() {
    return `Private room map: ${MAPS[this.mapIdx].name}  (click to change)`;
  }

  private startOnline(data: { mode: 'quick' | 'create' | 'join'; mapId?: string; code?: string }) {
    this.scene.start('online', { ...data, name: this.name });
  }

  private button(x: number, y: number, label: string, onClick: () => void, size = 28) {
    const t = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: `${size}px`, color: '#ffffff', backgroundColor: '#1e293b', padding: { x: 24, y: 12 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setBackgroundColor('#334155'));
    t.on('pointerout', () => t.setBackgroundColor('#1e293b'));
    t.on('pointerup', onClick);
    return t;
  }
}
