import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/main.css';
import './styles/app.css';
import './styles/components.css';
import { applyStoredTheme } from '@/utils/theme-manager';
import { setupCustomAlert } from '@/utils/alert';

applyStoredTheme();
setupCustomAlert();

requestAnimationFrame(() => {
  document.documentElement.classList.remove('no-transition');
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
