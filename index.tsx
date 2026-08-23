/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './contexts/ToastContext';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement); 
root.render(
  <React.StrictMode>
    {/*
      Provides the app's only channel for telling the user something went wrong.
      Before this, roughly two dozen user-facing messages went to console.warn —
      so failing validation (no hero portrait, bad file type) produced no visible
      response at all, and buttons looked broken.
    */}
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
