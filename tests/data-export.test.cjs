// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const XLSX = require('xlsx');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { snapshotDesktop } = require('./helpers/exportSnapshot.cjs');
const { parseDelimitedText } = loadTypeScript('src/features/table/importData.ts');

// Exercise the real component handlers while replacing only rendering and desktop IPC.
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
function exportFixture(format, columns, rows, { includeHeader = true, spreadsheetSafe = false, respond, storage, ...props } = {}) {
  const h = createHookHarness(), calls = [], notices = [];
  const dependencies = {
    '@/shared/utils/notifications': { notify: (message, options) => { assert.equal(options.severity, 'success'); notices.push(message); } },
    react: h.react, '@mui/material': new Proxy({}, { get: (_, name) => name }), xlsx: XLSX,
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      if (args[0] === 'show-save-dialog' && !args[1].filters) return { canceled: false, filePath: args[1].defaultPath };
      calls.push(args); return respond ? respond(...args) : { success: true };
    } } }
  };
  for (const name of ['FolderOpen', 'ContentCopy', 'FileDownload']) dependencies[`@mui/icons-material/${name}`] = {};
  const { default: ExportDialog } = loadTypeScript('src/components/data/ExportDialog.tsx', dependencies, {
    React, navigator: { platform: 'MacIntel' },
    localStorage: storage || { getItem: () => JSON.stringify({ spreadsheetSafe, format, filePath: '/unused/export.xlsx', includeHeader }), setItem() {} },
    alert() { throw new Error('Export must not display a blocking alert'); }
  });
  const render = () => h.render(() => ExportDialog({ columns, rows, ...props }));
  find(render(), n => n.type === 'IconButton').props.onClick(); render(); h.commit();
  return { calls, notices, render, h, error: () => find(render(), node => node.type === 'Alert')?.children.join('') || '',
    button: label => find(render(), n => n.type === 'Button' && n.children.includes(label)) };
}
async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(predicate(), 'Expected asynchronous export phase was reached');
}
async function exportData(format, columns, rows, options) {
  const fixture = exportFixture(format, columns, rows, options);
  await fixture.button('export_2').props.onClick();
  return { calls: fixture.calls, notices: fixture.notices, tree: fixture.render() };
}
function readExcel(calls) {
  const request = calls.find(call => call[0] === 'save-file');
  assert.equal(request[3], 'binary');
  const workbook = XLSX.read(request[2], { type: 'array' });
  return XLSX.utils.sheet_to_json(workbook.Sheets.Data, { header: 1, defval: null });
}
const plain = value => JSON.parse(JSON.stringify(value));
for (const includeHeader of [true, false]) {
  test(`Excel preserves duplicate/empty labels, column order and values with headers ${includeHeader}`, async () => {
    const columns = [
      { field: 'a', headerName: 'Value' }, { field: 'b', headerName: 'Value' },
      { field: 'c', headerName: '' }, { field: 'fallback' }
    ];
    const row = { a: 'first', b: 'second', c: '9007199254740993', fallback: '0.1234567890123456789' };
    const result = await exportData('excel', columns, [row], { includeHeader });
    const expected = [['first', 'second', '9007199254740993', '0.1234567890123456789']];
    if (includeHeader) expected.unshift(['Value', 'Value', '', 'fallback']);
    assert.deepEqual(readExcel(result.calls), expected);
    assert.deepEqual(result.notices, ['excel_file_exported']);
  });
  test(`Clipboard TSV round-trips embedded separators, CR/LF, quotes and empty records with headers ${includeHeader}`, async () => {
    const values = ['日本語\ttab', 'line1\r\nline2', 'a\rb', 'a\nb', 'say "hello"', '', '   ', '=literal', ''];
    const result = await exportData('clipboard', [{ field: 'value', headerName: 'A\t"B"\r\nC' }], values.map(value => ({ value })), { includeHeader });
    const text = result.calls.find(call => call[0] === 'copy-to-clipboard')[1];
    const expected = values.map(value => [value]);
    if (includeHeader) expected.unshift(['A\t"B"\r\nC']);
    assert.deepEqual(plain(parseDelimitedText(text, '\t', key => key)), expected);
    assert.deepEqual(result.notices, ['copied_to_clipboard']);
  });
}
test('Clipboard TSV retains positions of empty and null cells in multiple columns', async () => {
  const columns = [{ field: 'first' }, { field: 'second', headerName: 'same' }, { field: 'third', headerName: 'same' }];
  const result = await exportData('clipboard', columns, [{ first: '', second: 'a\tb', third: null }, { first: null, second: '', third: 'end' }]);
  const text = result.calls[0][1];
  assert.deepEqual(plain(parseDelimitedText(text, '\t', key => key)), [['first', 'same', 'same'], ['', 'a\tb', ''], ['', '', 'end']]);
});
test('CSV preserves quoting and field-name fallbacks', async () => {
  const result = await exportData('csv', [{ field: 'name' }, { field: 'note', headerName: 'Note' }], [{ name: 'a,b', note: 'say "yes"\r\nnext' }]);
  const request = result.calls[0]; assert.equal(request[0], 'save-file'); assert.equal(request[3], 'utf8');
  assert.deepEqual(plain(parseDelimitedText(request[2], ',', key => key)), [['name', 'Note'], ['a,b', 'say "yes"\r\nnext']]);
});
test('Chunked data uses the same positional Excel output', async () => {
  const offsets = [];
  const result = await exportData('excel', [{ field: 'a', headerName: 'Same' }, { field: 'b', headerName: 'Same' }], [], {
    totalCount: 5001, fetchDataChunk: async (offset, limit) => {
      offsets.push([offset, limit]);
      return Array.from({ length: offset === 0 ? 5000 : 1 }, (_, index) => ({ a: `a${offset + index}`, b: `b${offset + index}` }));
    }
  });
  const records = readExcel(result.calls);
  assert.deepEqual(offsets, [[0, 5000], [5000, 5000]]); assert.equal(records.length, 5002);
  assert.deepEqual(records[5001], ['a5000', 'b5000']);
});
test('Failed file saves and clipboard writes keep the dialog open without a success notification', async () => {
  for (const format of ['excel', 'clipboard']) {
    const result = await exportData(format, [{ field: 'value' }], [{ value: 'unchanged' }], { respond: () => {
      if (format === 'clipboard') throw new Error('Clipboard unavailable');
      return { success: false, error: 'Save unavailable' };
    } });
    assert.equal(find(result.tree, n => n.type === 'Dialog').props.open, true);
    assert.deepEqual(result.notices, []); assert.match(find(result.tree, node => node.type === 'Alert').children.join(''), /^export_error/);
    assert.equal(find(result.tree, n => n.type === 'Button' && n.children.includes('export_2')).props.disabled, false);
  }
});
for (const totalCount of [0, 1, 9000, undefined]) {
  test(`Export reads to the end when the earlier count is ${totalCount}`, async () => {
    const offsets = [];
    let closed = 0;
    const fetchDataChunk = Object.assign(async (offset, limit) => {
      offsets.push([offset, limit]);
      return Array.from({ length: offset === 0 ? 5000 : 2 }, (_, i) => ({ id: offset + i + 1 }));
    }, { close: async () => { closed++; } });
    const result = await exportData('csv', [{ field: 'id' }], [], { totalCount, fetchDataChunk,
      respond: () => { assert.equal(closed, 1, 'Release the snapshot before writing output'); return { success: true }; } });
    assert.deepEqual(offsets, [[0, 5000], [5000, 5000]]);
    const records = plain(parseDelimitedText(result.calls[0][2], ',', key => key));
    assert.equal(records.length, 5003); assert.deepEqual(records.at(-1), ['5002']);
    assert.deepEqual(result.notices, ['csv_file_exported']); assert.equal(closed, 1);
  });
}
test('Export keeps all initial rows when the database changes between transferred chunks', async () => {
  let dataset = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1 }));
  let queries = 0, closed = 0;
  const desktop = snapshotDesktop(async () => { queries++; return { success: true, rows: dataset.map(row => ({ ...row })) }; });
  const { createExportSnapshotFetcher } = loadTypeScript('src/features/table/exportSnapshot.ts', { '@/shared/api/desktop': desktop });
  const snapshot = createExportSnapshotFetcher(() => 'SELECT * FROM items ORDER BY id');
  const fetchDataChunk = Object.assign(async (offset, limit) => {
    const rows = await snapshot(offset, limit);
    if (offset === 0) dataset = [...dataset.slice(1), { id: 6001 }];
    return rows;
  }, { close: async () => { closed++; await snapshot.close(); } });
  const result = await exportData('csv', [{ field: 'id' }], [], { totalCount: 6000, fetchDataChunk });
  const records = plain(parseDelimitedText(result.calls[0][2], ',', key => key));
  assert.deepEqual(records.slice(1).map(row => row[0]), Array.from({ length: 6000 }, (_, i) => String(i + 1)));
  assert.equal(queries, 1); assert.equal(closed, 1);
});
test('A complete 5000-row snapshot ends locally without querying an expired snapshot', async () => {
  let queries = 0;
  const { createExportSnapshotFetcher } = loadTypeScript('src/features/table/exportSnapshot.ts', {
    '@/shared/api/desktop': snapshotDesktop(async () => { queries++; return { success: true, rows: Array.from({ length: 5000 }, (_, id) => ({ id })) }; })
  });
  const result = await exportData('csv', [{ field: 'id' }], [], { totalCount: 5000, fetchDataChunk: createExportSnapshotFetcher(() => 'SELECT * FROM items') });
  assert.equal(queries, 1); assert.deepEqual(result.notices, ['csv_file_exported']);
  assert.equal(plain(parseDelimitedText(result.calls[0][2], ',', key => key)).length, 5001);
});
test('Fetch and cleanup errors abort before saving or copying partial output', async () => {
  for (const format of ['csv', 'clipboard']) for (const failure of ['fetch', 'close']) {
    let closed = 0;
    const fetchDataChunk = Object.assign(async offset => {
      if (failure === 'fetch' && offset) throw new Error('Read failed');
      return Array.from({ length: offset === 0 ? 5000 : 1 }, (_, id) => ({ id }));
    }, { close: async () => { closed++; if (failure === 'close') throw new Error('Release failed'); } });
    const result = await exportData(format, [{ field: 'id' }], [], { totalCount: 5001, fetchDataChunk });
    assert.equal(result.calls.length, 0); assert.equal(closed, 1);
    assert.equal(find(result.tree, n => n.type === 'Dialog').props.open, true);
    assert.deepEqual(result.notices, []); assert.match(find(result.tree, node => node.type === 'Alert').children.join(''), /^export_error/);
  }
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
for (const format of ['csv', 'excel', 'clipboard']) {
  test(`${format}: immediate repeated export actions fetch, close and write only once`, async () => {
    const pending = deferred(); let fetched = 0, closed = 0;
    const fetchDataChunk = Object.assign(async () => { fetched++; return pending.promise; }, { close: async () => { closed++; } });
    const h = exportFixture(format, [{ field: 'value' }], [], { fetchDataChunk });
    const exportClick = h.button('export_2').props.onClick;
    const cancel = h.button('cancel').props.onClick;
    const browse = h.button('browse').props.onClick;
    const first = exportClick(); await exportClick(); await browse(); cancel();
    await waitUntil(() => fetched === 1);
    assert.equal(fetched, 1); assert.equal(h.calls.length, 0);
    assert.equal(find(h.render(), node => node.type === 'Dialog').props.open, true);
    assert.equal(h.button('export_2').props.disabled, true);
    assert.equal(h.button('browse').props.disabled, true);
    pending.resolve([{ value: 'demo' }]); await first;
    assert.equal(closed, 1); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], format === 'clipboard' ? 'copy-to-clipboard' : 'save-file');
    assert.equal(h.notices.length, 1);
  });
}

