import { expect, test } from 'vitest';
import {
  advSettingsToggle, backupsText, bookRow, cadenceText, consolidationText,
  fallbackItems, forecastRows, heatWeightsValue, journalMinText, killRuleRows,
  killSwitchValue, lastDigestText, lastTickText, llmBudgetText, memoryText,
  mixRows, planText, quietHoursText, rebalanceMix, riskRows, safetyRows,
  scanWindowText, sportCell, staleText, thresholdTexts, toleranceText,
  validWaNumber, verifyGapText,
} from './settings';

const S = {
  tolerancePct: 5, verifyGapSecs: 75, staleRemoveMin: 10, freshWindowSecs: 120,
  minArbMarginPct: 0.75, minEvEdgePct: 2.0, middleRatio: 1.5,
  kellyFraction: 0.25, kellyCapPct: 5, bankrollCents: 1_000_000,
  flatPairCents: 10_000, roundToCents: 500, minStakeCents: 1_000, dailyPickCap: 12,
  quietStartHour: 0, quietEndHour: 8, scanBaseMin: 20, scanHotMinMin: 5,
  scanHotMaxMin: 8, hotWindowHours: 2, sharpVelocityPerDayPerBook: 3,
  marketBreadthPerWeekPerBook: 2, goGentleHeat: 30, stopHeat: 60,
  heatWeightLimit: 23, heatWeightReject: 9, heatWeightCut: 14, heatWeightWithdrawal: -2,
  heatHalfLifeDays: 21, brainCadenceHours: 6, brainKillSwitch: 0, anchorIdx: 0,
  creditPlanMonthly: 100_000,
  mixArbPct: 47, mixMiddlePct: 24, mixEvPct: 29,
  anchorFallback: 0, oneSportRule: 1, journalMinPerDay: 1,
  whatsappNumber: '', disabledSports: '',
};

test('SCAN RULES rows derive from the store — mockup strings at defaults', () => {
  expect(scanWindowText(S)).toBe('08:00 – 24:00 PT');
  expect(quietHoursText(S)).toBe('00:00 – 08:00 · NO SENDS, NO SCANS');
  expect(cadenceText(S)).toBe('BASE 20 MIN · 5–8 MIN < 2H TO START');
  expect(verifyGapText(S)).toBe('75 S');
  expect(staleText(S)).toBe('10 MIN');
  expect(scanWindowText({ ...S, quietEndHour: 9, quietStartHour: 1 })).toBe('09:00 – 01:00 PT');
});

test('CREDIT FORECASTER rows format live numbers, projection tinted yellow', () => {
  const f = {
    projectedPerDay: 2_306, dailyAllowance: 2_475, usedThisMonth: 40_000,
    monthEndProjection: 91_400, planMonthly: 100_000, remaining: 61_212, runwayDays: 19,
  };
  expect(forecastRows(f)).toEqual([
    ['PROJECTED CREDITS / DAY', '2,306 OF 2,475', 'plain'],
    ['MONTH-END PROJECTION', '91,400 / 100,000', 'yellow'],
    ['REMAINING (LIVE HEADER)', '61,212 · 19 DAYS RUNWAY', 'plain'],
  ]);
});

test('mix rows + deterministic rebalance always summing 100', () => {
  expect(mixRows(S)).toEqual([
    { key: 'ARB', pct: 47 }, { key: 'MIDDLE', pct: 24 }, { key: 'EV', pct: 29 },
  ]);
  expect(rebalanceMix({ arb: 47, middle: 24, ev: 29 }, 'arb', 60))
    .toEqual({ arb: 60, middle: 18, ev: 22 });
  expect(rebalanceMix({ arb: 100, middle: 0, ev: 0 }, 'arb', 40))
    .toEqual({ arb: 40, middle: 30, ev: 30 }); // zero others split the rest
  const r = rebalanceMix({ arb: 33, middle: 33, ev: 34 }, 'ev', 0);
  expect(r.arb + r.middle + r.ev).toBe(100);
  expect(r.ev).toBe(0);
});

test('RISK & BANKROLL rows — mockup strings at defaults', () => {
  expect(riskRows(S)).toEqual([
    ['FLAT PAIR STAKE', '$100 CAD'],
    ['KELLY FRACTION / CAP', '0.25 / 5% OF TOTAL'],
    ['TOTAL BANKROLL', '$10,000 CAD'],
    ['MIN STAKE / ROUND TO', '$10 / $5'],
    ['TRADES PER DAY CAP', '12'],
  ]);
  expect(toleranceText(S)).toBe('5% · 0–100%');
});

test('BRAIN panel rows', () => {
  expect(heatWeightsValue(S, false)).toBe('DEFAULT · EDITABLE WHILE GREEN');
  expect(heatWeightsValue(S, true)).toBe('CUSTOM · EDITABLE WHILE GREEN');
  expect(consolidationText(S)).toBe('EVERY 6 H · HAIKU');
  expect(llmBudgetText({ llmSpentCents: 0, llmCapCents: 300 })).toBe('$0.00 / $3.00 THIS MONTH');
  expect(llmBudgetText({ llmSpentCents: 84, llmCapCents: 300 })).toBe('$0.84 / $3.00 THIS MONTH');
  expect(killSwitchValue(S)).toBe('OFF');
  expect(killSwitchValue({ ...S, brainKillSwitch: 1 })).toBe('ON');
  expect(lastDigestText(null, null, Date.UTC(2026, 6, 14, 19, 0))).toBe('—');
  // 2026-07-14 19:00 UTC = 12:00 PDT, same Vancouver day as "now"
  expect(lastDigestText(Date.UTC(2026, 6, 14, 19, 0), 16, Date.UTC(2026, 6, 14, 20, 0)))
    .toBe('TODAY 12:00 · 16 BOOKS');
  expect(lastDigestText(Date.UTC(2026, 6, 13, 19, 0), 16, Date.UTC(2026, 6, 14, 20, 0)))
    .toBe('JUL 13 12:00 · 16 BOOKS');
});

