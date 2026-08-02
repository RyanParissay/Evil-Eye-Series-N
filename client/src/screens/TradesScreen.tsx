import { useState } from 'react';
import { AppState } from '../lib/api';
import { FeedHealthLine } from '../components/FeedHealthLine';
import { LiveCard } from '../components/LiveCard';
import { PendingCard } from '../components/PendingCard';
import { ViewAll } from '../components/ViewAll';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const [limitedOpenId, setLimitedOpenId] = useState<string | null>(null);
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <FeedHealthLine state={state} now={now} />
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.length === 0 && <div className="empty-note">NOTHING VERIFIED RIGHT NOW</div>}
      {verified.map((t) => (
        <LiveCard
          key={t.id}
          trade={t}
          now={now}
          refresh={refresh}
          limitedOpen={limitedOpenId === t.id}
          onToggleLimited={() => setLimitedOpenId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
      {pending.length === 0 && <div className="empty-note">NO CANDIDATES IN VERIFICATION</div>}
      {pending.map((t) => (
        <PendingCard key={t.id} trade={t} now={now} />
      ))}
      <ViewAll killedToday={state?.counts.killedToday ?? 0} />
    </main>
  );
}
