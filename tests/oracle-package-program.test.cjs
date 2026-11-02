// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getPackageRoutine, packageInvocation, renamePackageProgram } = require('../electron/oracle/packageProgram');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

for (const name of ['PKG', 'Mixed Name', "Owner's Package", '日本語']) {
  test(`Package trace renaming preserves literals and comments for ${name}`, () => {
    const quoted = `"${name}"`;
    const literal = name.replaceAll("'", "''");
    const source = `-- ${name}\nCREATE OR REPLACE PACKAGE BODY "TEST".${quoted} AS\nFUNCTION F RETURN VARCHAR2 IS\nBEGIN\nRETURN '${literal}' || q'[${literal}]' || ${quoted}.G();\nEND F;\nEND ${quoted};`;
    const renamed = renamePackageProgram(source, name, 'MBT_TEMP');
    assert.ok(renamed.startsWith(`-- ${name}\n`)); assert.ok(renamed.includes(`'${literal}' || q'[${literal}]'`));
    assert.ok(renamed.includes('"TEST"."MBT_TEMP" AS')); assert.ok(renamed.includes('"MBT_TEMP".G()'));
    assert.ok(renamed.includes('END F;')); assert.ok(renamed.endsWith('END "MBT_TEMP";'));
  });
}
test('Typed package invocation selects the formal types and returns OUT values through generated binds', () => {
  const rows = [{ ARGUMENT_NAME: 'Input Value', DATA_TYPE: 'NUMBER', IN_OUT: 'IN' }, { ARGUMENT_NAME: 'Output Value', DATA_TYPE: 'VARCHAR2', IN_OUT: 'OUT' }];
  const sql = packageInvocation('"TEST"."PKG"."CALL"', false, ['Input Value', 'Output Value'], ['"Input Value" => :mb_arg_0', '"Output Value" => :mb_arg_1'], rows);
  assert.ok(sql.includes('mb_value_0 NUMBER;')); assert.ok(sql.includes('mb_value_1 VARCHAR2(32767);'));
  assert.ok(sql.includes('mb_value_0 := :mb_arg_0;')); assert.ok(sql.includes('"Input Value" => mb_value_0'));
  assert.ok(sql.includes(':mb_arg_1 := mb_value_1;')); assert.ok(!sql.includes('mb_value_1 := :mb_arg_1;'));
});
function routineFixture(changes = {}) {
  const rows = changes.rows || [{ ARGUMENT_NAME: 'P', DATA_TYPE: 'VARCHAR2', IN_OUT: 'IN', POSITION: 1, DEFAULTED: 'Y' }];
  const calls = [];
  const connection = { async execute(sql, binds) {
    calls.push({ sql, binds });
    return { rows: /ALL_ARGUMENTS/.test(sql) ? rows : changes.missing ? [] : /SUBPROGRAM_ID = :id/.test(sql) ? [{ SUBPROGRAM_ID: 2 }] : changes.overloaded ? [{ SUBPROGRAM_ID: 1 }, { SUBPROGRAM_ID: 2 }] : [{ SUBPROGRAM_ID: 2 }] };
  } };
  const params = { schema: 'TEST', objectName: "Pkg'Case", subProgram: 'P', subProgramId: 2, args: { P: '' }, argTypes: { P: 'VARCHAR2' }, argDirections: { P: 'IN' }, argumentModes: { P: 'value' } };
  return { connection, calls, params };
}
test('Package metadata validation binds exact identity and accepts explicit empty input', async () => {
  const h = routineFixture(); assert.equal((await getPackageRoutine(h.connection, h.params)).length, 1);
  for (const call of h.calls) { assert.ok(!call.sql.includes("Pkg'Case")); assert.equal(call.binds.name, "Pkg'Case"); assert.equal(call.binds.id, 2); }
});
for (const failure of ['stale', 'missing', 'unsupported', 'ambiguous default']) {
  test(`Package execution rejects ${failure} before invoking a different routine`, async () => {
    const h = routineFixture({ missing: failure === 'missing', overloaded: failure === 'ambiguous default', rows: failure === 'unsupported' ? [{ DATA_TYPE: 'PL/SQL RECORD', TYPE_NAME: 'R', POSITION: 1 }] : undefined });
    if (failure === 'stale') h.params.argTypes.P = 'NUMBER';
    if (failure === 'ambiguous default') { h.params.args = {}; h.params.argumentModes.P = 'default'; }
    await assert.rejects(() => getPackageRoutine(h.connection, h.params));
  });
}
test('Package compilation uses one main statement, separates warnings and maps leading comment offsets', async () => {
  const calls = [];
  const desktop = { ipcRenderer: { async invoke(...args) {
    calls.push(args);
    return { success: true, rows: /ALL_ERRORS/.test(args[1]) ? [{ LINE: 2, POSITION: 3, TEXT: 'Unused variable', ATTRIBUTE: 'WARNING' }] : [] };
  } } };
  const { compilePackageSource } = loadTypeScript('src/features/stored/packageCreation.ts', { '@/shared/api/desktop': desktop, i18next: { t: key => key } });
  const source = '-- editor note\n\nCREATE OR REPLACE PACKAGE TEST.PKG AS\nPROCEDURE A;\nEND;\n/';
  const result = await compilePackageSource('TEST', 'PKG', 'PACKAGE', source, false);
  assert.equal(result.success, true); assert.equal(result.errors.length, 0); assert.equal(result.warnings[0].line, 4);
  assert.equal(calls[0][0], 'execute-sql'); assert.ok(!calls[0][1].endsWith('/'));
  const before = calls.length;
  await assert.rejects(() => compilePackageSource('TEST', 'PKG', 'PACKAGE', source + '\nDROP TABLE TEST.DATA;', false));
  assert.equal(calls.length, before);
});
test('Package program choices retain overload IDs and exact bound schema names', async () => {
  const calls = [];
  const { loadPackagePrograms } = loadTypeScript('src/features/stored/packageMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { async invoke(...args) {
    calls.push(args); return { success: true, rows: [{ PROCEDURE_NAME: 'P', SUBPROGRAM_ID: 2, SIGNATURE: 'NUMBER' }, { PROCEDURE_NAME: 'P', SUBPROGRAM_ID: 3, SIGNATURE: 'VARCHAR2' }] };
  } } } });
  const programs = await loadPackagePrograms('Case.Schema', "Pkg'Case");
  assert.equal(programs[0].label, 'P(NUMBER)'); assert.notEqual(programs[0].key, programs[1].key);
  assert.equal(calls[0][2].owner, 'Case.Schema'); assert.ok(!calls[0][1].includes("Pkg'Case"));
});

