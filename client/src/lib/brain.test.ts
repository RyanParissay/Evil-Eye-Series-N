import { expect, test } from 'vitest';
import type { TradeView } from './api';
import {
  anchorSub, anchorValue, chartGeometry, cpeTile, creditsTile, doesNowText, dvTile,
  fmtInt, formatTimeSecs, gradeTone, healthBadge, heatCell, heatY, journalToggle,
  killSwitchLabel, maxBetTexts, modelControlRows, passTimeLabel, picksTile,
  quitRulesText, rationaleBody, rationaleLabel, siteMeta, sitesToggle, traceLines, traceTitle,
} from './brain';

const CONTROLS = { limit: 23, reject: 9, cut: 14, withdrawal: -2, halfLifeDays: 21, cadenceHours: 6 };

function book(over: Record<string, unknown> = {}) {
  return {
    name: 'betmgm', displayName: 'BetMGM', sport: 'baseball', sharpExempt: false,
    heat: 41, health: 'yellow' as const, suspicion: 3, maxBetCents: 25_000, wasCents: 50_000,
    history: [], marks: [], ...over,
  };
}

test('header labels', () => {
  expect(passTimeLabel(null)).toBe('LAST FULL PASS —');
  // 2026-07-14 05:47 UTC == 2026-07-13 22:47 PDT
  expect(passTimeLabel(Date.UTC(2026, 6, 14, 5, 47))).toBe('LAST FULL PASS 10:47 PM');
  expect(killSwitchLabel(false)).toBe('KILL SWITCH · OFF');
  expect(killSwitchLabel(true)).toBe('KILL SWITCH · ON');
});

test('anchor tile: labels cycle, sim honesty note when off pinnacle', () => {
  expect(anchorValue(0)).toBe('PINNACLE ▾');
  expect(anchorValue(1)).toBe('CIRCA ▾');
  expect(anchorValue(2)).toBe('CONSENSUS ▾');
  expect(anchorSub({ idx: 0, live: true })).toEqual({ text: 'live', tone: 'green' });
  expect(anchorSub({ idx: 0, live: false })).toEqual({ text: 'offline', tone: 'muted' });
  expect(anchorSub({ idx: 1, live: true })).toEqual({ text: 'maps to pinnacle in sim', tone: 'yellow' });
});

test('tiles format from the payload; empty tiles show honest em-dashes', () => {
  expect(fmtInt(61_212)).toBe('61,212');
  expect(creditsTile({ remainingCredits: 61_212, planCredits: 100_000, runwayDays: 19 }))
    .toEqual({ value: '61,212 / 100,000', sub: '19d runway', tone: 'green' });
  expect(dvTile({ passRatePct: 77, edgeRetentionPct: 81, rechecked: 120 }))
    .toEqual({ value: '77% pass rate', sub: 'survivors keep 81% edge', tone: 'muted' });
  expect(dvTile(null)).toEqual({ value: '—', sub: 'no rechecks yet', tone: 'muted' });
  expect(picksTile({ sent: 8, of: 12, heldBack: 4 }))
    .toEqual({ value: '8 of 12 sent', sub: '4 held back', tone: 'yellow' });
  expect(cpeTile({ avgPct: 1.1, beatClosePct: 62, legs: 40 }))
    .toEqual({ value: '+1.1% avg', sub: '62% beat the close', tone: 'green' });
  expect(cpeTile({ avgPct: -0.4, beatClosePct: 41, legs: 12 }).value).toBe('−0.4% avg'); // U+2212
  expect(cpeTile(null)).toEqual({ value: '—', sub: 'no closes captured yet', tone: 'muted' });
});

test('rationale panel derives label and body', () => {
  expect(rationaleLabel(8)).toBe('WHY ONLY 8 TODAY');
  expect(rationaleBody({
    sent: 8, candidates: 214, passed: 12,
    heldBackClauses: ['2 died at the recheck', 'daily cap of 12 held back 4'],
  })).toBe('214 candidates → 12 passed double verification → 8 sent. Held back: 2 died at the recheck · daily cap of 12 held back 4.');
});

