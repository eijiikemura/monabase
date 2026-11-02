// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');

test('AI request button forwards the action/ref, accessible title and disabled state', () => {
  let clicks = 0; const ref = {};
  const f = render('src/features/ai/AiRequestButton.tsx', { ref, title: 'Review SQL', disabled: true, onClick: () => { clicks++; }, sx: { height: 24 } });
  assert.equal(f.tree.props.ref, ref); assert.equal(f.tree.props['aria-label'], 'Review SQL'); assert.equal(f.tree.props.disabled, true);
  f.props.disabled = false; f.props['aria-label'] = 'Explicit description'; f.render(); f.tree.props.onClick(); assert.equal(clicks, 1); assert.equal(f.tree.props['aria-label'], 'Explicit description');
  delete f.props.title; delete f.props['aria-label']; f.render(); assert.equal(f.tree.props['aria-label'], 'ask_ai'); f.unmount();
});

test('AI menu separates settings from usage history and closes each popup explicitly', () => {
  let settings = 0;
  const f = render('src/features/ai/AiMenu.tsx', { outputDateFormat: 'YYYY-MM-DD', onOpenSettings: () => { settings++; } }, { dependencies: { './AiUsageHistoryDialog': 'UsageHistory' } });
  f.button('AI').props.onClick({ currentTarget: {} }); f.render(); assert.equal(f.node('Menu').props.open, true);
  f.node('MenuItem', node => node.children.includes('ai_settings')).props.onClick(); f.render(); assert.equal(settings, 1); assert.equal(f.node('Menu').props.open, false); assert.equal(f.node('UsageHistory').props.open, false);
  f.node('MenuItem', node => node.children.includes('ai_usage_history')).props.onClick(); f.render(); assert.equal(f.node('UsageHistory').props.open, true); assert.equal(f.node('UsageHistory').props.outputDateFormat, 'YYYY-MM-DD');
  f.node('UsageHistory').props.onClose(); f.render(); assert.equal(f.node('UsageHistory').props.open, false); f.unmount();
});

for (const themeMode of ['light', 'dark']) test(`AI settings ${themeMode} protects locked credentials, retries reads and only saves explicitly`, async () => {
  const actions = [], aiLogic = { t: key => key, aiSettingsDialogOpen: true, providerPopupOpen: false, isAiEnabled: true, apiKey: '', modelName: 'local', endpointUrl: '', credentialUnavailable: true, isProcessing: true, isLoading: false, loadError: 'Read failed', canEditSettings: false,
    setAiSettingsDialogOpen: value => actions.push(['dialog', value]), setProviderPopupOpen: value => actions.push(['provider', value]), setIsAiEnabled: value => actions.push(['enabled', value]), setApiKey: value => actions.push(['key', value]), setModelName: value => actions.push(['model', value]), setEndpointUrl: value => actions.push(['endpoint', value]), retryLoadSettings: () => actions.push(['retry']), handleSave: () => actions.push(['save']) };
  const f = render('src/features/ai/AiSettingsDialog.tsx', { aiLogic }, { themeMode });
  f.node('Dialog').props.onClose(); assert.deepEqual(actions, []); assert.equal(f.button('save_2').props.disabled, true);
  assert.equal(f.node('TextField', node => node.props.label === 'api_key').props.type, 'password');
  assert.ok(f.text().includes('credentials_could_not_be_unlocked'));
  aiLogic.isProcessing = false; aiLogic.canEditSettings = true; f.render(); await f.click('retry_ai_settings_load');
  f.node('TextField', node => node.props.label === 'model_name_2').props.onChange({ target: { value: 'demo' } });
  await f.click('select'); assert.deepEqual(actions.slice(-2), [['endpoint', 'https://api.openai.com/v1'], ['provider', false]]);
  assert.ok(!actions.some(action => action[0] === 'save')); await f.click('save_2'); assert.deepEqual(actions.at(-1), ['save']);
  aiLogic.isAiEnabled = false; f.render(); assert.ok(f.nodes().filter(node => node.type === 'TextField').every(node => node.props.disabled)); f.unmount();
});

