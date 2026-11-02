// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { simpleGit } = require('simple-git');

const transportConfig = ['http.sslVerify=true', 'http.followRedirects=false'];

async function createGitClient(baseDir, overrides = {}, factory = simpleGit) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_|^(?:EDITOR|VISUAL|PAGER)$/.test(name)));
  // Only the application's temporary index may enter Git's privileged environment.
  if (overrides.GIT_INDEX_FILE) environment.GIT_INDEX_FILE = overrides.GIT_INDEX_FILE;
  const create = config => factory({ baseDir, config, allowEnvironment: ['GIT_INDEX_FILE'] }).env(environment);
  try {
    const probe = create(transportConfig);
    // Names only: never copy credentials or other configuration values into diagnostics.
    const keys = await probe.raw(['config', '--null', '--name-only', '--list']);
    if (typeof keys !== 'string') throw new Error('Invalid Git configuration response.');
    const scoped = new Map();
    for (const key of keys.split('\0').filter(Boolean)) {
      if (/^http\..+\.(?:sslverify|followredirects)$/i.test(key)) {
        const scope = new URL(key.slice(5, key.lastIndexOf('.')));
        if (scope.username || scope.password || scope.search || scope.hash) throw new Error('Unsafe scoped transport key.');
      }
      if (/^http\..+\.sslverify$/i.test(key)) scoped.set(key, `${key}=true`);
      if (/^http\..+\.followredirects$/i.test(key)) scoped.set(key, `${key}=false`);
    }
    // URL-specific settings take precedence over generic ones; override every loaded scope too.
    return create([...transportConfig, ...scoped.values()]);
  } catch {
    throw new Error('security_git_transport_setup_failed');
  }
}
module.exports = { createGitClient };
