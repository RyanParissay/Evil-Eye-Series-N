import { describe, expect, it } from 'vitest';
import type { OddsEvent } from '@shared/types';
import { filterEventsToBookmakers } from './bookmakerFilter';

function event(id: string, bookKeys: string[]): OddsEvent {
  return {
    id,
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: '2026-07-10T00:00:00Z',
    homeTeam: 'A',
    awayTeam: 'B',
    bookmakers: bookKeys.map((key) => ({
      key,
      title: key,
      lastUpdate: '2026-07-09T00:00:00Z',
      markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 2 }, { name: 'B', price: 2 }] }],
    })),
  };
}

describe('filterEventsToBookmakers', () => {
  it('strips bookmakers not in the allowlist', () => {
    const [filtered] = filterEventsToBookmakers(
      [event('e1', ['pinnacle', 'fanduel', 'bet365'])],
      ['pinnacle', 'bet365'],
    );
    expect(filtered.bookmakers.map((b) => b.key)).toEqual(['pinnacle', 'bet365']);
  });

  it('drops events left with no accessible bookmakers', () => {
    const filtered = filterEventsToBookmakers(
      [event('e1', ['fanduel', 'draftkings']), event('e2', ['bet365'])],
      ['bet365'],
    );
    expect(filtered.map((e) => e.id)).toEqual(['e2']);
  });

  it('does not mutate the input events', () => {
    const original = event('e1', ['pinnacle', 'fanduel']);
    filterEventsToBookmakers([original], ['pinnacle']);
    expect(original.bookmakers).toHaveLength(2);
  });

  it('passes everything through when the allowlist covers all books', () => {
    const events = [event('e1', ['pinnacle', 'bet365'])];
    const filtered = filterEventsToBookmakers(events, ['pinnacle', 'bet365', 'coolbet']);
    expect(filtered[0].bookmakers).toHaveLength(2);
  });
});
