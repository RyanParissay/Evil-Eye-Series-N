/**
 * How long do our arbs actually live? Pure: opportunity records joined
 * with the scan log. Honest-numbers rules: a record with no covering
 * scan after detection is EXCLUDED (unknown ≠ dead), and commencement
 * kills are censored (the event outlived the market window) — never
 * mixed into the "gone" lifetime distribution.
 *
 * The haircut mapping (design doc §3): acting on an alert costs roughly
 * one scan interval, so measuredHaircut% = 100 × (1 − P(survive one
 * covering scan)). Qualified at ≥14 days of scan-log span AND ≥50
 * survival samples.
 */
import type { OpportunityRecord, RateStat, ScanLogEntry, SurvivalStats } from '@shared/types';

const QUALIFY_SPAN_MS = 14 * 24 * 3_600_000;
const QUALIFY_SAMPLES = 50;

export function computeSurvival(
  records: OpportunityRecord[],
  scans: ScanLogEntry[],
  now: Date,
): SurvivalStats {
  const ordered = [...scans].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));

  const overall: boolean[] = [];
  const byPair = new Map<string, boolean[]>();
  const byBand = new Map<string, boolean[]>();
  const lifetimes: number[] = [];
  let censored = 0;

  for (const record of records) {
    // Lifetime: absence-deaths only; commencement kills are censored.
    if (record.status === 'dead') {
      const commenced = Date.parse(record.commenceTime) <= Date.parse(record.statusChangedAt);
      if (commenced) {
        censored += 1;
      } else {
        lifetimes.push(Date.parse(record.statusChangedAt) - Date.parse(record.detectedAt));
      }
    }

    // Survival at the next covering scan (same tab, sport rescanned).
    const nextScan = ordered.find(
      (s) =>
        s.scannedAt > record.detectedAt &&
        s.regionTab === record.regionTab &&
        s.sportsScanned.includes(record.sportKey),
    );
    if (!nextScan) continue;
    const survived = record.lastSeenAt >= nextScan.scannedAt;
    overall.push(survived);

    const pair = record.legs.map((l) => l.bookmakerKey).sort().join('+');
    (byPair.get(pair) ?? byPair.set(pair, []).get(pair)!).push(survived);
    const band = hourBand(record.detectedAt);
    (byBand.get(band) ?? byBand.set(band, []).get(band)!).push(survived);
  }

  const overallStat = rate(overall);
  const spanMs =
    ordered.length >= 2
      ? Date.parse(ordered[ordered.length - 1].scannedAt) - Date.parse(ordered[0].scannedAt)
      : 0;
  const qualified = spanMs >= QUALIFY_SPAN_MS && overallStat.samples >= QUALIFY_SAMPLES;

  lifetimes.sort((a, b) => a - b);
  return {
    overall: overallStat,
    byPair: [...byPair.entries()]
      .map(([pair, flags]) => ({ pair, ...rate(flags) }))
      .sort((a, b) => b.samples - a.samples),
    byBand: [...byBand.entries()]
      .map(([band, flags]) => ({ band, ...rate(flags) }))
      .sort((a, b) => a.band.localeCompare(b.band)),
    lifetime: {
      samples: lifetimes.length,
      medianMs: quantile(lifetimes, 0.5),
      p25Ms: quantile(lifetimes, 0.25),
      p75Ms: quantile(lifetimes, 0.75),
      censored,
    },
    haircut: {
      qualified,
      measuredPct:
        qualified && overallStat.rate != null
          ? Math.round((1 - overallStat.rate) * 10_000) / 100
          : null,
      detail: qualified
        ? `${overallStat.samples} arbs measured: ${Math.round((overallStat.rate ?? 0) * 100)}% survive one scan interval`
        : `unmeasured — needs ≥14 days of scan history and ≥50 samples (have ${Math.round(spanMs / 86_400_000)}d, ${overallStat.samples})`,
    },
  };
}

/** Six 4-hour local bands: "00-04" … "20-24". */
function hourBand(iso: string): string {
  const hour = new Date(iso).getHours();
  const start = Math.floor(hour / 4) * 4;
  return `${String(start).padStart(2, '0')}-${String(start + 4).padStart(2, '0')}`;
}

function rate(flags: boolean[]): RateStat {
  return {
    samples: flags.length,
    rate: flags.length > 0 ? flags.filter(Boolean).length / flags.length : null,
  };
}

/** Median-style quantile on a sorted array (linear interpolation). */
function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
