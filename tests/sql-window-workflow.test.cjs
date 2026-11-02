// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createSqlBatches } = require('../electron/services/sqlBatches');
const { loadTypeScript: load } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createSqlWindowHarness } = require('./helpers/sqlWindow.cjs');
const { prepareSqlStatement, parseDdlAction } = load('src/features/sql/sqlExecutionPlan.ts', {
  './sqlScript': load('src/features/sql/sqlScript.ts')
});
const plain = value => JSON.parse(JSON.stringify(value));
test('PostgreSQL SQL window fixtures preserve the configured execution schema instead of assuming test', async () => {
  for (const schema of ['public', 'Mixed."Schema']) {
    const h = await createSqlWindowHarness('postgresql', 'SELECT 1 AS value', async () => ({ success: true, rows: [{ value: 1 }], metaData: [{ name: 'value' }] }), { schema });
    try {
      assert.equal(h.state.selectedSchema, schema);
      await h.state.handleExecuteSql(); await h.flush();
      assert.deepEqual(h.alerts, []);
      assert.equal(h.calls.find(call => call[0] === 'execute-sql')[3], schema);
    } finally { h.unmount(); }
  }
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: SQL binds preserve exact values and never substitute comments or quoted literals`, () => {
    const sql = "SELECT :n, :s, :n, ':s' /* :n */ -- :s\n";
    const value = "x'); DROP TABLE important; --";
    const result = prepareSqlStatement(sql, db, { N: '9007199254740993.123456789', S: value }, { N: 'NUMBER' }, 'YYYY-MM-DD');
    assert.equal(result.binds.mb_input_0, '9007199254740993.123456789');
    assert.equal(result.binds.mb_input_1, value);
    assert.ok(!result.sql.includes(value)); assert.match(result.sql, /':s' \/\* :n \*\/ -- :s/);
    assert.equal((result.sql.match(/CAST\(:mb_input_0/g) || []).length, 2);
    for (const N of ['1); DELETE FROM important', 'NaN', 'Infinity', '--1']) assert.throws(() => prepareSqlStatement('SELECT :n', db, { N }, { N: 'NUMBER' }, 'YYYY-MM-DD'));
    assert.throws(() => prepareSqlStatement('SELECT :d', db, { D: '2026-02-30' }, { D: 'DATE' }, 'YYYY-MM-DD'));
    const date = prepareSqlStatement('SELECT :d', db, { D: '2026-10-25 12:34:56.123456789 +05:45' }, { D: 'DATE' }, 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM');
    assert.equal(date.binds.mb_input_0, '2026-10-25 12:34:56.123456789 +05:45');
    assert.ok(!date.sql.includes('2026-10-25'));
    assert.equal(prepareSqlStatement('SELECT :missing', db, {}, {}, 'YYYY-MM-DD').binds.mb_input_0, null);
  });
  test(`${db}: DDL refresh preserves exact quoted schemas and skips comments`, () => {
    assert.deepEqual(plain(parseDdlAction('/* lead */ CREATE OR REPLACE VIEW "Mi.x"."v" AS SELECT 1', db)), { schema: 'Mi.x', objType: 'VIEW' });
    assert.equal(parseDdlAction('CREATE TABLE Test.items (id integer)', db).schema, db === 'oracle' ? 'TEST' : 'test');
    assert.deepEqual(plain(parseDdlAction('DROP TABLE IF EXISTS "Mi""x"."t"', db)), { schema: 'Mi"x', objType: 'TABLE' });
    assert.equal(parseDdlAction("SELECT 'CREATE TABLE pretend.x'", db), null);
  });
  test(`${db}: script errors retain prior SELECT results and do not run remaining statements`, async () => {
    let calls = 0;
    const h = await createSqlWindowHarness(db, 'SELECT 1; SELECT bad; SELECT 3;', async () => ++calls === 1
      ? { success: true, rows: [{ value: '9007199254740993' }], metaData: [{ name: 'value' }] }
      : { success: false, error: 'Invalid statement' });
    try {
      await h.state.handleExecuteSql(); await h.flush();
      assert.equal(calls, 2); assert.equal(h.state.logs.length, 2);
      assert.equal(h.state.rows[0].value, '9007199254740993'); assert.equal(h.state.bottomTab, 1);
      assert.equal(h.state.logs[0].resultMsg, 'Invalid statement');
    } finally { h.unmount(); }
  });
  test(`${db}: a hundred statements retain one latest row result and log every statement`, async () => {
    let calls = 0;
    const script = Array.from({ length: 100 }, (_, index) => `SELECT ${index + 1}`).join(';') + ';INSERT INTO demo VALUES (1);';
    const h = await createSqlWindowHarness(db, script, async () => {
      calls++;
      return calls <= 100 ? { success: true, rows: [{ value: calls }], metaData: [{ name: 'value' }] }
        : { success: true, command: 'INSERT', rowsAffected: 1, rows: [], metaData: [] };
    });
    try {
      await h.state.handleExecuteSql(); await h.flush();
      assert.equal(calls, 101); assert.equal(h.state.logs.length, 101);
      assert.equal(h.state.rows.length, 1); assert.equal(h.state.rows[0].value, 100);
      assert.equal(h.state.bottomTab, 1);
      assert.equal('results' in h.state, false); assert.equal('selectResult' in h.state, false);
    } finally { h.unmount(); }
  });
  test(`${db}: duplicate execution and stopping a pending statement never start the next statement`, async () => {
    let release, calls = 0;
    const h = await createSqlWindowHarness(db, 'SELECT 1; SELECT 2;', () => { calls++; return new Promise(resolve => { release = resolve; }); });
    try {
      const pending = h.state.handleExecuteSql(); await h.flush();
      await h.state.handleExecuteSql(); assert.equal(calls, 1);
      await h.state.handleCancelSql(); release({ success: true, rows: [{ value: 1 }], metaData: [{ name: 'value' }] });
      await pending; await h.flush();
      assert.equal(calls, 1); assert.equal(h.state.logs.length, 1); assert.equal(h.state.rows.length, 0); assert.equal(h.state.bottomTab, 1); assert.equal(h.state.isLoading, false);
    } finally { h.unmount(); }
  });
  test(`${db}: unmount ignores late failures and validates every bind before starting a script`, async () => {
    let release, calls = 0;
    const h = await createSqlWindowHarness(db, 'SELECT 1; SELECT :n;', () => { calls++; return new Promise(resolve => { release = resolve; }); });
    h.state.setBindValues({ N: 'bad' }); h.state.setBindTypes({ N: 'NUMBER' }); await h.flush();
    await h.state.handleExecuteSql(); assert.equal(calls, 0); assert.equal(h.alerts.length, 1);
    h.state.setBindValues({ N: '2' }); await h.flush(); const pending = h.state.handleExecuteSql(); await h.flush();
    h.unmount(); release({ success: false, error: 'Late failure' }); await pending;
    assert.equal(calls, 1); assert.equal(h.alerts.length, 1);
  });
}
test('SQL batch ownership, idle cancellation and connection replacement reject stale execution', () => {
  let client = { breakExecution: async () => {} };
  const batches = createSqlBatches(() => client), sender = new EventEmitter(); sender.id = 1;
  const event = { sender }, other = { sender: { id: 2 } };
  batches.begin(event, 'first');
  assert.throws(() => batches.enter(other, 'first'), /no longer available/);
  batches.cancel(event, 'first'); assert.throws(() => batches.enter(event, 'first'), /cancelled/); batches.end(event, 'first');
  for (let i = 0; i < 15; i++) { batches.begin(event, 'batch' + i); batches.end(event, 'batch' + i); }
  assert.equal(sender.listenerCount('destroyed'), 1);
  batches.begin(event, 'old'); client = { breakExecution: async () => {} };
  assert.throws(() => batches.enter(event, 'old'), /no longer available/);
  batches.begin(event, 'current'); const current = batches.enter(event, 'current');
  assert.throws(() => batches.enter(event, 'current'), /already running/);
  sender.emit('destroyed'); assert.equal(current.cancelled, true);
  assert.throws(() => batches.enter(event, 'current'), /no longer available/);
});
test('SQL history serializes reads, additions and clears and ignores stale read results', async () => {
  const h = createHookHarness(), calls = []; let resolveRead;
  const t = key => key;
  const { useSqlHistory } = load('src/features/sql/useSqlHistory.ts', { react: h.react,
    'react-i18next': { useTranslation: () => ({ t }) },
    '@/features/sql/sqlHistory': { invokeSqlHistoryWhen: async (_alive, _t, channel) => {
      calls.push(channel); if (channel === 'get-sql-history') return new Promise(resolve => { resolveRead = resolve; });
      return channel === 'clear-sql-history' ? [] : [{ sql: 'new' }];
    } }
  });
  const render = () => h.render(useSqlHistory);
  render(); h.commit(); await h.settle();
  const add = render().addHistory({ sql: 'new' }), clear = render().clearHistory();
  assert.deepEqual(calls, ['get-sql-history']); resolveRead([{ sql: 'stale' }]);
  await add; await clear;
  assert.deepEqual(calls, ['get-sql-history', 'add-sql-history', 'clear-sql-history']); assert.equal(render().historyLogs.length, 0); h.unmount();
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: displayed result counts and duration stay attached to rows across later DML, errors and empty results`, async () => {
    let call = 0;
    const h = await createSqlWindowHarness(db, 'SELECT original; INSERT INTO demo VALUES (1);', async () => {
      call++;
      if (call === 1) return { success: true, rows: [{ value: 1 }, { value: 2 }], metaData: [{ name: 'value' }], executionTime: 12.5 };
      if (call === 2) return { success: true, rows: [], metaData: [], command: 'INSERT', rowsAffected: 1, executionTime: 99 };
      if (call === 3) return { success: false, error: 'Expected error', executionTime: 200 };
      return { success: true, rows: [], metaData: [{ name: 'value' }], executionTime: 0 };
    });
    try {
      assert.equal(h.state.resultSummary, null);
      await h.state.handleExecuteSql(); await h.flush();
      const original = plain(h.state.resultSummary);
      assert.equal(original.rowCount, 2); assert.equal(original.durationMs, 12.5); assert.ok(original.completedAt);
      assert.equal(h.state.bottomTab, 1);
      h.state.setSqlText('SELECT failing'); await h.flush();
      await h.state.handleExecuteSql(); await h.flush();
      assert.deepEqual(plain(h.state.resultSummary), original);
      assert.equal(h.state.rows.length, 2);
      h.state.setSqlText('SELECT empty'); await h.flush();
      await h.state.handleExecuteSql(); await h.flush();
      assert.equal(h.state.resultSummary.rowCount, 0); assert.equal(h.state.resultSummary.durationMs, 0);
      assert.equal(h.state.rows.length, 0); assert.equal(h.state.bottomTab, 0);
    } finally { h.unmount(); }
  });
}

