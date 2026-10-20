import { describe, expect, it } from 'vitest';
import { cssColor, feedEntry, ordinal, scoreboard } from './hudModel';

const f = (id: number, kills: number) => ({ id, name: `p${id}`, kills, color: 0 });

describe('scoreboard', () => {
  it('shows the leader as rival when you are behind', () => {
    const s = scoreboard([f(1, 3), f(2, 7), f(3, 5)], 1);
    expect(s.you?.id).toBe(1);
    expect(s.rival?.id).toBe(2);
    expect(s.rank).toBe(3);
    expect(s.players).toBe(3);
  });

  it('shows the runner-up as rival when you lead', () => {
    const s = scoreboard([f(1, 9), f(2, 7), f(3, 8)], 1);
    expect(s.rival?.id).toBe(3);
    expect(s.rank).toBe(1);
  });

  it('lets tied players share a place', () => {
    expect(scoreboard([f(1, 4), f(2, 4), f(3, 1)], 2).rank).toBe(1);
  });

  it('copes with being alone or missing', () => {
    expect(scoreboard([f(1, 0)], 1).rival).toBeNull();
    expect(scoreboard([f(1, 0)], 9).you).toBeNull();
  });
});

describe('feedEntry', () => {
  it('names you as YOU and highlights your kills', () => {
    const e = feedEntry(f(2, 0), f(1, 1), 1);
    expect(e.killer?.text).toBe('YOU');
    expect(e.victim.text).toBe('p2');
    expect(e.mine).toBe(true);
  });

  it('leaves other players kills plain', () => {
    expect(feedEntry(f(2, 0), f(3, 1), 1).mine).toBe(false);
  });

  it('gives no killer for a self-kill or an unknown killer', () => {
    expect(feedEntry(f(2, 0), f(2, 0), 1).killer).toBeNull();
    expect(feedEntry(f(2, 0), undefined, 1).killer).toBeNull();
  });
});

describe('formatting', () => {
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND', '101ST']);
  });

  it('writes CSS colours', () => {
    expect(cssColor(0x2de2e6)).toBe('#2de2e6');
    expect(cssColor(0x0000ff)).toBe('#0000ff');
  });
});
