import { useState } from 'react';
import { patchBook, patchSettings } from '../lib/api';
import {
  advSettingsToggle, bookRow, fallbackItems, journalMinText, killRuleRows,
  lastTickText, memoryText, planText, safetyRows, sportCell, thresholdTexts,
  type SettingsView,
} from '../lib/settings';
import { Stepper } from './Stepper';

interface AdvancedSettingsProps {
  view: SettingsView;
  now: number;
  refresh: () => void;
}

export function AdvancedSettings({ view, now, refresh }: AdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const s = view.settings;

  const toggleBook = async (name: string, enabled: boolean) => {
    await patchBook(name, { enabled: enabled ? 0 : 1 });
    refresh();
  };
  const setSport = async (name: string, sport: string) => {
    await patchBook(name, { sport });
    refresh();
  };
  const toggleSport = async (sport: string, enabled: boolean) => {
    const cur = s.disabledSports.split(',').map((x) => x.trim()).filter(Boolean);
    const next = enabled ? [...cur, sport] : cur.filter((x) => x !== sport);
    await patchSettings({ disabledSports: [...new Set(next)].sort().join(',') });
    refresh();
  };
  const sportsRoster = view.sports.map((x) => x.sport);
  const step = async (key: string, next: number) => {
    await patchSettings({ [key]: next });
    refresh();
  };
  const locked = view.safetyLocked;

  return (
    <>
      <button className="adv-toggle" onClick={() => setOpen((v) => !v)}>{advSettingsToggle(open)}</button>
      {open && (
        <>
          <p className="adv-intro">Changes here are written to the brain journal.</p>
          <div className="adv-grid">
            <section className="panel span2">
              <header className="panel-head">
                INPUTS
                <span className="panel-head-note" style={{ float: 'right' }}>
                  <span className="dot yellow" /> 5 / 5 INPUTS SIM
                </span>
              </header>
              <div className="input-row2">
                <div className="input-title">ODDS FEED · THE ODDS API</div>
                <div className="input-right">
                  <span className="masked">NO KEY — SIM</span>
                  <button className="mini-btn">EDIT</button>
                  <span>{planText(view.forecaster.planMonthly)}</span>
                  <span className="chip-live sim">SIM</span>
                  <span>{lastTickText(view.lastTickAt, now)}</span>
                </div>
              </div>
              <div className="input-row2">
                <div className="input-title">RESULTS FEED</div>
                <div className="input-right"><span className="chip-live sim">SIM</span></div>
                <div className="input-helper">Settles every receipt after games end · ~40 credits/day, already in the forecast</div>
              </div>
              <div className="input-row2">
                <div className="input-title">YOUR REPORTS — CONFIRM TAPS + LIMITED? + WHATSAPP REPLIES</div>
                <div className="input-right"><span className="chip-live green">LINKED</span></div>
                <div className="input-helper">Channel configured in the WHATSAPP panel. This is the brain's only source of truth about limits.</div>
              </div>
              <div className="input-row2">
                <div className="input-title">REFERENCE TABLES — MARGIN TABLES v2026.07 · DEEP LINKS 16/16 BOOKS</div>
                <div className="input-right"><button className="mini-btn">CHECK FOR UPDATES</button></div>
                <div className="input-helper">Ships with the app; updates rarely.</div>
              </div>
              <div className="input-row2">
                <div className="input-title">BRAIN MEMORY</div>
                <div className="input-right"><span className="kv-value">{memoryText(view.memory)}</span></div>
                <div className="input-helper">Backups live in the DATA panel.</div>
              </div>
              <div className="adv-footer">Inputs in, picks out. The brain never reads news, injuries, or stats — prices only.</div>
            </section>

            <section className="panel">
              <header className="panel-head">MY BOOKS</header>
              <div className="panel-body">
                {view.books.map((b) => {
                  const row = bookRow(b);
                  return (
                    <div className={`book-row${!b.sharpExempt && !b.enabled ? ' off' : ''}`} key={b.name}>
                      <span className="book-name">{row.name}</span>
                      {b.sharpExempt ? (
                        <>
                          <span className="book-sport" style={{ cursor: 'default' }}>ANY</span>
                          <span className="chip-state sharp">{row.chip.label}</span>
                        </>
                      ) : (
                        <>
                          <select
                            className="book-sport" value={b.sport}
                            onChange={(e) => { void setSport(b.name, e.target.value); }}
                          >
                            {sportsRoster.map((sp) => <option key={sp} value={sp}>{sp.toUpperCase()}</option>)}
                          </select>
                          <button
                            className={`chip-state ${row.chip.tone}`}
                            onClick={() => { void toggleBook(b.name, b.enabled); }}
                          >
                            {row.chip.label}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                <button className="add-book">+ ADD BOOK</button>
              </div>
            </section>

            <section className="panel">
              <header className="panel-head">SPORTS & LEAGUES</header>
              <div className="panel-body">
                <div className="sports-grid">
                  {view.sports.map((x) => (
                    <button
                      key={x.sport}
                      className={`sport-cell${x.enabled ? '' : ' off'}`}
                      onClick={() => { void toggleSport(x.sport, x.enabled); }}
                    >
                      {sportCell(x)}
                    </button>
                  ))}
                </div>
                <div className="helper-note">More leagues = more credits. The forecaster updates live.</div>
              </div>
            </section>

            <section className="panel">
              <header className="panel-head">EDGE THRESHOLDS & FRESHNESS</header>
              <div className="panel-body">
                {(() => {
                  const t = thresholdTexts(s);
                  return (
                    <>
                      <div className="kv"><span className="kv-key">{t[0]![0]}</span>
                        <Stepper value={t[0]![1]}
                          onDec={() => { void step('minArbMarginPct', Math.max(0.05, Number((s.minArbMarginPct - 0.05).toFixed(2)))); }}
                          onInc={() => { void step('minArbMarginPct', Number((s.minArbMarginPct + 0.05).toFixed(2))); }} />
                      </div>
                      <div className="kv"><span className="kv-key">{t[1]![0]}</span>
                        <Stepper value={t[1]![1]}
                          onDec={() => { void step('minEvEdgePct', Math.max(0.1, Number((s.minEvEdgePct - 0.1).toFixed(1)))); }}
                          onInc={() => { void step('minEvEdgePct', Number((s.minEvEdgePct + 0.1).toFixed(1))); }} />
                      </div>
                      <div className="kv"><span className="kv-key">{t[2]![0]}</span>
                        <Stepper value={t[2]![1]}
                          onDec={() => { void step('middleRatio', Math.max(1.0, Number((s.middleRatio - 0.1).toFixed(1)))); }}
                          onInc={() => { void step('middleRatio', Number((s.middleRatio + 0.1).toFixed(1))); }} />
                      </div>
                      <div className="kv"><span className="kv-key">{t[3]![0]}</span>
                        <Stepper value={t[3]![1]}
                          onDec={() => { void step('freshWindowSecs', Math.max(30, s.freshWindowSecs - 10)); }}
                          onInc={() => { void step('freshWindowSecs', s.freshWindowSecs + 10); }} />
                      </div>
                    </>
                  );
                })()}
                <div className="helper-note">Verified cards count down from this before turning STALE.</div>
              </div>
            </section>

            <section className="panel">
              <header className="panel-head">REFERENCE PRICER FALLBACK</header>
              <div className="panel-body">
                <div className="kv-key" style={{ padding: '10px 0 4px' }}>IF THE ANCHOR GOES DOWN</div>
                {fallbackItems(s).map((item) => (
                  <div key={item.idx} className={`radio-item${item.active ? ' active' : ''}`}>
                    {item.label}
                  </div>
                ))}
                <div className="helper-note">
                  The anchor itself is switched on the Brain tab. Switching starts a new measurement series — it never mixes rulers.
                </div>
              </div>
            </section>

            <section className={`panel${locked ? ' locked' : ''}`}>
              <header className="panel-head">
                ACCOUNT SAFETY RULES
                <span className="panel-head-note">□ EDITABLE WHILE GREEN</span>
              </header>
              <div className="panel-body">
                {safetyRows(s).map(([key, value, tone]) => (
                  key === 'ONE-SPORT RULE' ? (
                    <div className="kv" key={key}>
                      <span className="kv-key">{key}</span>
                      <button className={`toggle-chip${s.oneSportRule === 0 ? '' : ' on'}`} disabled={locked}
                        onClick={() => { void step('oneSportRule', s.oneSportRule === 0 ? 1 : 0); }}>
                        {value}
                      </button>
                    </div>
                  ) : (
                    <div className="kv" key={key}>
                      <span className="kv-key">{key}</span>
                      <span className={`kv-value${tone === 'plain' ? '' : ` ${tone}`}${key === 'DEFAULT QUIT RULE' ? ' kv-quit' : ''}`}>{value}</span>
                    </div>
                  )
                ))}
                <div className="helper-note">Locked while any book is amber or red — you set these when calm.</div>
              </div>
            </section>

            <section className="panel span2">
              <header className="panel-head">
                STRATEGY KILL RULES + JOURNAL
                <span className="panel-head-note">□ EDITABLE WHILE PASSING</span>
              </header>
              <div className="panel-body">
                {killRuleRows().map(([key, value]) => (
                  <div className="kv" key={key}><span className="kv-key">{key}</span><span className="kv-value">{value}</span></div>
                ))}
                <div className="helper-note">A strategy on watch locks its own rule.</div>
                <div className="journal-sub">
                  <div className="kv">
                    <span className="kv-key">JOURNAL MINIMUM</span>
                    <Stepper value={journalMinText(s)}
                      onDec={() => { void step('journalMinPerDay', Math.max(1, s.journalMinPerDay - 1)); }}
                      onInc={() => { void step('journalMinPerDay', Math.min(4, s.journalMinPerDay + 1)); }} />
                  </div>
                  <div className="helper-note">The brain always writes at least this many entries and as many more as it wants.</div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
