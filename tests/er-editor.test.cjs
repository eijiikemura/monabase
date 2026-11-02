// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { erDocumentKey, buildErSyncPreview, erEdgeChanged } = loadTypeScript('src/features/er/erDocument.ts');
const node = (id, columns = []) => ({ id, type: 'tableNode', position: { x: 0, y: 0 }, data: { columns, tableComment: '' } });
const edge = (id, source = 'A', target = 'B') => ({ id, source, target, markerEnd: 'many' });
const json = value => JSON.parse(JSON.stringify(value));

test('Document identity ignores transient selection, dimensions and display settings but retains schema and position', () => {
  const document = { name: 'diagram', schema: 'test', nodes: [node('A')], edges: [edge('one')] };
  const transient = json(document);
  Object.assign(transient.nodes[0], { selected: true, width: 500, height: 200, dragging: false });
  Object.assign(transient.nodes[0].data, { showComments: false, diffStatus: 'modified' });
  transient.edges[0].selected = true;
  assert.equal(erDocumentKey(document), erDocumentKey(transient));
  transient.nodes[0].position.x = 1;
  assert.notEqual(erDocumentKey(document), erDocumentKey(transient));
  assert.notEqual(erDocumentKey(document), erDocumentKey({ ...document, schema: 'other' }));
});

test('Synchronization reports all column changes, retains placement and virtual relations, and removes only missing tables', () => {
  const document = { name: 'diagram', schema: 'test', nodes: [node('A', [{ name: 'old' }, { name: 'value', type: 'int' }]), node('B'), node('gone')],
    edges: [edge('one'), edge('two'), edge('removed', 'A', 'gone')] };
  const preview = buildErSyncPreview(document, [node('A', [{ name: 'new' }, { name: 'value', type: 'text' }]), node('B'), node('not-selected')]);
  assert.equal(preview.before, erDocumentKey(document));
  assert.deepEqual(json(preview.changes), [
    { table: 'A', column: 'new', status: 'added' }, { table: 'A', column: 'value', status: 'modified' },
    { table: 'A', column: 'old', status: 'deleted' }, { table: 'gone', status: 'deleted' }
  ]);
  assert.deepEqual(json(preview.nodes.map(n => n.id)), ['A', 'B']);
  assert.equal(preview.nodes[0].position, document.nodes[0].position);
  assert.equal(preview.nodes[0].data.diffStatus, 'modified');
  assert.deepEqual(json(preview.edges.map(e => e.id)), ['one', 'two']);
  assert.equal(document.nodes.length, 3);
  assert.equal(buildErSyncPreview(document, []).nodes.length, 0);
});

test('Relation comparison includes endpoints, handles and cardinality', () => {
  const original = edge('one');
  assert.equal(erEdgeChanged(original, { ...original, selected: true }), false);
  for (const patch of [{ target: 'C' }, { sourceHandle: 'created_by' }, { targetHandle: 'id' }, { markerEnd: 'one' }]) {
    assert.equal(erEdgeChanged(original, { ...original, ...patch }), true);
  }
});

