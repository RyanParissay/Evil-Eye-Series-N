import { useBrain } from '../hooks/useBrain';
import { killSwitchLabel, passTimeLabel } from '../lib/brain';
import { EngineStrip } from '../components/EngineStrip';
import { RationalePanel } from '../components/RationalePanel';

export function BrainScreen() {
  const { brain, refresh } = useBrain();

  if (!brain) {
    return (
      <main>
        <div className="empty-note">BRAIN OFFLINE — SERVER UNREACHABLE</div>
      </main>
    );
  }
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
    </main>
  );
}
