// client/src/lib/settings.ts — SettingsView contract mirror (server:
// settings/report.ts) plus every pure display derivation for the SETTINGS
// screen. No React, no fetch. Every KV value derives from the live store —
// the mockup's numbers are demo filler (inventory §7.3).
import { formatCents } from './format';

// ---- contract mirror --------------------------------------------------------

/** Mirror of the server Settings record (numbers + the two string keys). */
export interface SettingsValues {
  tolerancePct: number; verifyGapSecs: number; staleRemoveMin: number; freshWindowSecs: number;
  minArbMarginPct: number; minEvEdgePct: number; middleRatio: number;
  kellyFraction: number; kellyCapPct: number; bankrollCents: number;
  flatPairCents: number; roundToCents: number; minStakeCents: number; dailyPickCap: number;
  quietStartHour: number; quietEndHour: number; scanBaseMin: number; scanHotMinMin: number;
  scanHotMaxMin: number; hotWindowHours: number; sharpVelocityPerDayPerBook: number;
  marketBreadthPerWeekPerBook: number; goGentleHeat: number; stopHeat: number;
  heatWeightLimit: number; heatWeightReject: number; heatWeightCut: number; heatWeightWithdrawal: number;
  heatHalfLifeDays: number; brainCadenceHours: number; brainKillSwitch: number; anchorIdx: number;
  creditPlanMonthly: number;
  mixArbPct: number; mixMiddlePct: number; mixEvPct: number;
  anchorFallback: number; oneSportRule: number; journalMinPerDay: number;
  whatsappNumber: string; disabledSports: string;
}

export interface SettingsBookView {
  name: string; displayName: string; sport: string; sharpExempt: boolean; enabled: boolean;
}

export interface ForecasterView {
  projectedPerDay: number; dailyAllowance: number; usedThisMonth: number;
  monthEndProjection: number; planMonthly: number; remaining: number; runwayDays: number;
}

export interface SettingsView {
  mode: 'SIMULATED';
  settings: SettingsValues;
  forecaster: ForecasterView;
  brain: { lastPassAt: number | null; lastPassBooks: number | null;
           llmSpentCents: number; llmCapCents: number; weightsCustom: boolean };
  books: SettingsBookView[];
  sports: { sport: string; enabled: boolean }[];
  safetyLocked: boolean;
  memory: { receipts: number; journalEntries: number };
  lastTickAt: number | null;
  backups: { lastAt: number | null; keep: 14 };
}

// ---- shared formatting -------------------------------------------------------

const group = (n: number): string => n.toLocaleString('en-US');
const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Always 2dp dollars: 84 → '$0.84' (LLM budget style). */
const money2 = (c: number): string => `$${(c / 100).toFixed(2)}`;

const HHMM = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const VAN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
});
const MON_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Vancouver', month: 'short', day: '2-digit',
});

function hhmm(ts: number): string {
  return HHMM.format(ts);
}
function monthDay(ts: number): string {
  const parts = MON_DAY.formatToParts(ts);
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month').toUpperCase()} ${get('day')}`;
}

// ---- SCAN RULES · CREDIT FORECASTER (§5.2) ------------------------------------

export function scanWindowText(s: SettingsValues): string {
  const end = s.quietStartHour === 0 ? '24' : pad2(s.quietStartHour);
  return `${pad2(s.quietEndHour)}:00 – ${end}:00 PT`;
}

export function quietHoursText(s: SettingsValues): string {
  return `${pad2(s.quietStartHour)}:00 – ${pad2(s.quietEndHour)}:00 · NO SENDS, NO SCANS`;
}

export function cadenceText(s: SettingsValues): string {
  return `BASE ${s.scanBaseMin} MIN · ${s.scanHotMinMin}–${s.scanHotMaxMin} MIN < ${s.hotWindowHours}H TO START`;
}

export function verifyGapText(s: SettingsValues): string {
  return `${s.verifyGapSecs} S`;
}

export function staleText(s: SettingsValues): string {
  return `${s.staleRemoveMin} MIN`;
}

export type RowTone = 'plain' | 'yellow' | 'red';

