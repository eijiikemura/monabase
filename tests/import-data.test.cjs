// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { translate } = require('../electron/i18n');
const { parseDelimitedText, resolveImportColumns } = loadTypeScript('src/features/table/importData.ts');
const t = (key, values) => translate(key, 'en', values);
const plain = value => JSON.parse(JSON.stringify(value));

test('Delimited parsing preserves empty records, whitespace, trailing fields and final quoted empty fields', () => {
  for (const delimiter of [',', '\t']) {
    const text = `\uFEFFA${delimiter}B\r\n\r\n${delimiter}\r\n"   "${delimiter}""\r\n${delimiter}""`;
    assert.deepEqual(plain(parseDelimitedText(text, delimiter, t)), [['A', 'B'], ['', ''], ['   ', ''], ['', '']]);
    assert.deepEqual(plain(parseDelimitedText('""', delimiter, t)), [['']]);
  }
  assert.deepEqual(plain(parseDelimitedText('\n\r\n', ',', t)), []);
});

test('Delimited parsing retains embedded separators, quotes, Unicode, and multiline values', () => {
  assert.deepEqual(plain(parseDelimitedText('"a,b","O\'Brien","say ""hello""","日本語\r\n改行"\n', ',', t)), [['a,b', "O'Brien", 'say "hello"', '日本語\r\n改行']]);
});

test('Malformed quotes are rejected before any records can be imported', () => {
  for (const text of ['A\n"unclosed', 'A\nplain"quote', 'A\n"closed"trailing', 'A\n"quoted" "other"']) {
    assert.throws(() => parseDelimitedText(text, ',', t), /Invalid delimited text near line 2/);
  }
});

test('Import headers prefer exact names before case-insensitive fallback', () => {
  const columns = ['code', 'CODE', ' Spaced ', 'A"B', "'literal'", 'Unique'];
  assert.deepEqual(plain(resolveImportColumns(['CODE', 'code', ' Spaced ', 'A"B', "'literal'", 'unique', 'ignored'], columns, t)), ['CODE', 'code', ' Spaced ', 'A"B', "'literal'", 'Unique', '']);
  assert.throws(() => resolveImportColumns(['Code'], columns, t), /matches multiple database columns/);
  assert.throws(() => resolveImportColumns(['code', 'code'], columns, t), /Multiple input columns/);
});

