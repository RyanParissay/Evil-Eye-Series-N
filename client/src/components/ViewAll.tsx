import { useState } from 'react';
import { TradeView, fetchTrades, metricPct } from '../lib/api';
import {
  formatCents, formatMetric, formatOdds, formatSignedCents, formatWhen,
} from '../lib/format';
import { Reveal, nextRevealState, revealControls } from '../lib/reveal';

interface ViewAllProps {
  killedToday: number;
}

/* Locked mapping for the four active statuses; SETTLED/KILLED/EXPIRED are
   defensive (Plan 1's view=all is "every non-settled trade", which can
   literally include terminal rows) and follow the mockup's colors. */

/* Mockup-attested KILLED abbreviations (ALL TRADES rows 9/10/13/17);
   unmapped reasons fall back to underscore → space (Decision note 16c). */
const KILL_LABEL: Record<string, string> = {
  FAILED_VERIFICATION: 'VERIFICATION',
  ROUNDING_DESTROYS_MARGIN: 'ROUNDING',
  HEAT_GATE: 'HEAT GATE',
  QUOTE_STALE: 'QUOTE STALE',
};

function allStatusCell(t: TradeView): { text: string; color: string } {
  switch (t.status) {
    case 'PENDING':
      return { text: 'PENDING', color: 'var(--muted-label)' };
    case 'VERIFIED':
      return { text: 'VERIFIED LIVE', color: '#fff' };
    case 'CONFIRMED':
      return { text: 'CONFIRMED', color: 'var(--green)' };
    case 'UNCONFIRMED':
      return { text: 'UNCONFIRMED', color: 'var(--muted-label)' };
    case 'SETTLED': {
      const cents = t.resultCents ?? 0;
      return {
        text: `CONFIRMED ${formatSignedCents(cents)}`,
        color: cents >= 0 ? 'var(--green)' : 'var(--red)',
      };
    }
    case 'KILLED': {
      const reason = t.killReason ?? '';
      const label = KILL_LABEL[reason] ?? reason.replace(/_/g, ' ');
      return { text: `KILLED — ${label}`, color: 'var(--red)' };
    }
    case 'EXPIRED':
      return { text: 'EXPIRED', color: 'var(--faint)' };
  }
}

function AllTradesRow({ t }: { t: TradeView }) {
  const status = allStatusCell(t);
  return (
    <div className="va-row">
      <span className="va-cat">{t.category}</span>
      <span className="va-event">
        {t.event} · {t.sport.toUpperCase()}
      </span>
      <span className="va-legs">
        {t.legs.map((l) => `${l.book} ${formatOdds(l.odds)}`).join(' / ')}
      </span>
      <span className={t.category === 'ARB' ? 'va-metric arb' : 'va-metric edge'}>
        {formatMetric(t.category, metricPct(t), { colon: false })}
      </span>
      <span className="va-status" style={{ color: status.color }}>
        {status.text}
      </span>
    </div>
  );
}

function historyDescription(t: TradeView): string {
  const stakes = t.legs
    .map((l) => l.stakeCents)
    .filter((c): c is number => c !== null);
  const base = `${t.category} · ${t.event}`;
  if (stakes.length === 0) return base;
  return `${base} · ${stakes.map((c) => formatCents(c)).join('/')}`;
}

/* Three history outcomes (§2.4): SETTLED → CONFIRMED chip colored by result;
   UNCONFIRMED → UNCONFIRMED chip + NO REPLY (mockup rows 4/10/16); else EXPIRED + —.
   Plan 1's history view says SETTLED/EXPIRED/KILLED only — the UNCONFIRMED branch
   is defensive in case its executor follows the mockup (Decision note 16l). */
function HistoryRow({ t }: { t: TradeView }) {
  const cents = t.resultCents ?? 0;
  let chip: string;
  let chipColor: string;
  let resultText: string;
  let resultColor: string;
  if (t.status === 'SETTLED') {
    chip = 'CONFIRMED';
    chipColor = cents >= 0 ? 'var(--green-money)' : 'var(--red)';
    resultText = `${cents >= 0 ? 'WON' : 'LOST'} ${formatSignedCents(cents)}`;
    resultColor = chipColor;
  } else if (t.status === 'UNCONFIRMED') {
    chip = 'UNCONFIRMED';
    chipColor = 'var(--muted-label)';
    resultText = 'NO REPLY';
    resultColor = 'var(--faint)';
  } else {
    chip = 'EXPIRED';
    chipColor = 'var(--faint)';
    resultText = '—';
    resultColor = 'var(--faint)';
  }
  return (
    <div className="hist-row">
      <span className="hist-desc">{historyDescription(t)}</span>
      <span className="hist-outcome">
        <span className="chip" style={{ color: chipColor }}>
          {chip}
        </span>
        <span style={{ color: resultColor }}>{resultText}</span>
      </span>
      <span className="hist-when">{formatWhen(t.settledAt ?? t.createdAt)}</span>
    </div>
  );
}