function sqlBottomFixture() {
  const h = createHookHarness(), events = [], replacements = [], jumps = [];
  const react = { ...h.react, memo: fn => fn, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const deps = {
    '@/shared/api/desktop': { ipcRenderer: { invoke() { throw new Error('Unexpected desktop request'); } } },
    react, '@mui/material': new Proxy({}, { get: (_, key) => key }),
    '@mui/x-data-grid': { DataGrid: 'DataGrid', enUS: { components: { MuiDataGrid: { defaultProps: { localeText: {} } } } }, jaJP: { components: { MuiDataGrid: { defaultProps: { localeText: {} } } } } },
    'react-i18next': { useTranslation: () => ({ t: (key, args) => args?.total !== undefined ? key + ':' + args.total + ':' + args.duration : key, i18n: { language: 'en' } }) },
    '@/features/data-grid/GridViewport': { GridViewport: 'GridViewport' },
    './useSqlWindowBottom': { useSqlWindowBottom: props => ({ resolvedDbType: 'oracle', isTransposed: false, setIsTransposed() {}, displayRows: props.rows, displayColumns: props.columns, historyColumns: [], parsedExplain: { tree: [], predicates: [], headerText: [] }, handleExportForAI() {} }) },
    '../ai/AiRequestButton': 'AI', '@/components/data/ExportDialog': 'Export'
  };
  for (const icon of ['DeleteOutline', 'SwapHoriz', 'ExpandMore', 'ChevronRight']) deps['@mui/icons-material/' + icon] = icon;
  const Bottom = load('src/features/sql/SqlWindowBottom.tsx', deps, { React: react,
    window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } }).default;
  const entry = { id: 'history-1', sql: 'SELECT history_value', executeTime: 'now', duration: 5, rowCount: 1 };
  const props = { bottomTab: 2, setBottomTab() {}, historyLogs: [entry], logs: [], rows: [], columns: [], historyLimit: 100,
    setSqlText: text => replacements.push(text), handleClearHistory() {}, handleClearLogs() {}, handleConsoleClick: line => jumps.push(line), resultSummary: null };
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
  let tree;
  const render = () => { tree = h.render(() => Bottom(props)); h.commit(); };
  const button = text => walk(tree).find(node => node.type === 'Button' && node.children.includes(text));
  return { h, props, render, walk, button, events, replacements, jumps, entry, get tree() { return tree; } };
}

