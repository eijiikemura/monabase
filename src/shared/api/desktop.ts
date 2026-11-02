// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { createDesktopClient } from './createDesktopClient';

// One renderer-owned client coordinates requests without mutating Electron APIs.
export const ipcRenderer = createDesktopClient(window.monaBase, loading => {
  window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: loading }));
});

export const subscribeTransactionState = ipcRenderer.subscribeTransactionState;
export const resetGlobalLoading = ipcRenderer.resetGlobalLoading;
export const beginGlobalLoading = ipcRenderer.beginGlobalLoading;
