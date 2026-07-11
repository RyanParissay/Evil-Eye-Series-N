/**
 * Router shell. `/` is the scan dashboard; `/opportunity/:id` is the
 * execution cockpit that WhatsApp alert deep links open. Pages own their
 * own state and fetching (the WhatsAppPanel model) — there is deliberately
 * no shared store above this level yet.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AdvancedPage } from './pages/AdvancedPage';
import { CockpitPage } from './pages/CockpitPage';
import { LedgerPage } from './pages/LedgerPage';
import { RiskModePage } from './pages/RiskModePage';
import { ScanPage } from './pages/ScanPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ScanPage />} />
        <Route path="/advanced" element={<AdvancedPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/risk" element={<RiskModePage />} />
        <Route path="/opportunity/:id" element={<CockpitPage />} />
      </Routes>
    </BrowserRouter>
  );
}
