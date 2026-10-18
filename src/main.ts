import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { OnlineScene } from './scenes/OnlineScene';
import { PreloadScene } from './scenes/PreloadScene';
import { RigTestScene } from './scenes/RigTestScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#7fb8e6',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [PreloadScene, MenuScene, GameScene, OnlineScene, RigTestScene],
});

// debug/automation handle: lets tests and the console inspect scenes, e.g. __mm.scene.getScene('online')
(window as unknown as { __mm: Phaser.Game }).__mm = game;
