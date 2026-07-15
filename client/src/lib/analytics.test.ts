import { expect, test } from 'vitest';
import {
  bankrollFootnote, chartDate, chartGeometry, closingEdgeTile, createEnabled,
  formatDateCaps, formatSignedDollars, formatAnnualized, formatReturn, fundStartText,
  funnelRows, gateBar, limitRow, monthLabel, monthlyCells, openBetStatus, openBetText,
  oppToggle, profileItems, retentionTile, roundingTile, sortOpp, startsNote, statsTexts,
} from './analytics';

test('date words: caps date, unpadded chart date, month label', () => {
  expect(formatDateCaps('2026-05-01')).toBe('MAY 01 2026');
  expect(formatDateCaps('2026-07-14')).toBe('JUL 14 2026');
  expect(chartDate('2026-07-05')).toBe('JUL 5');
  expect(chartDate('2026-06-13')).toBe('JUN 13');
  expect(monthLabel('2026-07')).toBe('JUL');
});

test('money words: signed whole dollars, returns 2dp, annualized 1dp — U+2212 minus', () => {
  expect(formatSignedDollars(43_812)).toBe('+$438');
  expect(formatSignedDollars(-2_000_000)).toBe('−$20,000');
  expect(formatSignedDollars(0)).toBe('+$0');
  expect(formatReturn(2.7412)).toBe('+2.74%');
  expect(formatReturn(-0.5)).toBe('−0.50%');
  expect(formatAnnualized(38.91)).toBe('+38.9%');
  expect(formatAnnualized(-12.34)).toBe('−12.3%');
});

test('top row: fund box, dropdown items, create gating, starts note', () => {
  const p = { id: 1, name: 'Ryan', startingCashCents: 1_000_000, createdDate: '2026-05-01' };
  expect(fundStartText(p)).toEqual({ amount: '$10,000', date: 'MAY 01 2026' });
  expect(profileItems([p, { ...p, id: 2, name: 'lea' }], 1)).toEqual([
    { id: 1, label: '● RYAN', current: true },
    { id: 2, label: 'LEA', current: false },
  ]);
  expect(createEnabled('', '$5,000')).toBe(false);
  expect(createEnabled('  ', '$5,000')).toBe(false);
  expect(createEnabled('LEA', '')).toBe(false);
  expect(createEnabled('LEA', '$0')).toBe(false);
  expect(createEnabled('LEA', '$5,000')).toBe(true);
  expect(startsNote('2026-07-14')).toBe('STARTS THE DAY YOU CREATE IT — JUL 14 2026');
});

test('chartGeometry: the mockup scale reproduces at $0–$600', () => {
  const points = [
    { day: '2026-07-13', profitCents: 0 },
    { day: '2026-07-14', profitCents: 60_000 },
  ];
  const g = chartGeometry(points)!;
  expect(g.yLabels.map((l) => l.text)).toEqual(['$0', '$100', '$200', '$300', '$400', '$500', '$600']);
  expect(g.yLabels.map((l) => l.y)).toEqual([205, 175, 145, 115, 85, 55, 25]);
  expect(g.xMajors).toEqual([207, 354, 500, 647, 794]);
  expect(g.xMinors).toEqual([133, 280, 427, 574, 720, 867]);
  expect(g.line).toBe('60,205 940,25');
  expect(g.bullets).toEqual([{ x: 60, y: 205 }, { x: 940, y: 25 }]);
  expect(g.last).toEqual({ x: 940, y: 25 });
  expect(g.dates).toEqual(['JUL 13', 'JUL 14']);
});

test('chartGeometry: losses extend the scale below zero', () => {
  const g = chartGeometry([
    { day: '2026-07-13', profitCents: -25_000 },
    { day: '2026-07-14', profitCents: 50_000 },
  ])!;
  expect(g.yLabels.map((l) => l.text)).toEqual(['−$400', '−$200', '$0', '$200', '$400', '$600']);
  expect(g.line).toBe('60,178 940,43');
});

test('chartGeometry: degenerate cases stay honest', () => {
  expect(chartGeometry([])).toBeNull();
  const single = chartGeometry([{ day: '2026-07-14', profitCents: 0 }])!;
  expect(single.line).toBeNull();
  expect(single.last).toEqual({ x: 940, y: 205 });
  expect(single.dates).toEqual(['JUL 14']);
  const flat = chartGeometry([
    { day: '2026-07-13', profitCents: 0 },
    { day: '2026-07-14', profitCents: 0 },
  ])!;
  expect(flat.yLabels.map((l) => l.text)).toEqual(['$0', '$1']); // widened by one smallest step
});

test('chartGeometry: long ranges drop per-point bullets and sample 6 dates', () => {
  const points = Array.from({ length: 90 }, (_, i) => ({
    day: `2026-04-${String((i % 30) + 1).padStart(2, '0')}`, profitCents: i * 100,
  }));
  const g = chartGeometry(points)!;
  expect(g.bullets).toEqual([]); // >60 points — line + last ring only
  expect(g.dates).toHaveLength(6);
  expect(g.line!.split(' ')).toHaveLength(90);
});

test('stats row + bankroll footnote', () => {
  expect(statsTexts({ profitCents: 43_812, returnPct: 2.7412, annualizedPct: 38.91 }))
    .toEqual({ ret: '+2.74%', ann: '+38.9%', profit: '+$438', retTone: 'pos' });
  expect(statsTexts({ profitCents: -100, returnPct: -0.01, annualizedPct: -0.1 }).retTone).toBe('neg');
  expect(bankrollFootnote(1_000_000))
    .toBe('RETURNS MEASURED AGAINST TOTAL BANKROLL ($10,000). ANNUALIZED = RANGE RETURN EXTRAPOLATED TO 365 DAYS.');
});