function ListControls({
  reveal, total, onChange,
}: {
  reveal: Reveal;
  total: number;
  onChange: (r: Reveal) => void;
}) {
  const c = revealControls(reveal, total);
  if (!c.showMore && !c.showLess && c.showAll === null) return null;
  return (
    <div className="va-footer">
      {c.showMore && (
        <button className="list-btn" onClick={() => onChange(nextRevealState(reveal))}>
          VIEW MORE →
        </button>
      )}
      {c.showLess && (
        <button className="list-btn" onClick={() => onChange(5)}>
          VIEW LESS
        </button>
      )}
      {c.showAll !== null && (
        <button className="list-btn" onClick={() => onChange('all')}>
          VIEW ALL ({c.showAll})
        </button>
      )}
    </div>
  );
}

export function ViewAll({ killedToday }: ViewAllProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<TradeView[] | null>(null);
  const [history, setHistory] = useState<TradeView[] | null>(null);
  const [allReveal, setAllReveal] = useState<Reveal>(5);
  const [histReveal, setHistReveal] = useState<Reveal>(5);
  const [graveyardOpen, setGraveyardOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setAllReveal(5);
      setHistReveal(5);
      setGraveyardOpen(false);
      void fetchTrades('all').then(setAll);
      void fetchTrades('history').then(setHistory);
    }
  };

  const allRows = all ?? [];
  const histAll = history ?? [];
  const histRows = histAll.filter(
    (t) => t.status === 'SETTLED' || t.status === 'EXPIRED' || t.status === 'UNCONFIRMED',
  );
  const killedRows = histAll.filter((t) => t.status === 'KILLED'); // graveyard ONLY
  const allCtl = revealControls(allReveal, allRows.length);
  const histCtl = revealControls(histReveal, histRows.length);

  return (
    <section className="viewall">
      {open && (
        <>
          <h2 className="section-header">ALL TRADES</h2>
          <div className="va-box">
            {allRows.slice(0, allCtl.visible).map((t) => (
              <AllTradesRow key={t.id} t={t} />
            ))}
            {allRows.length === 0 && <div className="empty-note">NO TRADES YET</div>}
            <ListControls reveal={allReveal} total={allRows.length} onChange={setAllReveal} />
          </div>
          <div className="hist-header-row">
            <h2 className="section-header inline">HISTORY</h2>
            <button className="grave-toggle" onClick={() => setGraveyardOpen((g) => !g)}>
              {graveyardOpen ? '▾' : '▸'} {killedToday} KILLED TODAY
            </button>
          </div>
          <div className="va-box">
            {histRows.slice(0, histCtl.visible).map((t) => (
              <HistoryRow key={t.id} t={t} />
            ))}
            {histRows.length === 0 && <div className="empty-note">NO HISTORY YET</div>}
            <ListControls reveal={histReveal} total={histRows.length} onChange={setHistReveal} />
            {graveyardOpen && (
              <div className="graveyard">
                <div className="grave-title">
                  GRAVEYARD — EVERY KILL IS LOGGED WITH ITS REASON
                </div>
                {killedRows.map((t) => (
                  <div key={t.id} className="grave-row">
                    <span>
                      {t.category} · {t.event}
                    </span>
                    <span className="grave-reason">{t.killReason ?? ''}</span>
                  </div>
                ))}
                {killedRows.length === 0 && <div className="empty-note">NO KILLS TODAY</div>}
              </div>
            )}
          </div>
        </>
      )}
      <button className={open ? 'cta open' : 'cta'} onClick={toggle}>
        VIEW ALL TRADES
      </button>
      <div className="cta-caption">
        EVERY VALUABLE TRADE THE SCANNER FOUND — ARB · MIDDLE · EV
      </div>
    </section>
  );
}
