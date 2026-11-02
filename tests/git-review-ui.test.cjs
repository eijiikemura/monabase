// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');

function all(node, predicate, found = []) {
  if (Array.isArray(node)) { node.forEach(item => all(item, predicate, found)); return found; }
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node); all(node.children, predicate, found); return found;
}
function fixture(name, invoke, props, extra = {}) {
  const h = createHookHarness(), alerts = [], notices = [], events = [];
  const React = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const Component = loadTypeScript(`src/features/git/${name}.tsx`, {
    '@/shared/utils/notifications': { notify: (message, options) => notices.push({ message, ...options }) },
    react: React, '@mui/material': new Proxy({ useMediaQuery: () => false }, { get: (target, key) => target[key] || key }),
    '@mui/material/styles': { useTheme: () => ({ palette: { mode: 'light' }, breakpoints: { down: () => 'media' } }) },
    'react-diff-viewer-continued': { __esModule: true, default: 'Diff' },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }, ...extra
  }, { React, alert: value => alerts.push(value), window: { dispatchEvent: value => events.push(value) }, CustomEvent: class { constructor(type) { this.type = type; } } }).default;
  let tree;
  const render = () => (tree = h.render(() => Component(props)));
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); h.commit(); await h.settle(); } return render(); };
  const find = predicate => all(tree, predicate)[0];
  return { props, flush, find, all: predicate => all(tree, predicate), alerts, notices, events,
    button: key => find(node => node.type === 'Button' && node.children.includes(key)), unmount: () => h.unmount() };
}
function workspace(invoke, definitions) {
  const objects = ['FUNCTION', 'PROCEDURE'].map((category, index) => ({ key: String(index), name: String(index), category }));
  return fixture('GitWorkspaceDialog', invoke, { dbType: 'postgresql', schema: 'test', onClose() {} }, {
    './gitDatabaseSources': {
      gitSourceCategories: () => ['FUNCTION', 'PROCEDURE'],
      listGitDatabaseObjects: async (_db, _schema, category) => objects.filter(object => object.category === category),
      readGitDatabaseSource: async object => ({ key: object.key, displayName: object.name, objectName: object.name, sourceText: definitions[+object.key], dbType: 'POSTGRESQL', objectType: object.category, schema: 'test' })
    }
  });
}
for (const stale of [false, true]) {
  test(`Schema review ${stale ? 'rejects changed DB definitions' : 'groups selected definitions'} before Git mutation`, async () => {
    const calls = [], definitions = ['source A', 'source B'];
    const h = workspace(async (channel, request) => {
      calls.push([channel, request]);
      if (channel === 'git-review-sources') return { success: true, head: 'head', rows: request.map(source => ({ ...source, path: source.key, headSource: 'old', localSource: 'old' })) };
      if (channel === 'git-commit-sources') return { success: true, committed: true };
      throw Error('Unexpected ' + channel);
    }, definitions);
    try {
      await h.flush(); await h.button('refresh').props.onClick(); await h.flush();
      assert.equal(h.find(node => node.type === 'Diff').props.newValue, 'source A');
      for (const checkbox of h.all(node => node.type === 'Checkbox')) checkbox.props.onChange({ target: { checked: true } });
      h.find(node => node.type === 'TextField' && node.props.label === 'commit_message').props.onChange({ target: { value: 'One feature' } });
      await h.flush(); if (stale) definitions[0] = 'Changed after review';
      await h.button('git_commit_selected').props.onClick(); await h.flush();
      const committed = calls.filter(([channel]) => channel === 'git-commit-sources');
      assert.equal(committed.length, stale ? 0 : 1);
      if (stale) assert.ok(h.find(node => node.type === 'Alert').children.includes('git_db_changed_refresh'));
      else { assert.equal(committed[0][1].rows.length, 2); assert.equal(committed[0][1].message, 'One feature');
        assert.deepEqual(h.alerts, []); assert.deepEqual(h.notices, [{ message: 'git_commit_executed', severity: 'success' }]); }
    } finally { h.unmount(); }
  });
}
test('Revision comparison ignores reversed old responses and never writes Git or DB data', async () => {
  const pending = [], writes = [];
  const h = fixture('GitRevisionCompareDialog', async (channel, request) => {
    if (channel === 'git-get-history') return { success: true, history: ['C', 'B', 'A'].map(fullId => ({ fullId, id: fullId, date: 'date', message: fullId })) };
    if (channel === 'git-get-file-content') return new Promise(resolve => pending.push({ id: request.commitId, resolve }));
    writes.push(channel); throw Error('Unexpected mutation');
  }, { object: { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'A' }, onClose() {} });
  try {
    await h.flush(); assert.equal(pending.length, 2);
    h.find(node => node.type === 'TextField' && node.props.label === 'git_compare_from').props.onChange({ target: { value: 'A' } });
    await h.flush(); assert.equal(pending.length, 4);
    pending[2].resolve({ success: true, content: 'new A' }); pending[3].resolve({ success: true, content: 'new C' }); await h.flush();
    pending[0].resolve({ success: true, content: 'stale B' }); pending[1].resolve({ success: true, content: 'stale C' }); await h.flush();
    const diff = h.find(node => node.type === 'Diff'); assert.equal(diff.props.oldValue, 'new A'); assert.equal(diff.props.newValue, 'new C');
    assert.deepEqual(writes, []);
  } finally { h.unmount(); }
});
test('Conflict controls keep edited content on failure and require all resolutions before completion', async () => {
  const calls = [], file = { path: 'a.sql', ours: 'ours', theirs: 'theirs', working: 'markers', token: 'file-token' };
  let fail = true, completed = false;
  const h = fixture('GitConflictDialog', async (channel, request) => {
    calls.push([channel, request]);
    if (channel === 'git-get-conflicts') return { success: true, files: [file], token: 'merge-1' };
    if (channel === 'git-resolve-conflict') return fail ? { success: false, error: 'Retry this file' } : { success: true, files: [], token: 'merge-2' };
    if (channel === 'git-complete-merge') return { success: true };
    throw Error('Unexpected ' + channel);
  }, { onClose() {}, onAbort: async () => {}, onComplete: () => { completed = true; } });
  try {
    await h.flush(); assert.equal(h.button('git_finish_merge').props.disabled, true);
    h.find(node => node.type === 'TextField' && node.props.label === 'git_merged_content').props.onChange({ target: { value: 'combined' } }); await h.flush();
    await h.button('git_mark_resolved').props.onClick(); await h.flush();
    assert.equal(h.find(node => node.type === 'TextField' && node.props.label === 'git_merged_content').props.value, 'combined');
    fail = false; await h.button('git_mark_resolved').props.onClick(); await h.flush();
    assert.equal(h.button('git_finish_merge').props.disabled, false); await h.button('git_finish_merge').props.onClick();
    assert.equal(completed, true); assert.equal(calls.at(-1)[1].token, 'merge-2');
  } finally { h.unmount(); }
});

