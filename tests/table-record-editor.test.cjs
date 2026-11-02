// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const types = loadTypeScript('src/shared/types/databaseTypes.ts');
const identities = loadTypeScript('src/features/data-grid/rowIdentity.ts');
const { withRowIdentity } = identities;

function editor(db, overrides = {}, invoke = async () => ({ success: true, rowsAffected: 1 })) {
  const requests = [], logs = [], loading = [], searches = [], dialogs = [], alerts = [];
  const { createTableRecordEditor } = loadTypeScript(`src/features/${db}/windows/table/tableRecordEditor.ts`, {
    '@/shared/utils/objectIdentity': loadTypeScript('src/shared/utils/objectIdentity.ts'),
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { requests.push(args); return invoke(...args); } } },
    '@/shared/utils/errorUtils': { getErrorMessage: error => error.message },
    '@/shared/utils/dateFormatter': { formatDbDate: value => String(value) },
    '@/shared/types/databaseTypes': types,
    '@/features/data-grid/rowIdentity': identities
  }, { alert: message => alerts.push(message), window: { confirm: () => true } });
  const context = {
    schema: 'APP', tableName: 'ITEMS', inputDateFormat: 'YYYY-MM-DD',
    structureDefs: [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'int', PK_POSITION: 1 },
      { COLUMN_NAME: 'NAME', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'varchar' }],
    hasLobColumns: false, isTransposed: false, conditions: {}, paginationModel: { page: 0, pageSize: 50 },
    recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'update', recordData: { ID: 1, NAME: 'new' },
      initialRecordData: { ID: 1, NAME: 'old' }, targetRowId: 'ROW1' },
    t: key => key, formatSqlValue: (_column, value) => typeof value === 'number' ? value : `'${String(value).replaceAll("'", "''")}'`,
    getPkWhereClause: row => `"ID" = ${row.ID}`,
    executeSearch: async (...args) => searches.push(args),
    setRecordDialog: state => dialogs.push(state), setDataContextMenu() {},
    setIsLoading: value => loading.push(value), setLogs: update => update(logs), setBottomTab() {}, setResultRows() {}, ...overrides
  };
  return { ...createTableRecordEditor(context), context, requests, logs, loading, searches, dialogs, alerts };
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: Record updates preserve database-specific identity and remain uncommitted`, async () => {
    const h = editor(db);
    await h.submitRecord();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0][0], 'execute-sql');
    assert.match(h.requests[0][1], /^UPDATE /);
    assert.match(h.requests[0][1], db === 'oracle' ? /WHERE ROWID = 'ROW1'/ : /WHERE "ID" = 1/);
    assert.match(h.requests[0][1], /NAME.*'new'/);
    assert.equal(h.searches.length, 1);
    assert.equal(h.dialogs.at(-1).isOpen, false);
    assert.deepEqual(h.loading, [true, false]);
  });

  test(`${db}: Failed updates retain the editor and do not refresh the displayed rows`, async () => {
    const h = editor(db, {}, async () => ({ success: false, error: 'database unavailable' }));
    await h.submitRecord();
    assert.equal(h.requests.length, 1);
    assert.equal(h.searches.length, 0);
    assert.equal(h.dialogs.length, 0);
    assert.match(h.alerts.at(-1), /database unavailable/);
    assert.deepEqual(h.loading, [true, false]);
  });

  test(`${db}: Binary record editing loads full values only through the main connection`, async () => {
    const h = editor(db, { hasLobColumns: true }, async () => ({ success: true, rows: [{ ID: 1, NAME: 'full value' }] }));
    await h.handleOpenUpdate(withRowIdentity({ ID: 1, NAME: 'preview', ORACLE_ROWID: 'business-value' }, 1, 'ROW1'));
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0][0], 'execute-sql');
    assert.match(h.requests[0][1], /^SELECT /);
    assert.equal(h.dialogs.at(-1).recordData.NAME, 'full value');
  });
}

for (const db of ['oracle', 'postgresql']) {
  for (const action of ['handleOpenUpdate', 'handleOpenDuplicate']) test(`${db}: ${action} refuses failed, missing, ambiguous and incomplete full records`, async () => {
    const row = withRowIdentity({ ID: 1, NAME: 'preview' }, 1, 'ROW1');
    for (const response of [{ success: false, error: 'Unavailable' }, { success: true, rows: [] }, { success: true, rows: [{ ID: 1, NAME: 'a' }, { ID: 1, NAME: 'b' }] }, { success: true, rows: [{ ID: 1 }] }, new Error('Rejected request')]) {
      const h = editor(db, { hasLobColumns: true }, async () => { if (response instanceof Error) throw response; return response; });
      await h[action](row);
      assert.equal(h.dialogs.length, 0); assert.equal(h.alerts.length, 1); assert.deepEqual(h.loading, [true, false]);
      assert.ok(h.requests.every(request => request[1].startsWith('SELECT'))); assert.equal(h.searches.length, 0);
    }
  });
  test(`${db}: a complete row with NULL data is valid and successful retries use fetched values`, async () => {
    const h = editor(db, { hasLobColumns: true }, async () => ({ success: true, rows: [{ ID: 1, NAME: null }] }));
    await h.handleOpenDuplicate(withRowIdentity({ ID: 1, NAME: 'preview' }, 1, 'ROW1'));
    assert.equal(h.dialogs[0].recordData.NAME, null); assert.equal(h.alerts.length, 0); assert.deepEqual(h.loading, [true, false]);
  });
}

for (const db of ['oracle', 'postgresql']) test(`${db}: binary record loads preserve bytes, empty values and reject display placeholders`, async () => {
  const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }, { COLUMN_NAME: 'NAME', DATA_TYPE: db === 'oracle' ? 'BLOB' : 'bytea' }];
  for (const [data, expected] of [[new Uint8Array([0, 255]), '00ff'], [new Uint8Array(), ''], ['', '']]) {
    const h = editor(db, { hasLobColumns: true, structureDefs: defs }, async () => ({ success: true, rows: [{ ID: 1, NAME: data }] }));
    await h.handleOpenDuplicate(withRowIdentity({ ID: 1, NAME: '[preview]' }, 1, 'ROW1'));
    assert.equal(h.dialogs[0].recordData.NAME.hex, expected); assert.equal(h.alerts.length, 0);
  }
  const invalid = editor(db, { hasLobColumns: true, structureDefs: defs }, async () => ({ success: true, rows: [{ ID: 1, NAME: '[preview]' }] }));
  await invalid.handleOpenUpdate(withRowIdentity({ ID: 1, NAME: '[preview]' }, 1, 'ROW1'));
  assert.equal(invalid.dialogs.length, 0); assert.equal(invalid.alerts.length, 1);
});

test('Oracle generates EMPTY_BLOB instead of a NULL-producing empty binary bind', async () => {
  const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', PK_POSITION: 1 }, { COLUMN_NAME: 'NAME', DATA_TYPE: 'BLOB' }];
  for (const mode of ['insert', 'update']) {
    const h = editor('oracle', { structureDefs: defs, recordSaving: { current: false }, recordDialog: { isOpen: true, mode, recordData: { ID: 1, NAME: { isBlob: true, hex: '' } }, initialRecordData: { ID: 1, NAME: null }, targetRowId: 'ROW1' } });
    await h.submitRecord(); assert.ok(h.requests[0][1].includes('EMPTY_BLOB()')); assert.equal(Object.keys(h.requests[0][2]).length, 0);
    const replacement = editor('oracle', { structureDefs: defs, recordSaving: { current: false }, recordDialog: { isOpen: true, mode, recordData: { ID: 1, NAME: { isBlob: true, hex: '', data: new Uint8Array([1]) } }, initialRecordData: { ID: 1, NAME: null }, targetRowId: 'ROW1' } });
    await replacement.submitRecord(); assert.ok(!replacement.requests[0][1].includes('EMPTY_BLOB()')); assert.equal(replacement.requests[0][2].value1[0], 1);
  }
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: unconfirmed dialog updates retain input and never report success or refresh rows`, async () => {
    for (const rowsAffected of [0, undefined, 2, NaN]) {
      let log = [], bottom;
      const h = editor(db, { setLogs: update => { log = update(log); }, setBottomTab: value => { bottom = value; } }, async () => ({ success: true, rowsAffected }));
      await h.submitRecord();
      assert.equal(h.dialogs.length, 0); assert.equal(h.searches.length, 0); assert.equal(h.context.recordDialog.recordData.NAME, 'new');
      assert.equal(h.alerts.length, 1); assert.match(h.alerts[0], rowsAffected === 0 ? /record_update_no_rows/ : /record_update_unconfirmed/);
      assert.equal(bottom, 1); assert.equal(log[0].resultMsg, 'update_error_2'); assert.deepEqual(h.loading, [true, false]);
    }
  });
  test(`${db}: zero-row and unknown-count inline updates preserve the original row and grid identity`, async () => {
    for (const rowsAffected of [0, undefined]) {
      let replaced = false;
      const h = editor(db, { setResultRows() { replaced = true; } }, async () => ({ success: true, rowsAffected }));
      const row = withRowIdentity({ ID: 1, NAME: 'old' }, 9, 'ROW1');
      const result = await h.handleProcessRowUpdate({ ...row, NAME: 'new' }, row);
      assert.equal(result, row); assert.equal(identities.getRowIdentity(result), 9); assert.equal(replaced, false); assert.equal(h.alerts.length, 1);
    }
  });
  test(`${db}: unchanged binary bytes issue no UPDATE even if file metadata or representation changes`, async () => {
    const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }, { COLUMN_NAME: 'NAME', DATA_TYPE: db === 'oracle' ? 'BLOB' : 'bytea' }];
    const original = { isBlob: true, hex: '00FF', fileName: 'old', sizeStr: '2 bytes' };
    for (const current of [original, { isBlob: true, data: new Uint8Array([0, 255]), fileName: 'new' }]) {
      const h = editor(db, { structureDefs: defs, recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'update', recordData: { ID: 1, NAME: current }, initialRecordData: { ID: 1, NAME: original }, targetRowId: 'ROW1' } });
      await h.submitRecord(); assert.equal(h.requests.length, 0); assert.equal(h.alerts[0], 'no_data_modified'); assert.equal(h.dialogs.length, 0);
    }
    const changedText = editor(db, { structureDefs: [...defs, { COLUMN_NAME: 'NOTE', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'varchar' }], recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'update', recordData: { ID: 1, NAME: original, NOTE: 'new' }, initialRecordData: { ID: 1, NAME: original, NOTE: 'old' }, targetRowId: 'ROW1' } });
    await changedText.submitRecord(); assert.match(changedText.requests[0][1], /SET "NOTE" =/); assert.ok(!changedText.requests[0][1].includes('"NAME"')); assert.equal(Object.keys(changedText.requests[0][2]).length, 0);
    const changedBytes = editor(db, { structureDefs: defs, recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'update', recordData: { ID: 1, NAME: { isBlob: true, hex: '0001' } }, initialRecordData: { ID: 1, NAME: original }, targetRowId: 'ROW1' } });
    await changedBytes.submitRecord(); assert.equal(changedBytes.requests[0][2].value1[1], 1); assert.equal(changedBytes.dialogs.at(-1).isOpen, false);
  });
}

