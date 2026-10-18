import Phaser from 'phaser';
import { sfx } from '../audio';
import { CameraSplit } from '../camera';
import { InputReader } from '../input';
import { PauseMenu } from '../ui';
import { Fx, Renderer, buildWorld } from '../render';
import { getMap, MAPS } from '../../shared/maps';
import type { MapDef } from '../../shared/mapTypes';
import { Sim, TICK } from '../../shared/sim/sim';
import type { FighterState } from '../../shared/sim/sim';
import { WEAPONS } from '../../shared/sim/weapons';

// Offline play against bots. Only draws and reads input: all rules live in shared/sim.

const BOT_COUNT = 3;
const BOT_COLORS = [0xef4444, 0x22c55e, 0xeab308, 0xa855f7];

export class GameScene extends Phaser.Scene {
  private map!: MapDef;
  private sim!: Sim;
  private player!: FighterState;
  private stage!: Renderer;
  private split!: CameraSplit;
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private input2!: InputReader;
  private pause!: PauseMenu;
  private camTarget!: Phaser.GameObjects.Rectangle;
  private fx = new Fx();
  private acc = 0;

  constructor() {
    super('game');
  }

  create() {
    this.acc = 0;
    this.fx = new Fx();

    // ?map=<id> picks a map; otherwise maps rotate each match
    const wanted = new URLSearchParams(window.location.search).get('map');
    const idx: number = this.registry.get('mapIndex') ?? Math.floor(Math.random() * MAPS.length);
    this.map = wanted ? getMap(wanted) : MAPS[idx % MAPS.length];

    this.sim = new Sim(this.map, { seed: (Math.random() * 2 ** 31) | 0 });
    this.player = this.sim.addFighter('You', false, 0x3b82f6);
    for (let i = 0; i < BOT_COUNT; i++) this.sim.addFighter(`Bot ${i + 1}`, true, BOT_COLORS[i % BOT_COLORS.length]);

    buildWorld(this, this.map);
    this.camTarget = this.add.rectangle(this.player.x, this.player.y, 2, 2, 0, 0);
    this.cameras.main.startFollow(this.camTarget, true, 0.12, 0.12);
    this.stage = new Renderer(this, this.fx);

    this.hud = this.add.text(16, 12, '', { fontFamily: 'monospace', fontSize: '20px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setScrollFactor(0).setDepth(30);
    this.banner = this.add.text(640, 300, '', { fontFamily: 'monospace', fontSize: '48px', color: '#fff', stroke: '#000', strokeThickness: 6, align: 'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(30);

    this.input2 = new InputReader(this);
    this.pause = new PauseMenu(this, { note: 'Offline match is frozen while paused', onLeave: () => this.scene.start('menu') });
    this.input.on('pointerdown', () => {
      if (!this.sim.over) return;
      this.registry.set('mapIndex', (MAPS.indexOf(this.map) + 1) % MAPS.length);
      this.scene.restart();
    });
    this.split = new CameraSplit(this); // world zoomed, interface not
  }

  update(_time: number, delta: number) {
    this.split.sync();
    if (this.pause.open) return; // freeze the match while paused
    this.acc += Math.min(delta / 1000, 0.1);
    this.input2.update();
    const intent = this.input2.read(this.player);
    let steps = 0;
    while (this.acc >= TICK && steps < 6) {
      const i = { ...intent };
      if (steps > 0) { i.reload = false; i.swap = false; i.grenade = false; } // one-shot buttons: first step only
      this.sim.step(TICK, { [this.player.id]: i });
      this.acc -= TICK;
      steps++;
    }
    if (steps === 6) this.acc = 0;

    this.handleEvents();
    this.fx.update(delta / 1000);
    this.camTarget.setPosition(this.player.x, this.player.y);
    this.stage.frame(
      {
        time: this.sim.time,
        fighters: this.sim.fighters,
        bullets: this.sim.bullets,
        grenades: this.sim.grenades,
        crates: this.sim.crates,
        localId: this.player.id,
      },
      this.input2.crosshair(),
      delta / 1000,
    );
    this.updateHud();
  }

  private handleEvents() {
    for (const e of this.sim.drainEvents()) {
      switch (e.type) {
        case 'shoot': {
          const s = this.sim.getFighter(e.id);
          if (s && (s.id === this.player.id || Math.hypot(s.x - this.player.x, s.y - this.player.y) < 900)) sfx.shoot(e.heavy);
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
        case 'reload': if (e.id === this.player.id) sfx.reload(); break;
        case 'pickup': if (e.id === this.player.id) sfx.pickup(); break;
        default: break;
      }
    }
  }

  private updateHud() {
    const p = this.player;
    const w = WEAPONS[p.weapon];
    const ammo = p.reloadUntil ? `RELOADING ${Math.max(0, p.reloadUntil - this.sim.time).toFixed(1)}s` : `${p.ammo}/${w.mag}`;
    const alt = p.altWeapon ? `  Alt: ${WEAPONS[p.altWeapon].name} ${p.altAmmo}` : '';
    const board = [...this.sim.fighters].sort((a, b) => b.kills - a.kills).map((f) => `${f.name.padEnd(6)} ${f.kills}`).join('\n');
    this.hud.setText(`HP ${Math.max(0, Math.ceil(p.hp))}  FUEL ${Math.ceil(p.fuel)}\n${w.name}  ${ammo}\nGrenades ${p.grenades}${alt}\n\n${this.map.name}\nFirst to ${this.sim.killLimit}\n${board}`);
    if (this.sim.over) {
      const win = this.sim.getFighter(this.sim.winner!);
      this.banner.setText(`${win?.name ?? '?'} wins!\nClick to play again`);
    } else this.banner.setText(p.dead ? 'You died - respawning...' : '');
  }
}
