// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export function assessAudit(report, policy, { lock, output, now = new Date() }) {
  assert.ok(report?.auditReportVersion === 2 && report.vulnerabilities && !report.error, 'Invalid npm audit report');
  assert.ok(Number.isInteger(report.metadata?.vulnerabilities?.total), 'Missing audit result totals');
  const vulnerabilities = report.vulnerabilities;
  const blocked = [], accepted = [];
  const active = new Set();
  const permitted = name => {
    const item = vulnerabilities[name];
    if (!item || active.has(name) || !Array.isArray(item.via) || !item.via.length) return false;
    active.add(name);
    const allowed = item.via.every(via => {
      if (typeof via === 'string') return permitted(via);
      if (!via || via.name !== policy.package || via.url !== policy.advisory || via.severity !== 'high' || via.range !== '<=4.0.7') return false;
      if (output !== 'static' || !Number.isFinite(Date.parse(policy.expiresAt)) || now.getTime() >= Date.parse(policy.expiresAt)) return false;
      if (!Array.isArray(item.nodes) || !item.nodes.length) return false;
      return item.name === policy.package && item.nodes.every(node => {
        const entry = lock.packages[node];
        return entry && !entry.link && policy.versions.includes(entry.version);
      });
    });
    active.delete(name);
    return allowed;
  };
  for (const [name, item] of Object.entries(vulnerabilities)) {
    if (!['info', 'low', 'moderate', 'high', 'critical'].includes(item.severity)) throw new Error('Unknown vulnerability severity');
    if (['info', 'low'].includes(item.severity)) continue;
    if (permitted(name)) accepted.push(name);
    else blocked.push(name);
  }
  assert.ok(report.metadata.vulnerabilities.total === Object.keys(vulnerabilities).length, 'Inconsistent audit result totals');
  return { blocked, accepted };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run this check with npm run audit:security');
  const result = spawnSync(process.execPath, [npm, 'audit', '--json'], { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 10 * 1024 * 1024 });
  assert.ok(!result.error && [0, 1].includes(result.status), 'npm audit could not complete');
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('npm audit returned invalid JSON'); }
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'security-audit-policy.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const { default: config } = await import('../astro.config.mjs');
  const assessment = assessAudit(report, policy, { lock, output: config.output });
  if (assessment.accepted.length) console.log(`Temporary accepted advisory: ${policy.advisory}; ${assessment.accepted.length} dependency entries; expires ${policy.expiresAt}. Static website build only; this is not a zero-vulnerability audit.`);
  if (assessment.blocked.length) throw new Error('Unaccepted security findings: ' + assessment.blocked.join(', '));
  console.log('No unaccepted moderate/high/critical security findings.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
