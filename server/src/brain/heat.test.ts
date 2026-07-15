import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';
import {
  DEFAULT_BELIEF_CENTS, computeHeat, deriveBelief, deriveHealth, suspicionLevel,
} from './heat.js';

const S = { ...DEFAULT_SETTINGS };
const DAY = 86_400_000;

test('a fresh limit report scores its full weight', () => {
  expect(computeHeat([{ kind: 'limit', ts: 1_000 }], [], 1_000, S)).toBe(23);
});

test('one 21-day half-life halves the weight', () => {
  expect(computeHeat([{ kind: 'limit', ts: 0 }], [], 21 * DAY, S)).toBe(12); // 11.5 → round 12
  expect(computeHeat([{ kind: 'limit', ts: 0 }], [], 42 * DAY, S)).toBe(6);  // 5.75 → 6
});

test('weights: reject +9, cut +14, withdrawal −2', () => {
  expect(computeHeat([{ kind: 'reject', ts: 0 }], [], 0, S)).toBe(9);
  expect(computeHeat([{ kind: 'cut', ts: 0 }], [], 0, S)).toBe(14);
  expect(computeHeat([{ kind: 'limit', ts: 0 }, { kind: 'withdrawal', ts: 0 }], [], 0, S)).toBe(21);
});

test('heat clamps to 0..100', () => {
  const six = Array.from({ length: 6 }, () => ({ kind: 'limit' as const, ts: 0 }));
  expect(computeHeat(six, [], 0, S)).toBe(100); // 138 clamps
  expect(computeHeat([{ kind: 'withdrawal', ts: 0 }], [], 0, S)).toBe(0); // −2 clamps
});

test('exposure: volume decays, breadth needs a second market inside 7d, capped at 15', () => {
  const flood = Array.from({ length: 30 }, () => ({ verifiedAt: 0, market: 'moneyline' }));
  expect(computeHeat([], flood, 0, S)).toBe(15); // volume 30 → cap 15
  expect(computeHeat([], [{ verifiedAt: 0, market: 'moneyline' }], 0, S)).toBe(1);
  expect(computeHeat([], [
    { verifiedAt: 0, market: 'moneyline' }, { verifiedAt: 0, market: 'total' },
  ], 0, S)).toBe(4); // 2 volume + 2 breadth
  expect(computeHeat([], [
    { verifiedAt: 0, market: 'moneyline' }, { verifiedAt: 0, market: 'total' },
  ], 8 * DAY, S)).toBe(2); // breadth window passed; volume decayed 2×0.768
});

test('signal and exposure add', () => {
  expect(computeHeat(
    [{ kind: 'limit', ts: 0 }],
    [{ verifiedAt: 0, market: 'moneyline' }, { verifiedAt: 0, market: 'total' }],
    0, S,
  )).toBe(27); // 23 + 4
});

test('health: red at stopHeat, amber at goGentle OR a fresh incident, else green', () => {
  expect(deriveHealth(64, [], 0, S)).toBe('red');
  expect(deriveHealth(60, [], 0, S)).toBe('red');
  expect(deriveHealth(38, [], 0, S)).toBe('yellow');
  expect(deriveHealth(30, [], 0, S)).toBe('yellow');
  expect(deriveHealth(12, [{ kind: 'cut', ts: 0 }], 2 * DAY, S)).toBe('yellow');   // incident < 7d
  expect(deriveHealth(12, [{ kind: 'cut', ts: 0 }], 8 * DAY, S)).toBe('green');    // incident aged out
  expect(deriveHealth(12, [{ kind: 'withdrawal', ts: 0 }], 0, S)).toBe('green');   // withdrawals are not incidents
  expect(deriveHealth(0, [], 0, S)).toBe('green');
});

test('suspicion maps from heat per inventory §3.5', () => {
  expect(suspicionLevel(0)).toBe(1);
  expect(suspicionLevel(14)).toBe(1);
  expect(suspicionLevel(15)).toBe(2);
  expect(suspicionLevel(30)).toBe(3);
  expect(suspicionLevel(45)).toBe(4);
  expect(suspicionLevel(60)).toBe(5);
  expect(suspicionLevel(100)).toBe(5);
});

test('belief: $500 prior, latest report wins, WAS only when lowered, pinnacle unlimited', () => {
  expect(deriveBelief([], false)).toEqual({ maxBetCents: DEFAULT_BELIEF_CENTS, wasCents: null });
  expect(deriveBelief([12_000], false)).toEqual({ maxBetCents: 12_000, wasCents: 50_000 });
  expect(deriveBelief([12_000, 25_000], false)).toEqual({ maxBetCents: 25_000, wasCents: null }); // raised — no ▼
  expect(deriveBelief([25_000, 12_000], false)).toEqual({ maxBetCents: 12_000, wasCents: 25_000 });
  expect(deriveBelief([50_000], false)).toEqual({ maxBetCents: 50_000, wasCents: null }); // equal to prior — no ▼
  expect(deriveBelief([12_000], true)).toEqual({ maxBetCents: null, wasCents: null });
});