test('WhatsApp number validation mirrors the server', () => {
  expect(validWaNumber('')).toBe(true); // clearing is legal
  expect(validWaNumber('+1 604 555 8112')).toBe(true);
  expect(validWaNumber('+16045558112')).toBe(true);
  expect(validWaNumber('604 555 8112')).toBe(false);
  expect(validWaNumber('+1 604 555 8112 ext 4')).toBe(false);
});

test('DATA panel rows', () => {
  expect(backupsText({ lastAt: null, keep: 14 })).toBe('14 NIGHTLY · NONE YET');
  // 2026-07-14 10:00 UTC = 03:00 PDT
  expect(backupsText({ lastAt: Date.UTC(2026, 6, 14, 10, 0), keep: 14 })).toBe('14 NIGHTLY · LAST 03:00');
});

test('advanced INPUTS derivations', () => {
  expect(planText(100_000)).toBe('PLAN 100K / MO');
  expect(planText(2_500)).toBe('PLAN 2,500 / MO');
  expect(lastTickText(null, 0)).toBe('LAST TICK —');
  expect(lastTickText(1_000, 42_000)).toBe('LAST TICK 41 S AGO');
  expect(memoryText({ receipts: 4_182, journalEntries: 47 }))
    .toBe('4,182 RECEIPTS · 47 JOURNAL ENTRIES · GROWING');
});

test('MY BOOKS + SPORTS & LEAGUES cells', () => {
  expect(bookRow({ name: 'pinnacle', displayName: 'Pinnacle', sport: 'ANY', sharpExempt: true, enabled: true }))
    .toEqual({ name: 'Pinnacle', sportLabel: 'ANY', chip: { label: 'SHARP — ALWAYS ON', tone: 'sharp' } });
  expect(bookRow({ name: 'bet365', displayName: 'bet365', sport: 'basketball', sharpExempt: false, enabled: true }))
    .toEqual({ name: 'bet365', sportLabel: 'BASKETBALL ▾', chip: { label: 'ON', tone: 'green' } });
  expect(bookRow({ name: 'bet365', displayName: 'bet365', sport: 'basketball', sharpExempt: false, enabled: false }).chip)
    .toEqual({ label: 'OFF', tone: 'muted' });
  expect(sportCell({ sport: 'basketball', enabled: true })).toBe('✓ BASKETBALL');
  expect(sportCell({ sport: 'soccer', enabled: false })).toBe('✗ SOCCER');
});

test('EDGE THRESHOLDS, fallback radios, safety rows, kill rules, journal stepper', () => {
  expect(thresholdTexts(S)).toEqual([
    ['MIN ARB MARGIN', '0.75%'],
    ['MIN EV EDGE', '2.0%'],
    ['MIN MIDDLE QUALITY', '1.5× BREAKEVEN HIT RATE'],
    ['FRESH WINDOW', '120 S'],
  ]);
  expect(fallbackItems(S)).toEqual([
    { idx: 0, label: '● FALL BACK TO CONSENSUS (DEFAULT)', active: true },
    { idx: 1, label: '○ PAUSE EV + MIDDLES, ARBS CONTINUE', active: false },
    { idx: 2, label: '○ PAUSE EVERYTHING', active: false },
  ]);
  expect(safetyRows(S)).toEqual([
    ['SHARP VELOCITY CAP', '3 / DAY / BOOK', 'plain'],
    ['MARKET BREADTH CAP', '2 / MARKET / BOOK / WEEK', 'plain'],
    ['ONE-SPORT RULE', 'ON', 'plain'],
    ['GO GENTLE AT', 'HEAT 30', 'yellow'],
    ['STOP AT', 'HEAT 60', 'red'],
    ['DEFAULT QUIT RULE', '"RETIRE ACCOUNT AFTER 2 STAKE CUTS IN 14 DAYS"', 'plain'],
  ]);
  expect(safetyRows({ ...S, oneSportRule: 0 })[2]).toEqual(['ONE-SPORT RULE', 'OFF', 'plain']);
  expect(killRuleRows()).toEqual([
    ['ARB DIES IF', 'CONFIRMED MARGIN < 60% OF QUOTED OVER 50 PAIRS'],
    ['EV DIES IF', 'CLOSING PRICE EDGE ≤ 0 AFTER 300 PICKS'],
    ['MIDDLE DIES IF', 'LEG CLOSING EDGE ≤ 0 AFTER 200 LEGS'],
  ]);
  expect(journalMinText(S)).toBe('1 / DAY');
  expect(advSettingsToggle(false)).toBe('ADVANCED SETTINGS →');
  expect(advSettingsToggle(true)).toBe('ADVANCED SETTINGS — COLLAPSE');
});