test('DB review sources retain PostgreSQL overload signatures and exact trigger-table identity', async () => {
  const calls = [];
  let table = 'Order.Items';
  const module = loadTypeScript('src/features/git/gitDatabaseSources.ts', {
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, query, binds) => {
      calls.push([channel, query, binds]); return { success: true, rows: [{ signature: 'integer, text', ddl: 'function source' }] };
    } } },
    '@/features/objects/objectRepository': { loadObjectReference: async () => ({ definition: 'trigger source', details: { tableName: table, functionDefinition: 'trigger function' } }) },
    '@/features/postgresql/windows/common/ddlHelper': {}
  });
  const base = { dbType: 'postgresql', schema: 'Mi"x.ed', name: 'Same', displayName: 'Same', id: '123', key: 'key' };
  const routine = await module.readGitDatabaseSource({ ...base, category: 'FUNCTION' }, key => key);
  assert.equal(routine.signature, 'integer, text'); assert.equal(routine.sourceText, 'function source');
  assert.equal(calls[0][0], 'execute-sql-bg'); assert.equal(calls[0][2].schema, 'Mi"x.ed');
  const trigger = await module.readGitDatabaseSource({ ...base, category: 'TRIGGER', parentName: table }, key => key);
  assert.equal(trigger.tableName, table); assert.equal(trigger.sourceText, 'trigger function;\n\ntrigger source;');
  table = 'Renamed';
  await assert.rejects(module.readGitDatabaseSource({ ...base, category: 'TRIGGER', parentName: 'Order.Items' }, key => key), /git_source_unavailable/);
});

test('Cancelling a schema scan ignores late DB results and performs no Git operation', async () => {
  let release; const calls = [];
  const h = fixture('GitWorkspaceDialog', async channel => { calls.push(channel); throw Error('Unexpected Git read'); },
    { dbType: 'oracle', schema: 'TEST', onClose() {} }, {
      './gitDatabaseSources': { gitSourceCategories: () => ['FUNCTION'],
        listGitDatabaseObjects: () => new Promise(resolve => { release = resolve; }),
        readGitDatabaseSource: () => { throw Error('Cancelled definitions must not be fetched'); } }
    });
  try {
    await h.flush(); const pending = h.button('refresh').props.onClick(); await h.flush();
    h.button('cancel_2').props.onClick(); await h.flush();
    assert.equal(h.button('close').props.disabled, false);
    release([{ key: 'A' }]); await pending; await h.flush(); assert.deepEqual(calls, []);
  } finally { h.unmount(); }
});

