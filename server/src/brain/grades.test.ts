import { expect, test } from 'vitest';
import type { Strategy, Trade } from '../shared/types.js';
import { PROVISIONAL_MIN_SETTLED, expectedWinProb, gradeAll, gradeStrategy } from './grades.js';

function settled(category: Strategy, resultCents: number, over: Partial<Trade> = {}): Trade {
  return {
    id: 'x', profileId: 1, category, event: 'A vs B', sport: 'basketball',
    legs: [{ book: 'bet365', selection: 'home', odds: 2.1, stakeCents: 5_000 }],
    marginInitial: 0.05, marginRecheck: 0.05, marginFinal: 0.05, status: 'SETTLED',
    killReason: null, resultCents, createdAt: 0, verifyDueAt: 0, verifiedAt: 1,
    freshUntil: 2, settledAt: 3, eventStartsAt: 0, ...over,
  };
}

test('no settled trades → neutral 50, provisional', () => {
  const g = gradeStrategy('ARB', []);
  expect(g.grade).toBe(50); // (0+1)/(0+2)
  expect(g.provisional).toBe(true);
  expect(g.note).toBe('provisional — 0 of 30 settled · 0 won vs 0.0 expected');
});

test('ARB: expected prob 1 per trade; 11 straight wins grade 92', () => {
  const trades = Array.from({ length: 11 }, () => settled('ARB', 220));
  expect(expectedWinProb(trades[0]!)).toBe(1);
  const g = gradeStrategy('ARB', trades);
  expect(g.grade).toBe(92); // (11+1)/(11+2) = 0.923
  expect(g.wins).toBe(11);
  expect(g.expectedWins).toBeCloseTo(11, 10);
  expect(g.provisional).toBe(true); // 11 < 30
});

test('EV: expected prob = (1+edge)/odds; heavy underperformance grades low', () => {
  // edge 0.05 at odds 2.1 → p = 1.05/2.1 = 0.5
  expect(expectedWinProb(settled('EV', 0))).toBeCloseTo(0.5, 10);
  const trades = [
    ...Array.from({ length: 9 }, () => settled('EV', -5_000)),
    settled('EV', 5_500),
  ];
  const g = gradeStrategy('EV', trades);
  expect(g.grade).toBe(29); // (1+1)/(5+2) = 0.2857
});

test('overperformance caps at 100', () => {
  const trades = Array.from({ length: 10 }, () => settled('EV', 5_500));
  expect(gradeStrategy('EV', trades).grade).toBe(100); // 11/7 → min 1
});

test('MIDDLE: expected prob = 1.5 × breakeven from the stored leg odds', () => {
  const t = settled('MIDDLE', 0, {
    legs: [
      { book: 'pointsbet', selection: 'over', odds: 1.9, stakeCents: 5_000 },
      { book: 'bet365', selection: 'under', odds: 1.95, stakeCents: 5_000 },
    ],
  });
  // sumInv = 1.039137; cost = 0.039137; bothWin = 2/1.039137 − 1 = 0.924675
  // breakeven = 0.042325 → ×1.5 = 0.063487
  expect(expectedWinProb(t)).toBeCloseTo(0.0635, 3);
});

test('MIDDLE: free middles floor the expected prob at 0.05', () => {
  const t = settled('MIDDLE', 0, {
    legs: [
      { book: 'pointsbet', selection: 'over', odds: 2.0, stakeCents: 5_000 },
      { book: 'bet365', selection: 'under', odds: 2.1, stakeCents: 5_000 },
    ],
  });
  expect(expectedWinProb(t)).toBe(0.05);
});

test('provisional flips off at 30 settled and the note switches shape', () => {
  const trades = Array.from({ length: 30 }, () => settled('ARB', 220));
  const g = gradeStrategy('ARB', trades);
  expect(g.provisional).toBe(false);
  expect(PROVISIONAL_MIN_SETTLED).toBe(30);
  expect(g.note).toBe('30 of 30 won vs 30.0 expected');
});

test('gradeAll always returns ARB, EV, MIDDLE in order, splitting by category', () => {
  const grades = gradeAll([settled('EV', 5_500), settled('ARB', 220)]);
  expect(grades.map((g) => g.strategy)).toEqual(['ARB', 'EV', 'MIDDLE']);
  expect(grades[0]!.settled).toBe(1);
  expect(grades[2]!.settled).toBe(0);
});
