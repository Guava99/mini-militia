import type { Vec } from './pose';

/**
 * Where each weapon sprite is held. All numbers are SVG units (= game pixels at 1x) measured on the sprite:
 * `grip` is the near hand and the rotation pivot, `fore` is where the support hand sits, `muzzle` is the barrel tip.
 */
export interface WeaponArt {
  key: string;
  w: number;
  h: number;
  grip: Vec;
  fore: Vec;
  muzzle: Vec;
}

export const WEAPON_ART: Record<string, WeaponArt> = {
  pistol: { key: 'pistol', w: 16, h: 11, grip: { x: 4, y: 6 }, fore: { x: 6.5, y: 4.6 }, muzzle: { x: 16, y: 2.6 } },
  smg: { key: 'smg', w: 28, h: 14, grip: { x: 7.6, y: 8.6 }, fore: { x: 19, y: 6.9 }, muzzle: { x: 27.8, y: 4.3 } },
  shotgun: { key: 'shotgun', w: 36, h: 12, grip: { x: 9.2, y: 5.6 }, fore: { x: 21, y: 8.2 }, muzzle: { x: 35.8, y: 3.8 } },
  sniper: { key: 'sniper', w: 46, h: 14, grip: { x: 12.4, y: 10.2 }, fore: { x: 24, y: 8.9 }, muzzle: { x: 45.6, y: 5.5 } },
  rocket: { key: 'rocket', w: 38, h: 16, grip: { x: 15.4, y: 12.2 }, fore: { x: 25.4, y: 11.9 }, muzzle: { x: 37.8, y: 6.5 } },
};

export const weaponArt = (key: string): WeaponArt => WEAPON_ART[key] ?? WEAPON_ART.pistol;
