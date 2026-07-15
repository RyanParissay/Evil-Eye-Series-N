import { useSettingsView } from '../hooks/useSettingsView';
import { StrategyMixPanel } from '../components/StrategyMixPanel';

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
      </div>
    </main>
  );
}
