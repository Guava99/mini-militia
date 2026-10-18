import Phaser from 'phaser';

/** How much the world is magnified relative to the 1280x720 UI. Larger = bigger soldiers, smaller field of view. */
export const WORLD_ZOOM = 1.35;

/**
 * Zooms the world without scaling the interface. The main camera shows the world at WORLD_ZOOM;
 * a second, unzoomed camera shows the UI. Every display object is shown by exactly one of them,
 * decided by depth: depth >= UI_DEPTH is interface, everything else is world.
 * Call sync() every frame so objects created later (soldiers appearing, popups) are assigned too.
 */
export const UI_DEPTH = 30;

export class CameraSplit {
  private ui: Phaser.Cameras.Scene2D.Camera;
  private seen = new WeakSet<object>();

  constructor(private scene: Phaser.Scene, zoom = WORLD_ZOOM) {
    scene.cameras.main.setZoom(zoom);
    this.ui = scene.cameras.add(0, 0, 1280, 720, false, 'ui');
    this.sync();
  }

  sync() {
    for (const o of this.scene.children.list) {
      if (this.seen.has(o)) continue;
      this.seen.add(o);
      const obj = o as Phaser.GameObjects.GameObject & { depth?: number };
      if ((obj.depth ?? 0) >= UI_DEPTH) this.scene.cameras.main.ignore(obj);
      else this.ui.ignore(obj);
    }
  }
}