test('SQL history double-click opens a new tab, while replacing the editor requires its explicit selected-row action', () => {
  const f = sqlBottomFixture();
  const { h, props, render, walk, button, events, replacements, entry } = f;
  render();
  assert.equal(button('sql_history_replace_editor').props.disabled, true);
  let grid = walk(f.tree).find(node => node.type === 'DataGrid');
  grid.props.onRowDoubleClick({ row: entry });
  assert.equal(events[0].type, 'open-sql-tab'); assert.equal(events[0].detail.initialSql, entry.sql);
  assert.deepEqual(replacements, []);
  grid.props.onRowSelectionModelChange([entry.id]); render();
  assert.equal(button('sql_history_replace_editor').props.disabled, false);
  button('sql_history_open_new_tab').props.onClick();
  assert.equal(events.length, 2); assert.deepEqual(replacements, []);
  button('sql_history_replace_editor').props.onClick();
  assert.deepEqual(replacements, [entry.sql]);
  const originalEntries = [entry, ...Array.from({ length: 210 }, (_, i) => ({ ...entry, id: `other-${i}`, sql: `SELECT other_${i}` }))];
  props.historyLogs = originalEntries; render();
  grid = walk(f.tree).find(node => node.type === 'DataGrid');
  grid.props.onPaginationModelChange({ page: 2, pageSize: 100 }); render();
  assert.equal(walk(f.tree).find(node => node.type === 'DataGrid').props.paginationModel.page, 2);
  const searchHistory = value => {
    walk(f.tree).find(node => node.type === 'TextField' && node.props.label === 'sql_history_search').props.onChange({ target: { value } }); render();
  };
  const eventCount = events.length, replaceCount = replacements.length;
  searchHistory('  HISTORY_VALUE  ');
  grid = walk(f.tree).find(node => node.type === 'DataGrid');
  assert.equal(grid.props.rows.length, 1); assert.equal(grid.props.rows[0], entry);
  assert.equal(grid.props.paginationModel.page, 0); assert.equal(button('sql_history_replace_editor').props.disabled, true);
  searchHistory('no_such_sql'); assert.equal(walk(f.tree).find(node => node.type === 'DataGrid').props.rows.length, 0);
  assert.equal(button('sql_history_open_new_tab').props.disabled, true);
  searchHistory(''); assert.equal(walk(f.tree).find(node => node.type === 'DataGrid').props.rows.length, 211);
  assert.equal(props.historyLogs, originalEntries); assert.equal(events.length, eventCount); assert.equal(replacements.length, replaceCount);
  props.historyLogs = []; render();
  assert.equal(button('sql_history_replace_editor').props.disabled, true);
  props.bottomTab = 0; props.resultSummary = { rowCount: 0, durationMs: 0, completedAt: 'now' }; render();
  const toolbar = walk(f.tree).find(node => node.props['data-testid'] === 'sql-result-toolbar');
  assert.ok(walk(toolbar).some(node => node.children.includes('sql_result_summary:0:0')));
  assert.equal(walk(toolbar).find(node => node.props.role === 'status').props['aria-live'], 'polite');
  assert.ok(walk(toolbar).some(node => node.type === 'Export'));
  h.unmount();
});

