import { useCallback, useEffect, useState } from 'react';
import { useAnalytics } from '../hooks/useAnalytics';
import { fetchProfiles } from '../lib/api';
import { bankrollFootnote, fundStartText, type ProfileView, type RangeKey } from '../lib/analytics';
import { ProfileBar } from '../components/ProfileBar';
import { RangeChips } from '../components/RangeChips';
import { ProfitChart } from '../components/ProfitChart';
import { MonthlyTable } from '../components/MonthlyTable';
import { TimeToActFunnel } from '../components/TimeToActFunnel';
import { AdvancedAnalytics } from '../components/AdvancedAnalytics';

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
      <ProfitChart title="CONFIRMED — PROFIT ($)" data={view.confirmed} />
      <ProfitChart
        title="ALL (CONFIRMED + UNCONFIRMED) — IF EVERY PICK WAS FOLLOWED ($)"
        data={view.all}
      />
      <p className="bankroll-note">{bankrollFootnote(view.bankrollCents)}</p>
      <MonthlyTable rows={view.monthly} />
      <TimeToActFunnel funnel={view.funnel} />
      <AdvancedAnalytics adv={view.advanced} since={view.advanced.leaderboards.since} />
      {view.simulated && (
        <p className="sim-footnote">
          EVERY FIGURE ON THIS PAGE IS SIMULATED PAPER MONEY — A SHADOW POSITION, NOT A LIVE PROMISE.
        </p>
      )}
    </main>
  );
}
