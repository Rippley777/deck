import { startAnalytics } from './lib/analytics';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-500.css';
import './styles.css';
import App from './App';
import { Portal } from './features/account/Portal';
startAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Portal>
      <App />
    </Portal>
  </React.StrictMode>,
);
