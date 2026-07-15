// client/src/lib/format.ts — pure display formatting. No imports, no React, no fetch.
// Money is integer cents everywhere; dollars exist only in these return strings.

function group(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** $35 / $10,000 when whole dollars; else $2.20. Input: non-negative cents. */
export function formatCents(c: number): string {
  const dollars = Math.floor(c / 100);
  const rem = c % 100;
  if (rem === 0) return `$${group(String(dollars))}`;
  return `$${group(String(dollars))}.${String(rem).padStart(2, '0')}`;
}

/** Always 2dp, '+' or U+2212 '−' sign: +$2.20, −$20.00. */
export function formatSignedCents(c: number): string {
  const sign = c < 0 ? '−' : '+';
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${group(String(dollars))}.${String(rem).padStart(2, '0')}`;
}

/** m:ss — floor, pad2. 86 → "1:26", 0 → "0:00", 161 → "2:41". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Decimal odds, always 2dp: "3.10", "2.06". */
export function formatOdds(n: number): string {
  return n.toFixed(2);
}

/** ARB → MARGIN[:] x.x% · EV/MIDDLE → EDGE[:] +x.x% — 1 decimal place. */
export function formatMetric(
  category: 'ARB' | 'MIDDLE' | 'EV',
  pct: number,
  opts: { colon: boolean },
): string {
  const sep = opts.colon ? ': ' : ' ';
  if (category === 'ARB') return `MARGIN${sep}${pct.toFixed(1)}%`;
  return `EDGE${sep}+${pct.toFixed(1)}%`;
}

/** "$25" → 2500, "$25.50" → 2550. Optional 2dp fraction; empty/junk/3+dp → null. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (m === null) return null;
  const whole = m[1];
  if (whole === undefined) return null;
  const frac = m[2];
  const cents = frac === undefined ? 0 : Number(frac.padEnd(2, '0'));
  return Number(whole) * 100 + cents;
}

const VANCOUVER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Epoch ms → "JUL 13 · 10:47 PM" in America/Vancouver (DST-safe via Intl). */
export function formatScanTime(epochMs: number): string {
  const parts = VANCOUVER.formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')} · ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** History third column — same format as the status line. */
export function formatWhen(epochMs: number): string {
  return formatScanTime(epochMs);
}
