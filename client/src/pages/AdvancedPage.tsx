import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiErrorCode, BookPreset, BookmakerConfig } from '../../../shared/types';
import {
  ApiError,
  createPreset,
  deletePreset,
  fetchBookmakers,
  fetchPresets,
  recompute,
  renamePreset,
  type RecomputeResponse,
} from '../api';
import { EyeGlyph } from '../components/EyeGlyph';
import { OpportunityCard } from '../components/OpportunityCard';
import { errorHint, errorTitle } from '../errorCopy';

/**
 * Advanced mode: recompute opportunities for any book subset from the
 * latest raw snapshot. Zero credits — this page never talks to the odds
 * provider, only to what the last scan already paid for.
 */
export function AdvancedPage() {
  const [books, setBooks] = useState<BookmakerConfig[] | null>(null);
  const [presets, setPresets] = useState<BookPreset[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<RecomputeResponse | null>(null);
  const [error, setError] = useState<{ code: ApiErrorCode; message: string } | null>(null);
  const [computing, setComputing] = useState(false);

  // Serialize recomputes: rapid toggling keeps only the latest request's
  // result (last-request-wins via a monotonically increasing ticket).
  const ticket = useRef(0);

  async function runRecompute(body: { presetId: string } | { bookmakerKeys: string[] }) {
    const mine = ++ticket.current;
    setComputing(true);
    setError(null);
    try {
      const response = await recompute(body);
      if (ticket.current !== mine) return;
      setResult(response);
      setSelected(new Set(response.bookmakerKeys));
    } catch (err) {
      if (ticket.current !== mine) return;
      const isApi = err instanceof ApiError;
      setError({
        code: isApi ? err.code : 'internal',
        message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
      });
    } finally {
      if (ticket.current === mine) setComputing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBookmakers(), fetchPresets()])
      .then(([bookList, presetList]) => {
        if (cancelled) return;
        setBooks(bookList);
        setPresets(presetList);
        // Open on the most recently used preset; first seed otherwise.
        const initial =
          [...presetList]
            .filter((p) => p.lastUsedAt)
            .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))[0] ??
          presetList[0];
        if (initial) {
          setActivePresetId(initial.id);
          void runRecompute({ presetId: initial.id });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const isApi = err instanceof ApiError;
        setError({
          code: isApi ? err.code : 'internal',
          message: isApi ? err.message : 'Something unexpected broke. Check the server logs.',
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleBook(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    setActivePresetId(null); // hand-edited selection is "custom"
    void runRecompute({ bookmakerKeys: [...next] });
  }

  function selectAll(keys: string[]) {
    setActivePresetId(null);
    setSelected(new Set(keys));
    void runRecompute({ bookmakerKeys: keys });
  }

  async function savePreset() {
    const name = window.prompt('Preset name?')?.trim();
    if (!name || selected.size === 0) return;
    const created = await createPreset(name, [...selected]);
    setPresets((current) => (current ? [...current, created] : [created]));
    setActivePresetId(created.id);
  }

  async function handleRename(preset: BookPreset) {
    const name = window.prompt('New name?', preset.name)?.trim();
    if (!name) return;
    const renamed = await renamePreset(preset.id, name);
    setPresets((current) =>
      current ? current.map((p) => (p.id === renamed.id ? renamed : p)) : current,
    );
  }

  async function handleDelete(preset: BookPreset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    await deletePreset(preset.id);
    setPresets((current) => (current ? current.filter((p) => p.id !== preset.id) : current));
    if (activePresetId === preset.id) setActivePresetId(null);
  }

  const bookStatus = useMemo(
    () => new Map(books?.map((b) => [b.key, b.status]) ?? []),
    [books],
  );
  const known = useMemo(() => new Set(result?.knownRecordIds ?? []), [result]);

  const visibleBooks = (books ?? []).filter(
    (b) =>
      !search ||
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.key.includes(search.toLowerCase()),
  );

  return (
    <div className="page">
      <header className="masthead">
        <EyeGlyph size={52} state={computing ? 'scanning' : 'open'} />
        <h1 className="wordmark">
          Advanced <span className="wordmark-accent">Mode</span>
        </h1>
        <p className="tagline micro-label">
          <Link to="/" className="adv-back">← Scanner</Link> · recompute the last scan · zero credits
        </p>
      </header>

      <section className="adv-controls">
        <div className="adv-presets" role="group" aria-label="Presets">
          {(presets ?? []).map((preset) => (
            <span key={preset.id} className={`adv-preset${preset.id === activePresetId ? ' is-active' : ''}`}>
              <button
                type="button"
                className="adv-preset-use"
                onClick={() => {
                  setActivePresetId(preset.id);
                  void runRecompute({ presetId: preset.id });
                }}
              >
                {preset.name}
              </button>
              <button type="button" className="adv-preset-edit" title="Rename" onClick={() => void handleRename(preset)}>
                ✎
              </button>
              <button type="button" className="adv-preset-edit" title="Delete" onClick={() => void handleDelete(preset)}>
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="adv-save"
            onClick={() => void savePreset()}
            disabled={selected.size === 0}
          >
            Save selection as preset
          </button>
        </div>

        <div className="adv-picker">
          <input
            className="adv-search"
            type="search"
            placeholder="Search books…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search bookmakers"
          />
          <div className="adv-bulk micro-label">
            <button type="button" onClick={() => selectAll((books ?? []).map((b) => b.key))}>
              select all
            </button>
            <button type="button" onClick={() => selectAll([])}>
              clear
            </button>
            <span>{selected.size} selected</span>
          </div>
          <div className="adv-books">
            {visibleBooks.map((b) => (
              <button
                key={b.key}
                type="button"
                className={`adv-chip${selected.has(b.key) ? ' is-on' : ''}`}
                aria-pressed={selected.has(b.key)}
                onClick={() => toggleBook(b.key)}
              >
                {b.title}
                {b.balance != null && b.balance > 0 && <span className="adv-chip-note">$</span>}
              </button>
            ))}
            {books && visibleBooks.length === 0 && (
              <span className="micro-label">No books match "{search}"</span>
            )}
          </div>
        </div>
      </section>

      <main className="results">
        {error && (
          <div className="state-block state-error" role="alert">
            <p className="state-title">{errorTitle(error.code)}</p>
            <p className="state-detail">{error.message}</p>
            <p className="state-detail">{errorHint(error.code)}</p>
          </div>
        )}

        {!error && result && result.snapshot === null && (
          <div className="state-block">
            <EyeGlyph size={64} state="closed" />
            <p className="state-title">No snapshot yet.</p>
            <p className="state-detail">
              Advanced mode replays the last scan's raw feed. Run one scan on the{' '}
              <Link to="/">scanner</Link> and everything here becomes free to explore.
            </p>
          </div>
        )}

        {!error && result?.snapshot && (
          <>
            <div className="results-head micro-label" aria-live="polite">
              as of scan {relativeTime(result.snapshot.fetchedAt)} ·{' '}
              {result.snapshot.sportsScanned.length} sports · {result.opportunities.length}{' '}
              opportunit{result.opportunities.length === 1 ? 'y' : 'ies'} · recomputed free
            </div>
            {result.opportunities.length === 0 && (
              <div className="state-block">
                <EyeGlyph size={64} state="closed" />
                <p className="state-title">No arbitrage in this book set.</p>
                <p className="state-detail">
                  Widen the selection — an arb needs its best prices to survive the filter.
                </p>
              </div>
            )}
            {result.opportunities.map((arb) => (
              <OpportunityCard
                key={`${arb.eventId}-${arb.marketKey}-${arb.id}`}
                arb={arb}
                bookStatus={bookStatus}
                cockpitLink={arb.id != null && known.has(arb.id)}
              />
            ))}
          </>
        )}
      </main>

      <footer className="footnote micro-label">
        Snapshot data ages — verify prices at the book before staking anything.
      </footer>
    </div>
  );
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
