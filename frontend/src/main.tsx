import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { ToastProvider } from './components/feedback/ToastContext';
import ToastViewport from './components/feedback/ToastViewport';
import './styles/global.css';
import './styles/theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
        <ToastViewport />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
