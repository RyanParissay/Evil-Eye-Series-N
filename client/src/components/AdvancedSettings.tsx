import { useState } from 'react';
import { patchBook, patchSettings } from '../lib/api';
import {
  advSettingsToggle, bookRow, lastTickText, memoryText, planText, sportCell,
  type SettingsView,
} from '../lib/settings';

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
          </div>
        </>
      )}
    </>
  );
}