test('monthly cells render the 10 columns in table order', () => {
  expect(monthlyCells({
    month: '2026-07', cand: 214, verif: 96, sent: 88, conf: 61, unconf: 6, exp: 7,
    killed: 118, followThruPct: 69, plCents: 18_800,
  })).toEqual(['JUL', '214', '96', '88', '61', '6', '7', '118', '69%', '+$188']);
  expect(monthlyCells({
    month: '2026-06', cand: 1, verif: 0, sent: 0, conf: 0, unconf: 0, exp: 0,
    killed: 0, followThruPct: null, plCents: 0,
  })[8]).toBe('—');
});

test('funnel rows: verbatim labels, >10 min appears only when non-zero, honest empty', () => {
  const rows = funnelRows({ under2: 31, from2to5: 46, from5to10: 14, over10: 0, dead: 9, total: 100 });
  expect(rows.map((r) => r.label)).toEqual([
    'CONFIRMED < 2 MIN', 'CONFIRMED 2–5 MIN', 'CONFIRMED 5–10 MIN', 'EXPIRED / DEAD AT CONFIRM',
  ]);
  expect(rows.map((r) => r.value)).toEqual(['31%', '46%', '14%', '9%']);
  expect(rows[3]!.dead).toBe(true);
  const withSlow = funnelRows({ under2: 1, from2to5: 0, from5to10: 0, over10: 1, dead: 0, total: 2 });
  expect(withSlow.map((r) => r.label)).toContain('CONFIRMED > 10 MIN');
  const empty = funnelRows({ under2: 0, from2to5: 0, from5to10: 0, over10: 0, dead: 0, total: 0 });
  expect(empty.every((r) => r.value === '—' && r.pct === null)).toBe(true);
});

test('open bets: composed row + status flip', () => {
  const bet = {
    category: 'ARB' as const, event: 'Blue Jays @ Mariners',
    legsText: 'DraftKings over @ 2.04 / Pinnacle under @ 2.02',
    stakeCents: 10_000, startsAt: Date.UTC(2026, 6, 15, 2, 10), live: false,
  };
  expect(openBetText(bet))
    .toBe('ARB · Blue Jays @ Mariners · DraftKings over @ 2.04 / Pinnacle under @ 2.02 · $100');
  expect(openBetStatus(bet)).toBe('STARTS 7:10 PM'); // 2026-07-15 02:10 UTC = 19:10 PDT
  expect(openBetStatus({ ...bet, live: true })).toBe('LIVE');
});

test('opportunity sort + reveal toggle', () => {
  const rows = [
    { book: 'Coolbet', count: 103, avgPct: 2.4 },
    { book: '1xBet', count: 139, avgPct: 2.9 },
    { book: 'Pinnacle', count: 139, avgPct: 2.1 },
  ];
  expect(sortOpp(rows, 'COUNT').map((r) => r.book)).toEqual(['1xBet', 'Pinnacle', 'Coolbet']);
  expect(sortOpp(rows, 'EDGE').map((r) => r.book)).toEqual(['1xBet', 'Coolbet', 'Pinnacle']);
  expect(oppToggle(false)).toBe('SEE ALL →');
  expect(oppToggle(true)).toBe('SHOW FEWER ←');
});

test('limits row: date · book · SPORT — event | MAX $x', () => {
  expect(limitRow({
    when: Date.UTC(2026, 6, 13, 5, 0), // JUL 12 22:00 PDT
    book: 'bet365', sport: 'soccer', event: 'Arsenal vs Chelsea', maxCents: 2_500,
  })).toEqual({ left: 'JUL 12 · bet365 · SOCCER — Arsenal vs Chelsea', right: 'MAX $25' });
});

test('gate bars: widths vs the max row, which tints yellow', () => {
  const bars = gateBar([
    { reason: 'ONE_SPORT_RULE', costCents: 21_200, note: '87% OF LINE ITEM IS 1XBET' },
    { reason: 'HEAT_GATE', costCents: 6_400, note: '50% OF LINE ITEM IS FANDUEL' },
  ]);
  expect(bars[0]).toEqual({
    reason: 'ONE_SPORT_RULE', widthPct: 100, cost: '−$212', note: '87% OF LINE ITEM IS 1XBET', top: true,
  });
  expect(bars[1]!.widthPct).toBe(30);
  expect(bars[1]!.top).toBe(false);
  expect(gateBar([])).toEqual([]);
});

test('cost tiles: honest em-dashes when empty', () => {
  expect(roundingTile({ costCents: 1_840, pairs: 41 })).toEqual({
    value: '−$18.40', note: 'Σ (UNROUNDED − ROUNDED WORST-CASE) OVER 41 CONFIRMED PAIRS',
  });
  expect(roundingTile(null)).toEqual({ value: '—', note: 'NO CONFIRMED PAIRS YET' });
  expect(retentionTile({ medianPct: 81, dieAtRecheckPct: 23, thresholdPct: 95 })).toEqual({
    value: '81% MEDIAN', note: 'PROMOTION THRESHOLD 95% · 23% OF CANDIDATES DIE AT RECHECK',
  });
  expect(retentionTile(null)).toEqual({ value: '—', note: 'NO RECHECKS YET' });
  expect(closingEdgeTile({ avgPct: 1.1, beatClosePct: 62, legs: 40 })).toEqual({
    value: '+1.1% MEAN · 62% POSITIVE', note: 'FROM LAST CACHED PRE-START SWEEP',
  });
  expect(closingEdgeTile({ avgPct: -0.4, beatClosePct: 41, legs: 3 }).value).toBe('−0.4% MEAN · 41% POSITIVE');
  expect(closingEdgeTile(null)).toEqual({ value: '—', note: 'NO CLOSES CAPTURED YET' });
});
