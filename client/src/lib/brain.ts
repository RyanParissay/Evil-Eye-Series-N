// client/src/lib/brain.ts — BrainView contract mirror (server: brain/report.ts)
// plus every pure display derivation for the BRAIN screen. No React, no fetch.
// Type-only imports from api.ts — no runtime cycle (api.ts imports BrainView
// type-only back).
import { formatCents, formatClock, formatSignedCents } from './format';
import type { KillReason, Strategy, TradeView } from './api';

// ---- contract mirror --------------------------------------------------------

export type BookHealth = 'green' | 'yellow' | 'red';
export type MarkKind = 'LIMIT REPORTED' | 'BET REJECTED' | 'STAKE CUT';

export interface BrainBookView {
  name: string;
  displayName: string;
  sport: string;
  sharpExempt: boolean;
  heat: number;
  health: BookHealth;
  suspicion: number;
  maxBetCents: number | null;
  wasCents: number | null;
  history: { ts: number; heat: number }[];
  marks: { ts: number; kind: MarkKind }[];
}

export interface GradeView {
  strategy: Strategy;
  grade: number;
  settled: number;
  wins: number;
  expectedWins: number;
  provisional: boolean;
  note: string;
}

export interface BrainControls {
  limit: number; reject: number; cut: number; withdrawal: number;
  halfLifeDays: number; cadenceHours: number;
}

export interface BrainView {
  lastFullPassAt: number | null;
  killSwitch: boolean;
  anchor: { idx: 0 | 1 | 2; label: 'PINNACLE' | 'CIRCA' | 'CONSENSUS'; effective: 'PINNACLE'; live: boolean };
  tiles: {
    credits: { remainingCredits: number; planCredits: number; runwayDays: number };
    doubleVerification: { passRatePct: number; edgeRetentionPct: number; rechecked: number } | null;
    todaysPicks: { sent: number; of: number; heldBack: number };
    closingPriceEdge: { avgPct: number; beatClosePct: number; legs: number } | null;
  };
  rationale: { sent: number; candidates: number; passed: number; heldBackClauses: string[] };
  books: BrainBookView[];
  grades: GradeView[];
  journal: { total: number; entries: { ts: number; text: string }[] };
  controls: BrainControls;
  limitsThisMonth: number;
}

// ---- clocks ------------------------------------------------------------------

