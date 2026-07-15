import { healthBadge, heatCell, sitesToggle, type BrainBookView } from '../lib/brain';

const COLLAPSED_ROWS = 5;

interface SiteTableProps {
  books: BrainBookView[];
  selected: string;
  onSelect: (name: string) => void;
  expanded: boolean;
  onToggle: () => void;
}

export function SiteTable({ books, selected, onSelect, expanded, onToggle }: SiteTableProps) {
  const rows = expanded ? books : books.slice(0, COLLAPSED_ROWS);
  return (
    <div className="site-table">
      <div className="site-head">
        <span>SITE</span>
        <span>ITS SPORT</span>
        <span>HEALTH</span>
        <span>HEAT</span>
      </div>
      {rows.map((b) => {
        const badge = healthBadge(b);
        const isSelected = selected === b.name;
        return (
          <div
            key={b.name}
            className={`site-row${isSelected ? ' selected' : ''}`}
            onClick={() => onSelect(b.name)}
          >
            <span className="site-name">{b.displayName}{isSelected ? ' ◂' : ''}</span>
            <span className="site-sport">{b.sport.toUpperCase()}</span>
            <span className={`health-badge ${badge.tone}`}>{badge.label}</span>
            <span className="site-heat">{heatCell(b)}</span>
          </div>
        );
      })}
      <button className="sites-toggle" onClick={onToggle}>
        {sitesToggle(books.length, expanded)}
      </button>
    </div>
  );
}
