import { defineConfig } from 'vite';

// base './' so the build works inside a Capacitor (Android/iOS) webview
export default defineConfig({
  base: './',
  // Never inline assets as data: URLs. Phaser's SVG loader expects real files (it cannot decode Vite's URL-encoded data URLs).
  build: { chunkSizeWarningLimit: 1600, assetsInlineLimit: 0 },
});
