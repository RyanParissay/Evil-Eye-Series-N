import { formatWhen } from '../lib/format';
import { journalToggle, type BrainView } from '../lib/brain';

const COLLAPSED_ENTRIES = 4; // the mockup's default journal depth

interface BrainJournalProps {
  journal: BrainView['journal'];
  open: boolean;
  onToggle: () => void;
}

export function BrainJournal({ journal, open, onToggle }: BrainJournalProps) {
  const entries = open ? journal.entries : journal.entries.slice(0, COLLAPSED_ENTRIES);
  return (
    <section className="journal">
      <div className="panel-label">BRAIN JOURNAL</div>
      {entries.map((e, i) => (
        <div className="journal-row" key={`${e.ts}-${i}`}>
          <span className="journal-ts">{formatWhen(e.ts)}</span>
          <span>{e.text}</span>
        </div>
      ))}
      {journal.total === 0 && <div className="empty-note">NO ENTRIES YET</div>}
      {journal.total > COLLAPSED_ENTRIES && (
        <button className="journal-toggle list-btn" onClick={onToggle}>
          {journalToggle(journal.total, open)}
        </button>
      )}
    </section>
  );
}