for (const database of ['oracle', 'postgresql']) test(`${database} column editor changes input state without submitting and respects database-specific type options`, async () => {
  const actions = [], state = { newColName: '', newType: database === 'oracle' ? 'NUMBER' : 'NUMERIC', newLength: '50', newScale: '2', newNullable: 'Y', newDefaultMode: 'manual', newDefault: '42', newComment: '', isPk: false, oldType: 'NUMBER' };
  const f = render(`src/features/${database}/windows/common/ColumnDefDialog.tsx`, {
    isOpen: true, mode: 'add', schema: 'test', sequences: ['seq'], userTypes: ['PRICE_TYPE'], dialogState: state,
    setDialogState: value => { f.props.dialogState = typeof value === 'function' ? value(f.props.dialogState) : value; },
    onSubmit: () => actions.push('submit'), onClose: () => actions.push('close'), showPkCheckbox: true
  });
  const change = (type, label, value) => { f.node(type, node => node.props.label === label).props.onChange({ target: { value } }); f.render(); };
  change('TextField', 'column_name', 'MixedName'); assert.equal(f.props.dialogState.newColName, database === 'oracle' ? 'MIXEDNAME' : 'mixedname');
  f.node('Checkbox').props.onChange({ target: { checked: true } }); f.render(); assert.equal(f.props.dialogState.isPk, true);
  if (database === 'oracle') {
    change('Select', 'data_type', 'NUMBER'); assert.equal(f.props.dialogState.newLength, '');
    change('Select', 'data_type', 'VARCHAR2'); assert.equal(f.props.dialogState.newScale, '');
    f.props.mode = 'modify'; f.props.dialogState.oldType = 'CLOB'; f.render(); assert.equal(f.node('Select', node => node.props.label === 'data_type').props.disabled, true);
    f.tree.props.onClose({}, 'backdropClick'); f.tree.props.onClose({}, 'escapeKeyDown'); assert.deepEqual(actions, []);
  } else {
    change('Select', 'data_type', 'TEXT'); assert.equal(f.props.dialogState.newLength, ''); assert.equal(f.props.dialogState.newDefault, '');
    change('Select', 'data_type', 'NUMERIC'); assert.equal(f.props.dialogState.newLength, '10'); assert.equal(f.props.dialogState.newScale, '0');
    change('Select', 'data_type', 'TIMESTAMP'); change('Select', 'default_value', 'now'); assert.equal(f.props.dialogState.newDefault, 'CURRENT_TIMESTAMP');
    change('Select', 'data_type', 'PRICE_TYPE'); assert.equal(f.node('TextField', node => ['length', 'length_required'].includes(node.props.label)), undefined);
  }
  assert.deepEqual(actions, []); await f.click(database === 'oracle' ? 'execute_changes' : 'add'); await f.click('cancel'); assert.deepEqual(actions, ['submit', 'close']); f.unmount();
});

test('Index column ordering disables impossible selections and routes enabled button/keyboard moves', async () => {
  const moves = [], f = render('src/features/index/IndexColumnOrder.tsx', { columns: ['a', 'b', 'c'], selected: [], disabled: false, onMove: direction => moves.push(direction) }, { name: 'IndexColumnOrder' });
  assert.equal(f.button('index_column_up').props.disabled, true); assert.equal(f.button('index_column_down').props.disabled, true);
  f.props.selected = ['a']; f.render(); assert.equal(f.button('index_column_up').props.disabled, true); await f.click('index_column_down');
  f.props.selected = ['b']; f.render(); let prevented = false;
  f.tree.props.onKeyDown({ altKey: true, key: 'ArrowUp', preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  f.props.disabled = true; f.render(); f.tree.props.onKeyDown({ altKey: true, key: 'ArrowDown', preventDefault() { throw new Error('Disabled shortcut'); } });
  assert.deepEqual(moves, [1, -1]); f.unmount();
});