test('Binary record equality respects view offsets, data precedence, empty values and invalid representations', () => {
  const { recordValuesEqual } = loadTypeScript('src/features/table/recordValues.ts');
  const source = new Uint8Array([9, 0, 255, 9]);
  assert.equal(recordValuesEqual({ isBlob: true, data: source.subarray(1, 3), hex: 'ffff' }, { isBlob: true, hex: '00FF' }), true);
  assert.equal(recordValuesEqual({ isBlob: true, data: new ArrayBuffer(0) }, { isBlob: true, hex: '' }), true);
  assert.equal(recordValuesEqual({ isBlob: true, hex: '' }, null), false);
  assert.equal(recordValuesEqual({ isBlob: true, hex: 'not hex' }, { isBlob: true, hex: 'not hex' }), false);
});

test('PostgreSQL record dialogs store literal null, explicit NULL and omitted defaults separately', async () => {
  const { createTableQueryBuilder } = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts');
  const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: 'varchar', NULLABLE: 'N', PK_POSITION: 1 }, { COLUMN_NAME: 'NAME', DATA_TYPE: 'varchar', NULLABLE: 'Y', DATA_DEFAULT: "'fallback'" }];
  const { formatSqlValue } = createTableQueryBuilder({ structureDefs: defs });
  for (const [value, expected] of [['null', "'null'"], [null, 'NULL'], ['', null]]) {
    const h = editor('postgresql', { structureDefs: defs, formatSqlValue, recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'insert', recordData: { ID: 'null', NAME: value }, initialRecordData: {} } });
    await h.submitRecord(); assert.equal(h.requests.length, 1);
    const sql = h.requests[0][1]; assert.ok(sql.includes("'null'"));
    if (expected) assert.ok(sql.includes(`, ${expected})`));
    else assert.ok(!sql.includes('"NAME"'));
  }
  const invalid = editor('postgresql', { structureDefs: defs, formatSqlValue, recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'insert', recordData: { ID: null, NAME: 'ok' }, initialRecordData: {} } });
  await invalid.submitRecord(); assert.equal(invalid.requests.length, 0); assert.ok(invalid.alerts.length);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
