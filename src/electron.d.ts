// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DesktopTransport } from './shared/api/createDesktopClient';
export {};

declare global {
  interface Window {
    monaBase: DesktopTransport;
  }
}
