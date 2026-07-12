/**
 * DST-safe America/Vancouver wall-clock helpers — pure, engine-grade (no
 * fs/env/Express/provider imports; `Intl` is a standard ECMAScript global,
 * not a Node built-in). Everything the scheduler and the quiet-hours guards
 * need to reason about local time is here, and it is ALWAYS derived from the
 * IANA zone via Intl — never a fixed UTC offset — so it stays correct across
 * the PST⇄PDT transitions.
 *
 * Quiet hours: zero Odds API calls of any kind 01:00–08:00 Vancouver local
 * (Phase-16 hard rule). This module supplies the predicate + the "next
 * 08:00" boundary the scheduler sleeps to.
 */

export const VANCOUVER_TZ = 'America/Vancouver';

/** 01:00 local, inclusive. */
export const QUIET_START_MIN = 1 * 60;
/** 08:00 local, exclusive. */
export const QUIET_END_MIN = 8 * 60;

/** Shared copy for the route-level quiet-hours guards (manual scans + cockpit
 *  re-verify) — the spec's "quiet hours until 08:00" message. */
export const QUIET_HOURS_MESSAGE =
  'Quiet hours — the eye rests until 08:00 (America/Vancouver). No scans or re-verifies run 01:00–08:00.';

export interface VancouverLocal {
  /** Full year. */
  year: number;
  /** Month 1–12. */
  month: number;
  /** Day of month 1–31. */
  day: number;
  /** 0=Sunday … 6=Saturday. */
  weekday: number;
  /** Minutes from local midnight, 0..1439. */
  minutesOfDay: number;
}

const PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: VANCOUVER_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Ymdhms {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(at: Date): Ymdhms {
  const map: Record<string, string> = {};
  for (const p of PARTS_FMT.formatToParts(at)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  // Some engines render local midnight as hour "24"; normalize to 0.
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Wall-clock fields of `at` in America/Vancouver. */
export function vancouverLocal(at: Date): VancouverLocal {
  const p = partsOf(at);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    // Day-of-week is a property of the calendar date, independent of zone,
    // so read it off a UTC-midnight anchor for that date.
    weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
    minutesOfDay: p.hour * 60 + p.minute,
  };
}

/** The offset (localWallClock − UTC), in ms, in effect at `instant`. */
function offsetMsAt(instant: number): number {
  const p = partsOf(new Date(instant));
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - instant;
}

/**
 * Epoch ms of the America/Vancouver instant whose wall clock is
 * (year, month, day, minutesOfDay). DST-safe: a first offset guess plus one
 * refinement handles the spring-forward / fall-back edges. (Wall clocks
 * inside the nonexistent spring-forward hour resolve to the adjacent valid
 * instant — the scheduler never targets that hour.)
 */
export function vancouverEpochOf(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
): number {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const off1 = offsetMsAt(wallAsUtc);
  let epoch = wallAsUtc - off1;
  const off2 = offsetMsAt(epoch);
  if (off2 !== off1) epoch = wallAsUtc - off2;
  return epoch;
}

/** True while `at` is inside quiet hours (01:00 inclusive – 08:00 exclusive). */
export function isQuietHours(at: Date): boolean {
  const m = vancouverLocal(at).minutesOfDay;
  return m >= QUIET_START_MIN && m < QUIET_END_MIN;
}

/**
 * Epoch ms of the upcoming 08:00 Vancouver — the moment quiet hours end.
 * If it's already 08:00 or later locally, rolls to the next day's 08:00.
 */
export function nextQuietEndMs(at: Date): number {
  const loc = vancouverLocal(at);
  let { year, month, day } = loc;
  if (loc.minutesOfDay >= QUIET_END_MIN) {
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    year = tomorrow.getUTCFullYear();
    month = tomorrow.getUTCMonth() + 1;
    day = tomorrow.getUTCDate();
  }
  return vancouverEpochOf(year, month, day, QUIET_END_MIN);
}