for (const db of ['oracle', 'postgresql']) {
  for (const mode of ['insert', 'duplicate', 'update']) {
    test(`${db}: ${mode} submission stays guarded across recreated editors and blocks closing`, async () => {
      const pending = deferred();
      const h = editor(db, { recordSaving: { current: false }, recordDialog: { isOpen: true, mode,
        recordData: { ID: 2, NAME: 'new' }, initialRecordData: { ID: 1, NAME: 'old' }, targetRowId: 'ROW1' } }, () => pending.promise);
      const first = h.submitRecord(); await h.submitRecord(); h.handleCloseDialog(); h.handleOpenInsert();
      const recreated = editor(db, h.context);
      await recreated.submitRecord(); recreated.handleCloseDialog();
      assert.equal(h.requests.length, 1); assert.equal(recreated.requests.length, 0); assert.equal(h.dialogs.length, 0);
      assert.equal(h.context.recordSaving.current, true);
      pending.resolve({ success: true, rowsAffected: 1 }); await first;
      assert.equal(h.context.recordSaving.current, false);
      assert.equal(h.dialogs.at(-1).isOpen, false);
      assert.equal(h.searches.length, 1);
    });
  }
  for (const mode of ['insert', 'duplicate']) {
    test(`${db}: ${mode} requires one confirmed affected row and keeps input for all other counts`, async () => {
      for (const rowsAffected of [0, undefined, 2, -1, NaN, 1.5]) {
        const h = editor(db, { recordSaving: { current: false }, recordDialog: { isOpen: true, mode,
          recordData: { ID: 2, NAME: 'retained' }, initialRecordData: {}, targetRowId: '' } }, async () => ({ success: true, rowsAffected }));
        await h.submitRecord();
        assert.equal(h.dialogs.length, 0); assert.equal(h.searches.length, 0);
        assert.equal(h.context.recordDialog.recordData.NAME, 'retained');
        assert.equal(h.alerts.at(-1), rowsAffected === 0 ? 'record_insert_no_rows' : 'record_insert_unconfirmed');
        assert.equal(h.context.recordSaving.current, false);
      }
    });
  }
  for (const failure of ['response', 'rejection']) {
    test(`${db}: failed insert ${failure} releases the guard and can be retried`, async () => {
      let attempts = 0;
      const h = editor(db, { recordSaving: { current: false }, recordDialog: { isOpen: true, mode: 'insert',
        recordData: { ID: 2, NAME: 'retained' }, initialRecordData: {}, targetRowId: '' } }, async () => {
        if (++attempts > 1) return { success: true, rowsAffected: 1 };
        if (failure === 'rejection') throw new Error('Simulated insert rejection');
        return { success: false, error: 'Simulated insert failure' };
      });
      await h.submitRecord(); assert.equal(h.dialogs.length, 0); assert.equal(h.context.recordSaving.current, false);
      await h.submitRecord(); assert.equal(attempts, 2); assert.equal(h.dialogs.at(-1).isOpen, false);
    });
  }
  test(`${db}: the actual table hook blocks draft mutation and repeated save after rendering`, async () => {
    const { createTableHarness } = require('./helpers/tableData.cjs');
    const pending = deferred(); let writes = 0;
    const h = await createTableHarness(db, async (channel, sql) => {
      if (/^INSERT/.test(sql)) { writes++; return pending.promise; }
      if (channel === 'execute-sql-bg') return { success: true, rows: [{ COLUMN_NAME: 'LABEL', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' }] };
      if (/COUNT/.test(sql)) return { success: true, rows: [{ CNT: 0 }] };
      return { success: true, rows: [], metaData: [{ name: 'LABEL' }] };
    });
    h.state.handleOpenInsert(); await h.flush();
    h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { LABEL: 'original' } }); await h.flush();
    const save = h.state.submitRecord(); await h.flush();
    assert.equal(h.state.isSavingRecord, true);
    h.state.setRecordDialog({ ...h.state.recordDialog, recordData: { LABEL: 'changed' } });
    h.state.handleCloseDialog(); await h.state.submitRecord(); await h.flush();
    assert.equal(h.state.recordDialog.recordData.LABEL, 'original'); assert.equal(h.state.recordDialog.isOpen, true); assert.equal(writes, 1);
    pending.resolve({ success: true, rowsAffected: 1 }); await save; await h.flush();
    assert.equal(h.state.isSavingRecord, false); assert.equal(h.state.recordDialog.isOpen, false);
    h.unmount();
  });
}