export function forecastRows(f: ForecasterView): [string, string, RowTone][] {
  return [
    ['PROJECTED CREDITS / DAY', `${group(f.projectedPerDay)} OF ${group(f.dailyAllowance)}`, 'plain'],
    ['MONTH-END PROJECTION', `${group(f.monthEndProjection)} / ${group(f.planMonthly)}`, 'yellow'],
    ['REMAINING (LIVE HEADER)', `${group(f.remaining)} · ${f.runwayDays} DAYS RUNWAY`, 'plain'],
  ];
}

// ---- STRATEGY MIX (§5.1) --------------------------------------------------------

export interface MixValues { arb: number; middle: number; ev: number }

export function mixRows(s: SettingsValues): { key: 'ARB' | 'MIDDLE' | 'EV'; pct: number }[] {
  return [
    { key: 'ARB', pct: s.mixArbPct },
    { key: 'MIDDLE', pct: s.mixMiddlePct },
    { key: 'EV', pct: s.mixEvPct },
  ];
}

/** Move one slider; the other two absorb the delta proportionally (largest-
 *  remainder-free: round one, give the exact rest to the other). Always sums 100. */
export function rebalanceMix(mix: MixValues, key: keyof MixValues, value: number): MixValues {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = (['arb', 'middle', 'ev'] as const).filter((k) => k !== key);
  const rest = 100 - v;
  const oldSum = mix[others[0]!] + mix[others[1]!];
  const first = oldSum === 0 ? Math.ceil(rest / 2) : Math.round((mix[others[0]!] / oldSum) * rest);
  const out = { ...mix, [key]: v } as MixValues;
  out[others[0]!] = first;
  out[others[1]!] = rest - first;
  return out;
}

// ---- RISK & BANKROLL (§5.3) --------------------------------------------------------

export function riskRows(s: SettingsValues): [string, string][] {
  return [
    ['FLAT PAIR STAKE', `${formatCents(s.flatPairCents)} CAD`],
    ['KELLY FRACTION / CAP', `${s.kellyFraction} / ${s.kellyCapPct}% OF TOTAL`],
    ['TOTAL BANKROLL', `${formatCents(s.bankrollCents)} CAD`],
    ['MIN STAKE / ROUND TO', `${formatCents(s.minStakeCents)} / ${formatCents(s.roundToCents)}`],
    ['TRADES PER DAY CAP', String(s.dailyPickCap)],
  ];
}

export function toleranceText(s: SettingsValues): string {
  return `${s.tolerancePct}% · 0–100%`;
}

// ---- BRAIN (§5.4) --------------------------------------------------------------------

export function heatWeightsValue(_s: SettingsValues, custom: boolean): string {
  return `${custom ? 'CUSTOM' : 'DEFAULT'} · EDITABLE WHILE GREEN`;
}

export function consolidationText(s: SettingsValues): string {
  return `EVERY ${s.brainCadenceHours} H · HAIKU`;
}

export function llmBudgetText(b: { llmSpentCents: number; llmCapCents: number }): string {
  return `${money2(b.llmSpentCents)} / ${money2(b.llmCapCents)} THIS MONTH`;
}

export function killSwitchValue(s: SettingsValues): string {
  return s.brainKillSwitch === 0 ? 'OFF' : 'ON';
}

export function lastDigestText(lastPassAt: number | null, books: number | null, now: number): string {
  if (lastPassAt === null) return '—';
  const sameDay = VAN_DAY.format(lastPassAt) === VAN_DAY.format(now);
  const when = sameDay ? `TODAY ${hhmm(lastPassAt)}` : `${monthDay(lastPassAt)} ${hhmm(lastPassAt)}`;
  return `${when} · ${books ?? 0} BOOKS`;
}

// ---- WHATSAPP (§5.5) -------------------------------------------------------------------

/** Mirrors the server rule: empty (clearing) or '+' then 7–19 digits/spaces. */
export function validWaNumber(v: string): boolean {
  return v === '' || /^\+\d[\d ]{6,18}$/.test(v);
}

// ---- DATA (§5.6) ----------------------------------------------------------------------

export function backupsText(b: { lastAt: number | null; keep: number }): string {
  return b.lastAt === null
    ? `${b.keep} NIGHTLY · NONE YET`                 // NEW copy — no backups until Plan 6
    : `${b.keep} NIGHTLY · LAST ${hhmm(b.lastAt)}`;
}

// ---- ADVANCED — INPUTS (§5.7) -----------------------------------------------------------

