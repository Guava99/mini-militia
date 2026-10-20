// Shared map schema: used by the web client now, and by the server and native clients later.
// Maps live in shared/maps/*.json and can be edited without touching game code.

export type PlatformKind = 'earth' | 'stone' | 'metal' | 'snow' | 'sand' | 'bridge';
export type WeaponKey = 'pistol' | 'smg' | 'shotgun' | 'sniper' | 'rocket' | 'random';

export interface PlatformDef {
  x: number; // top-left, world pixels
  y: number;
  w: number;
  h: number;
  kind: PlatformKind;
}

export interface MapTheme {
  /** Visual style, chosen by the client renderer. Defaults to 'sunset'. */
  style?: 'sunset' | 'neon';
  skyTop: string;
  /** Optional middle colour of the sky gradient. */
  skyMid?: string;
  skyBottom: string;
  far: string;
  near: string;
  sun: string;
}

export interface MapDef {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  theme: MapTheme;
  platforms: PlatformDef[];
  /** Fighter centre positions (fighter box is 18x44). */
  spawns: { x: number; y: number }[];
  /** Pickup crate centre positions. */
  pickups: { x: number; y: number; weapon: WeaponKey }[];
  decor: { kind: string; x: number; y: number; scale: number }[];
}
