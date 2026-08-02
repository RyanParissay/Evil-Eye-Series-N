import { AppState, deriveFeedHealth } from '../lib/api';

interface FeedHealthLineProps {
  state: AppState | null;
  now: number;
}

/** §2.2: small feed-health indicator on the TRADES screen — SIM shows a neutral
 *  label, LIVE shows OK/ERROR and time since the last successful fetch, so a
 *  broken feed is never silently indistinguishable from "no opportunities". */
export function FeedHealthLine({ state, now }: FeedHealthLineProps) {
  const feed = deriveFeedHealth(state, now);
  return (
    <div className="feed-health">
      <span className={`feed-chip ${feed.tone}`}>{feed.text}</span>
      {feed.detail && <span className="feed-health-detail">{feed.detail}</span>}
    </div>
  );
}