for (const phase of ['cleanup', 'write']) {
  test(`Export remains guarded while ${phase} is pending`, async () => {
    const pending = deferred(); let closed = 0;
    const h = exportFixture('csv', [{ field: 'value' }], [], {
      fetchDataChunk: Object.assign(async () => [{ value: 'demo' }], { close: async () => { closed++; if (phase === 'cleanup') await pending.promise; } }),
      respond: () => phase === 'write' ? pending.promise : { success: true }
    });
    const click = h.button('export_2').props.onClick;
    const first = click(); await h.h.settle(); await click();
    await waitUntil(() => phase === 'cleanup' ? closed === 1 : h.calls.length === 1);
    assert.equal(closed, 1);
    assert.equal(h.calls.length, phase === 'write' ? 1 : 0);
    assert.equal(h.button('export_2').props.disabled, true);
    pending.resolve({ success: true }); await first;
    assert.equal(h.calls.length, 1); assert.equal(h.button('export_2').props.disabled, false);
  });
}

test('A failed export releases the guard and retains the dialog for retry', async () => {
  let writes = 0;
  const h = exportFixture('csv', [{ field: 'value' }], [{ value: 'demo' }], { respond: () => ({ success: ++writes > 1, error: 'Simulated write failure' }) });
  await h.button('export_2').props.onClick();
  assert.equal(find(h.render(), node => node.type === 'Dialog').props.open, true);
  assert.equal(h.button('export_2').props.disabled, false);
  await h.button('export_2').props.onClick();
  assert.equal(writes, 2); assert.equal(h.notices.at(-1), 'csv_file_exported');
});

