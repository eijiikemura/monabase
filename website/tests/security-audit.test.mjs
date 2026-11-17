// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { assessAudit } from '../scripts/audit-security.mjs';
const policy = JSON.parse(fs.readFileSync(new URL('../security-audit-policy.json', import.meta.url)));
const advisory = { name: 'picomatch', url: policy.advisory, severity: 'high', range: '<=4.0.7' };
const fixture = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
  picomatch: { name: 'picomatch', severity: 'high', via: [{ ...advisory }], nodes: ['node_modules/picomatch'] },
  astro: { name: 'astro', severity: 'high', via: ['picomatch'], nodes: ['node_modules/astro'] },
} });
const options = () => ({ now: new Date('2026-11-18T00:00:00Z'), output: 'static', lock: { packages: { 'node_modules/picomatch': { version: '4.0.7' } } } });

test('Security audit accepts only the approved advisory and its complete dependency paths', () => {
  assert.deepEqual(assessAudit(fixture(), policy, options()), { blocked: [], accepted: ['picomatch', 'astro'] });
  const report = fixture(); report.vulnerabilities.astro.via.push({ name: 'astro', url: 'https://github.com/advisories/GHSA-new-issue', severity: 'moderate' });
  assert.deepEqual(assessAudit(report, policy, options()).blocked, ['astro']);
  report.vulnerabilities.picomatch.via[0].url = 'https://github.com/advisories/GHSA-another-issue';
  assert.deepEqual(assessAudit(report, policy, options()).blocked, ['picomatch', 'astro']);
});
test('Security audit blocks expired, nonstatic, unreviewed-version and unknown dependency cases', () => {
  for (const change of [
    opts => { opts.now = new Date(policy.expiresAt); },
    opts => { opts.output = 'server'; },
    opts => { opts.lock.packages['node_modules/picomatch'].version = '4.0.8'; },
  ]) { const opts = options(); change(opts); assert.equal(assessAudit(fixture(), policy, opts).blocked.length, 2); }
  for (const change of [
    report => { report.vulnerabilities.astro.via = ['missing']; },
    report => { report.vulnerabilities.astro.via = ['astro']; },
  ]) { const report = fixture(); change(report); assert.ok(assessAudit(report, policy, options()).blocked.includes('astro')); }
});
test('Security audit fails closed on service errors or malformed results and permits a genuinely clean report', () => {
  for (const report of [{}, { error: { code: 'ENOTFOUND' } }, { ...fixture(), error: {} }]) assert.throws(() => assessAudit(report, policy, options()));
  const report = fixture(); report.metadata.vulnerabilities.total = 0;
  assert.throws(() => assessAudit(report, policy, options()), /Inconsistent/);
  assert.deepEqual(assessAudit({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }, policy, options()), { blocked: [], accepted: [] });
});