export function planText(planMonthly: number): string {
  const k = planMonthly >= 1_000 && planMonthly % 1_000 === 0 ? `${planMonthly / 1_000}K` : group(planMonthly);
  return `PLAN ${k} / MO`;
}

export function lastTickText(lastTickAt: number | null, now: number): string {
  if (lastTickAt === null) return 'LAST TICK —';
  return `LAST TICK ${Math.max(0, Math.round((now - lastTickAt) / 1000))} S AGO`;
}

export function memoryText(m: { receipts: number; journalEntries: number }): string {
  return `${group(m.receipts)} RECEIPTS · ${group(m.journalEntries)} JOURNAL ENTRIES · GROWING`;
}

// ---- ADVANCED — MY BOOKS + SPORTS & LEAGUES ------------------------------------------------

export type ChipTone = 'sharp' | 'green' | 'muted';

export function bookRow(b: SettingsBookView): { name: string; sportLabel: string; chip: { label: string; tone: ChipTone } } {
  if (b.sharpExempt) return { name: b.displayName, sportLabel: 'ANY', chip: { label: 'SHARP — ALWAYS ON', tone: 'sharp' } };
  return {
    name: b.displayName,
    sportLabel: `${b.sport.toUpperCase()} ▾`,
    chip: b.enabled ? { label: 'ON', tone: 'green' } : { label: 'OFF', tone: 'muted' },
  };
}

export function sportCell(x: { sport: string; enabled: boolean }): string {
  return `${x.enabled ? '✓' : '✗'} ${x.sport.toUpperCase()}`;
}

// ---- ADVANCED — thresholds, fallback, safety, kill rules ------------------------------------

export function thresholdTexts(s: SettingsValues): [string, string][] {
  return [
    ['MIN ARB MARGIN', `${s.minArbMarginPct.toFixed(2)}%`],
    ['MIN EV EDGE', `${s.minEvEdgePct.toFixed(1)}%`],
    ['MIN MIDDLE QUALITY', `${s.middleRatio.toFixed(1)}× BREAKEVEN HIT RATE`],
    ['FRESH WINDOW', `${s.freshWindowSecs} S`],
  ];
}

const FALLBACK_LABELS = [
  'FALL BACK TO CONSENSUS (DEFAULT)',
  'PAUSE EV + MIDDLES, ARBS CONTINUE',
  'PAUSE EVERYTHING',
] as const;

export function fallbackItems(s: SettingsValues): { idx: 0 | 1 | 2; label: string; active: boolean }[] {
  return FALLBACK_LABELS.map((text, i) => ({
    idx: i as 0 | 1 | 2,
    label: `${s.anchorFallback === i ? '●' : '○'} ${text}`,
    active: s.anchorFallback === i,
  }));
}

export function safetyRows(s: SettingsValues): [string, string, RowTone][] {
  return [
    ['SHARP VELOCITY CAP', `${s.sharpVelocityPerDayPerBook} / DAY / BOOK`, 'plain'],
    ['MARKET BREADTH CAP', `${s.marketBreadthPerWeekPerBook} / MARKET / BOOK / WEEK`, 'plain'],
    ['ONE-SPORT RULE', s.oneSportRule === 0 ? 'OFF' : 'ON', 'plain'],
    ['GO GENTLE AT', `HEAT ${s.goGentleHeat}`, 'yellow'],
    ['STOP AT', `HEAT ${s.stopHeat}`, 'red'],
    ['DEFAULT QUIT RULE', '"RETIRE ACCOUNT AFTER 2 STAKE CUTS IN 14 DAYS"', 'plain'],
  ];
}

export function killRuleRows(): [string, string][] {
  return [
    ['ARB DIES IF', 'CONFIRMED MARGIN < 60% OF QUOTED OVER 50 PAIRS'],
    ['EV DIES IF', 'CLOSING PRICE EDGE ≤ 0 AFTER 300 PICKS'],
    ['MIDDLE DIES IF', 'LEG CLOSING EDGE ≤ 0 AFTER 200 LEGS'],
  ];
}

export function journalMinText(s: SettingsValues): string {
  return `${s.journalMinPerDay} / DAY`;
}

export function advSettingsToggle(open: boolean): string {
  return open ? 'ADVANCED SETTINGS — COLLAPSE' : 'ADVANCED SETTINGS →';
}