test('SQL pane layout restores preferred height and clamps keyboard and drag resizing to its container', () => {
  const h = createHookHarness(), events = new Map();
  let resize, disconnected = 0, active = true, state;
  const { useSqlPaneLayout } = load('src/features/sql/SqlPaneLayout.tsx', {
    react: h.react, '@mui/material': {},
    '@mui/icons-material/VerticalAlignTop': {}, '@mui/icons-material/VerticalAlignBottom': {}, '@mui/icons-material/UnfoldMore': {},
    'react-i18next': { useTranslation: () => ({ t: key => key }) }
  }, { ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected++; } },
    window: { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) }, HTMLElement: class {} });
  const host = { clientHeight: 700 };
  const render = () => { state = h.render(() => useSqlPaneLayout(active)); state.rootRef.current = active ? host : null; };
  const flush = () => { render(); h.commit(); render(); };
  render(); h.commit(); flush();
  const key = (value, extra = {}) => { let prevented = false;
    state.separatorProps.onKeyDown({ key: value, nativeEvent: {}, preventDefault: () => { prevented = true; }, ...extra });
    flush(); return prevented;
  };
  const initial = state.height;
  assert.equal(key('ArrowDown'), true); assert.equal(state.height, initial + 20);
  state.changeMode('editor'); flush(); assert.equal(state.mode, 'editor');
  state.changeMode('result'); flush(); assert.equal(state.mode, 'result');
  state.changeMode('split'); flush(); assert.equal(state.height, initial + 20);
  assert.equal(key('ArrowDown', { ctrlKey: true }), false); assert.equal(state.height, initial + 20);
  key('End'); assert.equal(state.height, 550);
  key('Home'); assert.equal(state.height, 80);
  key('ArrowDown', { shiftKey: true }); assert.equal(state.height, 140);
  state.separatorProps.onMouseDown({ button: 0, clientY: 200, preventDefault() {}, currentTarget: {} }); flush();
  events.get('mousemove')({ clientY: 250 }); flush(); assert.equal(state.height, 190);
  events.get('blur')(); flush(); assert.equal(state.isResizing, false); assert.equal(events.size, 0);
  host.clientHeight = 200; resize(); flush(); assert.equal(state.height, 80);
  host.clientHeight = 700; resize(); flush(); assert.equal(state.height, 190);
  active = false; flush(); active = true; flush(); assert.equal(state.height, 190);
  h.unmount(); assert.ok(disconnected >= 2); assert.equal(events.size, 0);
});