for (const outcome of ['failure', 'canceled', 'success']) {
  test(`Destination browse ${outcome} preserves state, avoids duplicate dialogs and permits retry`, async () => {
    const pending = deferred(); let attempts = 0;
    const h = exportFixture('csv', [{ field: 'value' }], [{ value: 'demo' }], { respond: channel => {
      assert.equal(channel, 'show-save-dialog');
      return ++attempts === 1 ? pending.promise : { canceled: false, filePath: '/mock/retry.csv' };
    } });
    const browse = h.button('browse').props.onClick;
    const cancel = h.button('cancel').props.onClick;
    const first = browse(); await browse(); await h.button('export_2').props.onClick(); cancel();
    assert.equal(attempts, 1); assert.equal(h.button('browse').props.disabled, true);
    assert.equal(find(h.render(), node => node.type === 'Dialog').props.open, true);
    if (outcome === 'failure') pending.reject(new Error('Simulated dialog failure'));
    else pending.resolve({ canceled: outcome === 'canceled', filePath: '/mock/selected.csv' });
    await first;
    assert.deepEqual(h.notices, []); assert.equal(h.error(), outcome === 'failure' ? 'failed_to_select_export_destination' : '');
    assert.equal(find(h.render(), node => node.type === 'TextField').props.value, outcome === 'success' ? '/mock/selected.csv' : '/unused/export.xlsx');
    assert.equal(h.button('browse').props.disabled, false);
    await h.button('browse').props.onClick();
    assert.equal(attempts, 2);
    assert.equal(find(h.render(), node => node.type === 'TextField').props.value, '/mock/retry.csv');
  });
}

