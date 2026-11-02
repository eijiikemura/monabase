// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const upstream = require('minimatch-v11');

class Minimatch extends upstream.Minimatch {
  parse(pattern) {
    const part = super.parse(pattern);
    if (part && typeof part === 'object' && typeof part.test === 'function') {
      // glob v7 reads the raw pattern and calls String.match on compiled parts.
      // Keep upstream's nonrecursive matcher instead of converting it to a regex.
      part._glob = part.pattern;
      part[Symbol.match] = value => part.test(value) ? [value] : null;
    }
    return part;
  }
}

// Older tools call require('minimatch') directly; newer tools use named exports.
// Both forms delegate to the same patched implementation without changing options.
module.exports = Object.assign(upstream.minimatch, upstream, { Minimatch });
