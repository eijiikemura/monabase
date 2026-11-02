// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function load(file, invoke, dependencies = {}, extraWindow = {}) {
  const react = dependencies.react;
  const eventHook = react ? loadTypeScript('src/shared/hooks/useEventCallback.ts', {
    react: { ...react, useLayoutEffect: react.useEffect,
      useCallback: react.useCallback || (callback => callback) }
  }) : undefined;
  return loadTypeScript(file, {
    '@/shared/utils/objectIdentity': loadTypeScript('src/shared/utils/objectIdentity.ts'),
    '@/shared/api/desktop': { ipcRenderer: { invoke } },
    ...(eventHook ? { '@/shared/hooks/useEventCallback': eventHook } : {}), ...dependencies
  }, { window: extraWindow, alert() {} });
}

for (const isPg of [false, true]) {
  const db = isPg ? 'postgresql' : 'oracle';
  const name = value => isPg ? value.toLowerCase() : value.toUpperCase();
  test(`${db}: Limits column, primary key, foreign key, and comment queries to the target and direct relations`, async () => {
    const calls = [];
    const { fetchErMetadata } = load('src/features/er/erMetadata.ts', async (channel, sql, binds) => {
      assert.equal(channel, 'execute-sql-bg');
      calls.push({ sql, binds });
      return { success: true, rows: calls.length === 1 ? [
        { PARENT_TABLE: name('PARENT'), CHILD_TABLE: name('MAIN'), CHILD_COLUMN: 'ID' },
        { PARENT_TABLE: name('MAIN'), CHILD_TABLE: name('CHILD'), CHILD_COLUMN: 'ID' }
      ] : [] };
    });
    await fetchErMetadata(isPg, name('APP'), name('MAIN'), false);
    assert.equal(calls.length, 6);
    assert.equal(calls[0].binds.erMain, name('MAIN'));
    assert.match(calls[0].sql, /OR .* = :erMain/);
    for (const { sql, binds } of calls.slice(1)) {
      assert.deepEqual(Object.values(binds).sort(), ['MAIN', 'PARENT', 'CHILD'].map(name).sort());
      assert.match(sql, /IN \(:erTable0, :erTable1, :erTable2\)/);
      if (/ORDER BY/i.test(sql)) assert.ok(sql.indexOf(' IN ') < sql.indexOf('ORDER BY'));
    }
  });

  test(`${db}: Supports isolated tables, custom additions, and complete schemas`, async () => {
    for (const [target, custom, expectedCalls] of [[name('MAIN'), false, 6], [name('MAIN'), true, 5], [null, false, 5]]) {
      const calls = [];
      const { fetchErMetadata } = load('src/features/er/erMetadata.ts', async (channel, sql, binds) => {
        calls.push({ sql, binds });
        return { success: true, rows: [] };
      });
      const result = await fetchErMetadata(isPg, name('APP'), target, custom);
      assert.equal(result.columns.length, 0);
      assert.equal(calls.length, expectedCalls);
      if (target) assert.equal(calls.at(-1).binds.erTable0, name('MAIN'));
      else assert.equal(Object.keys(calls.at(-1).binds).length, 0);
    }
  });

  test(`${db}: Does not present failed relation queries as an empty result`, async () => {
    let count = 0;
    const { fetchErMetadata } = load('src/features/er/erMetadata.ts', async () => {
      count++;
      return { success: false, error: '取得失敗' };
    });
    await assert.rejects(fetchErMetadata(isPg, name('APP'), name('MAIN'), false), /取得失敗/);
    assert.equal(count, 1);
  });

  test(`${db}: Loads relations with one query and fetches choices only when adding`, async () => {
    const effects = [], calls = [], cached = [], updates = [];
    const react = {
      useRef: value => ({ current: value }),
      useEffect: callback => effects.push(callback),
      useState: value => [value, next => updates.push(next)]
    };
    const { useTableRelationTab } = load(`src/features/${db}/windows/table/useTableRelationTab.ts`, async (channel, sql) => {
      assert.equal(channel, 'execute-sql-bg');
      calls.push(sql);
      if (calls.length === 1) return { success: true, rows: [{ CONSTRAINT_NAME: 'FK_MAIN', SOURCE_COLUMN: 'ID', TARGET_TABLE: 'PARENT', TARGET_COLUMN: 'ID', DELETE_RULE: 'CASCADE' }] };
      return { success: true, rows: [] };
    }, {
      react, 'react-i18next': { useTranslation: () => ({ t: text => text }) },
      "@/shared/utils/errorUtils": { getErrorMessage: error => error.message }
    }, { addEventListener() {}, removeEventListener() {} });
    const hook = useTableRelationTab({ schema: name('APP'), tableName: name('MAIN'), isActive: true, setCachedRelations: data => cached.push(data) });
    effects.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(cached[0].relations[0].CONSTRAINT_NAME, 'FK_MAIN');
    assert.equal(cached[0].relations[0].SOURCE_COLUMNS, 'ID');
    assert.equal(cached[0].allTables.length, 0);
    await hook.handleOpenAddDialog();
    assert.equal(calls.length, 3);
    assert.ok(calls.slice(1).some(sql => /ALL_TAB_COLUMNS|information_schema.columns/.test(sql)));
    assert.ok(calls.slice(1).some(sql => /ALL_TABLES|information_schema.tables/.test(sql)));
    assert.equal(updates.at(-1), false);
  });

  test(`${db}: Reuses cached tabs and reloads after refresh notifications`, async () => {
    const slots = [], pendingEffects = [], listeners = new Map();
    let cursor = 0, calls = 0, cachedRelations = null;
    const react = {
      useRef(value) {
        const index = cursor++;
        slots[index] ||= { current: value };
        return slots[index];
      },
      useState(value) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = value;
        return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
      },
      useEffect(callback, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || !deps || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
          pendingEffects.push(() => {
            previous?.cleanup?.();
            slots[index] = { deps, cleanup: callback() };
          });
        }
      }
    };
    const { useTableRelationTab } = load(`src/features/${db}/windows/table/useTableRelationTab.ts`, async () => {
      calls++;
      return { success: true, rows: [] };
    }, {
      react, 'react-i18next': { useTranslation: () => ({ t: text => text }) },
      "@/shared/utils/errorUtils": { getErrorMessage: error => error.message }
    }, {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name)
    });
    const setCachedRelations = value => { cachedRelations = value; };
    const render = isActive => {
      cursor = 0;
      useTableRelationTab({ schema: name('APP'), tableName: name('MAIN'), isActive, cachedRelations, setCachedRelations });
      pendingEffects.splice(0).forEach(effect => effect());
    };
    render(true);
    await new Promise(resolve => setImmediate(resolve));
    render(true);
    render(false);
    render(true);
    assert.equal(calls, 1);
    listeners.get('reload-source')({ detail: { schema: name('APP'), tableName: name('MAIN') } });
    render(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
  });
}

