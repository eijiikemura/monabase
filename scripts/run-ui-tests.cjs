// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function run(file) {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.resolve(__dirname, '../tests/e2e', file)], { env, stdio: 'inherit' });
    child.on('error', () => reject(new Error('Could not launch Electron UI tests.')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Electron UI tests failed: ${file} (${code}).`)));
  });
}
(async () => {
  await run('progress.cjs');
  await run('ipc-security.cjs');
  await run('settings.cjs');
  await run('sidebar.cjs');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
