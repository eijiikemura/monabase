// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { mysqlGenerator } = require('./helpers/mysqlGenerator.cjs');
const model = loadTypeScript('src/features/mysql/generator/generatorModel.ts', { './generatorValidation': loadTypeScript('src/features/data-generator/generatorValidation.ts') });
const column = (name, type, extra = {}) => ({ COLUMN_NAME: name, DATA_TYPE: type, COLUMN_TYPE: type, CHARACTER_MAXIMUM_LENGTH: 40, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0, DATETIME_PRECISION: 0, IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, EXTRA: '', GENERATION_EXPRESSION: '', ...extra });
const columns = [column('id', 'bigint', { COLUMN_TYPE: 'bigint unsigned', EXTRA: 'auto_increment' }), column('label', 'varchar'), column('amount', 'decimal', { NUMERIC_PRECISION: 40, NUMERIC_SCALE: 18 }), column('computed', 'int', { GENERATION_EXPRESSION: '1 + 1' })];
function fixture(options = {}, execute) {
  return mysqlGenerator(async (channel, sql, binds) => {
    if (channel === 'show-save-dialog') return { canceled: false, filePath: '/tmp/generator-test.txt' };
    if (channel === 'save-file') return { success: true };
    if (channel === 'execute-sql' && execute) return execute(sql, binds);
    if (channel === 'execute-sql') return { success: true, rowsAffected: 3, hasUncommittedTx: true, transactionStatus: 'active' };
    if (/SHOW CREATE/.test(sql)) return { success: true, rows: [{ 'Create Table': 'CREATE TABLE demo (id BIGINT, label VARCHAR(40), amount DECIMAL(40,18)) ENGINE=InnoDB' }] };
    if (/information_schema.TABLES/.test(sql)) return { success: true, rows: [{ TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB' }] };
    if (/information_schema.COLUMNS/.test(sql)) return { success: true, rows: columns };
    return { success: true, rows: [] };
  }, options);
}
test('MySQL generation preserves exact numbers, character length, literal binds and generated omissions', () => {
  const rules = model.columnRules(columns, new Set());
  assert.equal(rules[0].generationExclusion, 'auto_increment'); assert.equal(rules[3].generationExclusion, 'generated'); assert.equal(rules[0].ruleType, 'DISABLED'); assert.equal(rules[3].ruleType, 'DISABLED');
  rules[1].ruleType = 'FIXED'; rules[1].fixedValue = "日本語'); DROP TABLE demo; --";
  rules[2].ruleType = 'FIXED'; rules[2].fixedValue = '12345678901234567890.123456789012345678';
  const insert = model.generatorInsert('mb_test', 'demo', [{ label: rules[1].fixedValue, amount: rules[2].fixedValue }], rules, 'YYYY-MM-DD');
  assert.ok(!insert.sql.includes('DROP')); assert.ok(!insert.sql.includes('`id`')); assert.equal(insert.binds.g_0_1, rules[2].fixedValue);
  const unsigned = { ...rules[0], ruleType: 'FIXED' };
  assert.equal(model.mysqlGeneratedValue(unsigned, '18446744073709551615', ''), '18446744073709551615');
  for (const value of ['18446744073709551616', '-1', '0.5']) assert.throws(() => model.mysqlGeneratedValue(unsigned, value, ''));
  assert.throws(() => model.mysqlGeneratedValue(rules[2], '1.1234567890123456789', ''));
  const time = model.columnRules([column('clock', 'time')], new Set())[0];
  model.validateMysqlRule(time, 3, 'YYYY-MM-DD'); assert.equal(model.mysqlGeneratedValue(time, '23:59:59', ''), '23:59:59');
});
test('MySQL controller previews without SQL, confirms generated rows and leaves transaction decisions to the user', async () => {
  const f = await fixture();
  try {
    f.state.setSelectedTable('demo'); await f.flush(); assert.equal(f.state.columnRules.length, 4, f.state.error);
    f.state.setGenerateCount(3); f.state.handleRuleChange(1, 'ruleType', 'FIXED'); f.state.handleRuleChange(1, 'fixedValue', 'Demo');
    f.state.handleRuleChange(2, 'ruleType', 'FIXED'); f.state.handleRuleChange(2, 'fixedValue', '1.25'); await f.flush();
    f.state.handlePreview(); await f.flush(); assert.equal(f.state.previewRows.length, 3);
    assert.equal(f.requests.filter(r => r[0] === 'execute-sql').length, 0);
    await f.state.handleGenerate(); await f.flush(); assert.equal(f.state.result.status, 'success'); assert.equal(f.state.result.confirmed, 3);
    assert.equal(f.states.at(-1).hasUncommittedTx, true); assert.ok(!f.requests.some(r => /commit|rollback/.test(r[0])));
    f.props.readonly = true; await f.flush(); await f.state.handleGenerate(); assert.equal(f.requests.filter(r => r[0] === 'execute-sql').length, 1);
  } finally { f.unmount(); }
});
test('MySQL AI requests carry native DDL, apply rules only and reject stale responses; offline export and JSON import remain available', async () => {
  const f = await fixture();
  try {
    f.state.setSelectedTable('demo'); await f.flush(); await f.state.handleExportForAI(); await f.flush();
    assert.equal(f.contexts.length, 1); const context = f.contexts[0]; assert.equal(context.requestType, 'data_generator'); assert.match(context.initialPrompt, /InnoDB/);
    const payload = { schema: 'mb_test', table: 'demo', generateCount: 3, rules: f.state.columnRules.map(r => ({ ...r, ...(r.COLUMN_NAME === 'label' ? { ruleType: 'FIXED', fixedValue: 'AI demo' } : {}) })) };
    assert.throws(() => context.onResponse(JSON.stringify({ ...payload, table: 'wrong_target' })));
    assert.throws(() => context.onResponse(JSON.stringify({ ...payload, rules: [{ COLUMN_NAME: 'amount', ruleType: 'FIXED', fixedValue: 'not a number' }] })));
    assert.equal(f.state.columnRules[1].fixedValue, '');
    context.onResponse(JSON.stringify(payload)); await f.flush(); assert.equal(f.state.columnRules[1].fixedValue, 'AI demo');
    assert.ok(!f.requests.some(r => r[0] === 'execute-sql'));
    assert.throws(() => context.onResponse(JSON.stringify(payload)), /changed|selection|outdated/i);
    f.props.aiEnabled = false; await f.flush(); await f.state.handleExportForAI(); assert.ok(f.requests.some(r => r[0] === 'save-file' && /MySQL/.test(r[2])));
    await f.flush(); f.state.handleImportSettings(); f.inputs.at(-1).onchange(); f.readers.at(-1).result = JSON.stringify(payload); f.readers.at(-1).onload(); await f.flush(); assert.equal(f.state.generateCount, 3);
  } finally { f.unmount(); }
});
test('Shared Oracle/MySQL generator panel keeps table-only picker, AI, previews and read-only execution guards', () => {
  const { componentHarness } = require('./helpers/componentHarness.cjs');
  const controller = { isLoading: false, schemas: ['mb_test'], selectedSchema: 'mb_test', selectedTable: 'demo', columnRules: model.columnRules(columns, new Set()), generateCount: 3,
    issues: { invalid: false, columns: {} }, progress: { running: false }, previewRows: [], previewColumns: [], result: null,
    setSelectedSchema() {}, setSelectedTable() {}, setGenerateCount() {}, handleRuleChange() {}, handleExportSettings() {}, handleExportForAI() {}, handleImportSettings() {}, handleGenerate() {}, handlePreview() {}, setPreviewOpen() {}, handleStop() {} };
  const f = componentHarness('src/features/data-generator/DataGeneratorPanel.tsx', { controller, dbType: 'mysql', isActive: true, isAiEnabled: true, readonly: true }, { dependencies: {
    '@/features/data-generator/GenerationPreviewDialog': { GenerationPreviewDialog: 'Preview' }, '@/features/data-generator/GenerationStatus': { GenerationStatus: 'Status' },
    '@/components/feedback/WindowLoadingIndicator': { WindowLoadingIndicator: 'Loading' }, '@/features/objects/ObjectPickerDialog': 'Picker', '@/features/ai/AiRequestButton': 'AiRequest'
  } });
  const row = f.nodes().find(node => typeof node.type === 'function' && node.type.name === 'ColumnRuleRow');
  const markup = JSON.stringify(row.type(row.props));
  assert.ok(markup.includes('generation_database_managed')); assert.ok(markup.includes('generation_auto_increment_help'));
  assert.ok(!markup.includes('this_column_type_is_not_supported_for_auto_generation'));
  assert.equal(f.node('Picker').props.dbType, 'mysql'); assert.equal(f.node('Picker').props.initialCategory, 'TABLE');
  assert.deepEqual(Array.from(f.node('Picker').props.categories), ['TABLE']); assert.equal(f.node('AiRequest').props.disabled, false);
  assert.equal(f.button('execute').props.disabled, true); assert.equal(f.node('Preview').props.disabled, true);
  f.props.isActive = false; f.render(); assert.equal(f.tree, null); f.unmount();
});

test('MySQL batch stop and later failures retain confirmed rows without implicit transaction completion', async () => {
  for (const stop of [true, false]) {
    let calls = 0, f;
    f = await fixture({}, async (_sql, binds) => {
      calls++;
      if (calls === 1) { if (stop) f.state.handleStop(); return { success: true, rowsAffected: Object.keys(binds).length / 2, hasUncommittedTx: true, transactionStatus: 'active' }; }
      return { success: false, error: 'Fixture constraint failure', hasUncommittedTx: true, transactionStatus: 'active' };
    });
    try {
      f.state.setSelectedTable('demo'); await f.flush();
      f.state.setGenerateCount(501); f.state.handleRuleChange(1, 'ruleType', 'FIXED'); f.state.handleRuleChange(1, 'fixedValue', 'Demo');
      f.state.handleRuleChange(2, 'ruleType', 'FIXED'); f.state.handleRuleChange(2, 'fixedValue', '1'); await f.flush();
      await f.state.handleGenerate(); await f.flush();
      assert.equal(f.state.result.status, stop ? 'stopped' : 'error'); assert.equal(f.state.result.confirmed, 500); assert.equal(calls, stop ? 1 : 2);
      assert.equal(f.states.at(-1).hasUncommittedTx, true); assert.ok(!f.requests.some(r => /commit|rollback/.test(r[0])));
    } finally { f.unmount(); }
  }
});
