import { expect, test } from 'vitest';
import { planNext, type PlanState } from './plan.js';
import { DEFAULT_SETTINGS } from '../shared/defaults.js';

const s = DEFAULT_SETTINGS;
const MIN = 60_000;

// Intl-based Vancouver wall-clock -> epoch helper (no hardcoded UTC offsets).
// Brute-force offset scan in 15-minute steps; independent of production code.
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function vanEpoch(y: number, m: number, d: number, h = 0, min = 0): number {
  const wallAsUtc = Date.UTC(y, m - 1, d, h, min);
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const candidate = wallAsUtc + off * MIN;
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(candidate))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    if (p.year === y && p.month === m && p.day === d && p.hour === h && p.minute === min) {
      return candidate;
    }
  }
  throw new Error(`no epoch maps to Vancouver ${y}-${m}-${d} ${h}:${min}`);
}

const st = (over: Partial<PlanState> = {}): PlanState => ({
  lastScanAt: null, pendingVerifyDueAts: [], anyEventWithinHotWindow: false, ...over,
});
const noRng = () => { throw new Error('rng must not be called'); };

// --- Quiet hours ---------------------------------------------------------------
test('03:00 Vancouver is quiet: sleeps to that day 08:00 Vancouver exactly', () => {
  const now = vanEpoch(2026, 7, 13, 3, 0);
  expect(planNext(st(), now, s, noRng)).toEqual({
    kind: 'sleepUntil', at: vanEpoch(2026, 7, 13, 8, 0),
  });
});

test('quiet hours win even over an overdue verify', () => {
  const now = vanEpoch(2026, 7, 13, 3, 0);
  const action = planNext(st({ pendingVerifyDueAts: [now - 5 * MIN] }), now, s, noRng);
  expect(action).toEqual({ kind: 'sleepUntil', at: vanEpoch(2026, 7, 13, 8, 0) });
});

// All remaining tests run at Vancouver noon — safely outside quiet hours.
const NOON = vanEpoch(2026, 7, 13, 12, 0);

// --- Scan cadence ----------------------------------------------------------------
test('lastScanAt null: scan now', () => {
  expect(planNext(st(), NOON, s, noRng)).toEqual({ kind: 'scan', at: NOON });
});

test('base cadence: next scan is lastScanAt + 20min; rng untouched', () => {
  const lastScanAt = NOON - 5 * MIN;
  expect(planNext(st({ lastScanAt }), NOON, s, noRng)).toEqual({
    kind: 'scan', at: lastScanAt + s.scanBaseMin * MIN,
  });
});

test('a scan can be due in the past: `at` is returned as-is, not clamped to now', () => {
  const lastScanAt = NOON - 25 * MIN; // 20min cadence => due 5min ago
  const action = planNext(st({ lastScanAt }), NOON, s, noRng);
  expect(action).toEqual({ kind: 'scan', at: lastScanAt + s.scanBaseMin * MIN });
  expect(action.at).toBeLessThan(NOON);
});

// --- Hot window cadence -----------------------------------------------------------
test('hot window, rng()=0: cadence is exactly scanHotMinMin (5min)', () => {
  const lastScanAt = NOON;
  const action = planNext(
    st({ lastScanAt, anyEventWithinHotWindow: true }), NOON, s, () => 0,
  );
  expect(action).toEqual({ kind: 'scan', at: lastScanAt + s.scanHotMinMin * MIN });
});

test('hot window, rng()=0.999: cadence is scanHotMinMin + 0.999*(max-min) (~8min)', () => {
  const lastScanAt = NOON;
  const cadenceMin = s.scanHotMinMin + 0.999 * (s.scanHotMaxMin - s.scanHotMinMin);
  const action = planNext(
    st({ lastScanAt, anyEventWithinHotWindow: true }), NOON, s, () => 0.999,
  );
  expect(action).toEqual({ kind: 'scan', at: lastScanAt + cadenceMin * MIN });
});

// --- Verify vs scan ------------------------------------------------------------------
test('earliest pending verify beats a later scan', () => {
  const action = planNext(
    st({ lastScanAt: NOON, pendingVerifyDueAts: [NOON + 60_000, NOON + 30_000] }),
    NOON, s, noRng,
  );
  expect(action).toEqual({ kind: 'verify', at: NOON + 30_000 }); // min of the dues
});

test('scan beats a verify due later than the scan', () => {
  const action = planNext(
    st({ lastScanAt: NOON, pendingVerifyDueAts: [NOON + 21 * MIN] }), NOON, s, noRng,
  );
  expect(action).toEqual({ kind: 'scan', at: NOON + s.scanBaseMin * MIN });
});

test('exact tie goes to verify', () => {
  const due = NOON + s.scanBaseMin * MIN; // identical instant as next scan
  const action = planNext(
    st({ lastScanAt: NOON, pendingVerifyDueAts: [due] }), NOON, s, noRng,
  );
  expect(action).toEqual({ kind: 'verify', at: due });
});

test('overdue verify is returned with its past `at` untouched (runner clamps)', () => {
  const due = NOON - 5 * MIN;
  const action = planNext(
    st({ lastScanAt: NOON, pendingVerifyDueAts: [due] }), NOON, s, noRng,
  );
  expect(action).toEqual({ kind: 'verify', at: due });
});
