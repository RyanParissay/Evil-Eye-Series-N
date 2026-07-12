/**
 * Auto-grading orchestration (Phase 13). GRADING_RULES.md §4 is binding:
 * poll only games with an open (ungraded) position, first poll at
 * commence + typical duration + 30min, retry every 45min, give up (flag
 * ungraded_stale) after 24h, hard-stop at 500 scores-credits/day. Grading
 * itself is the pure engine (engine/grading.ts) — this module is the I/O
 * shell: what's due, one fetchScores call per sport, and where the result
 * lands (OpportunityService.applyGrading/setGradingFlag).
 */
import type { GradeResult, OpportunityRecord, OpportunityStatus, RecordGrading } from '@shared/types';
import {
  SCORE_GIVE_UP_MS,
  SCORE_RETRY_MS,
  SCORES_DAILY_CREDIT_CAP,
  firstPollAt,
  rulesForSport,
} from '../config/gradingRules';
import { gradeRecord, manualPnlPer100, type FinalScore } from '../engine/grading';
import { csvEscape } from '../ledger/ledgerService';
import type { UsageInfo } from '../providers/OddsProvider';
import type { GradingDataStore } from './gradingStore';

/** The provider surface GradingService actually needs — structural, for tests. */
export interface ScoresProvider {
  fetchScores(
    sportKey: string,
    params: { daysFrom?: number; eventIds?: readonly string[] },
  ): Promise<{
    scores: Array<{
      eventId: string;
      completed: boolean;
      home: number | null;
      away: number | null;
      homeTeam: string;
      awayTeam: string;
    }>;
    usage: UsageInfo;
  }>;
}

export type GradingOutcome =
  | { ok: true; record: OpportunityRecord }
  | { ok: false; reason: 'not_found' | 'conflict' | 'bad_request'; message: string };

/** What GradingService needs from OpportunityService — structural, for tests. */
export interface GradingOpportunities {
  list(status?: OpportunityStatus): Promise<OpportunityRecord[]>;
  get(id: string): Promise<OpportunityRecord | null>;
  applyGrading(id: string, grading: RecordGrading): Promise<GradingOutcome>;
  setGradingFlag(id: string, flag: string): Promise<GradingOutcome>;
}

export interface PollSummary {
  graded: number;
  /** Records for which a scores call was actually attempted this poll. */
  polled: number;
  /** True when the daily cap stopped some (or all) of the due score fetches. */
  capped: boolean;
}

