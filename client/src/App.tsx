import { useState } from 'react';
import { Header } from './components/Header';
import { Nav, type Tab } from './components/Nav';
import { StatusLine } from './components/StatusLine';
import { useAppState } from './hooks/useAppState';
import { useTick } from './hooks/useTick';
import { deriveStatusLine } from './lib/api';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { BrainScreen } from './screens/BrainScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TradesScreen } from './screens/TradesScreen';

export function App() {
  const [tab, setTab] = useState<Tab>('TRADES');
  const { state, refresh } = useAppState();
  const now = useTick(); // the single shared 1s tick
  const { modeLabel } = deriveStatusLine(state);

  return (
    <div className="page">
      <Header modeLabel={modeLabel} />
      <Nav tab={tab} onSelect={setTab} />
      <StatusLine state={state} />
      {tab === 'TRADES' && <TradesScreen state={state} now={now} refresh={refresh} />}
      {tab === 'BRAIN' && <BrainScreen />}
      {tab === 'ANALYTICS' && <AnalyticsScreen />}
      {tab === 'SETTINGS' && <SettingsScreen />}
    </div>
  );
}
