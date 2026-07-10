/**
 * Bookmaker configuration: the registry the feed populates, with the manual
 * operational fields — enabled, balance, status, notes. Collapsed by
 * default; the row inputs PATCH on change (toggles/selects) or on blur
 * (balance, notes). App owns the list so opportunity cards share it.
 */
import { useState } from 'react';
import type { BookmakerConfig, BookmakerStatusValue } from '../../../shared/types';
import type { BookmakerPatchBody } from '../api';

interface BookmakerPanelProps {
  books: BookmakerConfig[] | null;
  onPatch: (key: string, patch: BookmakerPatchBody) => Promise<void>;
}

export function BookmakerPanel({ books, onPatch }: BookmakerPanelProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledCount = books?.filter((b) => b.enabled).length ?? 0;

  async function patch(key: string, body: BookmakerPatchBody) {
    setError(null);
    try {
      await onPatch(key, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    }
  }

  return (
    <section className="bm-panel" aria-label="Bookmaker configuration">
      <button
        type="button"
        className="bm-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="micro-label">Bookmakers</span>
        <span className="bm-summary micro-label">
          {books === null
            ? '…'
            : books.length === 0
              ? 'none yet'
              : `${enabledCount}/${books.length} enabled`}
        </span>
        <span className="bm-chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && books !== null && books.length === 0 && (
        <p className="wa-note">
          No bookmakers yet — run a scan and this list populates itself from the odds feed.
        </p>
      )}

      {open && books !== null && books.length > 0 && (
        <div className="bm-scroll">
          <table className="bm-table">
            <thead>
              <tr className="micro-label">
                <th>On</th>
                <th>Book</th>
                <th>Status</th>
                <th>Balance $</th>
                <th>Notes</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {books.map((book) => (
                <BookmakerRow key={book.key} book={book} onPatch={patch} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <p className={`wa-note${error ? ' wa-note-error' : ''}`}>
          {error ??
            'Disabled books are excluded from fetching and detection. Limited/dead books stay visible with a warning but never alert. Fewer than 10 enabled books makes scans cheaper.'}
        </p>
      )}
    </section>
  );
}

function BookmakerRow({
  book,
  onPatch,
}: {
  book: BookmakerConfig;
  onPatch: (key: string, patch: BookmakerPatchBody) => Promise<void>;
}) {
  // Text fields buffer locally and PATCH on blur; toggles PATCH immediately.
  const [balance, setBalance] = useState(book.balance == null ? '' : String(book.balance));
  const [notes, setNotes] = useState(book.notes);

  function commitBalance() {
    const trimmed = balance.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setBalance(book.balance == null ? '' : String(book.balance));
      return;
    }
    if (next !== book.balance) void onPatch(book.key, { balance: next });
  }

  function commitNotes() {
    if (notes.trim() !== book.notes) void onPatch(book.key, { notes: notes.trim() });
  }

  return (
    <tr className={book.enabled ? '' : 'bm-row-disabled'}>
      <td>
        <button
          type="button"
          role="switch"
          aria-checked={book.enabled}
          aria-label={`${book.title} enabled`}
          className="switch switch-small"
          onClick={() => void onPatch(book.key, { enabled: !book.enabled })}
        >
          <span className="switch-thumb" aria-hidden="true" />
        </button>
      </td>
      <td className="bm-book">
        {book.title}
        {book.status !== 'active' && (
          <span className="chip chip-warn bm-status-chip">⚠ {book.status}</span>
        )}
      </td>
      <td>
        <select
          className="wa-input bm-input"
          value={book.status}
          aria-label={`${book.title} status`}
          onChange={(e) =>
            void onPatch(book.key, { status: e.currentTarget.value as BookmakerStatusValue })
          }
        >
          <option value="active">active</option>
          <option value="limited">limited</option>
          <option value="dead">dead</option>
        </select>
      </td>
      <td>
        <input
          type="number"
          min={0}
          step={0.01}
          className="wa-input bm-input bm-input-balance"
          placeholder="—"
          aria-label={`${book.title} balance`}
          value={balance}
          onChange={(e) => setBalance(e.currentTarget.value)}
          onBlur={commitBalance}
        />
      </td>
      <td>
        <input
          type="text"
          className="wa-input bm-input bm-input-notes"
          placeholder="—"
          aria-label={`${book.title} notes`}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          onBlur={commitNotes}
        />
      </td>
      <td className="bm-seen micro-label">{formatSeen(book.lastSeenAt)}</td>
    </tr>
  );
}

function formatSeen(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}
