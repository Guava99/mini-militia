export interface WeaponDef {
  key: string;
  name: string;
  fireDelay: number; // seconds between shots
  damage: number;
  speed: number; // px/s
  spread: number; // radians
  pellets: number;
  mag: number;
  reloadS: number;
  explosive: number; // blast radius in px, 0 = none
  length: number; // gun sprite length (render hint)
  color: number; // gun colour (render hint)
}

export const WEAPONS: Record<string, WeaponDef> = {
  pistol: { key: 'pistol', name: 'Pistol', fireDelay: 0.3, damage: 20, speed: 850, spread: 0.02, pellets: 1, mag: 12, reloadS: 0.9, explosive: 0, length: 16, color: 0x444444 },
  smg: { key: 'smg', name: 'SMG', fireDelay: 0.09, damage: 9, speed: 900, spread: 0.08, pellets: 1, mag: 30, reloadS: 1.3, explosive: 0, length: 24, color: 0x222222 },
  shotgun: { key: 'shotgun', name: 'Shotgun', fireDelay: 0.75, damage: 11, speed: 750, spread: 0.22, pellets: 7, mag: 6, reloadS: 1.8, explosive: 0, length: 28, color: 0x6b4423 },
  sniper: { key: 'sniper', name: 'Sniper', fireDelay: 1.1, damage: 80, speed: 1700, spread: 0, pellets: 1, mag: 4, reloadS: 2.2, explosive: 0, length: 40, color: 0x2a3b2a },
  rocket: { key: 'rocket', name: 'Rocket', fireDelay: 1.2, damage: 70, speed: 520, spread: 0.01, pellets: 1, mag: 2, reloadS: 2.5, explosive: 100, length: 34, color: 0x7a2222 },
};

export const PICKUP_KEYS = ['smg', 'shotgun', 'sniper', 'rocket'];
