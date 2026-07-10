/**
 * Router shell. `/` is the scan dashboard; `/opportunity/:id` is the
 * execution cockpit that WhatsApp alert deep links open. Pages own their
 * own state and fetching (the WhatsAppPanel model) — there is deliberately
 * no shared store above this level yet.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CockpitPage } from './pages/CockpitPage';
import { ScanPage } from './pages/ScanPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ScanPage />} />
        <Route path="/opportunity/:id" element={<CockpitPage />} />
      </Routes>
    </BrowserRouter>
  );
}
