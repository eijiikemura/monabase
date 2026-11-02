// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPackageHarness } = require('./helpers/packageLogic.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const argument = name => ({ ARGUMENT_NAME: name, DATA_TYPE: 'VARCHAR2', IN_OUT: 'IN', POSITION: 1, DEFAULTED: 'Y' });
const executions = h => h.calls.filter(([channel]) => channel === 'execute-stored' || channel === 'execute-trace');
const source = 'CREATE PACKAGE BODY TEST.PKG AS PROCEDURE A IS BEGIN NULL; END; END;';
function fixture(invoke) {
  return async (channel, sql, binds) => {
    if (channel === 'execute-sql-bg') {
      if (/GET_DDL/.test(sql)) return { success: true, rows: [{ DDL: source }] };
      if (/FROM ALL_PROCEDURES p/.test(sql)) return { success: true, rows: ['A', 'B', 'NO_ARGS'].map((name, index) => ({ PROCEDURE_NAME: name, SUBPROGRAM_ID: index + 1, SIGNATURE: name === 'NO_ARGS' ? '' : 'VARCHAR2' })) };
      if (/FROM ALL_OBJECTS o/.test(sql)) return { success: true, rows: [{ OBJECT_TYPE: 'PACKAGE', STATUS: 'VALID' }, { OBJECT_TYPE: 'PACKAGE BODY', STATUS: 'VALID' }] };
      if (/FROM ALL_ERRORS/.test(sql)) return { success: true, rows: [] };
    }
    return invoke(channel, sql, binds);
  };
}
async function select(h, name) { h.render().setSelectedSubProgram(name); await h.render().loadArguments(name); await h.flush(); }
for (const failure of ['error', 'missing', 'rejection']) {
  test(`A ${failure} fetching B arguments blocks execution and retry restores the exact program`, async () => {
    let fail = true;
    const h = createPackageHarness(fixture(async (channel, sql, binds) => {
      if (channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql)) {
        if (binds.subProgram === 'B' && fail) {
          if (failure === 'rejection') throw Error('Metadata unavailable');
          return failure === 'missing' ? { success: true } : { success: false, error: 'Metadata unavailable' };
        }
        return { success: true, rows: [argument(binds.subProgram)] };
      }
      return { success: true, returnValues: [] };
    }));
    try {
      await h.render().loadObjectInfo(); await h.flush(); h.render().setArgValues({ A: 'A value' });
      h.render().setSelectedSubProgram('B');
      await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {});
      assert.equal(executions(h).length, 0);
      await h.render().loadArguments('B'); await h.flush();
      assert.ok(h.render().argumentLoadError); assert.equal(h.render().canExecuteSubProgram, false);
      assert.deepEqual(Object.keys(h.render().argValues), []);
      fail = false; await h.render().loadArguments('B'); await h.flush();
      assert.equal(h.render().canExecuteSubProgram, true);
      h.render().setArgValues({ B: 'B value' }); await h.flush(); await h.render().handleExecute(() => {});
      const sent = executions(h)[0][1]; assert.equal(sent.objectName, 'PKG'); assert.equal(sent.subProgram, 'B'); assert.equal(sent.subProgramId, 2);
      assert.equal(sent.args.B, 'B value'); assert.equal(sent.args.A, undefined);
    } finally { h.dispose(); }
  });
}
test('Delayed A arguments cannot replace B arguments or readiness', async () => {
  let hold = false, finishA;
  const h = createPackageHarness(fixture(async (channel, sql, binds) => {
    if (channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql)) {
      if (hold && binds.subProgram === 'A') return new Promise(resolve => { finishA = resolve; });
      return { success: true, rows: [argument(binds.subProgram)] };
    }
    return { success: true };
  }));
  try {
    await h.render().loadObjectInfo(); hold = true; const pending = h.render().loadArguments('A');
    await select(h, 'B'); finishA({ success: true, rows: [argument('A')] }); await pending; await h.flush();
    assert.equal(h.render().argumentsList[0].ARGUMENT_NAME, 'B'); assert.equal(h.render().canExecuteSubProgram, true);
  } finally { h.dispose(); }
});
test('Empty successful arguments permit parameterless programs while pending and disposed responses cannot permit execution', async () => {
  let hold = false, finish;
  const h = createPackageHarness(fixture(async (channel, sql) => channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql) && hold ? new Promise(resolve => { finish = resolve; }) : { success: true, rows: [], returnValues: [] }));
  await h.render().handleExecute(() => {}); assert.equal(executions(h).length, 0);
  await h.render().loadObjectInfo(); await select(h, 'NO_ARGS'); assert.equal(h.render().canExecuteSubProgram, true);
  await h.render().handleExecute(() => {}); assert.equal(executions(h).length, 1);
  hold = true; const pending = h.render().loadArguments('NO_ARGS'); await h.flush();
  assert.equal(h.render().canExecuteSubProgram, false); await h.render().handleTraceExecute(false, () => {}); assert.equal(executions(h).length, 1);
  h.dispose(); finish({ success: true, rows: [] }); await pending;
  assert.equal(h.render().canExecuteSubProgram, false);
});
test('Definition failures preserve dirty drafts, block compile/execution and recover without discarding edits', async () => {
  let fail = false; const normal = fixture(async () => ({ success: true, rows: [] }));
  const h = createPackageHarness((channel, ...args) => fail && channel === 'execute-sql-bg' ? { success: false, error: 'Definition unavailable' } : normal(channel, ...args));
  try {
    await h.render().loadObjectInfo(); await h.flush(); const draft = h.render().sourceText + '\n-- unsaved';
    h.render().setSourceText(draft); await h.flush(); fail = true;
    await h.render().loadObjectInfo(true); await h.flush(); assert.equal(h.render().sourceText, draft); assert.ok(h.render().definitionLoadError);
    h.calls.length = 0; await h.render().handleCompile(() => {}); await h.render().handleExecute(() => {}); assert.equal(h.calls.length, 0);
    fail = false; await h.render().loadObjectInfo(true); await h.flush(); assert.equal(h.render().sourceText, draft); assert.equal(h.render().metadataReady, true);
    await h.render().handleTraceExecute(false, () => {}); assert.equal(executions(h).length, 0); assert.match(h.alerts.at(-1), /Compile your edits/);
  } finally { h.dispose(); }
});
test('Package trace modes preserve omitted defaults, NULL and text without renderer rollback', async () => {
  const h = createPackageHarness(fixture(async (channel, sql, binds) => ({ success: true, rows: channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql) ? [argument(binds.subProgram)] : [], returnValues: [] })));
  try {
    await h.render().loadObjectInfo(); await h.flush();
    for (const mode of ['default', 'null', 'value']) {
      h.render().setArgumentModes({ A: mode }); h.render().setArgValues({ A: '  ' }); await h.flush();
      await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {}); await h.flush();
      const requests = executions(h).slice(-2).map(call => call[1]); assert.equal(requests.length, 2);
      for (const request of requests) { assert.equal(request.argumentModes.A, mode); assert.equal(request.args.A, mode === 'default' ? undefined : mode === 'null' ? null : '  '); }
    }
    assert.equal(h.calls.filter(call => call[0] === 'execute-sql' && call[1] === 'ROLLBACK').length, 0);
  } finally { h.dispose(); }
});
for (const type of ['PROCEDURE', 'FUNCTION', 'PACKAGE BODY']) {
  test(`Compilation checks the exact quoted name and ${type} with bound values`, async () => {
    const calls = [];
    const { executeCompile } = loadTypeScript('src/features/stored/storedCommon.ts', {
      i18next: { t: key => key }, '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
        calls.push(args);
        return { success: true, rows: /FROM ALL_ERRORS/.test(args[1]) ? [{ LINE: 2, POSITION: 3, TEXT: 'Syntax error' }] : [] };
      } } }
    });
    const result = await executeCompile('Case.Schema', "Mixed'Name", 'BEGIN NULL; END;', type);
    const [, sql, binds] = calls.find(([channel, text]) => channel === 'execute-sql-bg' && /FROM ALL_ERRORS/.test(text));
    assert.equal(sql.includes('UPPER('), false);
    assert.ok(sql.includes('TYPE = :type'));
    assert.equal(sql.includes("Mixed'Name"), false);
    assert.deepEqual(JSON.parse(JSON.stringify(binds)), { owner: 'Case.Schema', name: "Mixed'Name", type });
    assert.equal(result.success, false); assert.equal(result.isSyntaxError, true);
    assert.equal(result.errors[0].line, 2);
  });
}

