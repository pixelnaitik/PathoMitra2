import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Static brochure entry. No service worker, no data store bootstrap, no
// appearance/settings local reads — none of the app's session or on-device
// persistence is reachable from this build. The only side effect before React
// mounts is the inline colour-mode script in index.html.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
