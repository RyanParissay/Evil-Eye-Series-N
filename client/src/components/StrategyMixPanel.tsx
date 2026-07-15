import { patchSettings } from '../lib/api';
import { mixRows, rebalanceMix, type SettingsValues } from '../lib/settings';

interface StrategyMixPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.1 — three sliders whose trio ALWAYS sums to 100: moving one rebalances the
 *  other two (pure rebalanceMix) and PATCHes all three together. */
export function StrategyMixPanel({ s, refresh }: StrategyMixPanelProps) {
  const move = async (key: 'arb' | 'middle' | 'ev', value: number) => {
    const next = rebalanceMix({ arb: s.mixArbPct, middle: s.mixMiddlePct, ev: s.mixEvPct }, key, value);
    await patchSettings({ mixArbPct: next.arb, mixMiddlePct: next.middle, mixEvPct: next.ev });
    refresh();
  };
  const sliderKey = { ARB: 'arb', MIDDLE: 'middle', EV: 'ev' } as const;
  return (
    <section className="panel">
      <header className="panel-head">STRATEGY MIX — LOCKED TO 100</header>
      <div className="panel-body">
        {mixRows(s).map((row) => (
          <div className="mix-row" key={row.key}>
            <div className="mix-label">
              <span>{row.key}</span>
              <span className="mix-pct">{row.pct}</span>
            </div>
            <input
              type="range" min={0} max={100} step={1} value={row.pct} className="mix-slider"
              onChange={(e) => { void move(sliderKey[row.key], Number(e.target.value)); }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
