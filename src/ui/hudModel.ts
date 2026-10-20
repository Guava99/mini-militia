// Pure helpers that turn game state into what the HUD shows. No DOM here, so they are easy to test.

export interface ScoreFighter {
  id: number;
  name: string;
  kills: number;
  color: number;
}

export interface Scoreboard {
  you: ScoreFighter | null;
  /** The best opponent: the leader, or the runner-up when you lead. */
  rival: ScoreFighter | null;
  /** 1 = first. Players on equal kills share a place. */
  rank: number;
  players: number;
}

export function scoreboard(fighters: readonly ScoreFighter[], youId: number): Scoreboard {
  const you = fighters.find((f) => f.id === youId) ?? null;
  let rival: ScoreFighter | null = null;
  for (const f of fighters) if (f.id !== youId && (!rival || f.kills > rival.kills)) rival = f;
  const rank = you ? 1 + fighters.filter((f) => f.kills > you.kills).length : fighters.length;
  return { you, rival, rank, players: fighters.length };
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}TH`;
  return `${n}${['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`;
}

export interface FeedName {
  text: string;
  color: string;
  you: boolean;
}

export interface FeedEntry {
  /** null when nobody gets the credit (a self-kill or an unknown killer). */
  killer: FeedName | null;
  victim: FeedName;
  /** You took part, so the row is highlighted. */
  mine: boolean;
}

/** One kill-feed row. `by` is the killer from the sim's 'die' event; it equals the victim on a self-kill. */
export function feedEntry(victim: ScoreFighter, by: ScoreFighter | undefined, youId: number): FeedEntry {
  const name = (f: ScoreFighter): FeedName => ({ text: f.id === youId ? 'YOU' : f.name, color: cssColor(f.color), you: f.id === youId });
  const killer = by && by.id !== victim.id ? name(by) : null;
  return { killer, victim: name(victim), mine: victim.id === youId || by?.id === youId };
}

/** 0xff3d9a -> '#ff3d9a' */
export const cssColor = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
