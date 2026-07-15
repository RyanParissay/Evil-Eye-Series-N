export const DEFAULT_SETTINGS = {
  tolerancePct: 5, verifyGapSecs: 75, staleRemoveMin: 10, freshWindowSecs: 120,
  minArbMarginPct: 0.75, minEvEdgePct: 2.0, middleRatio: 1.5,
  kellyFraction: 0.25, kellyCapPct: 5, bankrollCents: 1_000_000,
  flatPairCents: 10_000, roundToCents: 500, minStakeCents: 1_000, dailyPickCap: 12,
  quietStartHour: 0, quietEndHour: 8, scanBaseMin: 20, scanHotMinMin: 5,
  scanHotMaxMin: 8, hotWindowHours: 2, sharpVelocityPerDayPerBook: 3,
  marketBreadthPerWeekPerBook: 2, goGentleHeat: 30, stopHeat: 60,
  // Brain (Plan 3) — the MODEL CONTROLS knobs. Weights are per-event raw heat
  // points; decay half-life in days; consolidation cadence in hours.
  heatWeightLimit: 23, heatWeightReject: 9, heatWeightCut: 14, heatWeightWithdrawal: -2,
  heatHalfLifeDays: 21, brainCadenceHours: 6, brainKillSwitch: 0, anchorIdx: 0,
  creditPlanMonthly: 100_000,
  // Live mode (Plan 6). Flipped ONLY by POST /api/mode — PATCH /api/settings
  // refuses this key because flipping has side effects (rewiring, env gating).
  liveMode: 0,
};

export type Settings = typeof DEFAULT_SETTINGS;
