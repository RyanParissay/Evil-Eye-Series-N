import { REGION_TABS, type RegionTabKey } from '../../../shared/regionTabs';

interface RegionTabsProps {
  active: RegionTabKey;
  onChange: (key: RegionTabKey) => void;
  disabled: boolean;
}

/**
 * Accessibility tabs: each maps to a minimal Odds API region set (the
 * credit dial) and a Canadian-accessible bookmaker allowlist (the filter).
 */
export function RegionTabs({ active, onChange, disabled }: RegionTabsProps) {
  const activeTab = REGION_TABS.find((t) => t.key === active);
  return (
    <div className="region-tabs-block">
      <span className="micro-label">Books · Canadian access</span>
      <div className="region-tabs" role="tablist" aria-label="Bookmaker regions">
        {REGION_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={tab.key === active}
            className={tab.key === active ? 'region-tab region-tab-active' : 'region-tab'}
            disabled={disabled}
            onClick={() => onChange(tab.key)}
            title={`${tab.description}\nBooks: ${tab.allowedBookmakers.join(', ')}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab && <span className="region-tab-hint">{activeTab.description}</span>}
    </div>
  );
}
