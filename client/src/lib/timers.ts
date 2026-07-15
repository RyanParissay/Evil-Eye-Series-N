// client/src/lib/timers.ts — pure countdown math; components feed it `now` from useTick.

export interface LiveTimer {
  phase: 'FRESH' | 'STALE';
  seconds: number;
}

/** FRESH = countdown to freshUntil (ceil); at/past 0 → STALE counting up (floor). */
export function liveTimer(freshUntil: number, now: number): LiveTimer {
  const diffMs = freshUntil - now;
  if (diffMs > 0) return { phase: 'FRESH', seconds: Math.ceil(diffMs / 1000) };
  return { phase: 'STALE', seconds: Math.floor((now - freshUntil) / 1000) }; // not -diffMs: -0 breaks toEqual
}

/** CHECKING AGAIN IN — clamps at 0; the client NEVER resets to 75. */
export function pendingCountdown(verifyDueAt: number, now: number): number {
  return Math.max(0, Math.ceil((verifyDueAt - now) / 1000));
}
