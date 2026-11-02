// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTypeHarness } = require('./helpers/typeData.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { oracleTypeStatement } = loadTypeScript('src/features/oracle/typeDefinition.ts', { '@/shared/api/desktop': {}, i18next: { t: key => key } });
const { postgresTypeDiagnostics } = loadTypeScript('src/features/type/typeDiagnostics.ts');
const oracleSource = 'CREATE OR REPLACE TYPE "test"."DemoType" AS OBJECT (ID NUMBER);';
function fixture(database) {
  const state = { source: oracleSource, labels: ['a'], diagnostics: [], status: 'VALID', fail: false, failDiagnostics: false, failWrite: 0, writes: 0, calls: [] };
  state.invoke = async (...args) => {
    state.calls.push(args); const [channel, sql] = args;
    if (channel === 'execute-sql-bg') {
      if (state.fail) return { success: false, error: 'Metadata failed' };
      if (/GET_DDL/.test(sql)) return { success: true, rows: [{ DDL: state.source }] };
      if (/ALL_OBJECTS/.test(sql)) return { success: true, rows: [{ OBJECT_TYPE: 'TYPE', STATUS: state.status }] };
      if (/ALL_ERRORS/.test(sql)) return state.failDiagnostics ? { success: false, error: 'Diagnostic read failed' } : { success: true, rows: state.diagnostics };
      if (/pg_enum/.test(sql)) return { success: true, rows: state.labels.map(enumlabel => ({ enumlabel })) };
      return { success: true, rows: [{ typtype: 'e' }] };
    }
    if (channel === 'execute-sql') {
      state.writes++;
      if (state.writes === state.failWrite) return { success: false, error: 'DDL rejected', errorPosition: sql.indexOf("'c'") + 1 };
      if (database === 'oracle') state.source = sql;
      else state.labels.push(/ADD VALUE '([^']+)'/.exec(sql)[1]);
    }
    return { success: true, rows: [] };
  };
  return state;
}
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: definition failure blocks save/delete and retry retains a dirty draft and baseline`, async () => {
    const f = fixture(database), h = await createTypeHarness(f.invoke, {}, { database });
    try {
      const draft = h.state.sourceText + '\n-- unsaved'; h.state.setSourceText(draft); await h.flush();
      f.fail = true; await h.state.loadObjectInfo(); await h.flush();
      assert.equal(h.state.sourceReady, false); assert.equal(h.state.sourceText, draft); assert.equal(h.state.sourceError, 'Metadata failed');
      f.calls.length = 0; await h.state.handleCompile(); await h.state.handleDelete(); assert.equal(f.calls.length, 0);
      f.fail = false; await h.state.loadObjectInfo(); await h.flush(); assert.equal(h.state.sourceReady, true); assert.equal(h.state.sourceText, draft); assert.equal(h.state.hasUnsavedChanges, true);
    } finally { h.unmount(); }
  });
  test(`${database}: reversed loads and edits while loading cannot replace newer editor content`, async () => {
    const f = fixture(database); let hold = false, release;
    const h = await createTypeHarness((channel, sql, binds) => {
      if (hold && channel === 'execute-sql-bg' && /GET_DDL|SELECT t.typtype/.test(sql)) { hold = false; return new Promise(resolve => { release = resolve; }); }
      return f.invoke(channel, sql, binds);
    }, {}, { database });
    try {
      const latest = h.state.sourceText; hold = true; const old = h.state.loadObjectInfo();
      await h.state.loadObjectInfo(); await h.flush(); release({ success: true, rows: database === 'oracle' ? [{ DDL: 'stale source' }] : [{ typtype: 'e' }] }); await old; await h.flush(); assert.equal(h.state.sourceText, latest);
      hold = true; const pending = h.state.loadObjectInfo(); h.state.setSourceText(latest + '\n-- new edit'); await h.flush();
      release({ success: true, rows: database === 'oracle' ? [{ DDL: oracleSource }] : [{ typtype: 'e' }] }); await pending; await h.flush(); assert.ok(h.state.sourceText.endsWith('-- new edit'));
    } finally { h.unmount(); }
  });
}
for (const source of [oracleSource.replace('DemoType', 'Other'), oracleSource.replace('"test"', '"other"'), oracleSource.replace('TYPE ', 'TYPE BODY '), oracleSource + '\n/\nDROP TABLE test.secret;']) {
  test(`Oracle type validation refuses another identity, kind or batch: ${source.slice(0, 55)}`, () => assert.throws(() => oracleTypeStatement(source, 'test', 'DemoType')));
}
test('Oracle single-program parsing retains quoted slash lines and comments', () => {
  const source = '-- leading comment\nCREATE TYPE "test"."DemoType" AS OBJECT ("Slash/Name" VARCHAR2(10));\n/\n/*\n/\ncomment */';
  const sql = oracleTypeStatement(source, 'test', 'DemoType'); assert.ok(sql.includes('"Slash/Name"')); assert.ok(sql.endsWith('/*\n/\ncomment */'));
});
for (const failure of ['invalid', 'diagnostics unavailable']) {
  test(`Oracle ${failure} cannot record a successful Git definition`, async () => {
    const f = fixture('oracle'), h = await createTypeHarness(f.invoke, {}, { database: 'oracle' });
    try {
      h.state.setSourceText('-- editor note\n\n' + oracleSource); await h.flush();
      if (failure === 'invalid') { f.diagnostics = [{ LINE: 1, POSITION: 5, TEXT: 'Native error', ATTRIBUTE: 'ERROR' }]; f.status = 'INVALID'; }
      else f.failDiagnostics = true;
      await h.state.handleCompile(); await h.flush();
      assert.equal(f.calls.filter(call => call[0] === 'git-commit').length, 0); assert.equal(h.state.hasUnsavedChanges, true);
      if (failure === 'invalid') assert.equal(h.state.compileErrors[0].line, 3); else assert.equal(h.state.sourceReady, false);
    } finally { h.unmount(); }
  });
}
test('Oracle warnings stay visible while Git receives the actual successfully compiled definition', async () => {
  const f = fixture('oracle'), h = await createTypeHarness(f.invoke, {}, { database: 'oracle' });
  try {
    f.diagnostics = [{ LINE: 1, POSITION: 1, TEXT: 'Warning only', ATTRIBUTE: 'WARNING' }];
    h.state.setSourceText('-- note\n' + oracleSource); await h.flush(); await h.state.handleCompile(); await h.flush();
    const git = f.calls.find(call => call[0] === 'git-commit'); assert.ok(git);
    const diagnostics = f.calls.findIndex(call => call[0] === 'execute-sql-bg' && /ALL_ERRORS/.test(call[1]));
    assert.ok(f.calls.indexOf(git) > diagnostics); assert.equal(git[1].sourceText, f.source + '\n/');
    assert.equal(h.state.compileErrors[0].severity, 'warning'); assert.equal(h.state.hasUnsavedChanges, false);
  } finally { h.unmount(); }
});
test('PostgreSQL preview cancellation executes no DDL and confirmation rechecks the live plan', async () => {
  const f = fixture('postgresql'), h = await createTypeHarness(f.invoke);
  try {
    h.state.setSourceText('CREATE TYPE "test"."DemoType" AS ENUM (\'a\', \'b\', \'c\');'); await h.flush(); await h.state.handleCompile(); await h.flush();
    assert.equal(h.state.changePlan.statements.length, 2); assert.equal(f.writes, 0);
    h.state.closeChangePlan(); await h.flush(); assert.equal(h.state.changePlan, null); assert.equal(f.writes, 0);
    await h.state.handleCompile(); await h.flush(); f.labels.push('b'); await h.state.handleConfirmCompile(); await h.flush();
    assert.equal(f.writes, 0); assert.equal(h.state.changePlan.statements.length, 1);
    await Promise.all([h.state.handleConfirmCompile(), h.state.handleConfirmCompile()]); await h.flush();
    assert.equal(f.writes, 1); assert.deepEqual(f.labels, ['a', 'b', 'c']);
  } finally { h.unmount(); }
});
test('PostgreSQL partial DDL failure retains the desired draft and retries only freshly reviewed remaining changes', async () => {
  const f = fixture('postgresql'), h = await createTypeHarness(f.invoke);
  try {
    const draft = 'CREATE TYPE "test"."DemoType" AS ENUM (\'a\', \'b\', \'c\');'; h.state.setSourceText(draft); await h.flush();
    f.failWrite = 2; await h.state.handleCompile(); await h.flush(); await h.state.handleConfirmCompile(); await h.flush();
    assert.equal(h.state.changePlan.completed, 1); assert.equal(h.state.changePlan.failed, true); assert.equal(h.state.sourceText, draft);
    assert.equal(f.calls.filter(call => call[0] === 'git-commit').length, 0); assert.deepEqual(f.labels, ['a', 'b']);
    await h.state.retryChangePlan(); await h.flush(); assert.equal(h.state.changePlan.statements.length, 1); assert.ok(h.state.changePlan.statements[0].includes("'c'"));
    await h.state.handleConfirmCompile(); await h.flush(); assert.equal(h.state.changePlan, null); assert.deepEqual(f.labels, ['a', 'b', 'c']);
    assert.equal(f.calls.filter(call => call[0] === 'git-commit').length, 1);
  } finally { h.unmount(); }
});
test('Generated ALTER error positions map only unambiguous tokens into the original Unicode CREATE source', () => {
  const source = 'CREATE TYPE "test"."日本😀" AS (id integer, extra mb_missing_type);';
  const statement = 'ALTER TYPE "test"."日本😀" ADD ATTRIBUTE "extra" mb_missing_type RESTRICT';
  const position = Array.from(statement.slice(0, statement.indexOf('mb_missing_type'))).length + 1;
  const errors = postgresTypeDiagnostics(source, statement, { errorPosition: position, error: 'Unknown type' });
  assert.equal(errors[0].col, source.indexOf('mb_missing_type') + 1); assert.equal(errors[0].line, 1);
  assert.equal(postgresTypeDiagnostics(source, statement, { error: 'No position' }).length, 0);
});

test('Oracle warning markers follow the reloaded canonical source after leading editor comments are removed', async () => {
  const f = fixture('oracle');
  const h = await createTypeHarness(async (...args) => {
    const response = await f.invoke(...args);
    if (args[0] === 'execute-sql') f.source = oracleSource;
    return response;
  }, {}, { database: 'oracle' });
  try {
    f.diagnostics = [{ LINE: 1, POSITION: 1, TEXT: 'Warning', ATTRIBUTE: 'WARNING' }];
    h.state.setSourceText('-- editor comment\n\n' + oracleSource); await h.flush(); await h.state.handleCompile(); await h.flush();
    assert.equal(h.state.compileErrors[0].line, 1); assert.equal(h.state.sourceText, oracleSource + '\n/');
  } finally { h.unmount(); }
});
