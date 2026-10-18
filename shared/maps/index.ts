import type { MapDef } from '../mapTypes';
import trainingArena from './training-arena.json';
import industrialZone from './industrial-zone.json';
import canyonBase from './canyon-base.json';

export const MAPS: MapDef[] = [trainingArena, industrialZone, canyonBase] as MapDef[];

export function getMap(id: string | null | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
