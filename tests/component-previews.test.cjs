// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');

test('Generation preview distinguishes default, NULL, empty text and exact decimals before explicit execution', async () => {
  const actions = [];
  const f = render('src/features/data-generator/GenerationPreviewDialog.tsx', {
    open: true, rows: [], columns: ['amount', 'nullable', 'empty', 'default'], disabled: false,
    onClose: () => actions.push('close'), onRefresh: () => actions.push('refresh'), onExecute: () => actions.push('execute')
  }, { name: 'GenerationPreviewDialog' });
  assert.equal(f.button('execute').props.disabled, true);
  f.props.rows = [{ amount: '9007199254740993.0000000001', nullable: null, empty: '' }]; f.render();
  const cells = f.nodes().filter(node => node.type === 'TableCell').slice(4);
  assert.equal(cells[0].children[0], '9007199254740993.0000000001');
  assert.equal(cells[1].children[0].type, 'strong'); assert.equal(cells[2].children[0], '');
  assert.equal(cells[3].children[0], 'generation_db_default'); assert.deepEqual(actions, []);
  await f.click('generation_refresh_preview'); await f.click('execute');
  f.props.disabled = true; f.render(); assert.equal(f.button('execute').props.disabled, true);
  assert.equal(f.button('generation_refresh_preview').props.disabled, true);
  await f.click('close'); assert.deepEqual(actions, ['refresh', 'execute', 'close']); f.unmount();
});

test('Generation progress handles zero totals, stop acknowledgement and partial failure without claiming success', async () => {
  let stops = 0;
  const f = render('src/features/data-generator/GenerationStatus.tsx', {
    progress: { running: true, stopping: false, confirmed: 0, total: 0 }, result: null, onStop: () => { stops++; }
  }, { name: 'GenerationStatus' });
  assert.equal(f.node('LinearProgress').props.value, 0); await f.click('generation_stop'); assert.equal(stops, 1);
  Object.assign(f.props.progress, { stopping: true, confirmed: 25, total: 100 }); f.render();
  assert.equal(f.node('LinearProgress').props.value, 25); assert.equal(f.button('generation_waiting_stop').props.disabled, true);
  f.props.progress.running = false; f.props.result = { status: 'failed', confirmed: 25, total: 100, error: 'Connection lost' }; f.render();
  assert.equal(f.node('LinearProgress'), undefined); assert.equal(f.node('Alert').props.severity, 'warning'); assert.ok(f.text().includes('Connection lost'));
  f.props.result.status = 'success'; f.render(); assert.equal(f.node('Alert').props.severity, 'success'); f.unmount();
});

test('Type change preview blocks closing/execution while busy and requires a new preview after partial failure', async () => {
  const actions = [], plan = { statements: ['FIRST', 'SECOND', 'THIRD'], completed: 1, failed: false };
  const f = render('src/features/type/TypeChangeDialog.tsx', { plan, busy: true, ready: true,
    onClose: () => actions.push('close'), onConfirm: () => actions.push('confirm'), onRetry: () => actions.push('retry')
  }, { name: 'TypeChangeDialog' });
  f.tree.props.onClose(); assert.deepEqual(actions, []); assert.equal(f.tree.props.disableEscapeKeyDown, true);
  assert.equal(f.button('execute').props.disabled, true);
  f.props.busy = false; f.props.ready = false; f.render(); assert.equal(f.button('execute').props.disabled, true);
  f.props.ready = true; f.render(); await f.click('execute');
  plan.failed = true; plan.error = 'Second statement failed'; f.render();
  assert.equal(f.button('execute'), undefined); assert.ok(f.text().includes('type_change_applied')); assert.ok(f.text().includes('type_change_failed')); assert.ok(f.text().includes('type_change_pending'));
  await f.click('type_retry_preview'); await f.click('close'); assert.deepEqual(actions, ['confirm', 'retry', 'close']);
  f.props.plan = null; f.render(); assert.equal(f.tree.props.open, false); f.unmount();
});

