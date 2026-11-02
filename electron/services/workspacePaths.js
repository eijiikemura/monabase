// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');

// Treat database identifiers as single filenames on every supported OS.
function workspacePath(root, ...segments) {
  for (const segment of segments) {
    if (typeof segment !== 'string' || !segment || segment === '.' || segment === '..' ||
        /[\\/<>:"|?*]/.test(segment) || [...segment].some(character => character.charCodeAt(0) < 32) || /[. ]$/.test(segment) ||
        segment.toLowerCase() === '.git' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) {
      throw new Error('Invalid workspace path component');
    }
  }
  const base = path.resolve(root);
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      // Reject links, including dangling links and Windows junctions, before I/O.
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error('Symbolic links are not allowed in workspace paths');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

function workspaceRelativePath(root, ...segments) {
  return path.relative(path.resolve(root), workspacePath(root, ...segments)).split(path.sep).join('/');
}

module.exports = { workspacePath, workspaceRelativePath };
