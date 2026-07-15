export type Tab = 'TRADES' | 'BRAIN' | 'ANALYTICS' | 'SETTINGS';

const TABS: Tab[] = ['TRADES', 'BRAIN', 'ANALYTICS', 'SETTINGS'];

interface NavProps {
  tab: Tab;
  onSelect: (t: Tab) => void;
}

export function Nav({ tab, onSelect }: NavProps) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <button key={t} className={t === tab ? 'active' : ''} onClick={() => onSelect(t)}>
          {t}
        </button>
      ))}
    </nav>
  );
}
