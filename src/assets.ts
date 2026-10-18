import Phaser from 'phaser';

// Every SVG under src/assets is picked up automatically; its texture key is the file name without extension.
// SVGs are rasterised at ART_SCALE x their nominal size, then drawn at 1/ART_SCALE, so art stays crisp on high-DPI screens.
const urls = import.meta.glob('./assets/**/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const ART_SCALE = 4;

export const artKeys = (): string[] => Object.keys(urls).map((p) => p.split('/').pop()!.replace('.svg', ''));

export function queueArt(scene: Phaser.Scene) {
  for (const [path, url] of Object.entries(urls)) {
    const key = path.split('/').pop()!.replace('.svg', '');
    scene.load.svg(key, url, { scale: ART_SCALE });
  }
}

/** Size of a loaded art texture in game units. */
export function artSize(scene: Phaser.Scene, key: string): { w: number; h: number } {
  const f = scene.textures.getFrame(key);
  return { w: f.width / ART_SCALE, h: f.height / ART_SCALE };
}

/** An image at game scale whose origin is a pivot point given in the art's own units. */
export function artImage(scene: Phaser.Scene, key: string, pivotX: number, pivotY: number): Phaser.GameObjects.Image {
  const { w, h } = artSize(scene, key);
  return scene.add.image(0, 0, key).setOrigin(pivotX / w, pivotY / h).setScale(1 / ART_SCALE);
}
