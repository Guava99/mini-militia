import Phaser from 'phaser';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import { artKeys, queueArt } from '../assets';

/** Loading screen: fetches and rasterises all art and the UI font, then opens the menu. */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('preload');
  }

  preload() {
    this.cameras.main.setBackgroundColor('#10161d');
    const cx = 640;
    const cy = 360;
    this.add.text(cx, cy - 70, 'JETPACK ARENA', { fontFamily: 'Rajdhani, sans-serif', fontSize: '54px', fontStyle: '700', color: '#e8edf2' }).setOrigin(0.5);
    const label = this.add.text(cx, cy + 40, 'Loading...', { fontFamily: 'Rajdhani, sans-serif', fontSize: '20px', color: '#8fa0b0' }).setOrigin(0.5);
    this.add.rectangle(cx, cy, 420, 8, 0x26313d).setOrigin(0.5);
    const bar = this.add.rectangle(cx - 210, cy, 0, 8, 0xf2a33a).setOrigin(0, 0.5);

    this.load.on('progress', (p: number) => {
      bar.width = 420 * p;
      label.setText(`Loading... ${Math.round(p * 100)}%`);
    });
    queueArt(this);
  }

  create() {
    // the font files are loaded lazily by the browser: make sure the weights we use are ready before any text is drawn
    const fonts = ['500 20px Rajdhani', '600 20px Rajdhani', '700 20px Rajdhani'];
    void Promise.all(fonts.map((f) => document.fonts.load(f)))
      .catch(() => undefined)
      .then(() => {
        console.log(`art ready: ${artKeys().length} textures`);
        this.scene.start('menu');
      });
  }
}