test('Export settings storage failure is reported and releases the guard without writing output', async () => {
  let fail = true;
  const h = exportFixture('clipboard', [{ field: 'value' }], [{ value: 'demo' }], {
    storage: { getItem: () => null, setItem() { if (fail) throw new Error('Simulated local storage failure'); } }
  });
  await h.button('export_2').props.onClick();
  assert.equal(h.calls.length, 0); assert.deepEqual(h.notices, []); assert.match(h.error(), /Simulated local storage failure/);
  assert.equal(h.button('export_2').props.disabled, false);
  fail = false; await h.button('export_2').props.onClick();
  assert.equal(h.calls[0][0], 'copy-to-clipboard');
});

for (const format of ['csv', 'clipboard']) {
  test(`${format} safety mode neutralizes text and headers while exact mode preserves original data`, async () => {
    const columns = [{ field: 'value', headerName: '=HEADER' }, { field: 'number', headerName: 'Number' }];
    const rows = [{ value: '=1+1', number: -12 }, { value: ' \t@SUM(A1)', number: 10 }];
    for (const spreadsheetSafe of [true, false]) {
      const result = await exportData(format, columns, rows, { spreadsheetSafe });
      const call = result.calls.find(call => call[0] === (format === 'csv' ? 'save-file' : 'copy-to-clipboard'));
      const text = call[format === 'csv' ? 2 : 1];
      const expected = [['=HEADER', 'Number'], ['=1+1', '-12'], [' \t@SUM(A1)', '10']];
      if (spreadsheetSafe) for (const row of expected) row[0] = "'" + row[0];
      assert.deepEqual(plain(parseDelimitedText(text, format === 'csv' ? ',' : '\t', key => key)), expected);
    }
  });
}
test('Spreadsheet safety defaults on and an explicit raw-mode choice is persisted and restored', async () => {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const create = () => exportFixture('clipboard', [{ field: 'value' }], [{ value: '=1+1' }], { storage });
  let h = create();
  const safety = () => find(h.render(), n => n.type === 'FormControlLabel' && n.props.label === 'spreadsheet_safe_export').props.control;
  assert.equal(safety().props.checked, true);
  safety().props.onChange({ target: { checked: false } }); h.render();
  await h.button('export_2').props.onClick();
  assert.equal(h.calls[0][1], 'value\n=1+1'); assert.equal(JSON.parse(saved).spreadsheetSafe, false);
  h = create(); assert.equal(safety().props.checked, false);
  safety().props.onChange({ target: { checked: true } }); h.render(); await h.button('export_2').props.onClick();
  assert.equal(h.calls[0][1], "value\n'=1+1");
});

