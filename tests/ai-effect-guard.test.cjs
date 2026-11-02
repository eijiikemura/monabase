// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { authorizeEffect, scenario, validateProposal, createPaidSession, assertImproved, median } = require('./live-ai/effect.cjs');
const env = { MONABASE_DB_TEST_ALLOW_WRITE: '1', MONABASE_TEST_CONFIG: 'local/db-tests.json' };
const key = 'sk-fictional-effect-test-not-a-real-key';

test('Paid effect checks require explicit approval and dedicated DB write opt-in, and refuse CI', () => {
  assert.doesNotThrow(() => authorizeEffect(['--allow-paid'], env));
  for (const args of [[], ['--allow-paid', '--other']]) assert.throws(() => authorizeEffect(args, env));
  for (const config of [{}, { ...env, MONABASE_DB_TEST_ALLOW_WRITE: '0' }, { ...env, CI: 'true' }]) assert.throws(() => authorizeEffect(['--allow-paid'], config));
});
for (const db of ['postgresql', 'oracle']) test(`${db}: only run-owned reviewed SELECT/index proposals can reach the DB`, () => {
  const spec = scenario(db, db === 'oracle' ? 'TEST' : 'test', 'MBT_012345ABCDEF', 'missing-index');
  const proposal = { query: spec.query, indexSql: `CREATE INDEX ${db === 'oracle' ? '"TEST".' : ''}"${spec.indexName}" ON ${spec.table} ("ID")`, explanation: 'Use selective index access.' };
  assert.equal(validateProposal(JSON.stringify(proposal), spec).query, spec.query);
  assert.equal(validateProposal('```json\n' + JSON.stringify(proposal) + '\n```', spec).query, spec.query);
  assert.throws(() => validateProposal('Explanation before JSON\n' + JSON.stringify(proposal), spec));
  for (const query of [spec.query + '; DELETE FROM x', spec.query.replace('42421', '0'), 'SELECT 1', spec.query + ' UNION SELECT 1,2', spec.query + ' FOR UPDATE']) {
    assert.throws(() => validateProposal(JSON.stringify({ ...proposal, query }), spec));
  }
  for (const indexSql of [proposal.indexSql + '; DROP TABLE x', proposal.indexSql.replace(spec.name, 'EXISTING'), proposal.indexSql.replace(spec.indexName, 'EXISTING'), proposal.indexSql.replace('("ID")', '(dangerous_function("ID"))'), '']) {
    assert.throws(() => validateProposal(JSON.stringify({ ...proposal, indexSql }), spec));
  }
  const rewrite = { ...spec, kind: 'non-sargable' };
  assert.throws(() => validateProposal(JSON.stringify(proposal), rewrite));
  assert.equal(validateProposal(JSON.stringify({ ...proposal, indexSql: '' }), rewrite).indexSql, '');
  assert.throws(() => scenario(db, 'production', 'MBT_012345ABCDEF', 'missing-index'));
  assert.throws(() => scenario(db, 'test', 'EXISTING', 'missing-index'));
});

test('Effect verdict requires actual block reduction, independently of elapsed-time noise', () => {
  assertImproved({ medianBlocks: 1000, medianMs: 10 }, { medianBlocks: 20, medianMs: 11 });
  assert.throws(() => assertImproved({ medianBlocks: 1000, medianMs: 10 }, { medianBlocks: 900, medianMs: 1 }));
  assert.throws(() => assertImproved({ medianBlocks: 1000, medianMs: 10 }, { medianBlocks: 10, medianMs: NaN }));
  for (const value of [-1, 0, NaN, Infinity]) assert.throws(() => assertImproved({ medianBlocks: 1000, medianMs: 10 }, { medianBlocks: value, medianMs: 1 }));
  assert.equal(median([10, 1, 5, 20, 2]), 5);
});

test('Paid effect transport fixes endpoint/model and enforces output and four-request caps', async () => {
  let calls = 0;
  const paid = createPaidSession(key, async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/chat/completions'); assert.equal(options.redirect, 'error');
    const payload = JSON.parse(options.body); assert.equal(payload.model, 'gpt-4o-mini'); assert.equal(payload.max_completion_tokens, 1024);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    for (let i = 0; i < 4; i++) assert.equal((await paid.ask('Synthetic fixture only.')).success, true);
    await assert.rejects(paid.ask('Do not send a fifth HTTP request.'), /ceiling/);
    assert.equal(calls, 4);
  } finally { paid.dispose(); }
});


test('Paid effect responses cannot persist echoed credentials', async () => {
  const paid = createPaidSession(key, async () => new Response(JSON.stringify({ choices: [{ message: { content: key }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } }));
  try { await assert.rejects(paid.ask('Synthetic fixture.'), /must not contain credentials/); }
  finally { paid.dispose(); }
});
