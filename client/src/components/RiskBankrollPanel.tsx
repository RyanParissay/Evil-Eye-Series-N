import { patchSettings } from '../lib/api';
import {
  bankrollText, clampStepper, dailyCapText, flatPairText, kellyCapText,
  kellyFractionText, minStakeText, roundToText, toleranceText, type SettingsValues,
} from '../lib/settings';
import { Stepper } from './Stepper';

/** §2.3 — one PATCH per knob; the displayed value always comes from `s` (the last
 *  server-confirmed state), never local state, so a rejected PATCH just leaves the
 *  row showing its last known-good value once `refresh()` re-polls. */
interface RiskBankrollPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.3 — live-value rows plus the tolerance stepper (MASTER PROMPT hard rule 2:
 *  the tolerance is user-set 0–100% HERE; step 1, clamped). */
export function RiskBankrollPanel({ s, refresh }: RiskBankrollPanelProps) {
  const step = async (key: string, next: number) => {
    await patchSettings({ [key]: next });
    refresh();
  };
  const tol = async (next: number) => {
    await patchSettings({ tolerancePct: clampStepper(next, 0, 100) });
    refresh();
  };
  return (
    <section className="panel">
      <header className="panel-head">RISK & BANKROLL</header>
      <div className="panel-body">
        <div className="kv">
          <span className="kv-key">FLAT PAIR STAKE</span>
          <Stepper value={flatPairText(s)}
            onDec={() => { void step('flatPairCents', clampStepper(s.flatPairCents - 1_000, 100)); }}
            onInc={() => { void step('flatPairCents', clampStepper(s.flatPairCents + 1_000, 100)); }} />
        </div>
        <div className="kv">
          <span className="kv-key">KELLY FRACTION / CAP</span>
          <span className="kv-pair">
            <Stepper value={kellyFractionText(s)}
              onDec={() => { void step('kellyFraction', clampStepper(Number((s.kellyFraction - 0.05).toFixed(2)), 0.05)); }}
              onInc={() => { void step('kellyFraction', clampStepper(Number((s.kellyFraction + 0.05).toFixed(2)), 0.05)); }} />
            <span className="kv-pair-sep">/</span>
            <Stepper value={kellyCapText(s)}
              onDec={() => { void step('kellyCapPct', clampStepper(s.kellyCapPct - 1, 1)); }}
              onInc={() => { void step('kellyCapPct', clampStepper(s.kellyCapPct + 1, 1)); }} />
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">TOTAL BANKROLL</span>
          <Stepper value={bankrollText(s)}
            onDec={() => { void step('bankrollCents', clampStepper(s.bankrollCents - 10_000, 100)); }}
            onInc={() => { void step('bankrollCents', clampStepper(s.bankrollCents + 10_000, 100)); }} />
        </div>
        <div className="kv">
          <span className="kv-key">LINE MOVE TOLERANCE</span>
          <Stepper value={toleranceText(s)}
            onDec={() => { void tol(s.tolerancePct - 1); }}
            onInc={() => { void tol(s.tolerancePct + 1); }} />
        </div>
        <div className="kv">
          <span className="kv-key">MIN STAKE / ROUND TO</span>
          <span className="kv-pair">
            <Stepper value={minStakeText(s)}
              onDec={() => { void step('minStakeCents', clampStepper(s.minStakeCents - 100, 100)); }}
              onInc={() => { void step('minStakeCents', clampStepper(s.minStakeCents + 100, 100)); }} />
            <span className="kv-pair-sep">/</span>
            <Stepper value={roundToText(s)}
              onDec={() => { void step('roundToCents', clampStepper(s.roundToCents - 100, 100)); }}
              onInc={() => { void step('roundToCents', clampStepper(s.roundToCents + 100, 100)); }} />
          </span>
        </div>
        <div className="kv">
          <span className="kv-key">TRADES PER DAY CAP</span>
          <Stepper value={dailyCapText(s)}
            onDec={() => { void step('dailyPickCap', clampStepper(s.dailyPickCap - 1, 1)); }}
            onInc={() => { void step('dailyPickCap', clampStepper(s.dailyPickCap + 1, 1)); }} />
        </div>
      </div>
    </section>
  );
}