test('XLSX treats DB JSON as literal text and never imports formula, link, rich text or style metadata', async () => {
  const values = [
    { f: '1+1', t: 'n', v: 2 },
    { t: 's', v: 'click', l: { Target: 'https://example.invalid/' }, h: '<b>rich</b>', z: '0.00', c: [{ t: 'comment' }] },
    [{ f: '1+1' }], '=1+1', '9007199254740993', '0.123456789012345678901', true, -12, null,
    { nested: { f: 'SUM(A1:A2)', big: 9007199254740993n } }
  ];
  const result = await exportData('excel', values.map((_value, i) => ({ field: String(i) })),
    [Object.fromEntries(values.map((value, i) => [String(i), value]))], { includeHeader: false });
  const workbook = XLSX.read(result.calls.find(call => call[0] === 'save-file')[2], { type: 'array', cellHTML: false });
  const sheet = workbook.Sheets.Data;
  for (const cell of Object.values(sheet)) {
    if (!cell || typeof cell !== 'object') continue;
    for (const key of ['f', 'F', 'D', 'l', 'r', 'h', 'c']) assert.equal(Object.hasOwn(cell, key), false, key);
  }
  const row = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })[0];
  assert.equal(row[0], JSON.stringify(values[0])); assert.equal(row[1], JSON.stringify(values[1]));
  assert.equal(row[2], JSON.stringify(values[2])); assert.equal(row[3], '=1+1');
  assert.equal(sheet.D1.t, 's'); assert.equal(row[4], values[4]); assert.equal(row[5], values[5]);
  assert.equal(row[6], true); assert.equal(row[7], -12); assert.equal(row[8], null);
  assert.equal(row[9], '{"nested":{"f":"SUM(A1:A2)","big":"9007199254740993"}}');
});

