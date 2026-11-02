// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createGitRepository } = require('./helpers/gitRepository.cjs');

const revision = id => ({ id, fullId: id, date: '2026-10-24', message: id, isMerge: false });
const snapshot = id => ({ version: 2, schema: 'test', nodes: id ? [{ id, position: { x: 1, y: 2 }, data: { columns: [] } }] : [], edges: [] });
const content = id => ({ success: true, content: JSON.stringify(snapshot(id)) });
const invalidDiagrams = ['{"nodes":[],"edges":[]}', '{"version":2,"schema":"   ","nodes":[],"edges":[]}', '{"version":2,"nodes":[],"edges":[]}', '{"version":2,"schema":null,"nodes":[],"edges":[]}', '{', 'null', '[]', '{}', '{"nodes":[],"edges":{}}',
  '{"nodes":{},"edges":[]}', '{"nodes":[{}],"edges":[]}', '{"nodes":[],"edges":[{}]}',
  ...[
    { ...snapshot('bad').nodes[0], position: { x: '1', y: 2 } },
    { ...snapshot('bad').nodes[0], data: { columns: {} } },
    { ...snapshot('bad').nodes[0], data: { columns: [null] } },
    { ...snapshot('bad').nodes[0], data: { columns: [{ name: {} }] } },
    { ...snapshot('bad').nodes[0], data: { columns: [], tableComment: {} } }
  ].map(node => JSON.stringify({ version: 2, schema: 'test', nodes: [node], edges: [] }))];


function componentHarness() {
  const hook = createHookHarness();
  const react = { ...hook.react, memo: value => value,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const dependencies = {
    '@/features/git/GitHistoryPagination': { default: 'GitHistoryPagination', __esModule: true },
    '@/features/objects/ObjectPickerDialog': { default: 'ObjectPickerDialog', __esModule: true },
    react, '@mui/material': new Proxy({}, { get: (_, key) => key }), '@mui/x-data-grid': { DataGrid: 'DataGrid' },
    reactflow: { __esModule: true, default: 'ReactFlow', Background: 'Background', Controls: 'Controls', ReactFlowProvider: 'Provider' },
    'reactflow/dist/style.css': {}
  };
  for (const name of ['Add', 'Download', 'FolderOpen', 'Save', 'Delete', 'Close', 'CompareArrows', 'ArrowBack', 'Restore', 'Sync']) {
    dependencies['@mui/icons-material/' + name] = name + 'Icon';
  }
  const Component = loadTypeScript('src/features/er/CustomErDiagram.tsx', dependencies).default;
  return logic => hook.render(() => Component({ logic, nodeTypes: {} }));
}
function find(node, predicate) {
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return; }
  if (!node || typeof node !== 'object') return;
  return predicate(node) ? node : find(node.children, predicate);
}

