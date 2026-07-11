/**
 * Peak-hours cadence + credit-budget guard — the pure logic behind the
 * Phase 8 mode line. CLIENT timers only, always (CLAUDE.md invariant):
 * windows are evaluated in the local time of the machine with the page
 * open, and credits only burn while someone is actually watching.
 * React-free and DOM-free, like autoScan.ts.
 */
import type { OpsSettings, ScanWindow } from '../../shared/types';

export interface CadenceState {
  inWindow: boolean;
  /** Effective auto-scan cadence right now; null = auto-scan sleeps. */
  cadenceMins: number | null;
  label: 'IN WINDOW' | 'OUT OF WINDOW';
}

export interface BudgetState {
  projectedMonthEnd: number | null;
  /** Projection exceeds the monthly budget. */
  warning: boolean;
  /** Hard stop: used ≥ autoStopPct% of budget. Manual scans never blocked. */
  stopped: boolean;
}

export function windowState(settings: OpsSettings, now: Date): CadenceState {
  const day = now.getDay();
  const window = day === 0 || day === 6 ? settings.weekend : settings.weekday;
  const mins = now.getHours() * 60 + now.getMinutes();
  const inside = inWindow(window, mins);
  return {
    inWindow: inside,
    cadenceMins: inside ? settings.inWindowMins : settings.outWindowMins,
    label: inside ? 'IN WINDOW' : 'OUT OF WINDOW',
  };
}

/** Start inclusive, end exclusive; end < start spans midnight. */
function inWindow(window: ScanWindow, mins: number): boolean {
  if (window.startMinutes <= window.endMinutes) {
    return mins >= window.startMinutes && mins < window.endMinutes;
  }
  return mins >= window.startMinutes || mins < window.endMinutes;
}

/**
 * Month-to-date burn (the provider's own counter) → naive local-calendar-
 * month projection. The stop releases by construction: a month rollover
 * resets the counter (used drops below the ceiling) and a budget raise
 * moves the ceiling.
 */
export function budgetState(
  settings: OpsSettings,
  usedTotal: number | null,
  now: Date,
): BudgetState {
  if (usedTotal == null) return { projectedMonthEnd: null, warning: false, stopped: false };
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const elapsed = (now.getTime() - monthStart) / (monthEnd - monthStart);
  const projectedMonthEnd = elapsed > 0 ? Math.round(usedTotal / elapsed) : usedTotal;
  return {
    projectedMonthEnd,
    warning: projectedMonthEnd > settings.monthlyCreditBudget,
    stopped: usedTotal >= (settings.autoStopPct / 100) * settings.monthlyCreditBudget,
  };
}
