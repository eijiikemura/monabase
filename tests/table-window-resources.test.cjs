// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');

async function resources(db) {
  const hook = createHookHarness(), listeners = new Map(), calls = [];
  let stats = async () => ({ success: true, rows: [{ VALUE: 1 }] }), source = async () => 'CREATE TABLE old_source';
  const t = key => key;
  const { useTableWindow } = loadTypeScript(`src/features/${db}/windows/table/useTableWindow.ts`, {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '../common/ddlHelper': { getFullTableDDL: (...args) => { calls.push(['source']); return source(...args); } },
    '@/shared/api/desktop': { ipcRenderer: { invoke: (channel, sql) => { calls.push([channel, sql]); return stats(sql); } } }
  }, { window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) } });
  let state;
  const render = () => (state = hook.render(() => useTableWindow({ fullTableName: '"A"."Items"', tabId: 1, isActive: true, inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD' })));
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  await flush();
  return { get state() { return state; }, calls, flush, emit: (type, detail) => listeners.get(type)?.({ detail }),
    stats: fn => { stats = fn; }, source: fn => { source = fn; }, unmount: () => hook.unmount() };
}
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: zero-row statistics are successful and do not automatically repeat`, async () => {
    const h = await resources(db);
    try {
      h.stats(async () => ({ success: true, rows: [] })); h.state.setActiveTab(4); await h.flush();
      assert.equal(h.state.statisticsRows.length, 0); assert.equal(h.state.statisticsError, false);
      assert.equal(h.calls.length, 2); await h.flush(); assert.equal(h.calls.length, 2);
    } finally { h.unmount(); }
  });
  test(`${db}: statistics failure retains both previous result sets and explicit retry recovers`, async () => {
    const h = await resources(db);
    try {
      h.state.setActiveTab(4); await h.flush();
      const previous = h.state.statisticsRows, columns = h.state.columnStatisticsRows;
      h.stats(async sql => /ALL_TABLES|pg_stat_all_tables/.test(sql) ? { success: true, rows: [{ VALUE: 9 }] } : { success: false, error: 'Denied' });
      await h.state.loadStatistics(); await h.flush();
      assert.equal(h.state.statisticsError, true); assert.equal(h.state.statisticsRows, previous); assert.equal(h.state.columnStatisticsRows, columns);
      h.stats(async () => ({ success: true, rows: [{ VALUE: 2 }] })); await h.state.loadStatistics(); await h.flush();
      assert.equal(h.state.statisticsError, false); assert.equal(h.state.statisticsRows[0].value, 2);
      assert.ok(h.calls.every(([channel]) => channel === 'execute-sql-bg'));
    } finally { h.unmount(); }
  });
  test(`${db}: source failure retains the last DDL and old responses cannot replace a newer result`, async () => {
    const h = await resources(db);
    try {
      h.state.setActiveTab(5); await h.flush(); assert.equal(h.state.sourceText, 'CREATE TABLE old_source');
      h.source(async () => { throw new Error('Denied'); }); await h.state.loadSource(); await h.flush();
      assert.equal(h.state.sourceText, 'CREATE TABLE old_source'); assert.equal(h.state.sourceError, true);
      const pending = []; h.source(() => new Promise(resolve => pending.push(resolve)));
      const older = h.state.loadSource(), newer = h.state.loadSource();
      pending[1]('CREATE TABLE newer'); await newer; await h.flush();
      pending[0]('CREATE TABLE obsolete'); await older; await h.flush();
      assert.equal(h.state.sourceText, 'CREATE TABLE newer'); assert.equal(h.state.sourceError, false);
    } finally { h.unmount(); }
  });
  test(`${db}: table notifications invalidate only the exact schema and object`, async () => {
    const h = await resources(db);
    try {
      h.state.setActiveTab(5); await h.flush();
      h.emit('reload-source', { schema: 'B', tableName: 'Items' }); await h.flush(); assert.equal(h.calls.length, 1);
      h.emit('reload-source', { schema: 'A', tableName: 'Items' }); await h.flush(); assert.equal(h.calls.length, 2);
      h.state.setActiveTab(4); await h.flush(); const count = h.calls.length;
      h.emit('reload-statistics', { schema: 'B', tableName: 'Items' }); await h.flush(); assert.equal(h.calls.length, count);
      h.emit('reload-statistics', { schema: 'A', tableName: 'Items' }); await h.flush(); assert.equal(h.calls.length, count + 2);
    } finally { h.unmount(); }
  });
}
