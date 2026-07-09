import type { ScanMeta } from '../../../shared/types';
import { UsagePanel } from './UsagePanel';

interface ControlBarProps {
  topN: number;
  onTopNChange: (n: number) => void;
  onScan: () => void;
  scanning: boolean;
  lastMeta: ScanMeta | null;
}

export function ControlBar({ topN, onTopNChange, onScan, scanning, lastMeta }: ControlBarProps) {
  return (
    <div className="control-bar">
      <div className="controls">
        <button className="scan-button" onClick={onScan} disabled={scanning}>
          {scanning ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Scanning
            </>
          ) : (
            'Run scan'
          )}
        </button>

        <div className="slider-block">
          <label
            className="micro-label"
            htmlFor="topn"
            title="Lower = cheaper, narrower scan. Higher = deeper, costlier scan. The slider sets how many sports are scanned (each sport costs markets × regions credits) and caps the results list."
          >
            Top N · breadth <span className="slider-value">{topN}</span>
          </label>
          <input
            id="topn"
            type="range"
            min={1}
            max={10}
            step={1}
            value={topN}
            disabled={scanning}
            onChange={(e) => onTopNChange(Number(e.currentTarget.value))}
          />
          <div className="slider-scale" aria-hidden="true">
            <span>cheap</span>
            <span>deep</span>
          </div>
        </div>
      </div>

      <UsagePanel meta={lastMeta} />
    </div>
  );
}
