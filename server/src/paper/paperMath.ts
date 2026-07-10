/**
 * Deterministic settlement of the paper book — pure. The store keeps
 * facts (entries at alert-time odds); every dollar here derives from
 * those facts plus the current settings, so changing an assumption
 * recomputes the whole simulation. Lazy by construction: profit realizes
 * at commence time, evaluated whenever someone reads.
 *
 * Why no scores: a two-leg arb taken at both quoted prices pays the same
 * whichever side wins — stake × profitPct/100, outcome-independent.
 */
import type { PaperBook, PaperEntry, PaperSettings, SettledPaperEntry } from '@shared/types';

export function settlePaperBook(
  entries: PaperEntry[],
  settings: PaperSettings,
  now: Date,
): PaperBook {
  const ordered = [...entries].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
  const nowMs = now.getTime();

  // Percent staking compounds off the bankroll AT ENTRY: starting bankroll
  // plus profits of entries already commenced by that moment. Entries
  // always enter before they commence, so processing in enteredAt order
  // sees every relevant settlement.
  const settledSoFar: Array<{ commenceMs: number; idealProfit: number }> = [];
  const settled: SettledPaperEntry[] = ordered.map((entry) => {
    const enteredMs = Date.parse(entry.enteredAt);
    const bankrollAtEntry =
      settings.startingBankroll +
      settledSoFar
        .filter((s) => s.commenceMs <= enteredMs)
        .reduce((sum, s) => sum + s.idealProfit, 0);
    const stake =
      settings.stakeRule.kind === 'flat'
        ? round2(settings.stakeRule.value)
        : round2((bankrollAtEntry * settings.stakeRule.value) / 100);
    const idealProfit = round2((stake * entry.profitPct) / 100);
    const haircutProfit = round2(idealProfit * (1 - settings.haircutPercent / 100));
    settledSoFar.push({ commenceMs: Date.parse(entry.commenceTime), idealProfit });
    return {
      ...entry,
      stake,
      idealProfit,
      haircutProfit,
      settled: Date.parse(entry.commenceTime) <= nowMs,
    };
  });

  const realized = settled
    .filter((e) => e.settled)
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));

  let runningIdeal = 0;
  let runningHaircut = 0;
  const equityIdeal: PaperBook['equityIdeal'] = [];
  const equityHaircut: PaperBook['equityHaircut'] = [];
  const monthly = new Map<string, { ideal: number; haircut: number }>();
  for (const e of realized) {
    runningIdeal += e.idealProfit;
    runningHaircut += e.haircutProfit;
    equityIdeal.push({ at: e.commenceTime, cumulativeProfit: round2(runningIdeal) });
    equityHaircut.push({ at: e.commenceTime, cumulativeProfit: round2(runningHaircut) });
    const month = e.commenceTime.slice(0, 7);
    const bucket = monthly.get(month) ?? { ideal: 0, haircut: 0 };
    bucket.ideal += e.idealProfit;
    bucket.haircut += e.haircutProfit;
    monthly.set(month, bucket);
  }

  return {
    entries: settled,
    equityIdeal,
    equityHaircut,
    monthly: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        ideal: round2(bucket.ideal),
        haircut: round2(bucket.haircut),
      })),
    bankrollIdeal: round2(settings.startingBankroll + runningIdeal),
    bankrollHaircut: round2(settings.startingBankroll + runningHaircut),
    openStake: round2(settled.filter((e) => !e.settled).reduce((sum, e) => sum + e.stake, 0)),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
