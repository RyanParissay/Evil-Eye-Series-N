import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(<div className="page">EVIL EYE V2 — client scaffold</div>);
