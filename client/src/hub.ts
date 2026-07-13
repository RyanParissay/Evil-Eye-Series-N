/**
 * Analytics Hub — pure client-side display helpers (formatting/filtering
 * only). No money math lives here: every dollar figure is copied verbatim
 * from HubProfileReport (server-computed); this file only narrows a list
 * for a filter control or rebases a chart's baseline for display — the
 * same relative-to-start transform PortfoliosPage already applies to its
 * series before charting (see equityToCumulativeProfit there).
 */
import type {
  GradeResult,
  HubEquityPoint,
  HubPosition,
  HubProfileReport,
  HubStake,
  OpportunityStrategy,
} from '../../shared/types';

export type PositionResultFilter = 'all' | GradeResult | 'pending';
export type PositionStrategyFilter = 'all' | OpportunityStrategy;

/** Narrow the position list by strategy and/or result — 'pending' means no
 *  `result` yet (ungraded). Both filters default to 'all' independently. */
export function filterPositions(
  positions: HubPosition[],
  filters: { strategy: PositionStrategyFilter; result: PositionResultFilter },
): HubPosition[] {
  return positions.filter((p) => {
    if (filters.strategy !== 'all' && p.purchase.strategy !== filters.strategy) return false;
    if (filters.result === 'all') return true;
    if (filters.result === 'pending') return p.result === undefined;
    return p.result === filters.result;
  });
}

/** Lifetime equity curve as cumulative profit relative to the profile's
 *  starting bankroll, for EquityChart (which plots cumulative profit, not
 *  raw bankroll). */
export function equityToProfitCurve(
  equity: HubEquityPoint[],
  startingBankroll: number,
): Array<{ at: string; cumulativeProfit: number }> {
  return equity.map((p) => ({
    at: p.at,
    cumulativeProfit: Math.round((p.bankroll - startingBankroll) * 100) / 100,
  }));
}

/** Human label for a HubStake — "$50 flat" or "5% of start". */
export function describeStake(stake: HubStake): string {
  return stake.type === 'flat' ? `$${stake.value} flat` : `${stake.value}% of start`;
}

/** Human label for a position's grade result — 'Pending' when ungraded. */
export function resultLabel(result: GradeResult | undefined): string {
  if (result === undefined) return 'Pending';
  return { win: 'Win', loss: 'Loss', push: 'Push', void: 'Void' }[result];
}

/* ————— Open Bets (the portfolio-wide fourth segment) ————— */

/** One pending position tagged with the profile that holds it — the same
 *  record purchased by two profiles is two distinct bets (two stakes at
 *  risk). */
export interface OpenBet {
  profileId: string;
  profileName: string;
  position: HubPosition;
}

/**
 * Flatten every profile's PENDING positions (no `result` yet) into one
 * portfolio-wide list, sorted soonest-to-resolve first: ascending
 * commenceTime — so in-play bets (already commenced, closest to grading)
 * lead, then the next kickoff, and so on. Positions whose record carries no
 * commence time sort last. Ties (same event bought by several profiles)
 * break newest-purchase-first, so the freshest entry of a cluster tops it.
 */
export function openBets(reports: HubProfileReport[]): OpenBet[] {
  const bets: OpenBet[] = [];
  for (const report of reports) {
    for (const position of report.positions) {
      if (position.result !== undefined) continue;
      bets.push({ profileId: report.profile.id, profileName: report.profile.name, position });
    }
  }
  return bets.sort((a, b) => {
    const ca = Date.parse(a.position.commenceTime);
    const cb = Date.parse(b.position.commenceTime);
    const aKnown = Number.isFinite(ca);
    const bKnown = Number.isFinite(cb);
    if (aKnown !== bKnown) return aKnown ? -1 : 1; // unknown commence last
    if (aKnown && bKnown && ca !== cb) return ca - cb;
    return b.position.purchase.at.localeCompare(a.position.purchase.at);
  });
}

/** Total dollars at risk: the sum of the server-provided pending stakes,
 *  rounded to cents. Arithmetic composition of server numbers — no money
 *  math is invented here. */
export function openStakeTotal(bets: OpenBet[]): number {
  const total = bets.reduce((sum, b) => sum + b.position.purchase.stake, 0);
  return Math.round(total * 100) / 100;
}

export type OpenBetStatus =
  | { kind: 'upcoming'; countdown: string }
  | { kind: 'in_play' }
  | { kind: 'unknown' };

/** Where an open bet sits in its lifecycle: counting down to commence,
 *  in play awaiting a grade, or unknown (record without a commence time). */
export function openBetStatus(commenceTime: string, now: Date): OpenBetStatus {
  const commence = Date.parse(commenceTime);
  if (!Number.isFinite(commence)) return { kind: 'unknown' };
  const delta = commence - now.getTime();
  if (delta > 0) return { kind: 'upcoming', countdown: timeUntilLabel(delta) };
  return { kind: 'in_play' };
}

/** Compact floor-based countdown: "<1m" / "12m" / "3h 12m" / "1d 2h".
 *  Zero remainders drop ("3h", "2d") — an honest countdown never rounds up. */
export function timeUntilLabel(deltaMs: number): string {
  const totalMinutes = Math.floor(deltaMs / 60_000);
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When the bet was placed, in local terms: "2:14 PM" today, "yesterday",
 *  "Jul 8" earlier this year, "Dec 31, 2025" across a year boundary. */
export function placedLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '—';
  if (sameLocalDay(at, now)) {
    const hours = at.getHours() % 12 === 0 ? 12 : at.getHours() % 12;
    const minutes = String(at.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${at.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameLocalDay(at, yesterday)) return 'yesterday';
  const monthDay = `${MONTHS[at.getMonth()]} ${at.getDate()}`;
  return at.getFullYear() === now.getFullYear() ? monthDay : `${monthDay}, ${at.getFullYear()}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
