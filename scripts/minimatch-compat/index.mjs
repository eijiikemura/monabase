// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import bridge from './index.cjs';

// Share constructors and the GLOBSTAR symbol across ESM and CommonJS consumers.
export const { minimatch, Minimatch, GLOBSTAR, sep, filter, defaults, braceExpand, escape, unescape } = bridge;
const matchFiles = bridge.match;
export { matchFiles as match };
export default bridge;
