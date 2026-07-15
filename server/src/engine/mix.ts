// Strategy mix (Plan 5, Design §3): LOCKED TO 100 becomes an engine fact — each
// category owns a share of the daily pick cap. Pure math, no I/O.
import type { Strategy } from '../shared/types.js';
import type { Settings } from '../shared/defaults.js';

export function mixPct(category: Strategy, s: Settings): number {
  switch (category) {
    case 'ARB': return s.mixArbPct;
    case 'MIDDLE': return s.mixMiddlePct;
    case 'EV': return s.mixEvPct;
  }
}

/** 0% means none, ever; any positive share floors at 1 so a small cap can't starve a category. */
export function mixAllowance(category: Strategy, s: Settings): number {
  const pct = mixPct(category, s);
  if (pct <= 0) return 0;
  return Math.max(1, Math.round((s.dailyPickCap * pct) / 100));
}
