// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

// Record labels and timing only. Never accept URLs, settings, errors or IPC payloads.
function createStartupDiagnostics({ started = performance.now(), now = () => performance.now(), io = fs, pid = process.pid } = {}) {
  const pending = [];
  let file;
  let count = 0;
  let disabled = false;
  function mark(stage) {
    if (disabled || ++count > 160) return;
    const entry = JSON.stringify({ time: new Date().toISOString(), pid, elapsedMs: Math.round((now() - started) * 100) / 100, stage });
    if (!file) { pending.push(entry); return; }
    try { io.appendFileSync(file, `${entry}\n`, { mode: 0o600 }); }
    catch { disabled = true; }
  }
  function attach(app) {
    try {
      const directory = app.getPath('logs');
      io.mkdirSync(directory, { recursive: true });
      file = path.join(directory, 'startup.jsonl');
      // Bound diagnostic disk use across launches, retaining one previous log.
      if (io.existsSync(file) && io.statSync(file).size > 1024 * 1024) {
        io.renameSync(file, path.join(directory, 'startup.previous.jsonl'));
      }
      io.appendFileSync(file, `${pending.join('\n')}\n`, { mode: 0o600 });
      pending.length = 0;
      mark(`runtime:${process.platform}:${process.arch}:${app.isPackaged ? 'packaged' : 'development'}`);
      app.once('browser-window-created', (_event, window) => {
        for (const event of ['ready-to-show', 'show', 'unresponsive']) window.on(event, () => mark(`window:${event}`));
        for (const event of ['dom-ready', 'did-finish-load', 'did-fail-load', 'render-process-gone']) {
          window.webContents.on(event, () => mark(`webContents:${event}`));
        }
      });
    } catch { disabled = true; }
  }
  function measure(stage, operation) {
    mark(`${stage}:begin`);
    try { return operation(); }
    finally { mark(`${stage}:end`); }
  }
  return { mark, attach, measure };
}

module.exports = { createStartupDiagnostics };
