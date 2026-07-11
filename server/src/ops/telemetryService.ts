/**
 * Reaction-funnel aggregation — the ideal-vs-reality bridge. Pure.
 * Missing steps are excluded from every delta, never zero-filled.
 */
import type { DeltaStat, OpportunityRecord, TelemetryStats } from '@shared/types';

export function computeTelemetry(records: OpportunityRecord[]): TelemetryStats {
  const alertToVerify: number[] = [];
  const alertToOpen: number[] = [];
  const openToVerify: number[] = [];
  const verifyToCompleted: number[] = [];

  let total = 0;
  let active = 0;
  let degraded = 0;
  let dead = 0;
  const profitDeltas: number[] = [];
  const byBook = new Map<
    string,
    { title: string; total: number; active: number; degraded: number; dead: number; deltas: number[] }
  >();

  for (const record of records) {
    const alertedAt = record.alertedAt;
    const opened = record.funnel?.cockpitOpenedAt;
    const verified = record.funnel?.verifyPressedAt;
    const completed = record.execution?.recordedAt;

    if (alertedAt && verified) alertToVerify.push(delta(alertedAt, verified));
    if (alertedAt && opened) alertToOpen.push(delta(alertedAt, opened));
    if (opened && verified) openToVerify.push(delta(opened, verified));
    if (verified && completed) verifyToCompleted.push(delta(verified, completed));

    if (!record.alerted) continue; // outcome stats are the alert-driven story
    for (const verify of record.verifies ?? []) {
      total += 1;
      if (verify.outcome === 'active') active += 1;
      else if (verify.outcome === 'degraded') degraded += 1;
      else dead += 1;
      const profitDelta = verify.profitPct - record.profitPctAtDetection;
      profitDeltas.push(profitDelta);
      for (const leg of record.legs) {
        const entry =
          byBook.get(leg.bookmakerKey) ??
          byBook
            .set(leg.bookmakerKey, {
              title: leg.bookmakerTitle,
              total: 0,
              active: 0,
              degraded: 0,
              dead: 0,
              deltas: [],
            })
            .get(leg.bookmakerKey)!;
        entry.total += 1;
        entry[verify.outcome] += 1;
        entry.deltas.push(profitDelta);
      }
    }
  }

  return {
    alertToVerify: deltaStat(alertToVerify),
    alertToOpen: deltaStat(alertToOpen),
    openToVerify: deltaStat(openToVerify),
    verifyToCompleted: deltaStat(verifyToCompleted),
    verifyOutcomes: {
      total,
      active,
      degraded,
      dead,
      avgProfitDeltaPp: mean(profitDeltas),
      byBook: [...byBook.entries()]
        .map(([bookmakerKey, e]) => ({
          bookmakerKey,
          title: e.title,
          total: e.total,
          active: e.active,
          degraded: e.degraded,
          dead: e.dead,
          avgProfitDeltaPp: mean(e.deltas),
        }))
        .sort((a, b) => b.total - a.total),
    },
  };
}

function delta(fromIso: string, toIso: string): number {
  return Date.parse(toIso) - Date.parse(fromIso);
}

function deltaStat(deltas: number[]): DeltaStat {
  if (deltas.length === 0) return { samples: 0, medianMs: null };
  const sorted = [...deltas].sort((a, b) => a - b);
  const pos = (sorted.length - 1) / 2;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return { samples: deltas.length, medianMs: sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo) };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}