test('site table cells', () => {
  expect(healthBadge(book({ sharpExempt: true }))).toEqual({ label: 'SHARP — SAFE', tone: 'sharp' });
  expect(healthBadge(book({ health: 'green' }))).toEqual({ label: 'GREEN', tone: 'green' });
  expect(healthBadge(book({ health: 'yellow' }))).toEqual({ label: 'AMBER', tone: 'amber' });
  expect(healthBadge(book({ health: 'red' }))).toEqual({ label: 'RED', tone: 'red' });
  expect(heatCell(book())).toBe('41');
  expect(heatCell(book({ sharpExempt: true }))).toBe('—');
  expect(sitesToggle(16, false)).toBe('+ 11 MORE SITES');
  expect(sitesToggle(16, true)).toBe('− SHOW FEWER SITES');
});

test('detail panel: meta, max bet, verbatim prose', () => {
  expect(siteMeta(book({ sharpExempt: true }))).toBe('· TAKES EVERY SPORT · THE HEDGE LEG');
  expect(siteMeta(book())).toBe('· BASEBALL ONLY · SUSPICION LEVEL 3/5');
  expect(maxBetTexts(book({ maxBetCents: null, wasCents: null }))).toEqual({ max: 'NO LIMIT', was: null });
  expect(maxBetTexts(book({ maxBetCents: 50_000, wasCents: null }))).toEqual({ max: '$500', was: null });
  expect(maxBetTexts(book())).toEqual({ max: '$250', was: 'WAS $500' });
  expect(doesNowText(book({ sharpExempt: true })))
    .toBe('Safe by design. Sharp books don’t limit winners — this is where the hedge leg goes, and it never accumulates heat.');
  expect(doesNowText(book({ health: 'green' })))
    .toBe('Full speed. Stakes at 100%, up to 3 sharp bets a day. Nothing to fix — keep withdrawals boring and regular.');
  expect(doesNowText(book())).toContain('Half as many risky bets here, stakes shrunk 40%');
  expect(doesNowText(book({ health: 'red' })))
    .toBe('Nothing sharp goes here anymore. Promo reminders only. Withdraw the balance in two or three plain chunks, then let it rest.');
  expect(quitRulesText(book({ sharpExempt: true }))).toBe('None needed. This account is meant to live forever.');
  expect(quitRulesText(book({ health: 'green' })))
    .toBe('"Retire this account after 2 stake cuts in 14 days." Editable now — the account is calm.');
  expect(quitRulesText(book()))
    .toBe('"Retire this account after 2 stake cuts in 14 days." Locked while the account struggles — you decided this when calm.');
});

test('chart geometry: thresholds fix the y-mapping; marks snap to the nearest pass', () => {
  expect(heatY(60)).toBe(20);   // STOP dashed line
  expect(heatY(30)).toBe(85);   // GO GENTLE dashed line
  expect(heatY(0)).toBe(150);
  expect(heatY(100)).toBe(10);  // clamped
  const geo = chartGeometry(
    [{ ts: 0, heat: 0 }, { ts: 100, heat: 60 }],
    [{ ts: 90, kind: 'LIMIT REPORTED' }],
  )!;
  expect(geo.line).toBe('10,150 790,20');
  expect(geo.marks).toEqual([{ x: 790, y: 20, label: 'LIMIT REPORTED' }]);
  expect(chartGeometry([{ ts: 0, heat: 5 }], [])).toBeNull(); // one pass — no line yet
});

test('grade tones: 70 green, 30 yellow, below red', () => {
  expect(gradeTone(92)).toBe('green');
  expect(gradeTone(70)).toBe('green');
  expect(gradeTone(69)).toBe('yellow');
  expect(gradeTone(30)).toBe('yellow');
  expect(gradeTone(29)).toBe('red');
});

test('journal toggle labels', () => {
  expect(journalToggle(47, false)).toBe('SHOW ALL 47 ENTRIES →');
  expect(journalToggle(47, true)).toBe('SHOWING ALL — COLLAPSE');
});

test('model controls rows render the binding copy from live settings', () => {
  expect(modelControlRows(CONTROLS)).toEqual([
    ['HEAT WEIGHTS (RAW)', 'LIMIT +23 · REJECT +9 · CUT +14 · WITHDRAWAL −2'],
    ['SUSPICION DECAY HALF-LIFE', '21 DAYS'],
    ['CONSOLIDATION CADENCE', 'EVERY 6 H'],
    ['JOURNAL RETENTION', 'FOREVER — NEVER DELETED'],
  ]);
});