test('XLSX preserves dates, numeric/boolean values and exact large-integer text with explicit cells', async () => {
  const date = new Date('2026-01-02T03:04:05.000Z');
  const result = await exportData('excel', [{ field: 'date' }, { field: 'big' }, { field: 'number' }, { field: 'boolean' }],
    [{ date, big: 9007199254740993n, number: 12.5, boolean: false }], { includeHeader: false });
  const workbook = XLSX.read(result.calls.find(call => call[0] === 'save-file')[2], { type: 'array', cellDates: true });
  const row = XLSX.utils.sheet_to_json(workbook.Sheets.Data, { header: 1, defval: null, UTC: true })[0];
  assert.equal(workbook.Sheets.Data.A1.v.toISOString(), date.toISOString());
  assert.equal(row[0].toISOString(), date.toISOString());
  assert.equal(row[1], '9007199254740993'); assert.equal(row[2], 12.5); assert.equal(row[3], false);
});

for (const totalCount of [undefined, 9000]) {
  test(`Stopping a pending export (${totalCount}) closes its snapshot without partial output and supports retry`, async () => {
    let resolveFetch, fetched = 0, closed = 0, first = true;
    const pending = new Promise(resolve => { resolveFetch = resolve; });
    const fetchDataChunk = Object.assign(async () => { fetched++; return first ? pending : [{ value: 'retry' }]; }, { close: async () => { closed++; } });
    const h = exportFixture('csv', [{ field: 'value' }], [], { totalCount, fetchDataChunk });
    const running = h.button('export_2').props.onClick(); await waitUntil(() => fetched === 1);
    const progress = find(h.render(), node => node.type === 'LinearProgress');
    assert.equal(progress.props.variant, totalCount ? 'determinate' : 'indeterminate');
    h.button('export_stop').props.onClick();
    assert.equal(h.button('export_stop').props.disabled, true);
    resolveFetch(Array.from({ length: 5000 }, () => ({ value: 'discard' }))); await running;
    assert.equal(fetched, 1); assert.equal(closed, 1); assert.equal(h.calls.length, 0); assert.deepEqual(h.notices, []);
    assert.ok(find(h.render(), node => node.props?.role === 'status' && node.children.includes('export_stopped')));
    assert.equal(find(h.render(), node => node.type === 'Dialog').props.open, true);
    first = false; await h.button('export_2').props.onClick();
    assert.equal(closed, 2); assert.equal(h.calls.length, 1); assert.deepEqual(h.notices, ['csv_file_exported']);
  });
}
test('A stopped export does not hide snapshot cleanup failures', async () => {
  let release;
  const h = exportFixture('clipboard', [{ field: 'value' }], [], { fetchDataChunk: Object.assign(
    () => new Promise(resolve => { release = resolve; }), { close: async () => { throw new Error('Cleanup failed'); } }) });
  const running = h.button('export_2').props.onClick(); await waitUntil(() => !!release);
  h.button('export_stop').props.onClick(); release([]); await running;
  assert.equal(h.calls.length, 0); assert.deepEqual(h.notices, []); assert.match(h.error(), /Cleanup failed/);
  assert.equal(find(h.render(), node => node.props?.role === 'status' && node.children.includes('export_stopped')), undefined);
});
test('Saving has an indeterminate phase and cannot be stopped after dispatch', async () => {
  let release;
  const h = exportFixture('csv', [{ field: 'value' }], [{ value: 'data' }], { respond: () => new Promise(resolve => { release = resolve; }) });
  const running = h.button('export_2').props.onClick(); await waitUntil(() => !!release);
  assert.ok(find(h.render(), node => node.type === 'Typography' && node.children.includes('export_saving')));
  assert.equal(find(h.render(), node => node.type === 'LinearProgress').props.variant, 'indeterminate');
  assert.equal(h.button('export_stop'), undefined); assert.equal(h.notices.length, 0);
  release({ success: true }); await running; assert.deepEqual(h.notices, ['csv_file_exported']);
});