test('Query builder review displays both proposals as text and applies only on explicit confirmation', async () => {
  const actions = [], ai = { review: null, isReviewing: false, discardReview: () => actions.push('discard'), applyReview: () => actions.push('apply') };
  const f = render('src/features/query-builder/QueryBuilderReviewDialog.tsx', { ai }); assert.equal(f.tree, null);
  ai.review = { beforeSql: 'SELECT old', afterSql: '<script>literal SQL</script>', beforeSettings: 'old', afterSettings: 'new' }; ai.isReviewing = true; f.render();
  assert.ok(f.text().includes(ai.review.afterSql)); assert.equal(f.button('qb_apply_proposal').props.disabled, true); assert.deepEqual(actions, []);
  ai.isReviewing = false; f.render(); await f.click('qb_apply_proposal'); await f.click('discard'); assert.deepEqual(actions, ['apply', 'discard']); f.unmount();
});

test('Sequence conflict shows baseline, current and desired values while guarding busy actions', async () => {
  const actions = [], f = render('src/features/sequence/SequenceSettingsStatus.tsx', {
    error: 'Read failed', ready: true, busy: true, restartSupport: 'unknown',
    conflict: { fields: ['increment'], baseline: { increment: '1' }, latest: { increment: '2' }, desired: { increment: '3' } },
    onRetry: () => actions.push('retry'), onDiscard: () => actions.push('discard'), onKeep: () => actions.push('keep')
  }, { name: 'SequenceSettingsStatus' });
  assert.ok(f.nodes().filter(node => node.type === 'Button').every(node => node.props.disabled));
  assert.ok(f.text().includes('sequence_restart_version_unknown')); assert.ok(f.text().includes('1')); assert.ok(f.text().includes('2')); assert.ok(f.text().includes('3'));
  f.props.busy = false; f.props.restartSupport = 'unsupported'; f.render();
  await f.click('retry'); await f.click('sequence_discard_edits'); await f.click('sequence_keep_local_changes');
  assert.deepEqual(actions, ['retry', 'discard', 'keep']); assert.ok(f.text().includes('sequence_restart_old_version')); f.unmount();
});

test('Trigger overview preserves read-only warnings, shared function scope and explicit retry', async () => {
  let retries = 0;
  const f = render('src/features/trigger/TriggerOverview.tsx', { data: null, error: 'Unavailable', busy: true, onRetry: () => { retries++; } }, { name: 'TriggerOverview' });
  assert.equal(f.button('retry').props.disabled, true);
  f.props.busy = false; f.props.data = { status: 'ENABLED', timing: 'BEFORE', events: 'UPDATE', level: 'ROW', when: null, updateColumns: ['amount'], functionName: 'test.shared', functionUsers: 2, header: 'CREATE TRIGGER', readOnly: true }; f.render();
  assert.ok(f.text().includes('trigger_read_only_definition')); assert.ok(f.text().includes('test.shared'));
  assert.equal(f.translations.find(item => item.key === 'trigger_function_users').values.count, 2);
  await f.click('retry'); assert.equal(retries, 1); f.unmount();
});

test('View metadata retains readable previous results on refresh failure and disables overlapping reads', async () => {
  let reads = 0;
  const f = render('src/features/view/ViewMetadataTab.tsx', { data: { status: 'VALID', columns: [{ name: 'Mixed Case', type: 'numeric', nullable: 'YES' }], references: [{ schema: 'test', name: 'source', type: 'TABLE' }], dependents: [{ schema: 'test', name: 'consumer', type: 'VIEW' }] }, error: 'Refresh failed', loading: true, onRefresh: () => { reads++; } }, { name: 'ViewMetadataTab' });
  assert.ok(f.text().includes('Mixed Case')); assert.ok(f.text().includes('source')); assert.ok(f.text().includes('consumer'));
  assert.equal(f.button('retry').props.disabled, true); assert.equal(f.button('refresh').props.disabled, true);
  f.props.loading = false; f.render(); await f.click('retry'); assert.equal(reads, 1); f.unmount();
});
