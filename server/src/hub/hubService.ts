/**
 * Analytics Hub service (Phase 16 Part B — everything here is SIMULATED and
 * says so: every report carries `simulated: true`).
 *
 * A Hub profile is a PARAMETERIZED ENGINE SERIES: it auto-purchases the
 * confirmed opportunities matching its filters, at its own stake, and its
 * report replays those purchases through the SAME settlement primitives the
 * Phase 14 scenario engine uses (portfolios/settlement.ts — pnlForStake +
 * maxDrawdownOf). No P&L or drawdown math is restated here.
 *
 * Purchases and skips are IMMUTABLE events, decided at confirmation time and
 * deduped by recordId, so re-running onConfirmed each scan is idempotent. The
 * report derives every position's outcome from the record's CURRENT
 * `grading` (Phase 13), so a bet that was pending at purchase settles as soon
 * as the record grades — no re-purchase.
 *
 * Bankroll / skip rule mirrors GRADING_RULES.md §5 and the scenario engine
 * EXACTLY: a profile can place a bet only when its realised bankroll
 * (starting + settled P&L of already-graded prior purchases; open/pending
 * exposure is reported but does NOT reduce it) is ≥ the stake, else a
 * `skipped_insufficient_bankroll` event is logged. Stakes never compound:
 * `pctOfStart` is a percentage of the STARTING bankroll (§5).
 *
 * Headline-edge filter (minEdgePct = a MINIMUM headline edge, pp):
 *   arb    → profitPctAtDetection  (the detection headline edge; same basis
 *            the scenario engine matches arb series on)
 *   ev     → ev.edgePct
 *   middle → middle.payoutPct  (the both-legs-win upside; cost% is the COST,
 *            so it is NOT a "minimum edge" — payout% is. minEdgePct 0, the
 *            premade default, passes any middle with non-negative payout.)
 * Suspicious / same-book records are never bet (mirrors the scenario engine's
 * 'excluded' bucket) even if they clear the edge.
 */
import { randomUUID } from 'node:crypto';
import type {
  HubProfile,
  HubProfileReport,
  HubPosition,
  HubStake,
  OpportunityRecord,
  OpportunityStrategy,
} from '@shared/types';
import { maxDrawdownOf, pnlForStake } from '../portfolios/settlement';
import type { HubData, HubDataStore, StoredPurchase, StoredSkip } from './profileStore';

const STRATEGIES: readonly OpportunityStrategy[] = ['arb', 'ev', 'middle'];
const MAX_NAME_LENGTH = 60;

/** The seed premades: Arb / EV / Middles, $1,000 start, flat $50, no filter. */
const PREMADE_DEFS: ReadonlyArray<{ id: string; name: string; strategies: OpportunityStrategy[] }> = [
  { id: 'premade-arb', name: 'Arb', strategies: ['arb'] },
  { id: 'premade-ev', name: 'EV', strategies: ['ev'] },
  { id: 'premade-middle', name: 'Middles', strategies: ['middle'] },
];
const PREMADE_STARTING_BANKROLL = 1000;
const PREMADE_STAKE: HubStake = { type: 'flat', value: 50 };

export interface ProfileInput {
  name: string;
  startingBankroll: number;
  stake: HubStake;
  strategies: OpportunityStrategy[];
  minEdgePct: number;
}

export interface HubServiceDeps {
  store: HubDataStore;
  /** Full record stream, active + archived (LedgerService.allRecordsList) —
   *  the report and the write-time bankroll both settle off record.grading. */
  records: () => Promise<OpportunityRecord[]>;
  now?: () => Date;
}

export type DeleteResult = 'ok' | 'not_found' | 'premade';

export class HubService {
  private readonly store: HubDataStore;
  private readonly records: () => Promise<OpportunityRecord[]>;
  private readonly now: () => Date;

  constructor(deps: HubServiceDeps) {
    this.store = deps.store;
    this.records = deps.records;
    this.now = deps.now ?? (() => new Date());
  }

  async listProfiles(): Promise<HubProfile[]> {
    return (await this.ensureSeeded()).profiles;
  }

