// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createTypeHarness } = require('./helpers/typeData.cjs');
const definition = loadTypeScript('src/features/postgresql/typeDefinition.ts', { '@/shared/api/desktop': {} });
const { parsePostgresType, postgresTypeSource, planPostgresTypeChanges } = definition;
const plain = value => JSON.parse(JSON.stringify(value));
const enumeration = (labels, identity = {}) => ({ schema: 'test', objectName: 'DemoType', kind: 'enum', labels, ...identity });

test('Enum source round-trips quotes, semicolons, comment markers, backslashes, newlines and Unicode', () => {
  const original = enumeration(["can't", 'semi;colon', '-- text /* remains data */', 'back\\slash', 'two\nlines', '日本語', '$tag$quoted$tag$', ''], { schema: "Team's Data", objectName: 'Odd"Type' });
  const source = postgresTypeSource(original);
  assert.deepEqual(plain(parsePostgresType(source, 'unused')), original);
  assert.match(source, /can''t/); assert.match(source, /"Odd""Type"/);
});
test('Type parsing shares script boundaries for comments, dollar literals and numeric typmods', () => {
  assert.deepEqual(plain(parsePostgresType('/* head */ CREATE TYPE demo AS ENUM ($label$semi;colon$label$, \'--comment\'); -- tail', 'test')).labels, ['semi;colon', '--comment']);
  const source = 'CREATE TYPE "test"."DemoType" AS ("a" numeric(10, 2), "b" timestamp(3) with time zone, "c" "Case"."T"[])';
  const parsed = parsePostgresType(source, 'test');
  assert.equal(parsed.attributes.length, 3); assert.match(parsed.attributes[0].typeSql, /10 , 2/);
});
test('Malformed, multiple, procedural and destructive type definitions are rejected before planning', () => {
  for (const source of [
    'CREATE TYPE x AS ENUM (\'a\'); DROP TABLE private_data;', 'DROP TYPE x CASCADE', 'ALTER TYPE x ADD VALUE \'a\'',
    "CREATE TYPE x AS ENUM ('a', 'a')", "CREATE TYPE x AS ENUM ('unterminated'')", "CREATE TYPE x AS ENUM ('a') SELECT 1)",
    'CREATE TYPE x AS (a int CASCADE)', 'CREATE TYPE x AS (a numeric(10,2)', 'CREATE TYPE x AS (a int,)', 'CREATE TYPE x AS (a int, a text)'
  ]) assert.throws(() => parsePostgresType(source, 'test'), /definition_invalid/, source);
});
test('Enum additions preserve all existing values and ordering without DROP or CASCADE', () => {
  const before = enumeration(['a', 'c']);
  const plan = planPostgresTypeChanges(before, enumeration(['first', 'a', "can't;stop", 'c', 'last']));
  assert.deepEqual(Array.from(plan), [
    'ALTER TYPE "test"."DemoType" ADD VALUE \'first\' BEFORE \'a\'',
    'ALTER TYPE "test"."DemoType" ADD VALUE \'can\'\'t;stop\' BEFORE \'c\'',
    'ALTER TYPE "test"."DemoType" ADD VALUE \'last\''
  ]);
  assert.ok(plan.every(sql => !/DROP|CASCADE/.test(sql)));
  assert.deepEqual(Array.from(planPostgresTypeChanges(before, before)), []);
});
test('Enum removal, inferred rename, reorder and identity changes are refused', () => {
  for (const labels of [['a'], ['b', 'c'], ['c', 'a']]) assert.throws(() => planPostgresTypeChanges(enumeration(['a', 'c']), enumeration(labels)), /unsupported_change/);
  assert.throws(() => planPostgresTypeChanges(enumeration(['a']), enumeration(['a'], { objectName: 'Other' })), /identity_change/);
});
test('Composite additions use one restricted statement and refuse rewrites of existing attributes', () => {
  const before = parsePostgresType('CREATE TYPE "test"."DemoType" AS ("a" numeric(10,2))', 'test');
  const desired = parsePostgresType('CREATE TYPE "test"."DemoType" AS ("a" NUMERIC (10, 2), "new" text, "other" integer)', 'test');
  const plan = planPostgresTypeChanges(before, desired);
  assert.equal(plan.length, 1); assert.match(plan[0], /ADD ATTRIBUTE "new" text RESTRICT, ADD ATTRIBUTE "other" integer RESTRICT/);
  for (const sql of ['CREATE TYPE "test"."DemoType" AS ()', 'CREATE TYPE "test"."DemoType" AS ("a" text)', 'CREATE TYPE "test"."DemoType" AS ("b" numeric(10,2))']) {
    assert.throws(() => planPostgresTypeChanges(before, parsePostgresType(sql, 'test')), /unsupported_change/);
  }
});

