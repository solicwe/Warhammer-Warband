import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { initCloudPortraits, loadImageManifest } from './ui/portraits';
import './ui/styles.css';

loadImageManifest();
initCloudPortraits();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