  async createProfile(input: ProfileInput): Promise<HubProfile> {
    const profile: HubProfile = {
      id: `custom-${randomUUID()}`,
      name: input.name.trim(),
      premade: false,
      startingBankroll: input.startingBankroll,
      stake: { type: input.stake.type, value: input.stake.value },
      strategies: [...input.strategies],
      minEdgePct: input.minEdgePct,
      createdAt: this.now().toISOString(),
    };
    await this.mutate((data) => {
      data.profiles.push(profile);
    });
    return profile;
  }

  /** Patches mutable fields (name/startingBankroll/stake/strategies/minEdgePct)
   *  — premades are editable too. `null` when the id is unknown. */
  async updateProfile(id: string, patch: Partial<ProfileInput>): Promise<HubProfile | null> {
    return this.mutate((data) => {
      const profile = data.profiles.find((p) => p.id === id);
      if (!profile) return null;
      if (patch.name !== undefined) profile.name = patch.name.trim();
      if (patch.startingBankroll !== undefined) profile.startingBankroll = patch.startingBankroll;
      if (patch.stake !== undefined) profile.stake = { type: patch.stake.type, value: patch.stake.value };
      if (patch.strategies !== undefined) profile.strategies = [...patch.strategies];
      if (patch.minEdgePct !== undefined) profile.minEdgePct = patch.minEdgePct;
      return { ...profile };
    });
  }

  async deleteProfile(id: string): Promise<DeleteResult> {
    return this.mutate((data) => {
      const profile = data.profiles.find((p) => p.id === id);
      if (!profile) return 'not_found';
      if (profile.premade) return 'premade';
      data.profiles = data.profiles.filter((p) => p.id !== id);
      data.purchases = data.purchases.filter((p) => p.profileId !== id);
      data.skipped = data.skipped.filter((s) => s.profileId !== id);
      return 'ok';
    });
  }

  /**
   * Auto-purchase every confirmed record that matches a profile's filters,
   * at the profile's stake — or log a skip when the profile can't afford it.
   * Idempotent: a record already purchased OR skipped by a profile is never
   * revisited. Caller passes ONLY confirmed records (Part A gating lives
   * upstream — this trusts its input).
   */
  async onConfirmed(records: OpportunityRecord[]): Promise<void> {
    const all = await this.records();
    const byId = new Map(all.map((r) => [r.id, r] as const));
    const at = this.now().toISOString();
    // Deterministic order — detection time, then id (same ordering the
    // scenario engine replays in).
    const candidates = [...records].sort(
      (a, b) => a.detectedAt.localeCompare(b.detectedAt) || a.id.localeCompare(b.id),
    );

    await this.mutate((data) => {
      for (const profile of data.profiles) {
        const seen = new Set<string>();
        for (const p of data.purchases) if (p.profileId === profile.id) seen.add(p.recordId);
        for (const s of data.skipped) if (s.profileId === profile.id) seen.add(s.recordId);

        // Realised bankroll = starting + settled P&L of already-graded prior
        // purchases (open exposure does NOT reduce it — scenario-engine rule).
        let bankroll = profile.startingBankroll;
        for (const p of data.purchases) {
          if (p.profileId !== profile.id) continue;
          const grading = byId.get(p.recordId)?.grading;
          if (grading) bankroll = round2(bankroll + pnlForStake(p.stake, grading));
        }

        const stake = stakeFor(profile);
        for (const record of candidates) {
          if (seen.has(record.id) || !matchesProfile(profile, record)) continue;
          seen.add(record.id);
          if (bankroll < stake) {
            data.skipped.push({ profileId: profile.id, at, recordId: record.id });
            continue;
          }
          data.purchases.push({
            profileId: profile.id,
            at,
            recordId: record.id,
            strategy: record.strategy,
            stake,
          });
          // A just-purchased bet is normally pending, so it does not move the
          // realised bankroll; if it is already graded (a same-scan settle),
          // fold it in — exactly as the scenario engine would.
          if (record.grading) bankroll = round2(bankroll + pnlForStake(stake, record.grading));
        }
      }
    });
  }

