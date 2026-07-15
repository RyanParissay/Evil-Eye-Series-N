import { patchSettings, postBrainPass } from '../lib/api';
import {
  consolidationText, heatWeightsValue, killSwitchValue, lastDigestText,
  llmBudgetText, type SettingsValues, type SettingsView,
} from '../lib/settings';

interface BrainPanelProps {
  s: SettingsValues;
  brain: SettingsView['brain'];
  now: number;
  refresh: () => void;
}

export function BrainPanel({ s, brain, now, refresh }: BrainPanelProps) {
  const toggleKill = async () => {
    await patchSettings({ brainKillSwitch: s.brainKillSwitch === 0 ? 1 : 0 });
    refresh();
  };
  const updateUnderstanding = async () => {
    await postBrainPass(); // runs even under the kill switch — an explicit user ask
    refresh();
  };
  const on = s.brainKillSwitch !== 0;
  return (
    <section className="panel">
      <header className="panel-head">BRAIN</header>
      <div className="panel-body">
        <div className="kv"><span className="kv-key">HEAT WEIGHTS</span><span className="kv-value">{heatWeightsValue(s, brain.weightsCustom)}</span></div>
        <div className="kv"><span className="kv-key">CONSOLIDATION PASS</span><span className="kv-value">{consolidationText(s)}</span></div>
        <div className="kv"><span className="kv-key">LLM BUDGET</span><span className="kv-value">{llmBudgetText(brain)}</span></div>
        <div className="kv">
          <span className="kv-key">KILL SWITCH</span>
          <button className={`toggle-chip${on ? ' on' : ''}`} onClick={() => { void toggleKill(); }}>
            {killSwitchValue(s)}
          </button>
        </div>
        <div className="kv"><span className="kv-key">LAST DIGEST</span><span className="kv-value">{lastDigestText(brain.lastPassAt, brain.lastPassBooks, now)}</span></div>
        <button className="panel-btn" onClick={() => { void updateUnderstanding(); }}>UPDATE UNDERSTANDING</button>
      </div>
    </section>
  );
}
