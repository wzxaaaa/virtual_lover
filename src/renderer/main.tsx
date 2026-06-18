import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserPreviewApi } from './browserPreviewApi';
import './styles.css';

installBrowserPreviewApi();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
