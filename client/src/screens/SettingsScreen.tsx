import { useSettingsView } from '../hooks/useSettingsView';
import { StrategyMixPanel } from '../components/StrategyMixPanel';
import { ScanRulesPanel } from '../components/ScanRulesPanel';
import { RiskBankrollPanel } from '../components/RiskBankrollPanel';
import { BrainPanel } from '../components/BrainPanel';
import { WhatsappPanel } from '../components/WhatsappPanel';
import { DataPanel } from '../components/DataPanel';
import { AdvancedSettings } from '../components/AdvancedSettings';

export function SettingsScreen() {
  const { view, refresh } = useSettingsView();

  if (!view) {
    return (
      <main>
        <div className="empty-note">SETTINGS OFFLINE — SERVER UNREACHABLE</div>
      </main>
    );
  }
  return (
    <main>
      <div className="settings-grid">
        <StrategyMixPanel s={view.settings} refresh={refresh} />
        <ScanRulesPanel s={view.settings} forecaster={view.forecaster} refresh={refresh} />
        <RiskBankrollPanel s={view.settings} refresh={refresh} />
        <BrainPanel s={view.settings} brain={view.brain} now={Date.now()} refresh={refresh} />
        <WhatsappPanel s={view.settings} refresh={refresh} />
        <DataPanel backups={view.backups} mode={view.mode} refresh={refresh} />
      </div>
      <AdvancedSettings view={view} now={Date.now()} refresh={refresh} />
    </main>
  );
}
