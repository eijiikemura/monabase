// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const blocks = loadTypeScript('src/features/stored/traceBlockEnd.ts');

for (const database of ['oracle', 'postgresql']) {
  const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${database}/windows/trigger/triggerTraceProgram.ts`, {
    '@/features/stored/traceBlockEnd': blocks
  });
  const context = {
    wizBody: `BEGIN\n  ${database === 'oracle' ? ':' : ''}NEW.ID := 7;\nEND TRG_DEMO;`,
    wizSchema: 'APP', wizTargetObject: 'DEMO', wizTiming: 'BEFORE', wizForEachRow: true,
    traceTargetDml: 'INSERT', traceInputData: { ID: '7' },
    structureDefs: [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER' }], checkWhere: 'ID = 7',
    formatSqlValue: (_column, value) => Number(value), wizAliasOld: 'OLD', newAliasRaw: 'NEW'
  };

  test(`${database}: Trigger trace generation preserves source mapping, aliases, and rollback`, () => {
    const program = buildTriggerTraceProgram(context);
    assert.match(program.sqlText, /v_n\.ID := 7;/);
    assert.ok(!program.sqlText.includes('END TRG_DEMO;'));
    assert.match(program.sqlText, /ROLLBACK;/);
    const generatedLine = program.mapT2P[2];
    assert.ok(generatedLine > 0);
    assert.equal(program.mapP2T[generatedLine], 2);
    const lines = program.sqlText.split('\n');
    assert.ok(lines.slice(generatedLine - 1, generatedLine + 1).some(line => line.includes('v_n.ID := 7;')));
  });

  test(`${database}: Row-level updates target the current row and INSTEAD OF skips physical DML`, () => {
    const update = buildTriggerTraceProgram({ ...context, traceTargetDml: 'UPDATE' });
    assert.match(update.sqlText, database === 'oracle' ? /FOR r_target IN c_target LOOP/ : /FOR r_target IN SELECT ctid AS rid/);
    assert.match(update.sqlText, database === 'oracle' ? /WHERE ROWID = r_target\.rid/ : /WHERE ctid = r_target\.rid/);
    const insteadOf = buildTriggerTraceProgram({ ...context, wizTiming: 'INSTEAD OF' });
    assert.ok(!insteadOf.sqlText.includes('INSERT INTO'));
  });
}