  async reports(): Promise<HubProfileReport[]> {
    const [data, all] = await Promise.all([this.ensureSeeded(), this.records()]);
    const byId = new Map(all.map((r) => [r.id, r] as const));
    return data.profiles.map((profile) => buildProfileReport(profile, data, byId));
  }

  /** Seed the premades once, then return the current data. */
  private async ensureSeeded(): Promise<HubData> {
    return this.store.update((data) => {
      if (data.seeded) return { data, result: data };
      const at = this.now().toISOString();
      const premades: HubProfile[] = PREMADE_DEFS.map((def) => ({
        id: def.id,
        name: def.name,
        premade: true,
        startingBankroll: PREMADE_STARTING_BANKROLL,
        stake: { ...PREMADE_STAKE },
        strategies: [...def.strategies],
        minEdgePct: 0,
        createdAt: at,
      }));
      const next: HubData = { ...data, seeded: true, profiles: [...premades, ...data.profiles] };
      return { data: next, result: next };
    });
  }

  /** Seed, then run a mutator that edits `data` in place and/or returns a
   *  result. Keeps every write path behind the seed. */
  private async mutate<R>(mutator: (data: HubData) => R): Promise<R> {
    await this.ensureSeeded();
    return this.store.update((data) => {
      const result = mutator(data);
      return { data, result };
    });
  }
}

function stakeFor(profile: HubProfile): number {
  return profile.stake.type === 'flat'
    ? round2(profile.stake.value)
    : round2((profile.startingBankroll * profile.stake.value) / 100);
}

function matchesProfile(profile: HubProfile, record: OpportunityRecord): boolean {
  if (!profile.strategies.includes(record.strategy)) return false;
  // Suspicious / same-book records would never be bet (scenario engine's
  // 'excluded' bucket) — CLAUDE.md: flagged, never hidden.
  if (record.suspicious || record.sameBookmaker) return false;
  return headlineEdge(record) >= profile.minEdgePct;
}

function headlineEdge(record: OpportunityRecord): number {
  if (record.strategy === 'ev') return record.ev?.edgePct ?? -Infinity;
  if (record.strategy === 'middle') return record.middle?.payoutPct ?? -Infinity;
  return record.profitPctAtDetection;
}

function buildProfileReport(
  profile: HubProfile,
  data: HubData,
  byId: Map<string, OpportunityRecord>,
): HubProfileReport {
  const purchases: StoredPurchase[] = data.purchases
    .filter((p) => p.profileId === profile.id)
    // Stable sort → equal timestamps keep insertion (confirmation) order.
    .sort((a, b) => a.at.localeCompare(b.at));
  const skippedEvents: StoredSkip[] = data.skipped.filter((s) => s.profileId === profile.id);

  let bankroll = profile.startingBankroll;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  let pending = 0;
  let exposure = 0;
  const equity: HubProfileReport['equity'] = [];
  const positions: HubPosition[] = [];

  for (const p of purchases) {
    const record = byId.get(p.recordId);
    const position: HubPosition = {
      purchase: { at: p.at, recordId: p.recordId, strategy: p.strategy, stake: p.stake },
      eventName: record?.eventName ?? '',
      sportTitle: record?.sportTitle ?? '',
      commenceTime: record?.commenceTime ?? '',
    };
    if (record?.grading) {
      const pnl = pnlForStake(p.stake, record.grading);
      bankroll = round2(bankroll + pnl);
      const result = record.grading.result;
      if (result === 'win') wins += 1;
      else if (result === 'loss') losses += 1;
      else if (result === 'push') pushes += 1;
      else voids += 1;
      position.result = result;
      position.pnl = pnl;
      position.gradeSource = record.grading.source;
      position.gradeFlags = record.grading.flags;
      equity.push({ at: p.at, bankroll });
    } else {
      pending += 1;
      exposure = round2(exposure + p.stake);
    }
    positions.push(position);
  }

  const pnl = round2(bankroll - profile.startingBankroll);
  return {
    profile,
    simulated: true,
    bankroll,
    pnl,
    roiPct: round2((pnl / profile.startingBankroll) * 100),
    betCount: purchases.length,
    wins,
    losses,
    pushes,
    voids,
    pending,
    exposure,
    maxDrawdown: maxDrawdownOf([profile.startingBankroll, ...equity.map((e) => e.bankroll)]),
    skipped: {
      count: skippedEvents.length,
      events: skippedEvents.map((s) => ({ at: s.at, recordId: s.recordId })),
    },
    equity,
    positions,
  };
}

