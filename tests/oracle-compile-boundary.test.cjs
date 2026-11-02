// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createStoredHarness } = require('./helpers/storedLogic.cjs');

const original = 'CREATE OR REPLACE PROCEDURE TEST.A AS BEGIN NULL; END;';
function fixture(options = {}) {
  const h = createStoredHarness(async (channel, query) => {
    if (channel === 'execute-sql-bg' && /SELECT STATUS/.test(query)) return { success: true, rows: [{ STATUS: 'VALID' }] };
    if (channel === 'execute-sql-bg' && /GET_DDL/.test(query)) return { success: true, rows: [{ DDL: original }] };
    return { success: true, rows: [] };
  }, options);
  return h;
}

for (const [name, source] of Object.entries({
  name: original.replace('TEST.A', 'TEST.B'),
  schema: original.replace('TEST.A', 'OTHER.A'),
  type: 'CREATE OR REPLACE FUNCTION TEST.A RETURN NUMBER AS BEGIN RETURN 1; END;',
  case: original.replace('TEST.A', 'TEST."a"'),
  additional: original + '\n/\nCREATE OR REPLACE PROCEDURE TEST.B AS BEGIN NULL; END;\n/',
  empty: '-- No program'
})) {
  test(`Existing Oracle compile rejects ${name} before any IPC and preserves the draft`, async () => {
    const h = fixture(); await h.render().loadObjectInfo(); h.calls.length = 0; h.render().setSourceText(source);
    await h.render().handleCompile(() => {});
    assert.equal(h.calls.length, 0);
    assert.equal(h.render().sourceText, source);
    assert.equal(h.render().hasUnsavedChanges, true);
    assert.ok(h.render().compileErrors.length > 0);
    h.dispose();
  });
}

for (const options of [{}, { isNew: true }]) {
  test(`Oracle ${options.isNew ? 'new' : 'existing'} compile accepts matching quoted identity and one delimiter`, async () => {
    const h = fixture(options);
    if (!options.isNew) await h.render().loadObjectInfo();
    h.calls.length = 0;
    const source = original.replace('TEST.A', '"TEST"."A"') + '\n/\n-- trailing comment';
    h.render().setSourceText(source); await h.render().handleCompile(() => {});
    const ddl = h.calls.filter(([channel, sql]) => channel === 'execute-sql' && /^CREATE/.test(sql));
    assert.equal(ddl.length, 1);
    assert.equal(ddl[0][1], source.replace('\n/\n', '\n\n'));
    const errorQuery = h.calls.find(([channel, sql]) => channel === 'execute-sql-bg' && /FROM ALL_ERRORS/.test(sql));
    assert.equal(errorQuery[2].name, 'A');
    h.dispose();
  });
}

test('New Oracle compile rejects another schema before creation', async () => {
  const h = fixture({ isNew: true }); h.render().setSourceText(original.replace('TEST.A', 'OTHER.A'));
  await h.render().handleCompile(() => {}); assert.equal(h.calls.length, 0); h.dispose();
});

const fragments = {
  comment: '/* documentation\n/\ncontinued documentation */',
  string: "v := 'first\n/\nlast';",
  escaped: "v := 'owner''s\n/\ntext';",
  qquote: "v := q'[owner's\n/\ntext]';",
  nqquote: "v := nq'{owner's\n/\ntext}';"
};
for (const [name, fragment] of Object.entries(fragments)) {
  test(`Oracle compilation preserves slash-only lines in a ${name} and sends one statement`, async () => {
    const source = `-- Leading comment\nCREATE OR REPLACE PROCEDURE TEST.A AS\nv VARCHAR2(200);\nBEGIN\n${fragment}\nNULL;\nEND;\n/\n-- Final comment`;
    const calls = [];
    const { executeCompile } = loadTypeScript('src/features/stored/storedCommon.ts', {
      i18next: { t: key => key }, '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
        calls.push(args); return { success: true, rows: [] };
      } } }
    });
    assert.equal((await executeCompile('TEST', 'A', source)).success, true);
    const ddl = calls.filter(([channel, sql]) => channel === 'execute-sql' && !/FROM ALL_ERRORS/.test(sql));
    assert.equal(ddl.length, 1);
    assert.equal(ddl[0][1], source.replace('\n/\n-- Final comment', '\n\n-- Final comment'));
  });
}

test('The compile helper refuses multiple statements before sending the first one', async () => {
  const calls = [];
  const { executeCompile } = loadTypeScript('src/features/stored/storedCommon.ts', {
    i18next: { t: key => key }, '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return { success: true }; } } }
  });
  await assert.rejects(() => executeCompile('TEST', 'A', original + '\n/\nDROP TABLE TEST.DATA;'), /compile_one_program_at_a_time/);
  assert.equal(calls.length, 0);
});
