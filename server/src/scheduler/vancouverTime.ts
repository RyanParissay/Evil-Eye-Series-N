// scheduler/vancouverTime.ts — DST-safe Vancouver wall-clock helpers.
// Every conversion goes through Intl.DateTimeFormat parts for America/Vancouver;
// no UTC offset is ever hardcoded, so PST/PDT transitions are handled by ICU.
import { DEFAULT_SETTINGS, type Settings } from '../shared/defaults.js';

const TZ = 'America/Vancouver';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', // never "24" for midnight
});

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number; }

function vancouverWallClock(epochMs: number): WallClock {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return {
    year: p.year!, month: p.month!, day: p.day!,
    hour: p.hour!, minute: p.minute!, second: p.second!,
  };
}

/**
 * Epoch ms of a Vancouver wall-clock time. Iterative two-pass technique:
 * guess the instant as if the wall time were UTC, ask Intl what wall time
 * that instant actually is in Vancouver, and correct by the difference.
 * Converges in one step for any fixed offset and across DST boundaries.
 * (Quiet end 08:00 is never skipped or ambiguous — Vancouver transitions
 * happen at 02:00 — so the loop always converges for our inputs.)
 */
function vancouverWallClockToEpoch(year: number, month: number, day: number, hour: number): number {
  const desired = Date.UTC(year, month - 1, day, hour); // Date.UTC normalizes day overflow
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const w = vancouverWallClock(guess);
    const actual = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, ((guess % 1000) + 1000) % 1000);
    if (actual === desired) return guess;
    guess += desired - actual;
  }
  return guess;
}

/** True iff epochMs falls in [quietStartHour, quietEndHour) Vancouver-local. */
export function isQuietHours(epochMs: number, s: Settings): boolean {
  const { hour } = vancouverWallClock(epochMs);
  const { quietStartHour: start, quietEndHour: end } = s;
  // start <= end is the normal case (defaults 0..8); the wrap branch keeps the
  // half-open semantics if quiet hours ever straddle midnight (e.g. 22 -> 8).
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Next instant strictly after epochMs at which Vancouver wall-clock reads
 * quietEndHour:00:00.000. At exactly 08:00 quiet is already over ([start, end)),
 * so the result rolls to the following day.
 */
export function nextQuietEnd(epochMs: number, s: Settings = DEFAULT_SETTINGS): number {
  const w = vancouverWallClock(epochMs);
  const sameDay = vancouverWallClockToEpoch(w.year, w.month, w.day, s.quietEndHour);
  if (sameDay > epochMs) return sameDay;
  return vancouverWallClockToEpoch(w.year, w.month, w.day + 1, s.quietEndHour);
}

/** "YYYY-MM-DD" of the Vancouver-local calendar day containing epochMs. */
export function dayKey(epochMs: number): string {
  const w = vancouverWallClock(epochMs);
  const yyyy = String(w.year).padStart(4, '0');
  const mm = String(w.month).padStart(2, '0');
  const dd = String(w.day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