test('Oracle scalar numeric input validation also checks PL/SQL and binary numeric families', () => {
  const { validateArguments } = loadTypeScript('src/features/stored/storedCommon.ts', { '@/shared/api/desktop': {}, i18next: { t: key => key } });
  for (const type of ['PLS_INTEGER', 'BINARY_INTEGER', 'BINARY_FLOAT', 'BINARY_DOUBLE']) {
    const args = [{ ARGUMENT_NAME: 'P', POSITION: 1, DATA_TYPE: type, IN_OUT: 'IN/OUT' }];
    assert.ok(validateArguments(args, { P: 'Infinity' }, { P: 'value' }));
    assert.equal(validateArguments(args, { P: '123' }, { P: 'value' }), null);
  }
});

test('Package self-reference renaming leaves other schemas unchanged', () => {
  const source = 'CREATE PACKAGE BODY TEST.PKG AS FUNCTION F RETURN NUMBER IS BEGIN RETURN PKG.G() + TEST.PKG.G() + OTHER.PKG.G(); END F; END PKG;';
  const result = renamePackageProgram(source, 'PKG', 'MBT_TEMP', 'TEST');
  assert.ok(result.includes('"MBT_TEMP".G() + TEST."MBT_TEMP".G() + OTHER.PKG.G()'));
});
test('Trace freshness checks use exact bound identities on the background connection', async () => {
  const calls = [];
  const { checkAndClearOldTrace } = loadTypeScript('src/features/stored/storedCommon.ts', {
    i18next: { t: key => key }, '@/shared/api/desktop': { ipcRenderer: { async invoke(...args) {
      calls.push(args); return args[0] === 'load-settings' ? {} : { success: true, rows: [{ DDL_TIME: 'same timestamp' }] };
    } } }
  });
  assert.equal(await checkAndClearOldTrace('Case.Schema', "Pkg'Case", 'PACKAGE BODY', 'same timestamp', () => {}), true);
  const call = calls.find(call => call[1]?.includes?.('LAST_DDL_TIME'));
  assert.equal(call[0], 'execute-sql-bg'); assert.ok(!call[1].includes("Pkg'Case")); assert.equal(call[2].name, "Pkg'Case"); assert.equal(call[2].owner, 'Case.Schema');
});