const TIME_SHORT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit', hour12: true,
});
const TIME_SECS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** "10:47 PM" — the LAST FULL PASS clock. */
export function formatTimeShort(epochMs: number): string {
  const parts = TIME_SHORT.formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** "22:41:06" — boiler-room trace clock. */
export function formatTimeSecs(epochMs: number): string {
  const parts = TIME_SECS.formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

// ---- header ------------------------------------------------------------------

export function passTimeLabel(ts: number | null): string {
  return ts === null ? 'LAST FULL PASS —' : `LAST FULL PASS ${formatTimeShort(ts)}`;
}

export function killSwitchLabel(on: boolean): string {
  return `KILL SWITCH · ${on ? 'ON' : 'OFF'}`;
}

// ---- engine tiles --------------------------------------------------------------

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

export type SubTone = 'green' | 'yellow' | 'muted';
export interface TileText { value: string; sub: string; tone: SubTone }

const ANCHOR_VALUES = ['PINNACLE ▾', 'CIRCA ▾', 'CONSENSUS ▾'] as const;

export function anchorValue(idx: number): string {
  return ANCHOR_VALUES[idx] ?? ANCHOR_VALUES[0];
}

/** Honesty note (NEW copy): a non-pinnacle anchor renders but maps to pinnacle in sim. */
export function anchorSub(anchor: { idx: number; live: boolean }): { text: string; tone: SubTone } {
  if (anchor.idx !== 0) return { text: 'maps to pinnacle in sim', tone: 'yellow' };
  return anchor.live ? { text: 'live', tone: 'green' } : { text: 'offline', tone: 'muted' };
}

export function creditsTile(t: BrainView['tiles']['credits']): TileText {
  return {
    value: `${fmtInt(t.remainingCredits)} / ${fmtInt(t.planCredits)}`,
    sub: `${t.runwayDays}d runway`,
    tone: 'green',
  };
}

export function dvTile(t: BrainView['tiles']['doubleVerification']): TileText {
  if (t === null) return { value: '—', sub: 'no rechecks yet', tone: 'muted' }; // NEW copy
  return { value: `${t.passRatePct}% pass rate`, sub: `survivors keep ${t.edgeRetentionPct}% edge`, tone: 'muted' };
}

export function picksTile(t: BrainView['tiles']['todaysPicks']): TileText {
  return { value: `${t.sent} of ${t.of} sent`, sub: `${t.heldBack} held back`, tone: 'yellow' };
}

export function cpeTile(t: BrainView['tiles']['closingPriceEdge']): TileText {
  if (t === null) return { value: '—', sub: 'no closes captured yet', tone: 'muted' }; // NEW copy
  const sign = t.avgPct < 0 ? '−' : '+';
  return {
    value: `${sign}${Math.abs(t.avgPct).toFixed(1)}% avg`,
    sub: `${t.beatClosePct}% beat the close`,
    tone: 'green',
  };
}

// ---- rationale -----------------------------------------------------------------

export function rationaleLabel(sent: number): string {
  return `WHY ONLY ${sent} TODAY`;
}

export function rationaleBody(r: BrainView['rationale']): string {
  return `${r.candidates} candidates → ${r.passed} passed double verification → ${r.sent} sent.`
    + ` Held back: ${r.heldBackClauses.join(' · ')}.`;
}

// ---- site table ------------------------------------------------------------------

export type HealthTone = 'sharp' | 'green' | 'amber' | 'red';

export function healthBadge(b: Pick<BrainBookView, 'sharpExempt' | 'health'>): { label: string; tone: HealthTone } {
  if (b.sharpExempt) return { label: 'SHARP — SAFE', tone: 'sharp' };
  if (b.health === 'red') return { label: 'RED', tone: 'red' };
  if (b.health === 'yellow') return { label: 'AMBER', tone: 'amber' };
  return { label: 'GREEN', tone: 'green' };
}

export function heatCell(b: Pick<BrainBookView, 'sharpExempt' | 'heat'>): string {
  return b.sharpExempt ? '—' : String(b.heat);
}

export function sitesToggle(total: number, open: boolean): string {
  return open ? '− SHOW FEWER SITES' : `+ ${total - 5} MORE SITES`;
}

// ---- detail panel ------------------------------------------------------------------

export function siteMeta(b: Pick<BrainBookView, 'sharpExempt' | 'sport' | 'suspicion'>): string {
  if (b.sharpExempt) return '· TAKES EVERY SPORT · THE HEDGE LEG';
  return `· ${b.sport.toUpperCase()} ONLY · SUSPICION LEVEL ${b.suspicion}/5`;
}

export function maxBetTexts(b: Pick<BrainBookView, 'maxBetCents' | 'wasCents'>): { max: string; was: string | null } {
  return {
    max: b.maxBetCents === null ? 'NO LIMIT' : formatCents(b.maxBetCents),
    was: b.wasCents === null ? null : `WAS ${formatCents(b.wasCents)}`,
  };
}

/** WHAT THE BRAIN DOES NOW — verbatim design-inventory §3.5. */
export function doesNowText(b: Pick<BrainBookView, 'sharpExempt' | 'health'>): string {
  if (b.sharpExempt) {
    return 'Safe by design. Sharp books don’t limit winners — this is where the hedge leg goes, and it never accumulates heat.';
  }
  if (b.health === 'red') {
    return 'Nothing sharp goes here anymore. Promo reminders only. Withdraw the balance in two or three plain chunks, then let it rest.';
  }
  if (b.health === 'yellow') {
    return 'Half as many risky bets here, stakes shrunk 40%, until heat cools below 30. Also watching: my closing price edge at this book is high — that’s what they grade me on.';
  }
  return 'Full speed. Stakes at 100%, up to 3 sharp bets a day. Nothing to fix — keep withdrawals boring and regular.';
}

/** □ QUIT RULES — WRITTEN IN ADVANCE — verbatim design-inventory §3.5. */
export function quitRulesText(b: Pick<BrainBookView, 'sharpExempt' | 'health'>): string {
  if (b.sharpExempt) return 'None needed. This account is meant to live forever.';
  if (b.health === 'green') {
    return '"Retire this account after 2 stake cuts in 14 days." Editable now — the account is calm.';
  }
  return '"Retire this account after 2 stake cuts in 14 days." Locked while the account struggles — you decided this when calm.';
}

// ---- suspicion chart ---------------------------------------------------------------

export interface ChartMark { x: number; y: number; label: string }
export interface ChartGeometry { line: string; marks: ChartMark[] }

/** Fixed by the mockup's dashed thresholds: heat 60 → y 20 (STOP), heat 30 → y 85 (GO GENTLE). */
export function heatY(heat: number): number {
  const y = 150 - heat * (13 / 6);
  return Math.round(Math.min(170, Math.max(10, y)) * 10) / 10;
}

export function chartGeometry(
  history: { ts: number; heat: number }[],
  marks: { ts: number; kind: MarkKind }[],
): ChartGeometry | null {
  const n = history.length;
  if (n < 2) return null;
  const x = (i: number): number => Math.round((10 + (i / (n - 1)) * 780) * 10) / 10;
  const line = history.map((h, i) => `${x(i)},${heatY(h.heat)}`).join(' ');
  const chartMarks = marks.map((m) => {
    let best = 0;
    for (let i = 1; i < n; i += 1) {
      if (Math.abs(history[i]!.ts - m.ts) < Math.abs(history[best]!.ts - m.ts)) best = i;
    }
    return { x: x(best), y: heatY(history[best]!.heat), label: m.kind };
  });
  return { line, marks: chartMarks };
}

// ---- grades + journal -----------------------------------------------------------------

export function gradeTone(grade: number): 'green' | 'yellow' | 'red' {
  if (grade >= 70) return 'green';
  if (grade >= 30) return 'yellow';
  return 'red';
}

export function journalToggle(total: number, open: boolean): string {
  return open ? 'SHOWING ALL — COLLAPSE' : `SHOW ALL ${total} ENTRIES →`;
}

// ---- advanced brain settings -------------------------------------------------------------

function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`; // U+2212 for the display minus
}

export function modelControlRows(c: BrainControls): [string, string][] {
  return [
    ['HEAT WEIGHTS (RAW)',
      `LIMIT ${signed(c.limit)} · REJECT ${signed(c.reject)} · CUT ${signed(c.cut)} · WITHDRAWAL ${signed(c.withdrawal)}`],
    ['SUSPICION DECAY HALF-LIFE', `${c.halfLifeDays} DAYS`],
    ['CONSOLIDATION CADENCE', `EVERY ${c.cadenceHours} H`],
    ['JOURNAL RETENTION', 'FOREVER — NEVER DELETED'],
  ];
}

// ---- boiler-room trace ----------------------------------------------------------------

const GATE_SEQUENCE: [name: string, reason: KillReason][] = [
  ['one_sport', 'ONE_SPORT_RULE'], ['heat', 'HEAT_GATE'], ['velocity', 'SHARP_VELOCITY_CAP'],
  ['breadth', 'MARKET_BREADTH_CAP'], ['rounding', 'ROUNDING_DESTROYS_MARGIN'], ['quote', 'QUOTE_STALE'],
];

export function traceTitle(t: TradeView): string {
  return `LIVE TRACE — LAST CANDIDATE THROUGH THE PIPE (${t.event.toUpperCase()})`;
}

/** The mockup's trace arithmetic is wrong (inventory §8.3) — every number here is computed. */
export function traceLines(t: TradeView): string[] {
  const lines: string[] = [];
  lines.push(`IN :  ${t.legs.map((l) => `${l.book} ${l.selection} @ ${l.odds.toFixed(3)}`).join(' · ')}`);

  const edge = t.marginFinal ?? t.marginRecheck ?? t.marginInitial;
  if (t.category === 'EV') {
    const odds = t.legs[0]?.odds ?? 2;
    lines.push(`DEVIG: fair_prob = (1 + edge) / odds = ${((1 + edge) / odds).toFixed(4)}`);
    lines.push(`EDGE: ev_edge = ${(edge * 100).toFixed(1)}%`);
  } else {
    const invs = t.legs.map((l) => 1 / l.odds);
    const sum = invs.reduce((a, b) => a + b, 0);
    lines.push(`DEVIG: inv_sum = ${invs.map((v) => v.toFixed(4)).join(' + ')} = ${sum.toFixed(4)}`);
    lines.push(t.category === 'ARB'
      ? `EDGE: arb_margin = 1 − inv_sum = ${((1 - sum) * 100).toFixed(1)}%`
      : `EDGE: middle_edge = ${(edge * 100).toFixed(1)}%`);
  }

  const killIdx = GATE_SEQUENCE.findIndex(([, reason]) => reason === t.killReason);
  if (t.status === 'KILLED' && t.killReason !== 'FAILED_VERIFICATION' && killIdx !== -1) {
    const parts = GATE_SEQUENCE.slice(0, killIdx).map(([g]) => `${g} ✓`);
    parts.push(`${GATE_SEQUENCE[killIdx]![0]} ✗ ${t.killReason}`);
    lines.push(`GATES: ${parts.join(' · ')}`);
  } else {
    lines.push(`GATES: ${GATE_SEQUENCE.map(([g]) => `${g} ✓`).join(' · ')}`);
  }

  if (t.marginRecheck !== null && t.marginInitial > 0) {
    const retention = ((t.marginRecheck / t.marginInitial) * 100).toFixed(1);
    lines.push(`RECHECK: retention ${retention}% — ${t.killReason === 'FAILED_VERIFICATION' ? 'failed, killed' : 'passed'}`);
  }

  const allStaked = t.legs.length > 0 && t.legs.every((l) => typeof l.stakeCents === 'number');
  lines.push(allStaked
    ? `STAKE: ${t.legs.map((l) => formatCents(l.stakeCents!)).join(' / ')} (rounded to $5, cap 5% of bankroll)`
    : 'STAKE: — (no stakes until verification)');

  lines.push(outLine(t));
  return lines;
}

function outLine(t: TradeView): string {
  switch (t.status) {
    case 'PENDING':
      return `OUT:  pending — recheck due ${formatTimeSecs(t.verifyDueAt)}`;
    case 'KILLED':
      return `OUT:  killed — ${t.killReason ?? 'UNKNOWN'}`;
    case 'EXPIRED':
      return 'OUT:  expired — never confirmed';
    case 'SETTLED':
      return `OUT:  settled ${formatSignedCents(t.resultCents ?? 0)}`;
    default: {
      const ttl = t.verifiedAt !== null && t.freshUntil !== null
        ? ` · fresh ${formatClock((t.freshUntil - t.verifiedAt) / 1000)}`
        : '';
      return `OUT:  verified ${t.verifiedAt !== null ? formatTimeSecs(t.verifiedAt) : '—'} · sent${ttl}`;
    }
  }
}