async function setup({ labels = ['pending', 'done'], respond, confirm = () => false } = {}) {
  const calls = [];
  let currentLabels = [...labels];
  const h = await createTypeHarness(async (...args) => {
    calls.push(args);
    if (respond) { const result = await respond(...args); if (result) return result; }
    const [channel, sql] = args;
    if (channel === 'execute-sql-bg') {
      return { success: true, rows: /pg_catalog.pg_enum/.test(sql) ? currentLabels.map(enumlabel => ({ enumlabel })) : [{ typtype: 'e' }] };
    }
    if (channel === 'execute-sql') {
      assert.match(sql, /^ALTER TYPE/);
      const match = /ADD VALUE ('(?:''|[^'])*')/.exec(sql);
      assert.ok(match); currentLabels.push(match[1].slice(1, -1).replaceAll("''", "'"));
      return { success: true, rows: [] };
    }
    if (channel === 'git-commit') return { success: true };
    throw new Error(`Unexpected channel: ${channel}`);
  }, {}, { confirm });
  return { ...h, get state() { return h.state; }, calls, labels: () => currentLabels, externalLabels: labels => { currentLabels = labels; } };
}
async function save(h) {
  await h.state.handleCompile(); await h.flush();
  if (h.state.changePlan && !h.state.changePlan.failed) { await h.state.handleConfirmCompile(); await h.flush(); }
}
test('Saving an unchanged type never issues database DDL and Git receives the intact definition', async () => {
  const h = await setup({ labels: ["can't", 'semi;colon'] });
  try {
    const original = h.state.sourceText; h.calls.length = 0; await save(h); await h.flush();
    assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 0);
    assert.equal(h.calls.find(call => call[0] === 'git-commit')[1].sourceText, original);
    assert.deepEqual(h.alerts, ['save_compile_successful']);
  } finally { h.unmount(); }
});
test('Saving an added label uses only ALTER and rereads the definition for Git', async () => {
  const h = await setup();
  try {
    h.state.setSourceText(postgresTypeSource(enumeration(['pending', 'done', "can't;stop"]))); await h.flush(); h.calls.length = 0;
    await save(h); await h.flush();
    const writes = h.calls.filter(call => call[0] === 'execute-sql'); assert.equal(writes.length, 1);
    assert.match(writes[0][1], /ADD VALUE 'can''t;stop'/);
    const saved = h.calls.find(call => call[0] === 'git-commit')[1];
    assert.deepEqual(plain(parsePostgresType(saved.sourceText, 'test')).labels, ['pending', 'done', "can't;stop"]);
    assert.equal(h.state.hasUnsavedChanges, false);
  } finally { h.unmount(); }
});
test('Unsupported changes and appended SQL never execute DDL or commit misleading Git history', async () => {
  const h = await setup();
  try {
    for (const source of [postgresTypeSource(enumeration(['done'])), postgresTypeSource(enumeration(['done', 'pending'])), h.state.sourceText + '\nDROP TABLE secret;']) {
      h.state.setSourceText(source); await h.flush(); h.calls.length = 0;
      await save(h); await h.flush();
      assert.equal(h.calls.filter(call => ['execute-sql', 'git-commit'].includes(call[0])).length, 0);
      assert.match(h.alerts.at(-1), /^postgres_type_save_failed/);
    }
  } finally { h.unmount(); }
});
test('Another session adding a label prevents a stale definition from silently removing it', async () => {
  const h = await setup();
  try {
    h.externalLabels(['pending', 'done', 'external']); h.calls.length = 0;
    await save(h); assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 0);
    assert.match(h.alerts.at(-1), /postgres_type_change_unsupported/);
  } finally { h.unmount(); }
});
test('A failed ALTER preserves the draft and issues neither DROP nor Git commit', async () => {
  const h = await setup({ respond: channel => channel === 'execute-sql' ? { success: false, error: 'Permission denied' } : undefined });
  try {
    h.state.setSourceText(postgresTypeSource(enumeration(['pending', 'done', 'new']))); await h.flush(); h.calls.length = 0;
    await save(h); await h.flush();
    assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 1);
    assert.equal(h.calls.filter(call => call[0] === 'git-commit').length, 0);
    assert.equal(h.state.hasUnsavedChanges, true); assert.match(h.state.changePlan.error, /Permission denied/);
  } finally { h.unmount(); }
});
test('A failed or unavailable catalog read blocks DDL rather than assuming an empty type', async () => {
  const h = await setup({ respond: channel => channel === 'execute-sql-bg' ? { success: false, error: 'Metadata failed' } : undefined });
  try {
    h.state.setSourceText(postgresTypeSource(enumeration(['new']))); await h.flush(); h.calls.length = 0; await save(h);
    assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 0); assert.match(h.alerts.at(-1), /Metadata failed/);
  } finally { h.unmount(); }
});
test('Git failure reports the database save separately and retries never reissue DDL', async () => {
  const h = await setup({ respond: channel => channel === 'git-commit' ? { success: false, error: 'Git unavailable' } : undefined });
  try {
    h.state.setSourceText(postgresTypeSource(enumeration(['pending', 'done', 'new']))); await h.flush(); await save(h); await h.flush();
    assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 1);
    assert.equal(h.state.hasUnsavedChanges, false); assert.match(h.alerts.at(-1), /postgres_type_saved_git_failed/);
    assert.ok(!h.alerts.includes('save_compile_successful'));
  } finally { h.unmount(); }
});
test('Explicit type deletion uses RESTRICT and leaves dependent data to the database guard', async () => {
  const h = await setup({ confirm: () => true, respond: channel => channel === 'execute-sql' ? { success: false, error: 'Dependent objects exist' } : undefined });
  try {
    h.calls.length = 0; await h.state.handleDelete();
    const writes = h.calls.filter(call => call[0] === 'execute-sql'); assert.equal(writes.length, 1);
    assert.equal(writes[0][1], 'DROP TYPE "test"."DemoType" RESTRICT');
    assert.equal(h.calls.filter(call => call[0] === 'git-delete-object').length, 0);
  } finally { h.unmount(); }
});