for (const db of ['oracle', 'postgresql']) {
  for (const sidebar of [false, true]) {
    test(`${db}: ${sidebar ? 'sidebar' : 'table'} import uses exact headers, rejects ambiguity and honors headerless data`, async () => {
      const requests = [];
      const file = sidebar ? `src/features/${db}/sidebarDataTransfer.ts` : `src/features/${db}/windows/table/tableDataTransfer.ts`;
      const factory = sidebar ? 'createSidebarDataTransfer' : 'createTableDataTransfer';
      const module = loadTypeScript(file, { '@/shared/api/desktop': { ipcRenderer: { async invoke(...args) {
        requests.push(args); return { success: true, rows: [], rowsAffected: 1 };
      } } } }, { alert() {}, window: { dispatchEvent() {} }, CustomEvent: class {} });
      const structureDefs = ['code', 'CODE'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' }));
      const context = { schema: 'TEST', tableName: 'ITEMS', structureDefs, resultColumns: [], conditions: {}, paginationModel: { page: 0, pageSize: 50 },
        t, formatSqlValue: (_column, value) => `'${value}'`, buildQueryStrings: () => ({ whereStr: '', orderStr: '' }), executeSearch: async () => {},
        setIsLoading() {}, setLogs() {}, setBottomTab() {}, setImportTarget() {},
        importTarget: { schema: 'TEST', tableName: 'ITEMS', structureDefs } };
      const transfer = module[factory](context);
      const run = sidebar ? transfer.processSidebarBulkInsertData : transfer.processBulkInsertData;
      await run([['CODE'], ['uppercase']], () => {}, true);
      assert.match(requests[0][1], /\("CODE"\) VALUES\s+\('uppercase'\)/);
      requests.length = 0;
      await assert.rejects(run([['Code'], ['ambiguous']], () => {}, true), /matches multiple database columns/);
      assert.equal(requests.length, 0);
      await run([['CODE', 'literal data']], () => {}, false);
      assert.match(requests[0][1], /VALUES\s+\('CODE', 'literal data'\)/);
    });
  }
}

const { createHookHarness } = require('./helpers/renderHook.cjs');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function importFixture({ onImport = async () => {}, readText = async () => 'LABEL\ndemo', remember = () => {} } = {}) {
  const hook = createHookHarness(), alerts = [], readers = [];
  const react = { ...hook.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  class Reader {
    readAsText(file, encoding) { readers.push({ reader: this, file, encoding }); }
  }
  const ImportDialog = loadTypeScript('src/components/data/ImportDialog.tsx', {
    react, '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@mui/icons-material/FolderOpen': 'Folder', '@mui/icons-material/FileUpload': 'Upload',
    'react-i18next': { useTranslation: () => ({ t }) }
  }, { navigator: { platform: 'MacIntel', clipboard: { readText } },
    localStorage: { getItem: () => null, setItem: remember }, FileReader: Reader, alert: message => alerts.push(message) }).default;
  let tree;
  function walk(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)]; }
  const render = () => { tree = hook.render(() => ImportDialog({ onImport, columns: ['LABEL'] })); };
  const nodes = () => walk(tree);
  render(); nodes().find(node => node.type === 'IconButton').props.onClick(); render(); hook.commit(); render();
  return { hook, render, nodes, readers, alerts,
    button: label => nodes().find(node => node.type === 'Button' && node.children.includes(label)),
    input: () => nodes().find(node => node.type === 'input'),
    csv: () => { nodes().find(node => node.type === 'RadioGroup').props.onChange({ target: { value: 'csv' } }); render(); },
    select: () => { nodes().find(node => node.type === 'input').props.onChange({ target: { files: [{ name: 'demo.csv' }], value: 'demo.csv' } }); render(); }
  };
}
const importButton = h => h.button('Execute').props.onClick;
const previewButton = h => h.button('Preview').props.onClick;
const preview = async h => { await previewButton(h)(); h.render(); };

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: preview writes nothing and repeated confirmed imports submit only one INSERT`, async () => {
    const pending = deferred(), requests = [];
    const { createTableDataTransfer } = loadTypeScript(`src/features/${db}/windows/table/tableDataTransfer.ts`, {
      '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql) => { requests.push({ channel, sql }); return pending.promise; } } }
    }, { alert() {} });
    const transfer = createTableDataTransfer({ schema: 'TEST', tableName: 'ITEMS',
      structureDefs: [{ COLUMN_NAME: 'LABEL', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' }],
      resultColumns: [], conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t,
      formatSqlValue: (_column, value) => `'${value}'`, buildQueryStrings: () => ({ whereStr: '', orderStr: '' }),
      executeSearch: async () => {}, setIsLoading() {}, setLogs() {}, setBottomTab() {} });
    const h = importFixture({ onImport: transfer.processBulkInsertData });
    assert.equal(h.button('Execute').props.disabled, true);
    await importButton(h)(); assert.equal(requests.length, 0);
    await preview(h); assert.equal(requests.length, 0);
    const execute = importButton(h), first = execute(); await execute();
    h.button('Cancel').props.onClick(); h.nodes().find(node => node.type === 'Dialog').props.onClose();
    await h.hook.settle(); h.render();
    assert.equal(requests.length, 1); assert.equal(requests[0].channel, 'execute-sql');
    assert.match(requests[0].sql, /^INSERT/);
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, true);
    pending.resolve({ success: true, rowsAffected: 1 }); await first; h.render();
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, false);
  });
}
for (const source of ['clipboard', 'csv']) {
  test(`${source}: pending preview prevents duplicate reads, changes and dismissal without importing`, async () => {
    const pending = deferred(); let reads = 0, imports = 0;
    const h = importFixture({ readText: () => { reads++; return pending.promise; }, onImport: async () => { imports++; } });
    if (source === 'csv') { h.csv(); h.select(); }
    const first = previewButton(h)(); await previewButton(h)(); h.button('Cancel').props.onClick(); h.render();
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, true);
    assert.equal(h.input().props.disabled, true);
    assert.equal(source === 'csv' ? h.readers.length : reads, 1);
    h.input().props.onChange({ target: { files: [{ name: 'other.csv' }] } }); h.render();
    if (source === 'csv') {
      assert.equal(h.nodes().find(node => node.type === 'TextField').props.value, 'demo.csv');
      h.readers[0].reader.onload({ target: { result: 'LABEL\ndemo' } });
    } else pending.resolve('LABEL\ndemo');
    await first; h.render(); assert.equal(imports, 0);
    await importButton(h)(); assert.equal(imports, 1);
  });
}
for (const failure of ['settings', 'clipboard', 'database', 'parsing']) {
  test(`Import ${failure} failure requires a fresh preview and supports an explicit retry`, async () => {
    let fail = true, reads = 0, imports = 0;
    const h = importFixture({
      remember() { if (fail && failure === 'settings') throw new Error('Simulated settings write failure'); },
      readText: async () => {
        reads++;
        if (fail && failure === 'clipboard') throw new Error('Simulated clipboard read failure');
        return fail && failure === 'parsing' ? 'LABEL\n"unclosed' : 'LABEL\ndemo';
      },
      onImport: async () => { imports++; if (fail && failure === 'database') throw new Error('Simulated insert failure'); }
    });
    await preview(h);
    if (failure === 'database') { await importButton(h)(); h.render(); }
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, true);
    assert.equal(h.button('Execute').props.disabled, true);
    assert.ok(h.nodes().some(node => node.type === 'Alert' && node.props.severity === 'error'));
    assert.equal(imports, failure === 'database' ? 1 : 0);
    if (failure === 'settings') assert.equal(reads, 0);
    fail = false; await preview(h); await importButton(h)(); h.render();
    assert.equal(imports, failure === 'database' ? 2 : 1);
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, false);
  });
}
test('CSV selection and read errors remain retryable without writing to the database', async () => {
  let imports = 0;
  const h = importFixture({ onImport: async () => { imports++; } }); h.csv();
  await preview(h); assert.equal(h.readers.length, 0);
  h.select(); const first = previewButton(h)(); h.readers[0].reader.onerror(); await first; h.render();
  assert.equal(imports, 0);
  const retry = previewButton(h)(); h.readers[1].reader.onload({ target: { result: 'LABEL\ndemo' } });
  await retry; h.render(); assert.equal(imports, 0); await importButton(h)(); assert.equal(imports, 1);
});
test('Changing a preview setting invalidates execution and refreshed clipboard data is explicit', async () => {
  let text = 'LABEL\nfirst'; const imports = [];
  const h = importFixture({ readText: async () => text, onImport: async records => imports.push(plain(records)) });
  await preview(h); text = 'LABEL\nsecond';
  assert.equal(h.button('Execute').props.disabled, false);
  h.nodes().find(node => node.type === 'FormControlLabel' && node.props.control?.type === 'Checkbox').props.control.props.onChange({ target: { checked: false } }); h.render();
  assert.equal(h.button('Execute').props.disabled, true); await importButton(h)(); assert.equal(imports.length, 0);
  await preview(h); await importButton(h)(); assert.deepEqual(imports, [[['LABEL'], ['second']]]);
});
test('Preview preserves raw values, reports ignored columns, and rejects malformed row widths', () => {
  const { previewImport } = loadTypeScript('src/features/table/importData.ts');
  const result = previewImport([['label', 'unused'], ['日本語', 'x']], ['LABEL'], true, t);
  assert.deepEqual(plain(result), { targets: ['LABEL', ''], rowCount: 1, sample: [['日本語', 'x']] });
  assert.throws(() => previewImport([['LABEL'], ['a', 'b']], ['LABEL'], true, t), /Row 2 has 2 fields/);
  assert.throws(() => previewImport([['LABEL']], ['LABEL'], true, t), /No data/);
  assert.throws(() => previewImport([['unknown'], ['value']], ['LABEL'], true, t), /columns|match/i);
  const sample = previewImport(Array.from({ length: 50 }, () => ['value']), ['LABEL'], false, t);
  assert.equal(sample.rowCount, 50); assert.equal(sample.sample.length, 10);
});

function bulkImportFixture(db, sidebar, respond) {
  const requests = [], alerts = [], progress = [], loading = [], targets = [], events = [], tabChanges = [];
  let logs = [], refreshes = 0;
  const module = loadTypeScript(sidebar ? `src/features/${db}/sidebarDataTransfer.ts` : `src/features/${db}/windows/table/tableDataTransfer.ts`, {
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql) => {
      assert.equal(channel, 'execute-sql'); requests.push(sql); return respond(requests.length, sql);
    } } }
  }, { alert: message => alerts.push(message), window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type) { this.type = type; } } });
  const structureDefs = [{ COLUMN_NAME: 'LABEL', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' }];
  const context = { schema: 'TEST', tableName: 'ITEMS', structureDefs, resultColumns: [], conditions: {}, paginationModel: { page: 0, pageSize: 50 },
    t, formatSqlValue: (_column, value) => `'${value}'`, buildQueryStrings: () => ({ whereStr: '', orderStr: '' }),
    executeSearch: async () => { refreshes++; }, setIsLoading: value => loading.push(value), setLogs: update => { logs = update(logs); }, setBottomTab: value => tabChanges.push(value),
    setImportTarget: target => targets.push(target), importTarget: { schema: 'TEST', tableName: 'ITEMS', structureDefs } };
  const api = module[sidebar ? 'createSidebarDataTransfer' : 'createTableDataTransfer'](context);
  const run = api[sidebar ? 'processSidebarBulkInsertData' : 'processBulkInsertData'];
  return { requests, alerts, progress, loading, targets, events, tabChanges, get logs() { return logs; }, get refreshes() { return refreshes; },
    run: (records, notify = value => progress.push(value), header = true) => run(records, notify, header) };
}
for (const db of ['oracle', 'postgresql']) for (const sidebar of [false, true]) {
  const scope = `${db} ${sidebar ? 'sidebar' : 'table'}`;
  test(`${scope}: mismatched and unconfirmed batch counts stop without reporting success`, async () => {
    for (const affected of [0, 1, undefined, -1, 3, NaN, 0.5]) {
      const h = bulkImportFixture(db, sidebar, () => ({ success: true, rowsAffected: affected }));
      await assert.rejects(h.run([['LABEL'], ['first'], ['second']]), error => {
        assert.match(error.message, /Import stopped/);
        assert.ok(error.message.includes(`Confirmed inserted rows: ${affected === 1 ? 1 : 0}.`));
        assert.match(error.message, /No automatic commit or rollback/); return true;
      });
      assert.equal(h.requests.length, 1); assert.deepEqual(h.alerts, []); assert.equal(h.refreshes, 0);
      assert.equal(h.progress.includes(100), false); assert.deepEqual(h.targets, []); assert.deepEqual(h.events, []);
      assert.deepEqual(h.tabChanges, [], 'Keep the grid footer and its import dialog mounted');
      assert.equal(h.loading.at(-1), false);
      if (!sidebar) assert.ok(h.logs[0].errorLines.length > 0);
    }
  });
  test(`${scope}: later batch failure preserves confirmed counts and prevents subsequent INSERTs`, async () => {
    const records = [['LABEL'], ...Array.from({ length: 2001 }, (_, index) => [String(index)])];
    for (const outcome of ['zero', 'partial', 'unknown', 'failed', 'rejected']) {
      const h = bulkImportFixture(db, sidebar, index => {
        if (index === 1) return { success: true, rowsAffected: 1000 };
        if (outcome === 'rejected') throw new Error('Simulated IPC rejection');
        return outcome === 'failed' ? { success: false, error: 'Simulated SQL failure' } : { success: true, rowsAffected: outcome === 'zero' ? 0 : outcome === 'partial' ? 1 : undefined };
      });
      await assert.rejects(h.run(records), error => {
        assert.ok(error.message.includes(`Confirmed inserted rows: ${outcome === 'partial' ? 1001 : 1000}.`));
        assert.match(error.message, /Check the database and transaction state before retrying/); return true;
      });
      assert.equal(h.requests.length, 2); assert.equal(h.progress.includes(100), false);
      assert.deepEqual(h.alerts, []); assert.deepEqual(h.targets, []); assert.equal(h.refreshes, 0);
      assert.deepEqual(h.tabChanges, [], 'Keep the import dialog mounted after SQL failure');
    }
  });
  test(`${scope}: complete batches use confirmed counts and finish normally`, async () => {
    const h = bulkImportFixture(db, sidebar, index => ({ success: true, rowsAffected: index === 1 ? 1000 : 1 }));
    await h.run([['LABEL'], ...Array.from({ length: 1001 }, (_, index) => [String(index)])]);
    assert.equal(h.requests.length, 2); assert.equal(h.alerts.length, 1); assert.ok(h.alerts[0].includes('1001'));
    assert.equal(h.progress.at(-1), 100); assert.equal(h.loading.at(-1), false);
    assert.equal(h.refreshes, sidebar ? 0 : 1);
  });
  test(`${scope}: a count mismatch retains the import dialog and allows an explicit retry`, async () => {
    let valid = false;
    const transfer = bulkImportFixture(db, sidebar, () => ({ success: true, rowsAffected: valid ? 2 : 0 }));
    const h = importFixture({ onImport: transfer.run, readText: async () => 'LABEL\nfirst\nsecond' });
    await preview(h); await importButton(h)(); h.render();
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, true);
    assert.equal(h.button('Execute').props.disabled, true);
    assert.ok(h.nodes().some(node => node.type === 'Alert' && /Confirmed inserted rows: 0/.test(node.children.join(''))));
    assert.deepEqual(transfer.targets, []);
    valid = true; await preview(h); await importButton(h)(); h.render();
    assert.equal(h.nodes().find(node => node.type === 'Dialog').props.open, false);
    assert.equal(transfer.requests.length, 2);
  });
}