test('Reversed definition responses and edits during loading cannot replace the latest package draft', async () => {
  let hold = false, finish;
  const normal = fixture(async () => ({ success: true, rows: [] }));
  const h = createPackageHarness((channel, sql, binds) => {
    if (hold && channel === 'execute-sql-bg' && /GET_DDL/.test(sql)) { hold = false; return new Promise(resolve => { finish = resolve; }); }
    return normal(channel, sql, binds);
  });
  try {
    await h.render().loadObjectInfo(); await h.flush(); hold = true; const first = h.render().loadObjectInfo();
    await h.render().loadObjectInfo(); await h.flush(); const latest = h.render().sourceText;
    finish({ success: true, rows: [{ DDL: 'stale definition' }] }); await first; await h.flush(); assert.equal(h.render().sourceText, latest);
    hold = true; const pending = h.render().loadObjectInfo(); h.render().setSourceText(latest + '\n-- typed while loading'); await h.flush();
    finish({ success: true, rows: [{ DDL: source }] }); await pending; await h.flush(); assert.ok(h.render().sourceText.endsWith('-- typed while loading'));
  } finally { h.dispose(); }
});
test('Unsupported composite parameters remain visible but cannot be executed', async () => {
  const h = createPackageHarness(fixture(async (channel, sql) => ({ success: true, rows: channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql) ? [{ ...argument('REC'), DATA_TYPE: 'PL/SQL RECORD', TYPE_NAME: 'REC_T' }] : [] })));
  try {
    await h.render().loadObjectInfo(); await h.flush(); assert.equal(h.render().canExecuteSubProgram, false);
    assert.equal(h.render().argumentsList[0].ARGUMENT_NAME, 'REC'); assert.ok(h.render().argumentLoadError);
    await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {}); assert.equal(executions(h).length, 0);
  } finally { h.dispose(); }
});

test('Package execution and tracing pass missing argument inputs as NULL without mode selection', async () => {
  const h = createPackageHarness(fixture(async (channel, sql, binds) => ({ success: true, rows: channel === 'execute-sql-bg' && /FROM ALL_ARGUMENTS/.test(sql) ? [argument(binds.subProgram)] : [], returnValues: [] })));
  try {
    await h.render().loadObjectInfo(); await h.flush();
    h.render().setArgValues({}); await h.flush();
    await h.render().handleExecute(() => {}); await h.render().handleTraceExecute(false, () => {}); await h.flush();
    const requests = executions(h); assert.equal(requests.length, 2);
    for (const [, request] of requests) assert.equal(request.args.A, null);
  } finally { h.dispose(); }
});
