import { RANGE_KEYS, type RangeKey } from '../lib/analytics';

interface RangeChipsProps {
  range: RangeKey;
  onSelect: (r: RangeKey) => void;
}

export function RangeChips({ range, onSelect }: RangeChipsProps) {
  return (
    <div className="chip-group">
      {RANGE_KEYS.map((r) => (
        <button key={r} className={`chip${r === range ? ' active' : ''}`} onClick={() => onSelect(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}