/** Validate a full profile create body. Router calls this before createProfile. */
export function parseProfileInput(
  body: unknown,
): { ok: true; value: ProfileInput } | { ok: false; message: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = b.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > MAX_NAME_LENGTH) {
    return { ok: false, message: `name is required (≤${MAX_NAME_LENGTH} chars)` };
  }
  const startingBankroll = b.startingBankroll;
  if (typeof startingBankroll !== 'number' || !Number.isFinite(startingBankroll) || startingBankroll <= 0) {
    return { ok: false, message: 'startingBankroll must be a positive number' };
  }
  const stake = parseStake(b.stake);
  if (!stake.ok) return stake;
  const strategies = parseStrategies(b.strategies);
  if (!strategies.ok) return strategies;
  const minEdgePct = b.minEdgePct;
  if (typeof minEdgePct !== 'number' || !Number.isFinite(minEdgePct) || minEdgePct < 0) {
    return { ok: false, message: 'minEdgePct must be a number ≥ 0' };
  }
  return {
    ok: true,
    value: { name, startingBankroll, stake: stake.value, strategies: strategies.value, minEdgePct },
  };
}

/** Validate a PATCH body — every field optional, at least one present. */
export function parseProfilePatch(
  body: unknown,
): { ok: true; value: Partial<ProfileInput> } | { ok: false; message: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const value: Partial<ProfileInput> = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || b.name.trim().length === 0 || b.name.trim().length > MAX_NAME_LENGTH) {
      return { ok: false, message: `name must be ≤${MAX_NAME_LENGTH} chars` };
    }
    value.name = b.name;
  }
  if (b.startingBankroll !== undefined) {
    if (typeof b.startingBankroll !== 'number' || !Number.isFinite(b.startingBankroll) || b.startingBankroll <= 0) {
      return { ok: false, message: 'startingBankroll must be a positive number' };
    }
    value.startingBankroll = b.startingBankroll;
  }
  if (b.stake !== undefined) {
    const stake = parseStake(b.stake);
    if (!stake.ok) return stake;
    value.stake = stake.value;
  }
  if (b.strategies !== undefined) {
    const strategies = parseStrategies(b.strategies);
    if (!strategies.ok) return strategies;
    value.strategies = strategies.value;
  }
  if (b.minEdgePct !== undefined) {
    if (typeof b.minEdgePct !== 'number' || !Number.isFinite(b.minEdgePct) || b.minEdgePct < 0) {
      return { ok: false, message: 'minEdgePct must be a number ≥ 0' };
    }
    value.minEdgePct = b.minEdgePct;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, message: 'no updatable fields provided' };
  }
  return { ok: true, value };
}

function parseStake(raw: unknown): { ok: true; value: HubStake } | { ok: false; message: string } {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (s.type !== 'flat' && s.type !== 'pctOfStart') {
    return { ok: false, message: "stake.type must be 'flat' or 'pctOfStart'" };
  }
  if (typeof s.value !== 'number' || !Number.isFinite(s.value) || s.value <= 0) {
    return { ok: false, message: 'stake.value must be a positive number' };
  }
  return { ok: true, value: { type: s.type, value: s.value } };
}

function parseStrategies(
  raw: unknown,
): { ok: true; value: OpportunityStrategy[] } | { ok: false; message: string } {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((s) => STRATEGIES.includes(s as OpportunityStrategy))
  ) {
    return { ok: false, message: `strategies must be a non-empty subset of ${STRATEGIES.join(', ')}` };
  }
  return { ok: true, value: [...new Set(raw as OpportunityStrategy[])] };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
