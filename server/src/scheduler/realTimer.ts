/**
 * The one real wall-clock timer in the whole server, kept inside
 * server/src/scheduler/ so the invariant "no setTimeout/setInterval outside
 * the scheduler" holds mechanically (see timerScope.test.ts). index.ts wires
 * these into the Scheduler; tests inject fakes instead.
 */
import type { TimerHandle } from './scheduler';

export const realTimer = {
  setTimer: (fn: () => void, ms: number): TimerHandle => setTimeout(fn, ms),
  clearTimer: (handle: TimerHandle): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