async function fixture(dbType, customInvoke) {
  const hook = createHookHarness(), pending = [], alerts = [], confirmations = [], calls = [];
  const t = key => key;
  const { useCustomErDiagram } = loadTypeScript('src/features/er/useCustomErDiagram.ts', {
    './erDocument': loadTypeScript('src/features/er/erDocument.ts'),
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    reactflow: {}, 'html-to-image': {},
    './erMetadata': loadTypeScript('src/features/er/erMetadata.ts', { '@/shared/api/desktop': {} }),
    '../postgresql/windows/common/schemaStorage': { getPgSelectSchema: () => '', savePgSelectSchema() {} },
    './useErDiagramWindow': { fetchErSchemas: async () => ['test'], fetchErDiagramData: async () => snapshot('current') },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, payload) => {
      calls.push([channel, payload]);
      if (channel === 'git-status-check') return { success: true, isRepo: true, remoteUrl: null };
      if (channel === 'execute-sql-bg') return { success: true, rows: [] };
      if (customInvoke) return customInvoke(channel, payload, pending);
      if (channel === 'get-er-diagrams') return { success: true, files: ['diagram.json', 'other.json'] };
      if (channel === 'git-get-history-er') return { success: true, history: [revision('A'), revision('B')] };
      if (channel === 'load-er-diagram') return { success: true, data: JSON.stringify(snapshot('current')) };
      if (channel === 'git-get-file-content-er') return new Promise((resolve, reject) => pending.push({ payload, resolve, reject }));
      throw new Error('Unexpected IPC: ' + channel);
    } } }
  }, {
    localStorage: { getItem: () => null }, document: { body: { style: {} } }, alert: value => alerts.push(value),
    window: { addEventListener() {}, removeEventListener() {}, confirm: message => { confirmations.push(message); return true; } }
  });
  let state;
  const render = () => (state = hook.render(() => useCustomErDiagram({ dbType, isActive: true, schemas: ['test'] })));
  async function flush() {
    for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); }
    return render();
  }
  await flush(); await state.handleOpenCustomEr('diagram.json'); await flush();
  await state.handleOpenCompareMode(); await flush();
  assert.equal(state.isCompareMode, true);
  return { get state() { return state; }, pending, alerts, confirmations, calls, flush,
    select: row => state.handleHistoryRowClick({ row: typeof row === 'string' ? revision(row) : row }),
    unmount: () => hook.unmount() };
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: invalid ordinary ER files retain the full working diagram and permit a valid retry`, async () => {
    let file = JSON.stringify(snapshot('current'));
    const h = await fixture(db, async channel => {
      if (channel === 'get-er-diagrams') return { success: true, files: ['diagram.json'] };
      if (channel === 'load-er-diagram') return { success: true, data: file };
      if (channel === 'git-get-history-er') return { success: true, history: [] };
      throw new Error('Unexpected IPC: ' + channel);
    });
    try {
      const nodes = h.state.customNodes, edges = h.state.customEdges, name = h.state.erDiagramName;
      const metadataCount = () => h.calls.filter(([channel]) => channel === 'execute-sql-bg').length;
      const before = metadataCount();
      for (const invalid of invalidDiagrams) {
        file = invalid;
        const count = h.alerts.length;
        await h.state.handleOpenCustomEr('broken.json'); await h.flush();
        assert.equal(h.alerts.length, count + 1);
        assert.match(h.alerts.at(-1), /invalid_er_diagram_structure/);
        assert.equal(h.state.customNodes, nodes); assert.equal(h.state.customEdges, edges);
        assert.equal(h.state.erDiagramName, name); assert.equal(h.state.customMode, 'design');
        assert.equal(h.state.isLoading, false); assert.equal(metadataCount(), before);
      }
      const valid = snapshot('retry');
      valid.nodes[0].data = { tableName: 'retry', tableComment: 'A table', columns: [{ name: 'ID', type: 'NUMBER', comment: 'Key', isPk: true }] };
      valid.edges = [{ id: 'self', source: 'retry', target: 'retry' }];
      file = JSON.stringify(valid);
      const count = h.alerts.length;
      await h.state.handleOpenCustomEr('retry.json'); await h.flush();
      assert.equal(h.alerts.length, count); assert.equal(h.state.erDiagramName, 'retry');
      assert.equal(h.state.customNodes[0].id, 'retry'); assert.equal(h.state.customNodes[0].data.columns[0].name, 'ID');
      assert.equal(h.state.customEdges[0].id, 'self');
      assert.ok(!h.calls.some(([channel]) => ['save-er-diagram', 'git-commit-er'].includes(channel)));
    } finally { h.unmount(); }
  });
  test(`${db}: an ordinary valid empty ER file can replace the working diagram intentionally`, async () => {
    let file = JSON.stringify(snapshot('current'));
    const h = await fixture(db, async channel => {
      if (channel === 'get-er-diagrams') return { success: true, files: ['diagram.json'] };
      if (channel === 'load-er-diagram') return { success: true, data: file };
      if (channel === 'git-get-history-er') return { success: true, history: [] };
      throw new Error('Unexpected IPC: ' + channel);
    });
    try {
      file = JSON.stringify(snapshot(null));
      await h.state.handleOpenCustomEr('empty.json'); await h.flush();
      assert.equal(h.state.erDiagramName, 'empty'); assert.equal(h.state.customMode, 'design');
      assert.equal(h.state.customNodes.length, 0); assert.equal(h.state.customEdges.length, 0);
      assert.equal(h.alerts.length, 0);
    } finally { h.unmount(); }
  });
  test(`${db}: actual ER controls disable restore while loading and after failure and enable it after retry`, async () => {
    const h = await fixture(db), render = componentHarness();
    const restoreButton = tree => find(tree, node => node.type === 'Button' && node.children.includes('restore_to_selected_version'));
    try {
      assert.equal(restoreButton(render(h.state)).props.disabled, true);
      const first = h.select('A'); await h.flush();
      const loading = render(h.state);
      assert.equal(restoreButton(loading).props.disabled, true);
      assert.ok(find(loading, node => node.type === 'CircularProgress' && node.props['aria-label'] === 'loading'));
      h.pending[0].resolve({ success: false, error: 'Unavailable' }); await first; await h.flush();
      assert.equal(restoreButton(render(h.state)).props.disabled, true);
      const retry = h.select('A'); h.pending[1].resolve(content('A')); await retry; await h.flush();
      const button = restoreButton(render(h.state));
      assert.equal(button.props.disabled, false); button.props.onClick(); await h.flush();
      assert.equal(h.state.customNodes[0].id, 'A');
    } finally { h.unmount(); }
  });
  test(`${db}: only a successfully loaded selected ER revision can be restored`, async () => {
    const h = await fixture(db);
    try {
      assert.equal(h.state.canRestoreHistory, false);
      const load = h.select('A'); await h.flush();
      assert.equal(h.state.isHistoryLoading, true); assert.equal(h.state.canRestoreHistory, false);
      h.pending[0].resolve(content('A')); await load; await h.flush();
      assert.equal(h.state.selectedHistory.fullId, 'A'); assert.equal(h.state.canRestoreHistory, true);
      h.state.handleRestorePastVersion(); await h.flush();
      assert.equal(h.state.customNodes[0].id, 'A'); assert.equal(h.state.isCompareMode, false);
      assert.equal(h.confirmations.length, 1);
      assert.ok(!h.calls.some(([channel]) => ['save-er-diagram', 'git-commit-er'].includes(channel)));
    } finally { h.unmount(); }
  });
  test(`${db}: beginning another revision load immediately blocks stale restore handlers`, async () => {
    const h = await fixture(db);
    try {
      const a = h.select('A'); h.pending[0].resolve(content('A')); await a; await h.flush();
      const staleRestore = h.state.handleRestorePastVersion;
      const b = h.select('B'); staleRestore(); await h.flush();
      assert.equal(h.state.canRestoreHistory, false); assert.equal(h.state.customNodes[0].id, 'current');
      assert.equal(h.confirmations.length, 0);
      h.pending[1].resolve(content('B')); await b; await h.flush(); h.state.handleRestorePastVersion(); await h.flush();
      assert.equal(h.state.customNodes[0].id, 'B');
    } finally { h.unmount(); }
  });
  test(`${db}: reversed ER responses retain the selected revision and its own snapshot`, async () => {
    const h = await fixture(db);
    try {
      const a = h.select('A'), b = h.select('B');
      h.pending[1].resolve(content('B')); await b; await h.flush();
      h.pending[0].resolve(content('A')); await a; await h.flush();
      assert.equal(h.state.selectedHistory.fullId, 'B'); assert.equal(h.state.annotatedPastNodes[0].id, 'B');
      h.state.handleRestorePastVersion(); await h.flush(); assert.equal(h.state.customNodes[0].id, 'B');
    } finally { h.unmount(); }
  });
  test(`${db}: old ER failures cannot clear a newer successful preview or show an error`, async () => {
    for (const reject of [false, true]) {
      const h = await fixture(db);
      try {
        const a = h.select('A'), b = h.select('B');
        h.pending[1].resolve(content('B')); await b; await h.flush();
        if (reject) h.pending[0].reject(new Error('Late failure'));
        else h.pending[0].resolve({ success: false, error: 'Late failure' });
        await a; await h.flush();
        assert.equal(h.state.canRestoreHistory, true); assert.equal(h.state.annotatedPastNodes[0].id, 'B');
        assert.equal(h.alerts.length, 0);
      } finally { h.unmount(); }
    }
  });
  test(`${db}: failed or invalid ER snapshots preserve the canvas and permit retry`, async () => {
    const h = await fixture(db);
    try {
      for (const result of [
        new Error('Current IPC failure'),
        { success: false, error: 'Missing revision' },
        ...invalidDiagrams.map(content => ({ success: true, content }))
      ]) {
        const load = h.select('B');
        if (result instanceof Error) h.pending.at(-1).reject(result);
        else h.pending.at(-1).resolve(result);
        await load; await h.flush();
        h.state.handleRestorePastVersion(); await h.flush();
        assert.equal(h.state.isHistoryLoading, false); assert.equal(h.state.canRestoreHistory, false);
        assert.equal(h.state.customNodes[0].id, 'current'); assert.equal(h.confirmations.length, 0);
      }
      const retry = h.select('B'); h.pending.at(-1).resolve(content('B')); await retry; await h.flush();
      assert.equal(h.state.canRestoreHistory, true);
    } finally { h.unmount(); }
  });
  test(`${db}: a valid empty ER revision remains intentionally restorable`, async () => {
    const h = await fixture(db);
    try {
      const load = h.select('empty'); h.pending[0].resolve(content(null)); await load; await h.flush();
      assert.equal(h.state.canRestoreHistory, true);
      h.state.handleRestorePastVersion(); await h.flush(); assert.equal(h.state.customNodes.length, 0);
    } finally { h.unmount(); }
  });
  test(`${db}: closing comparison invalidates pending ER previews and allows a fresh selection`, async () => {
    const h = await fixture(db);
    try {
      const load = h.select('A'); h.state.handleCloseCompareMode();
      h.pending[0].resolve(content('A')); await load; await h.flush();
      assert.equal(h.state.selectedHistory, null); assert.equal(h.state.canRestoreHistory, false);
      await h.state.handleOpenCompareMode(); await h.flush();
      const fresh = h.select('B'); h.pending[1].resolve(content('B')); await fresh; await h.flush();
      assert.equal(h.state.canRestoreHistory, true);
    } finally { h.unmount(); }
  });
  test(`${db}: changing diagrams invalidates pending ER data even with the same commit id`, async () => {
    const h = await fixture(db);
    try {
      const old = h.select('A'); h.state.setErDiagramName('other');
      h.pending[0].resolve(content('wrong-file')); await old; await h.flush();
      assert.equal(h.state.selectedHistory, null); assert.equal(h.state.canRestoreHistory, false);
      const fresh = h.select('A');
      assert.equal(h.pending[1].payload.objectName, 'other.json');
      h.pending[1].resolve(content('other-file')); await fresh; await h.flush();
      assert.equal(h.state.annotatedPastNodes[0].id, 'other-file');
    } finally { h.unmount(); }
  });
  test(`${db}: late ER success and rejection after unmount do not notify or restore`, async () => {
    for (const reject of [false, true]) {
      const h = await fixture(db), load = h.select('A');
      h.unmount();
      if (reject) h.pending[0].reject(new Error('Late failure'));
      else h.pending[0].resolve(content('late'));
      await load; assert.equal(h.alerts.length, 0); assert.equal(h.confirmations.length, 0);
    }
    const ready = await fixture(db), load = ready.select('A');
    ready.pending[0].resolve(content('A')); await load; await ready.flush();
    const restore = ready.state.handleRestorePastVersion;
    ready.unmount(); restore(); assert.equal(ready.confirmations.length, 0);
  });
  test(`${db}: actual Git revisions stay paired with ER snapshots when responses arrive backwards`, async t => {
    const repo = await createGitRepository(t), handlers = new Map();
    loadModule('electron/ipc/er.js', { 'simple-git': { simpleGit: repo.client } }, {}, { strict: false }).registerErHandlers({
      ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, gitDirectory: repo.repo, t: key => key
    });
    const er = (channel, payload) => handlers.get(channel)(null, payload);
    const dbType = db === 'oracle' ? 'ORACLE' : 'POSTGRESQL';
    for (const id of ['old', 'new']) assert.equal((await er('git-commit-er', {
      dbType, objectName: 'diagram', sourceText: JSON.stringify(snapshot(id)), message: id
    })).success, true);
    const head = await repo.git.revparse(['HEAD']);
    const file = path.join(repo.repo, 'MonaBase', dbType, 'ErDiagram', 'diagram.json');
    const bytes = fs.readFileSync(file);
    const h = await fixture(db, async (channel, payload, pending) => {
      const result = await er(channel, payload);
      if (channel === 'git-get-file-content-er') return new Promise(resolve => pending.push({ payload, resolve: () => resolve(result) }));
      return result;
    });
    try {
      const older = h.state.historyList.find(row => row.message === 'old'), newer = h.state.historyList.find(row => row.message === 'new');
      assert.ok(older); assert.ok(newer);
      const a = h.select(older), b = h.select(newer);
      const deadline = Date.now() + 10000;
      while (h.pending.length < 2 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.pending.length, 2, 'Real Git reads must complete before releasing the delayed responses');
      h.pending.find(item => item.payload.commitId === newer.fullId).resolve(); await b; await h.flush();
      h.pending.find(item => item.payload.commitId === older.fullId).resolve(); await a; await h.flush();
      assert.equal(h.state.selectedHistory.fullId, newer.fullId);
      h.state.handleRestorePastVersion(); await h.flush(); assert.equal(h.state.customNodes[0].id, 'new');
      assert.deepEqual(fs.readFileSync(file), bytes); assert.equal(await repo.git.revparse(['HEAD']), head);
      const broken = '{"nodes":[],"edges":{}}';
      assert.equal((await er('save-er-diagram', { dbType, objectName: 'diagram', sourceText: broken })).success, true);
      const alerts = h.alerts.length;
      await h.state.handleOpenCustomEr('diagram.json'); await h.flush();
      assert.equal(h.alerts.length, alerts + 1); assert.match(h.alerts.at(-1), /invalid_er_diagram_structure/);
      assert.equal(h.state.customNodes[0].id, 'new'); assert.equal(h.state.erDiagramName, 'diagram');
      assert.equal(fs.readFileSync(file, 'utf8'), broken); assert.equal(await repo.git.revparse(['HEAD']), head);
      assert.equal((await er('save-er-diagram', { dbType, objectName: 'diagram', sourceText: bytes.toString('utf8') })).success, true);
      await h.state.handleOpenCustomEr('diagram.json'); await h.flush();
      assert.equal(h.alerts.length, alerts + 1); assert.equal(h.state.customNodes[0].id, 'new');
      assert.deepEqual(fs.readFileSync(file), bytes); assert.equal(await repo.git.revparse(['HEAD']), head);
    } finally { h.unmount(); }
  });
}

for (const db of ['oracle', 'postgresql']) test(`${db}: ER history pagination replaces rows and a failed page keeps the current list`, async () => {
  const h = await fixture(db, async (channel, payload) => {
    if (channel === 'get-er-diagrams') return { success: true, files: ['diagram.json'] };
    if (channel === 'load-er-diagram') return { success: true, data: JSON.stringify(snapshot('current')) };
    if (channel === 'git-get-history-er') return payload.page === 2 ? { success: false, error: 'History limit reached' } :
      { success: true, history: [revision(`page${payload.page}`)], hasMore: true };
    throw new Error('Unexpected IPC: ' + channel);
  });
  try {
    await h.state.loadErHistory(1); await h.flush();
    assert.equal(h.state.historyPage, 1); assert.equal(h.state.historyList.length, 1);
    assert.equal(h.state.historyList[0].id, 'page1');
    await h.state.loadErHistory(2); await h.flush();
    assert.equal(h.state.historyPage, 1); assert.equal(h.state.historyLoading, false);
    assert.equal(h.state.historyList[0].id, 'page1'); assert.ok(h.alerts.includes('History limit reached'));
  } finally { h.unmount(); }
});