async function fixture(dbType) {
  const hook = createHookHarness({ doubleUpdates: true }), alerts = [], confirms = [], calls = [], images = [];
  let confirm = true, failSave = false, saved, loaded = { version: 2, schema: 'original', nodes: [node('A'), node('B')], edges: [edge('one'), edge('two')] };
  let latest = [node('A', [{ name: 'added' }]), node('B')];
  let pendingSync;
  const t = key => key;
  const ownViewport = { appendChild() {}, insertAdjacentHTML() {} };
  const { useCustomErDiagram } = loadTypeScript('src/features/er/useCustomErDiagram.ts', {
    './erDocument': loadTypeScript('src/features/er/erDocument.ts'),
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    reactflow: { applyNodeChanges: (changes, nodes) => nodes.flatMap(n => {
      const change = changes.find(c => c.id === n.id);
      return change?.type === 'remove' ? [] : [{ ...n, ...(change?.position ? { position: change.position, dragging: change.dragging } : {}),
        ...(change?.type === 'select' ? { selected: change.selected } : {}) }];
    }), applyEdgeChanges: (changes, edges) => edges.filter(e => !changes.some(c => c.type === 'remove' && c.id === e.id)),
    getNodesBounds: () => ({ x: 0, y: 0, width: 200, height: 200 }) },
    'html-to-image': { toPng: async element => { images.push(element); return 'data:image/png;base64,AA'; } },
    '../postgresql/windows/common/schemaStorage': { getPgSelectSchema: () => '', savePgSelectSchema() {} },
    './erMetadata': { selectErSchema: (_list, value) => value || 'test' },
    './useErDiagramWindow': { fetchErSchemas: async () => ['test', 'original'], fetchErDiagramData: async () => {
      if (pendingSync) return pendingSync;
      return { nodes: latest, edges: [] };
    } },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      calls.push(args); const [channel, payload] = args;
      if (channel === 'get-er-diagrams') return { success: true, files: ['diagram.json'] };
      if (channel === 'git-status-check') return { success: true, isRepo: false, remoteUrl: null };
      if (channel === 'load-er-diagram') return { success: true, data: JSON.stringify(loaded) };
      if (channel === 'execute-sql-bg') return { success: true, rows: [] };
      if (channel === 'save-er-diagram') { if (failSave) return { success: false, error: 'Disk unavailable' }; saved = JSON.parse(payload.sourceText); return { success: true, filePath: 'temporary' }; }
      if (channel === 'git-get-file-content-er') return { success: true, content: JSON.stringify(loaded) };
      return { success: true, history: [] };
    } } }
  }, {
    localStorage: { getItem: () => null, setItem() {} }, alert: message => alerts.push(message),
    window: { addEventListener() {}, removeEventListener() {}, confirm: message => { confirms.push(message); return confirm; } },
    document: { body: { style: {}, appendChild() {} }, createElement: tag => tag === 'a' ? { click() {} } : { innerHTML: '' }, getElementById: () => ({ remove() {} }),
      querySelectorAll: () => { throw new Error('Global viewport lookup is forbidden'); } }
  });
  let state;
  const render = () => state = hook.render(() => useCustomErDiagram({ dbType, initialSchema: 'test', isActive: true }));
  async function flush() { for (let i = 0; i < 5; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  await flush(); await state.handleOpenCustomEr('diagram.json'); await flush();
  state.reactFlowWrapper.current = { querySelector: selector => { assert.equal(selector, '.react-flow__viewport'); return ownViewport; } };
  return { get state() { return state; }, get saved() { return saved; }, setLoaded: value => loaded = value,
    setLatest: value => latest = value, setPending: value => pendingSync = value, setConfirm: value => confirm = value, setFailSave: value => failSave = value,
    flush, alerts, confirms, calls, images, ownViewport, unmount: hook.unmount };
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: schema survives load and save; unversioned and unknown versions are rejected without replacing the diagram`, async () => {
    const h = await fixture(db);
    try {
      assert.equal(h.state.customSchema, 'original');
      assert.ok(h.calls.filter(c => c[0] === 'execute-sql-bg').every(c => c[2].owner === 'original'));
      h.state.handleChangeCustomSchema({ target: { value: 'other' } }); await h.flush();
      assert.equal(h.state.customSchema, 'original');
      h.state.setErDiagramName('renamed'); await h.flush(); await h.state.handleCommit(); await h.flush();
      assert.equal(h.saved.version, 2); assert.equal(h.saved.schema, 'original'); assert.equal(h.state.isDirty, false);
      for (const invalid of [
        { nodes: [node('old')], edges: [] },
        { version: 2, nodes: [], edges: [] },
        { version: 2, schema: '   ', nodes: [], edges: [] },
        { version: 99, schema: 'wrong', nodes: [], edges: [] }
      ]) {
        const before = h.state.customNodes;
        const metadataCount = h.calls.filter(call => call[0] === 'execute-sql-bg').length;
        h.setLoaded(invalid); await h.state.handleOpenCustomEr('bad.json'); await h.flush();
        assert.equal(h.state.erDiagramName, 'renamed'); assert.equal(h.state.customSchema, 'original');
        assert.equal(h.state.customNodes, before); assert.equal(h.state.isDirty, false);
        assert.equal(h.calls.filter(call => call[0] === 'execute-sql-bg').length, metadataCount);
        assert.match(h.alerts.at(-1), /invalid_er_diagram_structure/);
      }
    } finally { h.unmount(); }
  });
  test(`${db}: undo and redo group dragging, preserve selection neutrality, reset branches and track successful saves`, async () => {
    const h = await fixture(db);
    try {
      assert.equal(h.state.isDirty, false); assert.equal(h.state.canUndo, false);
      h.state.onCustomNodesChange([{ id: 'A', type: 'select', selected: true }]); await h.flush();
      assert.equal(h.state.isDirty, false); assert.equal(h.state.canUndo, false);
      for (const x of [10, 20]) { h.state.onCustomNodesChange([{ id: 'A', type: 'position', position: { x, y: 0 }, dragging: true }]); await h.flush(); }
      assert.equal(h.state.canUndo, false);
      h.state.onCustomNodesChange([{ id: 'A', type: 'position', position: { x: 30, y: 0 }, dragging: false }]); await h.flush();
      assert.equal(h.state.isDirty, true); h.state.handleUndo(); await h.flush();
      assert.equal(h.state.customNodes[0].position.x, 0); assert.equal(h.state.isDirty, false); assert.equal(h.state.canRedo, true);
      h.state.handleRedo(); await h.flush(); assert.equal(h.state.customNodes[0].position.x, 30);
      h.setFailSave(true); await h.state.handleCommit(); await h.flush(); assert.equal(h.state.isDirty, true);
      h.setFailSave(false); await h.state.handleCommit(); await h.flush(); assert.equal(h.state.isDirty, false);
      h.state.handleUndo(); await h.flush(); assert.equal(h.state.isDirty, true);
      h.state.setErDiagramName('branch'); await h.flush(); assert.equal(h.state.canRedo, false);
      h.setConfirm(false); h.state.handleCloseCustomEr(); await h.flush(); assert.equal(h.state.customMode, 'design');
      await h.state.handleCommit(); await h.flush(); const count = h.confirms.length;
      h.state.handleCloseCustomEr(); await h.flush(); assert.equal(h.state.customMode, 'init'); assert.equal(h.confirms.length, count);
    } finally { h.unmount(); }
  });
  test(`${db}: synchronization requires review, supports cancellation and undo, and rejects stale previews`, async () => {
    const h = await fixture(db);
    try {
      await h.state.handleSyncWithDatabase(); await h.flush();
      assert.equal(h.state.customNodes[0].data.columns.length, 0); assert.ok(h.state.syncPreview);
      h.state.setSyncPreview(null); await h.flush(); assert.equal(h.state.customNodes[0].data.columns.length, 0);
      await h.state.handleSyncWithDatabase(); await h.flush(); h.state.handleApplySync(); await h.flush();
      assert.equal(h.state.customNodes[0].data.columns[0].name, 'added'); assert.equal(h.state.isDirty, true);
      h.state.handleUndo(); await h.flush(); assert.equal(h.state.customNodes[0].data.columns.length, 0);
      h.setLatest([]); await h.state.handleSyncWithDatabase(); await h.flush(); h.state.handleApplySync(); await h.flush();
      assert.equal(h.state.customNodes.length, 0); assert.equal(h.state.customEdges.length, 0);
      h.state.handleUndo(); await h.flush(); assert.equal(h.state.customNodes.length, 2); assert.equal(h.state.customEdges.length, 2);
      await h.state.handleSyncWithDatabase(); await h.flush(); h.state.setErDiagramName('edited-after-preview'); await h.flush();
      h.state.handleApplySync(); await h.flush(); assert.equal(h.state.customNodes.length, 2); assert.equal(h.alerts.at(-1), 'er_sync_stale');
      assert.ok(!h.calls.some(c => c[0] === 'execute-sql'));
    } finally { h.unmount(); }
  });
  test(`${db}: relation deletion is reversible and image export captures this canvas only`, async () => {
    const h = await fixture(db);
    try {
      h.state.onCustomEdgesChange([{ type: 'remove', id: 'one' }]); await h.flush();
      assert.deepEqual(json(h.state.customEdges.map(e => e.id)), ['two']);
      h.state.handleUndo(); await h.flush(); assert.equal(h.state.customEdges.length, 2);
      h.state.onCustomNodesChange([{ type: 'remove', id: 'A' }]); await h.flush(); assert.equal(h.state.customEdges.length, 0);
      h.state.handleUndo(); await h.flush(); assert.equal(h.state.customEdges.length, 2);
      await h.state.handleExportImage(); assert.equal(h.images.length, 1); assert.equal(h.images[0], h.ownViewport);
    } finally { h.unmount(); }
  });
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: parallel relations retain their own Git comparison status and restoring schema is undoable`, async () => {
    const h = await fixture(db);
    try {
      h.setLoaded({ version: 2, schema: 'past', nodes: [node('A'), node('B')], edges: [edge('one'), { ...edge('two'), markerEnd: 'one' }, edge('deleted')] });
      await h.state.handleOpenCompareMode(); await h.flush();
      await h.state.handleHistoryRowClick({ row: { id: 'old', fullId: 'old' } }); await h.flush();
      const past = h.state.annotatedPastEdges;
      assert.equal(past.find(e => e.id === 'one').style, undefined);
      assert.equal(past.find(e => e.id === 'two').style.stroke, '#ff9800');
      assert.equal(past.find(e => e.id === 'deleted').style.stroke, '#f44336');
      h.state.handleRestorePastVersion(); await h.flush();
      assert.equal(h.state.customSchema, 'past'); assert.equal(h.state.customEdges.length, 3);
      h.state.handleUndo(); await h.flush();
      assert.equal(h.state.customSchema, 'original'); assert.equal(h.state.customEdges.length, 2);
    } finally { h.unmount(); }
  });
  test(`${db}: an in-flight synchronization cannot replace a newer edit`, async () => {
    const h = await fixture(db);
    try {
      let resolve;
      h.setPending(new Promise(done => { resolve = done; }));
      const request = h.state.handleSyncWithDatabase();
      h.state.setErDiagramName('newer'); await h.flush();
      resolve({ nodes: [], edges: [] }); await request; await h.flush();
      assert.equal(h.state.syncPreview, null); assert.equal(h.state.customNodes.length, 2);
      assert.equal(h.alerts.at(-1), 'er_sync_stale');
    } finally { h.unmount(); }
  });
}
