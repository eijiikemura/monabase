// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createStoredHarness } = require('./helpers/storedLogic.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { validateArguments, buildFinalArgs, oracleCompileLineOffset } = loadTypeScript('src/features/stored/storedCommon.ts', { '@/shared/api/desktop': {}, i18next: { t: key => key } });
const { splitDefaultExpressions } = loadTypeScript('src/features/stored/routineArguments.ts');
const { routineDiagnostics } = loadTypeScript('src/features/stored/routineDiagnostics.ts');
function fixture(database, changes = {}) {
  const source = database === 'oracle' ? 'CREATE OR REPLACE PROCEDURE TEST.A(P IN VARCHAR2 DEFAULT \'default\') AS BEGIN NULL; END;' : `CREATE OR REPLACE FUNCTION "TEST"."A"(p text DEFAULT 'default') RETURNS text LANGUAGE plpgsql AS $f$\nBEGIN\nRETURN p;\nEND;\n$f$;`;
  return async (channel, sql) => {
    if (channel === 'get-trace-data') return { success: true };
    if (channel === 'execute-sql-bg' && /GET_DDL/.test(sql)) return { success: true, rows: [{ DDL: source }] };
    if (channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql)) return { success: true, rows: [{ ARGUMENT_NAME: 'P', DATA_TYPE: 'VARCHAR2', IN_OUT: 'IN', POSITION: 1, DEFAULT_LENGTH: 0, DEFAULTED: 'Y' }] };
    if (channel === 'execute-sql-bg' && /SELECT STATUS/.test(sql)) return { success: true, rows: [{ STATUS: 'VALID' }] };
    if (channel === 'execute-sql-bg' && /AS signature, pg_get_functiondef/.test(sql)) return { success: true, rows: [{ oid: '42', signature: 'text', ddl: source }] };
    if (channel === 'execute-sql-bg' && /WITH ORDINALITY/.test(sql)) return { success: true, rows: [{ proargnames: ['p'], proargmodes: ['i'], data_type: 'text', pronargs: 1, pronargdefaults: 1, defaults: "'default'::text" }] };
    return { success: true, rows: [], ...changes };
  };
}
test('Routine argument modes distinguish explicit defaults, automatic NULL and whitespace values', () => {
  const args = [{ ARGUMENT_NAME: 'P', POSITION: 1, DATA_TYPE: 'text', IN_OUT: 'IN/OUT', DEFAULTED: 'Y', DEFAULT_LENGTH: 0 }];
  assert.deepEqual(Object.keys(buildFinalArgs(args, { P: '' }, { P: 'default' })), []);
  assert.equal(buildFinalArgs(args, { P: 'retained' }, { P: 'null' }).P, null);
  assert.equal(buildFinalArgs(args, { P: '' }, { P: 'value' }).P, null);
  assert.equal(buildFinalArgs(args, { P: '  ' }, { P: 'value' }).P, '  ');
  assert.equal(validateArguments(args, { P: '' }, { P: 'value' }), null);
  for (const invalid of ['Infinity', '0x10', 'NaN']) assert.ok(validateArguments([{ ...args[0], DATA_TYPE: 'numeric' }], { P: invalid }, { P: 'value' }));
  assert.equal(validateArguments([{ ...args[0], DATA_TYPE: 'numeric' }], { P: '9007199254740993' }, { P: 'value' }), null);
});
test('Oracle compiler positions include leading editor comments and blank lines', () => {
  assert.equal(oracleCompileLineOffset('-- editor note\n\nCREATE OR REPLACE PROCEDURE TEST.A AS BEGIN NULL; END;'), 2);
});
test('Catalog defaults split only outer expression separators', () => {
  assert.deepEqual(Array.from(splitDefaultExpressions("concat('a,b', 'c'), ARRAY[1,2], now(), 'default'::text")), ["concat('a,b', 'c')", 'ARRAY[1,2]', 'now()', "'default'::text"]);
});
test('Routine diagnostics map Unicode positions and native body contexts without inventing line one', () => {
  const source = 'CREATE FUNCTION "日本😀"() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\nBAD;\nEND;$$;';
  const position = Array.from(source.slice(0, source.indexOf('BAD'))).length + 1;
  assert.equal(routineDiagnostics(source, { error: 'failure', errorPosition: position })[0].line, 3);
  assert.equal(routineDiagnostics(source, { error: 'failure', errorContext: 'compilation of PL/pgSQL function "f" near line 3' })[0].line, 3);
  assert.equal(routineDiagnostics(source, { error: 'unknown position' }).length, 0);
});
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: failed metadata blocks execution and compilation, preserves a dirty draft and recovers through retry`, async () => {
    let fail = false; const normal = fixture(database);
    const h = createStoredHarness((channel, sql) => fail && channel === 'execute-sql-bg' ? { success: false, error: 'Metadata rejected' } : normal(channel, sql), { database, objectType: database === 'oracle' ? 'PROCEDURE' : 'FUNCTION' });
    try {
      await h.render().loadObjectInfo(); await h.flush(); assert.equal(h.render().metadataReady, true);
      const draft = h.render().sourceText + '\n-- unsaved text'; h.render().setSourceText(draft); await h.flush();
      fail = true; await h.render().loadObjectInfo(); await h.flush(); assert.equal(h.render().sourceText, draft); assert.equal(h.render().metadataReady, false); assert.match(h.render().loadError, /Metadata rejected/);
      h.calls.length = 0; await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {}); await h.render().handleCompile(() => {});
      assert.equal(h.calls.length, 0);
      fail = false; await h.render().loadObjectInfo(); await h.flush(); assert.equal(h.render().sourceText, draft); assert.equal(h.render().metadataReady, true);
    } finally { h.dispose(); }
  });
  test(`${database}: explicit argument modes reach normal execution without losing text values`, async () => {
    const normal = fixture(database), h = createStoredHarness((channel, ...args) => channel === 'execute-trace' ? { success: true, returnValues: [], dbmsOutput: [] } : normal(channel, ...args), { database, objectType: database === 'oracle' ? 'PROCEDURE' : 'FUNCTION' });
    try {
      await h.render().loadObjectInfo(); await h.flush(); const name = database === 'oracle' ? 'P' : 'p';
      for (const mode of ['default', 'null', 'value']) {
        h.render().setArgumentModes({ [name]: mode }); h.render().setArgValues({ [name]: '' }); await h.flush();
        await h.render().handleExecute(() => {}); await h.flush();
        const request = h.calls.filter(call => call[0] === 'execute-stored').at(-1)?.[1]; assert.ok(request);
        assert.equal(request.argumentModes[name], mode);
        if (mode === 'default') assert.ok(!Object.hasOwn(request.args, name)); else assert.equal(request.args[name], null);
        await h.render().handleTraceExecute(false, () => {}); await h.flush();
        const trace = h.calls.filter(call => call[0] === 'execute-trace').at(-1)?.[1]; assert.ok(trace);
        assert.equal(trace.argumentModes[name], mode); assert.equal(JSON.stringify(trace.args), JSON.stringify(request.args));
        if (database === 'postgresql') assert.ok(trace.sourceText.includes(mode === 'default' ? "p := ('default'::text);" : 'p := NULL;'));
        assert.equal(h.calls.filter(call => call[0] === 'execute-sql' && /ROLLBACK/i.test(call[1])).length, 0);
      }
    } finally { h.dispose(); }
  });
  test(`${database}: late definition responses cannot replace newer loads or edits made during loading`, async () => {
    const normal = fixture(database); let hold = false, release;
    const h = createStoredHarness(async (channel, sql) => {
      if (hold && channel === 'execute-sql-bg' && /GET_DDL|AS signature, pg_get_functiondef/.test(sql)) { hold = false; return new Promise(resolve => { release = resolve; }); }
      return normal(channel, sql);
    }, { database, objectType: database === 'oracle' ? 'PROCEDURE' : 'FUNCTION' });
    try {
      await h.render().loadObjectInfo(); await h.flush(); hold = true; const first = h.render().loadObjectInfo();
      await h.render().loadObjectInfo(); await h.flush(); const source = h.render().sourceText;
      release({ success: true, rows: [{ DDL: 'stale', oid: '42', signature: 'text', ddl: 'stale' }] }); await first; await h.flush(); assert.equal(h.render().sourceText, source);
    } finally { h.dispose(); }
  });
}

test('Missing and empty scalar arguments automatically pass NULL while explicit defaults and text remain distinct', () => {
  for (const DATA_TYPE of ['numeric', 'DATE', 'text']) {
    const args = [{ ARGUMENT_NAME: 'P', POSITION: 1, DATA_TYPE, IN_OUT: 'IN/OUT', DEFAULTED: 'Y', DEFAULT_LENGTH: 0 }];
    for (const values of [{}, { P: '' }]) {
      assert.equal(validateArguments(args, values), null);
      assert.equal(buildFinalArgs(args, values).P, null);
      assert.deepEqual(Object.keys(buildFinalArgs(args, values, { P: 'default' })), []);
    }
  }
  const args = [{ ARGUMENT_NAME: 'P', POSITION: 1, DATA_TYPE: 'text', IN_OUT: 'IN', DEFAULTED: 'N' }];
  for (const value of ['  ', 'null', 'NULL', '日本語']) assert.equal(buildFinalArgs(args, { P: value }).P, value);
});
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: empty initial arguments reach normal and trace execution as NULL without mode selection`, async () => {
    const normal = fixture(database);
    const h = createStoredHarness((channel, ...args) => channel === 'execute-trace' ? { success: true, returnValues: [], dbmsOutput: [] } : normal(channel, ...args), { database, objectType: database === 'oracle' ? 'PROCEDURE' : 'FUNCTION' });
    try {
      await h.render().loadObjectInfo(); await h.flush();
      const name = database === 'oracle' ? 'P' : 'p';
      assert.equal(h.render().argumentModes[name], 'value');
      await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {}); await h.flush();
      for (const channel of ['execute-stored', 'execute-trace']) assert.equal(h.calls.find(call => call[0] === channel)[1].args[name], null);
    } finally { h.dispose(); }
  });
}