test('SQL log filters search SQL, result and error text without mutating logs, editor or desktop state', () => {
  const f = sqlBottomFixture();
  try {
    const logs = [
      { time: 'now', sql: 'SELECT first', execTime: 1, resultMsg: 'Fetched 日本語' },
      { time: 'now', sql: 'SELECT bad', execTime: '-', resultMsg: 'Failed', errorLines: ['[ERROR] Line 2: column missing'] },
      { time: 'now', sql: 'SELECT stopped', execTime: '-', resultMsg: 'Script stopped', errorLines: ['[ERROR] Script stopped'] }
    ];
    f.props.bottomTab = 1; f.props.logs = logs; f.render();
    const nodes = () => f.walk(f.tree);
    const search = value => { nodes().find(node => node.type === 'TextField' && node.props.label === 'sql_log_search').props.onChange({ target: { value } }); f.render(); };
    const displayedSql = () => nodes().filter(node => node.type === 'Typography' && logs.some(log => node.children.includes(log.sql))).map(node => node.children[0]);
    assert.deepEqual(displayedSql(), ['SELECT first', 'SELECT bad', 'SELECT stopped']);
    for (const query of ['  COLUMN MISSING  ', 'select BAD', 'failed']) { search(query); assert.deepEqual(displayedSql(), ['SELECT bad']); }
    search('日本語'); assert.deepEqual(displayedSql(), ['SELECT first']);
    search('');
    nodes().find(node => node.type === 'FormControlLabel').props.control.props.onChange({ target: { checked: true } }); f.render();
    assert.deepEqual(displayedSql(), ['SELECT bad', 'SELECT stopped']);
    search('first'); assert.deepEqual(displayedSql(), []);
    assert.ok(nodes().some(node => node.children.includes('sql_log_no_matches')));
    nodes().find(node => node.type === 'FormControlLabel').props.control.props.onChange({ target: { checked: false } }); f.render();
    assert.deepEqual(displayedSql(), ['SELECT first']);
    search(''); assert.deepEqual(displayedSql(), logs.map(log => log.sql));
    assert.equal(f.props.logs, logs); assert.deepEqual(f.jumps, []); assert.deepEqual(f.events, []); assert.deepEqual(f.replacements, []);
    f.props.logs = []; f.render(); assert.ok(nodes().some(node => node.children.includes('no_execution_logs')));
  } finally { f.h.unmount(); }
});
test('Only normalized valid SQL error lines are native keyboard buttons and clicks navigate without executing', () => {
  const f = sqlBottomFixture();
  try {
    const lines = ['[ERROR] Line 5: missing', '[ERROR] 行 2: 日本語', '[error]  line 3: lowercase',
      '[ERROR] no line', 'E Line 2: false prefix', '[ERROR] Line 0: invalid', '[ERROR] Line 9007199254740993: unsafe'];
    f.props.bottomTab = 1; f.props.logs = [{ time: 'now', sql: 'SELECT bad', execTime: '-', resultMsg: 'failed', errorLines: lines }]; f.render();
    const rendered = f.walk(f.tree).filter(node => node.props['data-testid'] === 'sql-log-error-line');
    assert.equal(rendered.length, lines.length);
    for (const [index, line] of rendered.entries()) {
      assert.equal(line.props.component, index < 3 ? 'button' : 'div');
      if (index < 3) { assert.equal(line.props.type, 'button'); assert.equal(line.props['aria-label'], `sql_log_jump_line: ${lines[index]}`); line.props.onClick(); }
      else assert.equal(line.props.onClick, undefined);
    }
    assert.deepEqual(f.jumps, lines.slice(0, 3)); assert.deepEqual(f.events, []); assert.deepEqual(f.replacements, []);
  } finally { f.h.unmount(); }
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: log navigation selects the requested editor line and ignores missing or out-of-range lines without SQL`, async () => {
    const h = await createSqlWindowHarness(db, 'SELECT first;\nSELECT bad;', async () => { throw new Error('Navigation must not execute SQL'); });
    const selections = []; let focused = 0;
    try {
      h.state.editorRef.current = { view: { state: { doc: { lines: 2, line: number => ({ from: number === 1 ? 0 : 14 }) } },
        dispatch: event => selections.push(event), focus: () => { focused++; } } };
      const calls = h.calls.length;
      h.state.handleConsoleClick('[ERROR] Line 2: failed');
      h.state.handleConsoleClick('[ERROR] 行 1: failed');
      h.state.handleConsoleClick('[ERROR] Line 3: outside');
      h.state.handleConsoleClick('[ERROR] failed');
      assert.deepEqual(selections.map(event => event.selection.anchor), [14, 0]);
      assert.equal(focused, 2); assert.equal(h.calls.length, calls);
    } finally { h.unmount(); }
  });
}

test('PostgreSQL SQL execution renders configured dates while keeping exact result values and text columns', async () => {
  const { buildGridColumns } = load('src/features/data-grid/dataGridHelper.tsx', {
    react: require('react'), i18next: { t: key => key }
  });
  const stamp = '2026-10-30 05:56:47.880908+00';
  for (const [dateFormat, expected] of [['DD-MMM-YY HH:mm:ss', '30-OCT-26 05:56:47'], ['YYYY/MM/DD HH:mm:ss', '2026/10/30 05:56:47']]) {
    const h = await createSqlWindowHarness('postgresql', 'SELECT current_timestamp;', async () => ({ success: true,
      rows: [{ stamp, label: stamp }], metaData: [{ name: 'stamp', dbTypeName: 'TIMESTAMP' }, { name: 'label', dbTypeName: 'VARCHAR' }] }), { dateFormat, buildGridColumns });
    try {
      await h.state.handleExecuteSql(); await h.flush();
      assert.deepEqual(h.alerts, []);
      const [column, text] = h.state.columns;
      assert.equal(column.renderCell({ value: h.state.rows[0].stamp }).props.children, expected);
      assert.equal(column.valueFormatter({ value: h.state.rows[0].stamp }), expected);
      assert.equal(text.renderCell({ value: h.state.rows[0].label }).props.children, stamp);
      assert.equal(h.state.rows[0].stamp, stamp);
    } finally { h.unmount(); }
  }
});
