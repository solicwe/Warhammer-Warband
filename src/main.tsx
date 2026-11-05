import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { initCloudPortraits, loadImageManifest } from './ui/portraits';
import { initTheme } from './ui/theme';
import './ui/styles.css';

initTheme();
loadImageManifest();
initCloudPortraits();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
