// scheduler/plan.ts — pure scheduler planner. No clocks, no I/O: the runner
// (Task 13) supplies `now` and an rng, and executes whatever action comes back.
import type { Settings } from '../shared/defaults.js';
import { isQuietHours, nextQuietEnd } from './vancouverTime.js';

const MIN = 60_000;

export interface PlanState {
  lastScanAt: number | null;
  pendingVerifyDueAts: number[];
  anyEventWithinHotWindow: boolean;
}

export type PlanAction =
  | { kind: 'scan'; at: number }
  | { kind: 'verify'; at: number }
  | { kind: 'sleepUntil'; at: number };

/**
 * Decide the next action. Quiet hours (Vancouver-local) always win: sleep until
 * the quiet window ends. Otherwise take the EARLIEST of the due verify recheck
 * (min of pendingVerifyDueAts) and the next scan (lastScanAt + cadence; a null
 * lastScanAt means scan immediately). Verify wins exact ties. Cadence is
 * scanBaseMin, or scanHotMinMin + rng()*(scanHotMaxMin - scanHotMinMin) when
 * any event is inside the hot window — rng is only consulted in that case.
 *
 * NOTE: an action's `at` may be in the past relative to `now` (e.g. an overdue
 * verify). It is returned as-is; the runner clamps to "run immediately".
 */
export function planNext(st: PlanState, now: number, s: Settings, rng: () => number): PlanAction {
  if (isQuietHours(now, s)) {
    return { kind: 'sleepUntil', at: nextQuietEnd(now, s) };
  }

  let scanAt: number;
  if (st.lastScanAt === null) {
    scanAt = now;
  } else {
    const cadenceMin = st.anyEventWithinHotWindow
      ? s.scanHotMinMin + rng() * (s.scanHotMaxMin - s.scanHotMinMin)
      : s.scanBaseMin;
    scanAt = st.lastScanAt + cadenceMin * MIN;
  }

  if (st.pendingVerifyDueAts.length > 0) {
    const verifyAt = Math.min(...st.pendingVerifyDueAts);
    if (verifyAt <= scanAt) return { kind: 'verify', at: verifyAt };
  }
  return { kind: 'scan', at: scanAt };
}
