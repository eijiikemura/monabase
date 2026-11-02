// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const identity = loadTypeScript('src/shared/utils/objectIdentity.ts');

function sidebar(db, respond) {
  const opened = [], slots = [], requests = [], timers = new Map();
  let cursor = 0, timerId = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useEffect() {}
  };
  const module = loadTypeScript(`src/features/${db}/${db === 'oracle' ? 'useSidebarObjects' : 'useSidebarLogic'}.ts`, {
    react,
    './triggerIdentity': loadTypeScript('src/features/postgresql/triggerIdentity.ts'), 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/shared/utils/objectIdentity': identity,
    '@/shared/utils/dateFormatter': { getOracleDateFormat: () => 'YYYY-MM-DD' },
    './sidebarQueries': loadTypeScript('src/features/oracle/sidebarQueries.ts'),
    '@/shared/hooks/useEventCallback': { useEventCallback: callback => callback },
    './sidebarDataTransfer': { createSidebarDataTransfer: () => ({}) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql, binds) => {
      requests.push({ channel, sql, binds });
      return respond(sql, binds);
    } } }
  }, {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    requests, opened,
    render() {
      cursor = 0;
      return db === 'oracle' ? module.useSidebarObjects('yyyy-MM-dd') :
        module.useSidebarLogic({ schemas: ['APP'], expandedSchemas: ['APP'], onAddTab(...args) { opened.push(args); }, outputDateFormat: 'yyyy-MM-dd' });
    },
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
    async flushFilters() { for (const callback of timers.values()) callback(); timers.clear(); await this.settle(); }
  };
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: older category responses cannot replace a newer filter or clear its loading indicator`, async () => {
    const pending = [];
    const harness = sidebar(db, sql => /WITH list/.test(sql) ? new Promise(resolve => pending.push(resolve)) : { success: true, rows: [] });
    const key = identity.qualifiedObjectName({ schema: 'APP', objectName: 'TABLE' });
    harness.render().handleFilterChange(key, 'OLD'); await harness.flushFilters();
    harness.render().handleFilterChange(key, 'NEW'); await harness.flushFilters();
    const row = name => db === 'oracle' ? { OBJECT_NAME: name } : { name };
    pending[0]({ success: true, rows: [row('OLD')] }); await harness.settle();
    assert.ok(harness.render().loadingCategories.includes(key));
    assert.equal(harness.render().loadedObjects[key], undefined);
    pending[1]({ success: true, rows: [row('NEW')] }); await harness.settle();
    assert.equal(harness.render().loadingCategories.includes(key), false);
    const rows = harness.render().loadedObjects[key];
    assert.equal(db === 'oracle' ? rows[0] : rows[0].name, 'NEW');
  });
  test(`${db}: category keys match the sidebar through expansion, caching, filtering, pagination, and refresh`, async () => {
    const schema = 'APP.DATA', type = 'TABLE';
    const key = identity.qualifiedObjectName({ schema, objectName: type });
    const harness = sidebar(db, sql => ({ success: true, rows: /INVALID/.test(sql) ? [] :
      Array.from({ length: 100 }, (_, index) => db === 'oracle' ? { OBJECT_NAME: `ITEM_${index}` } : { name: `ITEM_${index}`, status: 'VALID' }) }));
    await harness.render().toggleType(schema, type);
    await harness.settle();
    assert.ok(harness.render().expandedTypes.includes(key));
    assert.equal(harness.render().loadedObjects[key].length, 100);
    assert.equal(harness.render().hasMore(key), true);
    assert.equal(harness.render().loadingCategories.includes(key), false);
    const requestCount = harness.requests.length;
    await harness.render().toggleType(schema, type);
    assert.equal(harness.render().expandedTypes.includes(key), false);
    await harness.render().toggleType(schema, type);
    assert.equal(harness.requests.length, requestCount, 'Reopening uses cached objects');
    harness.render().handleFilterChange(key, ' ITEM ');
    await harness.flushFilters();
    const filtered = harness.requests.findLast(request => /WITH list/.test(request.sql));
    assert.equal(filtered.binds.schema, "APP.DATA");
    assert.equal(filtered.binds.filter, "%ITEM%");
    harness.render().loadMore(key);
    await harness.settle();
    assert.equal(harness.render().loadedObjects[key].length, 200);
    assert.ok(harness.requests.some(request => /OFFSET 100/.test(request.sql)));
    harness.render().handleRefreshObjects({ stopPropagation() {} }, schema, type);
    await harness.settle();
    assert.equal(harness.render().loadedObjects[key].length, 100);
    assert.ok(harness.requests.every(request => request.channel === 'execute-sql-bg'));
  });
}

test('Oracle: materialized-view refresh dates use the same identity as the rendered object', async () => {
  const schema = 'APP', objectName = 'DAILY.SALES';
  const harness = sidebar('oracle', () => ({ success: true, rows: [
    { MVIEW_NAME: objectName, LAST_REFRESH: '2026-10-21' },
    { MVIEW_NAME: 'PENDING', LAST_REFRESH: null }
  ] }));
  await harness.render().fetchMViewRefreshDates(schema);
  assert.equal(harness.render().mviewRefreshDates[identity.qualifiedObjectName({ schema, objectName })], '2026-10-21');
  assert.equal(harness.render().mviewRefreshDates[identity.qualifiedObjectName({ schema, objectName: 'PENDING' })], 'unrefreshed');
});


test('PostgreSQL TYPE listing includes enum and standalone composite types, excluding table row types', async () => {
  const h = sidebar('postgresql', () => ({ success: true, rows: [{ name: 'EnumType', status: 'VALID' }, { name: 'CompositeType', status: 'VALID' }] }));
  await h.render().toggleType('APP', 'TYPE'); await h.settle();
  const query = h.requests.find(request => /WITH list/.test(request.sql)).sql;
  assert.match(query, /t.typtype = 'e'/); assert.match(query, /t.typtype = 'c' AND c.relkind = 'c'/);
  assert.match(query, /LEFT JOIN pg_class c ON c.oid = t.typrelid/);
  assert.equal(h.render().loadedObjects[identity.qualifiedObjectName({ schema: 'APP', objectName: 'TYPE' })].length, 2);
});

for (const db of ['oracle', 'postgresql']) {
  const row = name => db === 'oracle' ? { OBJECT_NAME: name } : { name, status: 'VALID' };
  const key = identity.qualifiedObjectName({ schema: 'App.Special', objectName: 'TABLE' });
  test(`${db}: failed refresh retains the last list and retry replaces it only after success`, async () => {
    let mode = 'initial';
    const h = sidebar(db, sql => !/WITH list/.test(sql) ? { success: true, rows: [] } : mode === 'failed' ?
      { success: false, error: 'Unavailable' } : { success: true, rows: [row(mode)] });
    await h.render().toggleType('App.Special', 'TABLE'); await h.settle();
    const previous = h.render().loadedObjects[key];
    mode = 'failed'; h.render().handleRefreshObjects({ stopPropagation() {} }, 'App.Special', 'TABLE'); await h.settle();
    assert.equal(h.render().loadedObjects[key], previous);
    assert.equal(h.render().categoryErrors[key], 'sidebar_list_unavailable');
    mode = 'retry'; await h.render().retryCategory(key); await h.settle();
    assert.equal(h.render().categoryErrors[key], '');
    assert.equal(db === 'oracle' ? h.render().loadedObjects[key][0] : h.render().loadedObjects[key][0].name, 'retry');
  });
  test(`${db}: first-load failure stays distinct from empty results and can be retried`, async () => {
    let fails = true;
    const h = sidebar(db, sql => { if (/WITH list/.test(sql) && fails) throw new Error('Offline'); return { success: true, rows: [] }; });
    await h.render().toggleType('App.Special', 'TABLE'); await h.settle();
    assert.equal(h.render().loadedObjects[key], undefined); assert.ok(h.render().categoryErrors[key]);
    fails = false; await h.render().retryCategory(key); await h.settle();
    assert.equal(h.render().loadedObjects[key].length, 0); assert.equal(h.render().categoryErrors[key], '');
  });
  test(`${db}: filter changes immediately block old-page appends and bind literal special characters`, async () => {
    const h = sidebar(db, sql => ({ success: true, rows: /WITH list/.test(sql) ? Array.from({ length: 100 }, (_, i) => row('OLD_' + i)) : [] }));
    await h.render().toggleType('App.Special', 'TABLE'); await h.settle();
    const before = h.requests.length;
    h.render().handleFilterChange(key, "a_%!O'Reilly");
    assert.ok(h.render().loadingCategories.includes(key)); assert.equal(h.render().hasMore(key), false);
    h.render().loadMore(key); assert.equal(h.requests.length, before);
    await h.flushFilters();
    const request = h.requests.findLast(r => /WITH list/.test(r.sql));
    assert.equal(request.binds.schema, 'App.Special'); assert.equal(request.binds.filter, "%a!_!%!!O'Reilly%");
    assert.ok(!request.sql.includes("O'Reilly")); assert.match(request.sql, /ESCAPE '!'/);
    h.render().handleFilterChange(key, '');
    const clearingRequests = h.requests.length; h.render().loadMore(key);
    assert.equal(h.requests.length, clearingRequests); await h.flushFilters();
    assert.equal(h.render().hasMore(key), true);
    assert.equal(h.requests.findLast(r => /WITH list/.test(r.sql)).binds.filter, undefined);
    h.render().handleFilterChange(key, 'TEMP'); h.render().handleFilterChange(key, '');
    const revertingRequests = h.requests.length; h.render().loadMore(key);
    assert.equal(h.requests.length, revertingRequests, 'Returning to the displayed filter still waits for its debounce');
    await h.flushFilters();
  });
  test(`${db}: failed next-page retry keeps the offset and duplicate clicks send one request`, async () => {
    const pending = []; let first = true;
    const h = sidebar(db, sql => {
      if (!/WITH list/.test(sql)) return { success: true, rows: [] };
      if (first) { first = false; return { success: true, rows: Array.from({ length: 100 }, (_, i) => row('ITEM_' + i)) }; }
      return new Promise(resolve => pending.push(resolve));
    });
    await h.render().toggleType('App.Special', 'TABLE'); await h.settle();
    h.render().loadMore(key); h.render().loadMore(key); assert.equal(pending.length, 1);
    pending[0]({ success: false, error: 'Offline' }); await h.settle();
    assert.equal(h.render().loadedObjects[key].length, 100); assert.equal(h.render().hasMore(key), false);
    const retry = h.render().retryCategory(key); h.render().retryCategory(key); assert.equal(pending.length, 2);
    pending[1]({ success: true, rows: [row('LAST')] }); await retry; await h.settle();
    assert.equal(h.render().loadedObjects[key].length, 101);
    assert.match(h.requests.findLast(r => /WITH list/.test(r.sql)).sql, /OFFSET 100/);
    assert.equal(h.render().hasMore(key), false);
  });
}

test('Sidebar selection identities separate schemas, categories, overloads and trigger tables', () => {
  const { sidebarObjectKey } = loadTypeScript('src/features/objects/sidebarNavigation.ts');
  const keys = [sidebarObjectKey('A', 'TABLE', 'X'), sidebarObjectKey('B', 'TABLE', 'X'),
    sidebarObjectKey('A', 'VIEW', 'X'), sidebarObjectKey('A', 'FUNCTION', 'X', 'integer'),
    sidebarObjectKey('A', 'FUNCTION', 'X', 'text'), sidebarObjectKey('A', 'TRIGGER', 'X', '', 'T1'),
    sidebarObjectKey('A', 'TRIGGER', 'X', '', 'T2')];
  assert.equal(new Set(keys).size, keys.length);
});

test('PostgreSQL routine context opening preserves the selected overload', async () => {
  const h = sidebar('postgresql', () => ({ success: true, rows: [] }));
  h.render().handleSidebarContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 2 }, 'table', 'same', 'A', 'FUNCTION', undefined, 'same', 'VALID', undefined, 'text');
  assert.equal(h.render().sidebarContextMenu.signature, 'text');
  h.render().handleOpenTableWindow();
  const { routineTabKey } = loadTypeScript('src/features/postgresql/routineIdentity.ts');
  assert.deepEqual(h.opened[0], ['stored', routineTabKey({ schema: 'A', objectName: 'same', objectType: 'FUNCTION', signature: 'text' }), 'FUNCTION']);
  assert.equal(h.render().selectedObject, JSON.stringify(['A', 'FUNCTION', 'same', 'text', '']));
});
