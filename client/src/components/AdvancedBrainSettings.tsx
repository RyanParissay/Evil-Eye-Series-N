import { useEffect, useState } from 'react';
import { fetchTrades, type TradeView } from '../lib/api';
import { modelControlRows, traceLines, traceTitle, type BrainView, type SubTone } from '../lib/brain';

// Verbatim design-inventory §3.8 — a spec display; the real math lives in server/src/engine.
const STRATEGY_CORE = `# arbitrage — 2 or 3 legs
inv_sum    = sum(1 / odds_i for each leg)
arb_margin = 1 - inv_sum                  # > 0.75% passes

# fair odds — de-vig the reference pricer
fair_prob  = (1/pin_a) / (1/pin_a + 1/pin_b)
ev_edge    = fair_prob * book_odds - 1    # > 2.0% passes

# staking — kelly against TOTAL bankroll
kelly_frac = 0.25
stake      = bankroll * kelly_frac * ev_edge / (book_odds - 1)
stake      = round_to(min(stake, 0.05 * bankroll), $5)

# verification — 75s later, tolerance gate
retention  = edge_recheck / edge_first
promote if retention >= 1 - tolerance   # default 5%`;

const PIPELINE = ['SCAN', 'NORMALIZE', 'DE-VIG', 'EDGE MATH', 'GATE BATTERY', 'STAKING', 'WHATSAPP'];

interface InputRow { src: string; detail: string; status: string; tone: SubTone }

/** Detail sentences verbatim §3.8; statuses are sim-honest (SIM until Plan 6 wires the feeds). */
function inputRows(brain: BrainView): InputRow[] {
  return [
    { src: 'THE ODDS API', detail: 'Odds feed · 16 books · poll 20 min (5–8 min near start)', status: 'SIM', tone: 'yellow' },
    { src: 'PINNACLE FEED', detail: 'Reference pricer — de-vig anchor for fair odds', status: 'SIM', tone: 'yellow' },
    { src: 'WHATSAPP REPLIES', detail: 'Confirms + limit reports via Twilio', status: 'SIM', tone: 'yellow' },
    { src: 'SETTLED RESULTS', detail: 'Final scores for grading + P/L', status: 'SIM', tone: 'yellow' },
    { src: 'LIMITS LOG', detail: 'Your reported max bets (Advanced Analytics)', status: `${brain.limitsThisMonth} THIS MONTH`, tone: 'yellow' },
    { src: 'LLM — HAIKU', detail: 'Consolidation pass · strategy text + heat review', status: '$0.00 / $3.00', tone: 'muted' },
  ];
}

function BoilerRoom() {
  const [last, setLast] = useState<TradeView | null>(null);
  useEffect(() => {
    void fetchTrades('all').then((trades) => setLast(trades?.[0] ?? null));
  }, []);
  return (
    <div className="boiler">
      <div className="boiler-title">
        MODEL INTERNALS — THE BOILER ROOM
        <span className="boiler-sub">READ-ONLY MIRROR OF THE BACK END</span>
      </div>
      <div className="pipeline">
        {PIPELINE.map((chip, i) => (
          <span key={chip}>
            {i > 0 && <span className="pipe-arrow">→ </span>}
            <span className="pipe-chip">{chip}</span>
          </span>
        ))}
      </div>
      <div className="code-box">
        <div className="code-label">THE MATH — STRATEGY CORE (strategy.py)</div>
        <pre className="code-pre">{STRATEGY_CORE}</pre>
      </div>
      <div className="code-box">
        <div className="code-label">
          {last ? traceTitle(last) : 'LIVE TRACE — LAST CANDIDATE THROUGH THE PIPE'}
        </div>
        <pre className="trace-pre">{last ? traceLines(last).join('\n') : 'NO CANDIDATES YET'}</pre>
      </div>
      <div className="boiler-foot">
        THIS IS THE EXACT CODE PATH EVERY CANDIDATE WALKS. STRATEGY EDITS HAPPEN IN SETTINGS — NEVER BY HAND IN HERE.
      </div>
    </div>
  );
}

interface AdvancedBrainSettingsProps {
  brain: BrainView;
  open: boolean;
  onToggle: () => void;
}

export function AdvancedBrainSettings({ brain, open, onToggle }: AdvancedBrainSettingsProps) {
  const [modelRoomOpen, setModelRoomOpen] = useState(false);
  return (
    <div className="viewall">
      {open && (
        <div className="brain-panel">
          <div className="brain-section-head">INPUTS — WHAT THE BRAIN IS CONSUMING</div>
          {inputRows(brain).map((r) => (
            <div className="input-row" key={r.src}>
              <span className="input-src">{r.src}</span>
              <span className="input-detail">{r.detail}</span>
              <span className={`input-status ${r.tone}`}>{r.status}</span>
            </div>
          ))}
          <div className="brain-section-head">MODEL CONTROLS</div>
          {modelControlRows(brain.controls).map(([key, value]) => (
            <div className="control-row" key={key}>
              <span className="control-key">{key}</span>
              <span className="control-value">{value}</span>
            </div>
          ))}
          <div className="brain-btn-row">
            <button className="brain-btn" type="button">+ ADD DATA SOURCE</button>
            <button
              className={`brain-btn${modelRoomOpen ? ' active' : ''}`}
              onClick={() => setModelRoomOpen((v) => !v)}
            >
              {modelRoomOpen ? 'CLOSE MODEL ←' : 'EDIT MODEL →'}
            </button>
          </div>
          {modelRoomOpen && <BoilerRoom />}
        </div>
      )}
      <button className={`cta cta-pink${open ? ' open' : ''}`} onClick={onToggle}>
        ADVANCED BRAIN SETTINGS
      </button>
      <div className="cta-caption">API INPUTS · DATA SOURCES · MODEL CONTROLS</div>
    </div>
  );
}