function trade(over: Partial<TradeView>): TradeView {
  return {
    id: 't1', profileId: 1, category: 'ARB', event: 'SIM-EVT-7', sport: 'basketball',
    legs: [
      { book: 'bet365', selection: 'home', odds: 2.105, stakeCents: 5_000 },
      { book: 'fanduel', selection: 'away', odds: 2.216, stakeCents: 5_000 },
    ],
    marginInitial: 0.1, marginRecheck: 0.096, marginFinal: 0.07,
    status: 'VERIFIED', killReason: null, resultCents: null,
    createdAt: 0, verifyDueAt: 75_000,
    verifiedAt: Date.UTC(2026, 6, 15, 5, 41, 6), // 22:41:06 PDT
    freshUntil: Date.UTC(2026, 6, 15, 5, 41, 6) + 120_000,
    settledAt: null, eventStartsAt: Date.UTC(2026, 6, 15, 7, 0),
    marginPct: 7, edgePct: 7,
    ...over,
  };
}

test('formatTimeSecs renders Vancouver 24h clock', () => {
  expect(formatTimeSecs(Date.UTC(2026, 6, 15, 5, 41, 6))).toBe('22:41:06');
});

test('traceLines: verified ARB — correct arithmetic, all gates, recheck, stakes, out', () => {
  expect(traceTitle(trade({}))).toBe('LIVE TRACE — LAST CANDIDATE THROUGH THE PIPE (SIM-EVT-7)');
  expect(traceLines(trade({}))).toEqual([
    'IN :  bet365 home @ 2.105 · fanduel away @ 2.216',
    'DEVIG: inv_sum = 0.4751 + 0.4513 = 0.9263',
    'EDGE: arb_margin = 1 − inv_sum = 7.4%',
    'GATES: one_sport ✓ · heat ✓ · velocity ✓ · breadth ✓ · rounding ✓ · quote ✓',
    'RECHECK: retention 96.0% — passed',
    'STAKE: $50 / $50 (rounded to $5, cap 5% of bankroll)',
    'OUT:  verified 22:41:06 · sent · fresh 2:00',
  ]);
});

test('traceLines: pending EV — fair prob from edge, no stakes before verification', () => {
  const t = trade({
    category: 'EV', status: 'PENDING',
    legs: [{ book: 'draftkings', selection: 'away', odds: 2.4, stakeCents: null }],
    marginInitial: 0.048, marginRecheck: null, marginFinal: null, verifiedAt: null, freshUntil: null,
    verifyDueAt: Date.UTC(2026, 6, 15, 5, 48, 18),
  });
  expect(traceLines(t)).toEqual([
    'IN :  draftkings away @ 2.400',
    'DEVIG: fair_prob = (1 + edge) / odds = 0.4367',
    'EDGE: ev_edge = 4.8%',
    'GATES: one_sport ✓ · heat ✓ · velocity ✓ · breadth ✓ · rounding ✓ · quote ✓',
    'STAKE: — (no stakes until verification)',
    'OUT:  pending — recheck due 22:48:18',
  ]);
});

test('traceLines: battery kill stops the gate line at the failure', () => {
  const t = trade({
    status: 'KILLED', killReason: 'HEAT_GATE',
    marginRecheck: null, marginFinal: null, verifiedAt: null, freshUntil: null,
    legs: [{ book: 'bet365', selection: 'home', odds: 2.105, stakeCents: null }],
  });
  const lines = traceLines(t);
  expect(lines).toContain('GATES: one_sport ✓ · heat ✗ HEAT_GATE');
  expect(lines[lines.length - 1]).toBe('OUT:  killed — HEAT_GATE');
});

test('traceLines: failed verification keeps gates clean and marks the recheck', () => {
  const t = trade({
    status: 'KILLED', killReason: 'FAILED_VERIFICATION',
    marginRecheck: 0.089, marginFinal: null, verifiedAt: null, freshUntil: null,
    legs: [
      { book: 'bet365', selection: 'home', odds: 2.105, stakeCents: null },
      { book: 'fanduel', selection: 'away', odds: 2.216, stakeCents: null },
    ],
  });
  const lines = traceLines(t);
  expect(lines).toContain('GATES: one_sport ✓ · heat ✓ · velocity ✓ · breadth ✓ · rounding ✓ · quote ✓');
  expect(lines).toContain('RECHECK: retention 89.0% — failed, killed');
});
