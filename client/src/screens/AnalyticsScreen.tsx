import { useCallback, useEffect, useState } from 'react';
import { useAnalytics } from '../hooks/useAnalytics';
import { fetchProfiles } from '../lib/api';
import { fundStartText, type ProfileView, type RangeKey } from '../lib/analytics';
import { ProfileBar } from '../components/ProfileBar';
import { RangeChips } from '../components/RangeChips';

export function AnalyticsScreen() {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>('30D');

  const loadProfiles = useCallback(() => {
    void fetchProfiles().then((ps) => {
      if (ps === null) return;
      setProfiles(ps);
      setProfileId((cur) => cur ?? ps[0]?.id ?? null);
    });
  }, []);
  useEffect(loadProfiles, [loadProfiles]);

  const { view } = useAnalytics(profileId, range);

  if (!view) {
    return (
      <main>
        <div className="empty-note">ANALYTICS OFFLINE — SERVER UNREACHABLE</div>
      </main>
    );
  }
  const fund = fundStartText(view.profile);
  return (
    <main>
      <div className="an-top">
        <ProfileBar
          profiles={profiles}
          currentId={view.profile.id}
          today={view.today}
          onSelect={setProfileId}
          onCreated={(p) => { loadProfiles(); setProfileId(p.id); }}
        />
        <div className="fund-box">
          FUND START <span className="fund-strong">{fund.amount}</span>
          {' · '}
          <span className="fund-strong">{fund.date}</span>
        </div>
      </div>
      <RangeChips range={range} onSelect={setRange} />
    </main>
  );
}