test('Oracle: Splits more than one thousand related tables within the IN clause limit', async () => {
  const calls = [];
  const { fetchErMetadata } = load('src/features/er/erMetadata.ts', async (channel, sql) => {
    calls.push(sql);
    return { success: true, rows: calls.length === 1 ? Array.from({ length: 1001 }, (_, index) => ({
      PARENT_TABLE: 'MAIN', CHILD_TABLE: `CHILD_${index}`, CHILD_COLUMN: 'ID'
    })) : [] };
  });
  await fetchErMetadata(false, 'APP', 'MAIN', false);
  assert.match(calls[1], /OR table_name IN \(:erTable1000, :erTable1001\)/);
});

test('ER assembly preserves parents, children, comments, and identifying relationships', async () => {
  const metadata = {
    columns: ['PARENT', 'MAIN', 'CHILD', 'UNRELATED'].map(TABLE_NAME => ({ TABLE_NAME, COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 10 })),
    primaryKeys: [{ TABLE_NAME: 'MAIN', COLUMN_NAME: 'ID' }],
    foreignKeys: [
      { PARENT_TABLE: 'PARENT', CHILD_TABLE: 'MAIN', CHILD_COLUMN: 'ID' },
      { PARENT_TABLE: 'MAIN', CHILD_TABLE: 'CHILD', CHILD_COLUMN: 'ID' }
    ],
    tableComments: [{ TABLE_NAME: 'MAIN', COMMENTS: '対象テーブル' }],
    columnComments: [{ TABLE_NAME: 'MAIN', COLUMN_NAME: 'ID', COMMENTS: '識別子' }]
  };
  const { fetchErDiagramData } = load('src/features/er/useErDiagramWindow.ts', async () => {}, {
    './formatDataType': loadTypeScript('src/features/er/formatDataType.ts'),
    './erMetadata': { fetchErMetadata: async () => metadata },
    "@/shared/utils/errorUtils": {}, "@/shared/hooks/useLoadingCounter": {}, react: {}, 'react-i18next': {},
    reactflow: {}, 'html-to-image': {}, "../postgresql/windows/common/schemaStorage": {}
  });
  const result = await fetchErDiagramData(false, 'APP', 'MAIN', true, true, false);
  assert.deepEqual(Array.from(result.nodes, node => node.id).sort(), ['CHILD', 'MAIN', 'PARENT']);
  const main = result.nodes.find(node => node.id === 'MAIN');
  assert.equal(main.data.tableComment, '対象テーブル');
  assert.equal(main.data.columns[0].comment, '識別子');
  assert.equal(main.data.columns[0].isPk, true);
  assert.equal(main.data.columns[0].isFk, true);
  assert.equal(result.edges.length, 2);
  assert.equal(result.edges.find(edge => edge.target === 'MAIN').data.isIdentifying, true);
  assert.ok(main.position.x > result.nodes.find(node => node.id === 'PARENT').position.x);
});
