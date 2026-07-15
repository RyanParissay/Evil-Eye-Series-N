import { useState } from 'react';
import { useBrain } from '../hooks/useBrain';
import { killSwitchLabel, passTimeLabel } from '../lib/brain';
import { BrainJournal } from '../components/BrainJournal';
import { EngineStrip } from '../components/EngineStrip';
import { RationalePanel } from '../components/RationalePanel';
import { SiteDetail } from '../components/SiteDetail';
import { SiteTable } from '../components/SiteTable';
import { StrategyPerformance } from '../components/StrategyPerformance';

export function BrainScreen() {
  const { brain, refresh } = useBrain();
  const [selectedSite, setSelectedSite] = useState('betmgm');
  const [allSites, setAllSites] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);

  if (!brain) {
    return (
      <main>
        <div className="empty-note">BRAIN OFFLINE — SERVER UNREACHABLE</div>
      </main>
    );
  }
  const selected = brain.books.find((b) => b.name === selectedSite) ?? brain.books[0];

  return (
    <main>
      <div className="brain-header">
        <span className="brain-title">BRAIN</span>
        <span className="brain-meta">
          {passTimeLabel(brain.lastFullPassAt)}
          <span className="kill-chip">{killSwitchLabel(brain.killSwitch)}</span>
        </span>
      </div>
      <EngineStrip brain={brain} refresh={refresh} />
      <RationalePanel r={brain.rationale} />
      <SiteTable
        books={brain.books}
        selected={selectedSite}
        onSelect={setSelectedSite}
        expanded={allSites}
        onToggle={() => setAllSites((v) => !v)}
      />
      {selected && <SiteDetail book={selected} />}
      <StrategyPerformance grades={brain.grades} />
      <BrainJournal
        journal={brain.journal}
        open={journalOpen}
        onToggle={() => setJournalOpen((v) => !v)}
      />
    </main>
  );
}
