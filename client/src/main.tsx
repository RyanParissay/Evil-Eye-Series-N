import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(<div>EVIL EYE V2 — client scaffold</div>);
