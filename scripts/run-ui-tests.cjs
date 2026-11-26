// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function run(file, overrides = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.resolve(__dirname, '../tests/e2e', file)], { env: { ...env, ...overrides }, stdio: 'inherit' });
    child.on('error', () => reject(new Error('Could not launch Electron UI tests.')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Electron UI tests failed: ${file} (${code}).`)));
  });
}
async function runDevelopmentWorkspace() {
  const { createServer } = await import('vite');
  // Use an independent port/cache so running tests never takes over the user's dev server.
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-vite-ui-'));
  let server;
  try {
    server = await createServer({ root: path.resolve(__dirname, '..'), cacheDir, clearScreen: false,
      optimizeDeps: { entries: [path.resolve(__dirname, '../index.html')] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, open: false } });
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Development UI test server has no TCP port.');
    await run('mysql.cjs', { MONABASE_MYSQL_UI_DEV: '1', MONABASE_MYSQL_UI_DEV_ORIGIN: `http://127.0.0.1:${address.port}` });
  } finally {
    await server?.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}
(async () => {
  if (!process.argv.includes('--development-only')) {
    await run('progress.cjs');
    await run('ipc-security.cjs');
    await run('settings.cjs');
    await run('quality.cjs');
    await run('sidebar.cjs');
    await run('mysql.cjs');
  }
  await runDevelopmentWorkspace();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
