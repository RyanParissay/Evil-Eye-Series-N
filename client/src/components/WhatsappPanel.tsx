import { useEffect, useState } from 'react';
import { patchSettings, sendWaTest } from '../lib/api';
import { quietHoursText, validWaNumber, type SettingsValues } from '../lib/settings';

interface WhatsappPanelProps {
  s: SettingsValues;
  refresh: () => void;
}

/** §5.5 — VALUES only; actual sending is Plan 6. The number PATCHes on blur when
 *  valid (or cleared); invalid text stays local, the store never holds junk. */
export function WhatsappPanel({ s, refresh }: WhatsappPanelProps) {
  const [number, setNumber] = useState(s.whatsappNumber);
  const [sent, setSent] = useState(false);
  useEffect(() => { setNumber(s.whatsappNumber); }, [s.whatsappNumber]);

  const commit = async () => {
    if (number !== s.whatsappNumber && validWaNumber(number)) {
      await patchSettings({ whatsappNumber: number });
      refresh();
    }
  };
  const test = async () => {
    if (await sendWaTest()) setSent(true);
  };
  return (
    <section className="panel">
      <header className="panel-head">WHATSAPP</header>
      <div className="panel-body">
        <div className="kv-key" style={{ paddingTop: 7 }}>YOUR NUMBER</div>
        <input
          className="wa-input" type="tel" placeholder="+1 604 555 0000" value={number}
          onChange={(e) => { setNumber(e.target.value); }}
          onBlur={() => { void commit(); }}
        />
        <div className="kv"><span className="kv-key">TRANSPORT</span><span className="kv-value">TWILIO · INBOUND POLL 45 S</span></div>
        <div className="kv"><span className="kv-key">REPLY CODES</span><span className="kv-value">1 SECURED · 3 LIMITED</span></div>
        <div className="kv"><span className="kv-key">DETAIL LEVEL</span><span className="kv-value">COMPACT</span></div>
        <div className="kv"><span className="kv-key">QUIET HOURS</span><span className="kv-value">{quietHoursText(s).split(' · ')[0]}</span></div>
        <button className="panel-btn" onClick={() => { setSent(false); void test(); }}>
          {sent ? 'SENT ✓' : 'SEND TEST MESSAGE'}
        </button>
      </div>
    </section>
  );
}
