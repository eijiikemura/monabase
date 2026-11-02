// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './i18n';
import { startRendererFocusDiagnostics } from '@/shared/utils/focusDiagnostics';

const stopFocusDiagnostics = startRendererFocusDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(stopFocusDiagnostics);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