test('Unresolved manual conflict drafts survive switching between files', async () => {
  const h = fixture('GitConflictDialog', async () => ({ success: true, token: 'merge', files: [
    { path: 'a.sql', ours: 'a', theirs: 'b', working: 'first' }, { path: 'b.sql', ours: 'c', theirs: 'd', working: 'second' }
  ] }), { onClose() {}, onAbort: async () => {}, onComplete() {} });
  try {
    await h.flush(); h.find(node => node.type === 'TextField' && node.props.label === 'git_merged_content').props.onChange({ target: { value: 'my draft' } }); await h.flush();
    h.all(node => node.type === 'ListItemButton')[1].props.onClick(); await h.flush();
    h.all(node => node.type === 'ListItemButton')[0].props.onClick(); await h.flush();
    assert.equal(h.find(node => node.type === 'TextField' && node.props.label === 'git_merged_content').props.value, 'my draft');
  } finally { h.unmount(); }
});

test('Revision comparison can choose different pages while retaining both selected revisions', async () => {
  const pages = [];
  const h = fixture('GitRevisionCompareDialog', async (channel, args) => {
    if (channel === 'git-get-history') {
      pages.push(args.page);
      return { success: true, hasMore: args.page === 0, history: (args.page ? ['A'] : ['C', 'B']).map(fullId => ({ fullId, id: fullId, date: 'date', message: fullId })) };
    }
    if (channel === 'git-get-file-content') return { success: true, content: 'source ' + args.commitId };
    throw new Error('Unexpected IPC: ' + channel);
  }, { object: { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'F' }, onClose() {} });
  try {
    await h.flush();
    const pager = () => h.find(node => typeof node.type === 'function' && node.type.name === 'GitHistoryPagination');
    pager().props.onChange(1); await h.flush();
    assert.equal(pager().props.page, 1); assert.equal(pager().props.hasMore, false);
    const from = () => h.find(node => node.type === 'TextField' && node.props.label === 'git_compare_from');
    from().props.onChange({ target: { value: 'A' } }); await h.flush();
    assert.equal(from().props.value, 'A');
    pager().props.onChange(0); await h.flush();
    // Returning to newer history must not silently replace the chosen older revision.
    assert.equal(from().props.value, 'A');
    assert.deepEqual(pages, [0, 1, 0]);
  } finally { h.unmount(); }
});

test('Revision comparison retains its loaded page after a failure and can retry that page', async () => {
  let fail = true;
  const h = fixture('GitRevisionCompareDialog', async (channel, args) => {
    if (channel === 'git-get-history') {
      if (args.page === 1 && fail) return { success: false, error: 'History read failed' };
      return { success: true, hasMore: args.page === 0, history: [{ id: 'r' + args.page, fullId: 'r' + args.page, date: 'date', message: 'page' + args.page }] };
    }
    if (channel === 'git-get-file-content') return { success: true, content: args.commitId };
    throw new Error('Unexpected IPC: ' + channel);
  }, { object: { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'F' }, onClose() {} });
  try {
    await h.flush();
    const pager = () => h.find(node => typeof node.type === 'function' && node.type.name === 'GitHistoryPagination');
    pager().props.onChange(1); await h.flush();
    assert.equal(pager().props.page, 0); assert.equal(pager().props.hasMore, true);
    assert.ok(h.find(node => node.type === 'MenuItem' && node.props.value === 'r0'));
    fail = false; pager().props.onChange(1); await h.flush();
    assert.equal(pager().props.page, 1); assert.equal(pager().props.hasMore, false);
  } finally { h.unmount(); }
});

test('Revision swap reverses the compared source identities and layout changes do not write Git or the database', async () => {
  const requests = [];
  const h = fixture('GitRevisionCompareDialog', async (channel, request) => {
    requests.push([channel, request]);
    if (channel === 'git-get-history') return { success: true, history: ['new', 'old'].map(fullId => ({ fullId, id: fullId, date: 'date', message: fullId })) };
    if (channel === 'git-get-file-content') return { success: true, content: request.commitId + ' source' };
    throw Error('Unexpected write');
  }, { object: { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'A' }, onClose() {} });
  try {
    await h.flush();
    assert.equal(h.find(node => node.type === 'Diff').props.oldValue, 'old source');
    const controls = h.find(node => node.type?.name === 'DiffLayoutControls');
    controls.props.onChange('unified'); await h.flush();
    assert.equal(h.find(node => node.type === 'Diff').props.splitView, false);
    await h.button('git_swap_revisions').props.onClick(); await h.flush();
    assert.equal(h.find(node => node.type === 'Diff').props.oldValue, 'new source');
    assert.equal(h.find(node => node.type === 'Diff').props.newValue, 'old source');
    assert.equal(h.find(node => node.type === 'Diff').props.splitView, false);
    assert.ok(requests.every(([channel]) => channel === 'git-get-history' || channel === 'git-get-file-content'));
  } finally { h.unmount(); }
});
