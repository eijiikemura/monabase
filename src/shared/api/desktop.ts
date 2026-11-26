// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { rememberStoredExecution, clearQualitySession } from '@/features/quality/qualitySession';
import type { StoredRequest, StoredData } from './desktopContract';
import { createDesktopClient } from './createDesktopClient';

// One renderer-owned client coordinates requests without mutating Electron APIs.
export const ipcRenderer = createDesktopClient(window.monaBase, loading => {
  window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: loading }));
}, (channel, args, response) => {
  if (channel === 'disconnect-db' || channel === 'connect-db') clearQualitySession();
  if (channel === 'execute-stored' && response && typeof response === 'object' && 'success' in response && response.success === true) {
    rememberStoredExecution(args[0] as StoredRequest, response as StoredData);
  }
});

export const subscribeTransactionState = ipcRenderer.subscribeTransactionState;
export const resetGlobalLoading = ipcRenderer.resetGlobalLoading;
export const beginGlobalLoading = ipcRenderer.beginGlobalLoading;
