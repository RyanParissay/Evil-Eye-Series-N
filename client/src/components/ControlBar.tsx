import type { RegionTabKey } from '../../../shared/regionTabs';
import type { ScanMeta } from '../../../shared/types';
import { AutoScanControl } from './AutoScanControl';
import { RegionTabs } from './RegionTabs';
import { UsagePanel } from './UsagePanel';

interface ControlBarProps {
  topN: number;
  onTopNChange: (n: number) => void;
  regionTab: RegionTabKey;
  onRegionTabChange: (key: RegionTabKey) => void;
  onScan: () => void;
  scanning: boolean;
  lastMeta: ScanMeta | null;
  /** Phase 16: the auto-scan switch drives the server scheduler. */
  schedulerEnabled: boolean;
  onSchedulerToggle: (enabled: boolean) => void;
  schedulerDisabledReason: string | null;
  schedulerBusy: boolean;
}

export function ControlBar({
  topN,
  onTopNChange,
  regionTab,
  onRegionTabChange,
  onScan,
  scanning,
  lastMeta,
  schedulerEnabled,
  onSchedulerToggle,
  schedulerDisabledReason,
  schedulerBusy,
}: ControlBarProps) {
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

        <RegionTabs active={regionTab} onChange={onRegionTabChange} disabled={scanning} />

        <AutoScanControl
          enabled={schedulerEnabled}
          onToggle={onSchedulerToggle}
          disabledReason={schedulerDisabledReason}
          busy={schedulerBusy}
        />
      </div>

      <UsagePanel meta={lastMeta} />
    </div>
  );
}