export class GradingService {
  constructor(
    private readonly provider: ScoresProvider,
    private readonly opportunities: GradingOpportunities,
    private readonly store: GradingDataStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async poll(): Promise<PollSummary> {
    const now = this.now();
    const nowMs = now.getTime();
    const today = dateKey(now);

    const stored = await this.store.read();
    let creditsToday = stored.daily.date === today ? stored.daily.credits : 0;

    // Open positions: active-file records (every strategy), not yet graded,
    // not given up on. Group whatever's actually due by sport.
    const records = await this.opportunities.list();
    const groups = new Map<string, OpportunityRecord[]>();

    for (const record of records) {
      if (record.grading) continue; // already settled — never re-graded
      if (record.gradingFlags?.includes('ungraded_stale')) continue;

      const rules = rulesForSport(record.sportKey, record.marketKey);
      if (!rules) {
        // Unknown sport: needs_rules costs no credits — never guess (§1).
        if (!record.gradingFlags?.includes('needs_rules')) {
          await this.opportunities.setGradingFlag(record.id, 'needs_rules');
        }
        continue;
      }

      const commenceMs = Date.parse(record.commenceTime);
      if (nowMs - commenceMs > SCORE_GIVE_UP_MS) {
        if (!record.gradingFlags?.includes('ungraded_stale')) {
          await this.opportunities.setGradingFlag(record.id, 'ungraded_stale');
          await this.stampStale(record.eventId, now, today);
        }
        continue;
      }

      if (nowMs < firstPollAt(record.commenceTime, rules)) continue; // not due yet

      const eventState = stored.events[record.eventId];
      if (eventState?.lastPollAt && nowMs - Date.parse(eventState.lastPollAt) < SCORE_RETRY_MS) {
        continue; // too soon to retry (§4: every 45min)
      }

      const group = groups.get(record.sportKey) ?? [];
      group.push(record);
      groups.set(record.sportKey, group);
    }

    let graded = 0;
    let polled = 0;
    let capped = false;

    for (const [sportKey, group] of groups) {
      if (creditsToday >= SCORES_DAILY_CREDIT_CAP) {
        capped = true;
        break; // §4 hard cap: stop polling, no further calls this run
      }

      const eventIds = [...new Set(group.map((r) => r.eventId))];
      const { scores, usage } = await this.provider.fetchScores(sportKey, { eventIds });
      creditsToday += usage.creditsCharged;

      const nowIso = now.toISOString();
      await this.store.update((data) => {
        const daily = data.daily.date === today ? data.daily : { date: today, credits: 0 };
        const events = { ...data.events };
        for (const record of group) {
          const cur = events[record.eventId] ?? { attempts: 0, lastPollAt: null, staleAt: null };
          events[record.eventId] = { attempts: cur.attempts + 1, lastPollAt: nowIso, staleAt: cur.staleAt };
        }
        return {
          data: { daily: { date: today, credits: daily.credits + usage.creditsCharged }, events },
          result: undefined,
        };
      });

      const byEvent = new Map(scores.map((s) => [s.eventId, s]));
      for (const record of group) {
        polled += 1;
        const score = byEvent.get(record.eventId);
        if (!score || !score.completed) continue; // not final yet — retry later

        const finalScore: FinalScore =
          score.home == null || score.away == null
            ? { home: 0, away: 0, cancelled: true } // §2: no scores on a completed game → void
            : { home: score.home, away: score.away };

        const outcome = gradeRecord(record, finalScore, now);
        if (outcome.ok) {
          const applied = await this.opportunities.applyGrading(record.id, outcome.grading);
          if (applied.ok) graded += 1;
        } else {
          await this.opportunities.setGradingFlag(record.id, 'needs_rules');
        }
      }
    }

    return { graded, polled, capped };
  }

  /**
   * §3 manual override: builds a fresh RecordGrading (source 'manual',
   * flag manually_graded) and appends to the audit trail. Manual always
   * wins — OpportunityService.applyGrading refuses to let a later AUTO
   * grade overwrite it (poll's own "already graded" filter is the primary
   * guard; that refusal is the belt-and-suspenders second one).
   */
  async manualGrade(id: string, result: GradeResult, note?: string): Promise<GradingOutcome> {
    const now = this.now();
    const record = await this.opportunities.get(id);
    if (!record) {
      return { ok: false, reason: 'not_found', message: `Unknown opportunity: ${id}` };
    }
    const old = record.grading?.result ?? null;
    const flags = new Set(record.grading?.flags ?? []);
    flags.add('manually_graded');
    const grading: RecordGrading = {
      result,
      legResults: record.legs.map(() => result),
      pnlPer100: manualPnlPer100(record.legs, result),
      flags: [...flags],
      ...(record.grading?.score && { score: record.grading.score }),
      gradedAt: now.toISOString(),
      source: 'manual',
      audit: [
        ...(record.grading?.audit ?? []),
        { at: now.toISOString(), old, next: result, ...(note && { note }) },
      ],
    };
    return this.opportunities.applyGrading(id, grading);
  }

  private async stampStale(eventId: string, now: Date, today: string): Promise<void> {
    await this.store.update((data) => {
      const daily = data.daily.date === today ? data.daily : { date: today, credits: 0 };
      const cur = data.events[eventId] ?? { attempts: 0, lastPollAt: null, staleAt: null };
      return {
        data: { daily, events: { ...data.events, [eventId]: { ...cur, staleAt: now.toISOString() } } },
        result: undefined,
      };
    });
  }
}

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/* ————— Ungradeable bucket (deliverable 5) ————— */

export interface GradingBuckets {
  graded: number;
  open: number;
  needsRules: number;
  stale: number;
  /** No schemaVersion and no grading — GRADING_RULES.md §6. */
  preV13: number;
}

/** Pure classification over whatever record set the caller supplies. */
export function gradingBuckets(records: OpportunityRecord[]): GradingBuckets {
  const buckets: GradingBuckets = { graded: 0, open: 0, needsRules: 0, stale: 0, preV13: 0 };
  for (const record of records) {
    if (record.schemaVersion == null && record.grading == null) {
      buckets.preV13 += 1;
    } else if (record.grading) {
      buckets.graded += 1;
    } else if (record.gradingFlags?.includes('ungraded_stale')) {
      buckets.stale += 1;
    } else if (record.gradingFlags?.includes('needs_rules')) {
      buckets.needsRules += 1;
    } else {
      buckets.open += 1;
    }
  }
  return buckets;
}

/* ————— CSV export (deliverable 6) ————— */

/**
 * Graded records only, one row per record, streamed to the sink chunk by
 * chunk — same Excel-safe conventions as ledgerService's exportCsv
 * (quoted, formula-defanged via csvEscape).
 */
export function gradedRecordsCsv(
  records: OpportunityRecord[],
  write: (chunk: string) => void,
): void {
  write(
    ['id', 'strategy', 'sport', 'event', 'commence', 'result', 'pnl_per_100', 'source', 'flags', 'graded_at'].join(
      ',',
    ) + '\n',
  );
  for (const record of records) {
    const grading = record.grading;
    if (!grading) continue;
    const row = [
      record.id,
      record.strategy,
      record.sportTitle,
      record.eventName,
      record.commenceTime,
      grading.result,
      grading.pnlPer100,
      grading.source,
      grading.flags.join('|'),
      grading.gradedAt,
    ];
    write(row.map(csvEscape).join(',') + '\n');
  }
}
