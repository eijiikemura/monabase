// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const connections = ['Saved A', 'Saved B', 'Saved C'].map(name => ({
  name, dbType: 'oracle', host: 'localhost', port: '1521', database: 'demo', user: 'demo', password: ''
}));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture(respond, options = {}) {
  const hook = createHookHarness(), alerts = [], calls = [], logins = [], t = key => key;
  const react = { ...hook.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const dependencies = {
    react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@mui/material': new Proxy({}, { get: (_target, name) => name === 'useTheme' ? () => ({ palette: { background: { default: '#fff' } } }) : name }),
    './MonaBaseLogo': 'Logo', '../shared/api/desktop': { ipcRenderer: { invoke: async (channel, ...args) => {
      calls.push({ channel, args }); return respond(channel, ...args);
    } } }
  };
  for (const icon of ['Delete', 'Add', 'ArrowUpward', 'ArrowDownward', 'Login', 'FolderOpen', 'ContentCopy']) {
    dependencies['@mui/icons-material/' + icon] = icon;
  }
  const LoginScreen = loadTypeScript('src/components/LoginScreen.tsx', dependencies, {
    alert: message => alerts.push(message), window: { confirm: options.confirm || (() => true) }
  }).default;
  let tree;
  function walk(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(walk);
    return [value, ...walk(value.children), ...walk(value.props?.secondaryAction), ...walk(value.props?.control)];
  }
  const nodes = () => walk(tree);
  const render = () => { tree = hook.render(() => LoginScreen({ onLoginSuccess: (...args) => logins.push(args) })); hook.commit(); };
  const settle = async () => { await hook.settle(); render(); };
  render();
  return { hook, render, settle, alerts, calls, logins, nodes,
    field: label => nodes().find(node => node.type === 'TextField' && node.props.label === label),
    order: () => nodes().filter(node => node.type === 'ListItem').map(node => node.props.key),
    move: (icon, index) => nodes().filter(node => node.type === 'IconButton' && node.children.some(child => child?.type === icon))[index],
    button: label => nodes().find(node => node.type === 'Button' && node.children.includes(label))
  };
}
const click = button => button.props.onClick({ stopPropagation() {} });

test('Initial connection load selects the first record when the form is untouched', async () => {
  const h = fixture(() => connections); await h.settle();
  assert.equal(h.field('connection_name_save_as').props.value, 'Saved A');
  assert.deepEqual(h.order(), connections.map(connection => connection.name));
});

for (const action of ['edit', 'new', 'save preference']) {
  test(`Delayed initial connection load preserves the ${action} draft`, async () => {
    const read = deferred(), h = fixture(() => read.promise);
    if (action === 'edit') h.field('connection_name_save_as').props.onChange({ target: { value: 'Unsaved draft' } });
    if (action === 'new') click(h.button('new'));
    if (action === 'save preference') h.nodes().find(node => node.type === 'Checkbox' && node.props.checked === true).props.onChange({ target: { checked: false } });
    h.render();
    const draft = h.field('connection_name_save_as').props.value;
    read.resolve(connections); await h.settle();
    assert.equal(h.field('connection_name_save_as').props.value, draft);
    assert.deepEqual(h.order(), connections.map(connection => connection.name));
    const save = h.nodes().filter(node => node.type === 'Checkbox').at(-1);
    assert.equal(save.props.checked, action !== 'save preference');
  });
}

test('Unmounted connection loads do not notify or select records', async () => {
  const read = deferred(), h = fixture(() => read.promise);
  h.hook.unmount(); read.reject(new Error('Simulated late load failure')); await h.settle();
  assert.deepEqual(h.alerts, []);
});

for (const outcome of ['failure response', 'rejection', 'success']) {
  test(`Connection reorder handles ${outcome} without overlapping writes`, async () => {
    const write = deferred();
    const h = fixture(channel => channel === 'get-connections' ? connections : write.promise);
    await h.settle();
    const move = h.move('ArrowDownward', 0);
    click(move); click(move); h.render();
    assert.equal(h.calls.filter(call => call.channel === 'save-connections-order').length, 1);
    assert.deepEqual(h.order(), ['Saved A', 'Saved B', 'Saved C']);
    assert.equal(h.button('connect').props.disabled, true);
    assert.equal(h.move('Delete', 0).props.disabled, true);
    assert.equal(h.move('ArrowUpward', 1).props.disabled, true);
    click(h.button('connect')); click(h.move('Delete', 0));
    assert.equal(h.calls.some(call => ['connect-db', 'save-connection', 'delete-connection'].includes(call.channel)), false);
    if (outcome === 'rejection') write.reject(new Error('Simulated write rejection'));
    else write.resolve(outcome === 'success' ? { success: true } : { success: false, error: 'Simulated write failure' });
    await h.settle();
    assert.deepEqual(h.order(), outcome === 'success' ? ['Saved B', 'Saved A', 'Saved C'] : ['Saved A', 'Saved B', 'Saved C']);
    assert.deepEqual(h.alerts, outcome === 'success' ? [] : [outcome === 'rejection' ? 'failed_to_save_connection' : 'Simulated write failure']);
    assert.equal(h.button('connect').props.disabled, false);
    assert.equal(h.move('Delete', 0).props.disabled, false);
  });
}

test('A failed reorder can be retried and a subsequent move uses the confirmed order', async () => {
  let writes = 0;
  const h = fixture(channel => channel === 'get-connections' ? connections : { success: ++writes !== 1 });
  await h.settle();
  click(h.move('ArrowDownward', 0)); await h.settle();
  assert.deepEqual(h.alerts, ['failed_to_save_connection']);
  click(h.move('ArrowDownward', 0)); await h.settle();
  assert.deepEqual(h.order(), ['Saved B', 'Saved A', 'Saved C']);
  click(h.move('ArrowUpward', 2)); await h.settle();
  assert.deepEqual(h.order(), ['Saved B', 'Saved C', 'Saved A']);
  assert.equal(writes, 3);
});

for (const action of ['untouched', 'edit deleted record', 'select and edit another record', 'new draft', 'duplicate']) {
  test(`Connection deletion preserves the latest ${action} state`, async () => {
    const deletion = deferred();
    const h = fixture(channel => channel === 'get-connections' ? connections : deletion.promise);
    await h.settle();
    const remove = h.move('Delete', 0);
    click(remove); click(remove); h.render();
    assert.equal(h.calls.filter(call => call.channel === 'delete-connection').length, 1);
    assert.equal(h.move('ArrowDownward', 0).props.disabled, true);
    assert.equal(h.move('Delete', 1).props.disabled, true);
    assert.equal(h.button('connect').props.disabled, true);
    click(h.move('ArrowDownward', 0)); click(h.button('connect'));
    assert.equal(h.calls.some(call => ['save-connections-order', 'save-connection', 'connect-db'].includes(call.channel)), false);
    if (action === 'select and edit another record') {
      h.nodes().filter(node => node.type === 'ListItemButton')[1].props.onClick(); h.render();
    }
    if (action.includes('edit')) {
      h.field('connection_name_save_as').props.onChange({ target: { value: 'Current draft' } }); h.render();
    }
    if (action === 'new draft') { click(h.button('new')); h.render(); }
    if (action === 'duplicate') { click(h.move('ContentCopy', 1)); h.render(); }
    const draft = h.field('connection_name_save_as').props.value;
    deletion.resolve({ success: true }); await h.settle();
    assert.equal(h.field('connection_name_save_as').props.value, action === 'untouched' ? 'new_connection' : draft);
    assert.deepEqual(h.order(), ['Saved B', 'Saved C']);
    assert.deepEqual(h.alerts, ['deleted']);
    assert.equal(h.button('connect').props.disabled, false);
    assert.equal(h.calls.filter(call => call.channel === 'get-connections').length, 1);
    if (action === 'edit deleted record') {
      assert.equal(h.nodes().filter(node => node.type === 'Checkbox').at(-1).props.checked, true);
      const labels = h.nodes().filter(node => node.type === 'FormControlLabel');
      assert.equal(labels.at(-1).props.label.children[0], 'save_connection');
    }
  });
}

for (const failure of ['response', 'rejection']) {
  test(`Connection deletion ${failure} preserves the draft and allows retry`, async () => {
    let attempts = 0;
    const h = fixture(channel => {
      if (channel === 'get-connections') return connections;
      if (++attempts > 1) return { success: true };
      if (failure === 'rejection') throw new Error('Simulated deletion rejection');
      return { success: false, error: 'Simulated deletion failure' };
    });
    await h.settle();
    h.field('connection_name_save_as').props.onChange({ target: { value: 'Retained draft' } }); h.render();
    click(h.move('Delete', 0)); await h.settle();
    assert.equal(h.field('connection_name_save_as').props.value, 'Retained draft');
    assert.deepEqual(h.order(), ['Saved A', 'Saved B', 'Saved C']);
    assert.deepEqual(h.alerts, [failure === 'rejection' ? 'failed_to_delete_connection' : 'Simulated deletion failure']);
    assert.equal(h.move('Delete', 0).props.disabled, false);
    click(h.move('Delete', 0)); await h.settle();
    assert.equal(attempts, 2); assert.deepEqual(h.order(), ['Saved B', 'Saved C']);
  });
}

test('A new connection name conflict is shown without connecting or losing input', async () => {
  const h = fixture(channel => channel === 'get-connections' ? connections : { success: false, error: 'connection_name_already_exists' });
  await h.settle(); click(h.button('new')); h.render();
  h.field('connection_name_save_as').props.onChange({ target: { value: 'Saved B' } }); h.render();
  click(h.button('connect')); await h.settle();
  assert.deepEqual(h.alerts, ['connection_name_already_exists']);
  assert.equal(h.field('connection_name_save_as').props.value, 'Saved B');
  const save = h.calls.find(call => call.channel === 'save-connection');
  assert.equal(save.args[1], '');
  assert.equal(h.calls.some(call => call.channel === 'connect-db'), false);
});

for (const phase of ['connect-db', 'get-schemas']) {
  test(`Repeated connect clicks are ignored while ${phase} is pending`, async () => {
    const pending = deferred();
    const h = fixture(channel => {
      if (channel === 'get-connections') return connections;
      if (channel === phase) return pending.promise;
      if (channel === 'connect-db') return { success: true };
      throw new Error('Unexpected IPC: ' + channel);
    });
    await h.settle();
    const connect = h.button('connect'); click(connect); click(connect); await h.settle();
    assert.equal(h.button('connect').props.disabled, true);
    assert.equal(h.calls.filter(call => call.channel === 'connect-db').length, 1);
    click(h.move('Delete', 0)); click(h.move('ArrowDownward', 0)); click(connect);
    assert.equal(h.calls.some(call => ['delete-connection', 'save-connections-order'].includes(call.channel)), false);
    pending.resolve(phase === 'connect-db' ? { success: false, error: 'Simulated connection failure' } : { success: true, schemas: ['demo'] });
    await h.settle();
    assert.equal(h.button('connect').props.disabled, false);
    assert.equal(h.logins.length, phase === 'get-schemas' ? 1 : 0);
    if (phase === 'connect-db') {
      click(h.button('connect')); await h.settle();
      assert.equal(h.calls.filter(call => call.channel === 'connect-db').length, 2);
    }
  });
}

for (const scenario of ['stored path', 'save success', 'save failure', 'save rejection', 'load rejection', 'dialog rejection', 'decline', 'dialog canceled', 'empty selection']) {
  test(`Oracle client setup handles ${scenario} and releases the connection guard`, async () => {
    const settingsRead = deferred(); let reads = 0;
    const h = fixture(channel => {
      if (channel === 'get-connections') return [{ ...connections[0], useOsAuth: true }];
      if (channel === 'load-settings') { reads++; return settingsRead.promise; }
      if (channel === 'show-open-folder-dialog') {
        if (scenario === 'dialog rejection') throw new Error('Simulated dialog error');
        return { canceled: scenario === 'dialog canceled', filePaths: scenario === 'empty selection' ? [] : ['/fictional/client'] };
      }
      if (channel === 'save-settings') {
        if (scenario === 'save rejection') throw new Error('Simulated private write error');
        return { success: scenario !== 'save failure', error: 'Simulated private storage error' };
      }
      if (channel === 'connect-db') return { success: true };
      if (channel === 'get-schemas') return { success: true, schemas: ['demo'] };
      throw new Error('Unexpected IPC: ' + channel);
    }, { confirm: () => scenario !== 'decline' });
    await h.settle();
    const connect = h.button('connect'); click(connect); click(connect); h.render();
    assert.equal(reads, 1);
    assert.equal(h.button('connect').props.disabled, true);
    click(h.move('Delete', 0)); click(h.move('ArrowDownward', 0));
    assert.equal(h.calls.some(call => ['delete-connection', 'save-connections-order'].includes(call.channel)), false);
    if (scenario === 'load rejection') settingsRead.reject(new Error('Simulated private read error'));
    else settingsRead.resolve({ oracleClientPath: scenario === 'stored path' ? '/fictional/existing' : '', queryTimeout: 0 });
    await h.settle();
    const success = ['stored path', 'save success'].includes(scenario);
    const canceled = ['decline', 'dialog canceled', 'empty selection'].includes(scenario);
    assert.equal(h.calls.filter(call => call.channel === 'connect-db').length, success ? 1 : 0);
    assert.equal(h.logins.length, success ? 1 : 0);
    assert.deepEqual(h.alerts, success ? [] : [canceled ? 'os_authentication_was_canceled_because_no_oracle_client_folder_was_selected' : scenario.startsWith('save ') ? 'oracle_client_settings_save_failed' : 'oracle_client_setup_failed']);
    assert.equal(h.button('connect').props.disabled, false);
    if (scenario === 'save success') {
      const write = h.calls.find(call => call.channel === 'save-settings');
      assert.equal(write.args[0].oracleClientPath, '/fictional/client');
      assert.equal(write.args[0].queryTimeout, 0);
      assert.ok(h.calls.findIndex(call => call.channel === 'save-settings') < h.calls.findIndex(call => call.channel === 'connect-db'));
    }
    if (canceled || scenario === 'stored path') assert.equal(h.calls.some(call => call.channel === 'save-settings'), false);
    if (!success) {
      click(h.button('connect')); await h.settle();
      assert.equal(reads, 2);
    }
  });
}

test('Connection exceptions release the guard for retry', async () => {
  let attempts = 0;
  const h = fixture(channel => {
    if (channel === 'get-connections') return connections;
    if (channel === 'connect-db') { attempts++; throw new Error('Simulated connection rejection'); }
    throw new Error('Unexpected IPC: ' + channel);
  });
  await h.settle(); click(h.button('connect')); await h.settle();
  assert.equal(h.button('connect').props.disabled, false);
  click(h.button('connect')); await h.settle(); assert.equal(attempts, 2);
});

for (const schemaFailure of ['response', 'rejection']) {
  test(`Schema lookup ${schemaFailure} closes the connection before retry`, async () => {
    let attempts = 0, active = false;
    const h = fixture(channel => {
      if (channel === 'get-connections') return connections;
      if (channel === 'connect-db') { active = true; attempts++; return { success: true }; }
      if (channel === 'get-schemas') {
        if (attempts > 1) return { success: true, schemas: ['demo'] };
        if (schemaFailure === 'rejection') throw new Error('Simulated schema rejection');
        return { success: false, error: 'Simulated schema failure' };
      }
      if (channel === 'disconnect-db') { active = false; return true; }
      throw new Error('Unexpected IPC: ' + channel);
    });
    await h.settle(); click(h.button('connect')); await h.settle();
    assert.equal(active, false); assert.equal(h.logins.length, 0);
    assert.equal(h.calls.filter(call => call.channel === 'disconnect-db').length, 1);
    assert.equal(h.button('connect').props.disabled, false);
    click(h.button('connect')); await h.settle();
    assert.equal(h.logins.length, 1); assert.equal(active, true);
    assert.deepEqual(h.calls.filter(call => ['connect-db', 'get-schemas', 'disconnect-db'].includes(call.channel)).map(call => call.channel),
      ['connect-db', 'get-schemas', 'disconnect-db', 'connect-db', 'get-schemas']);
  });
}

for (const failure of ['rejection', 'unconfirmed result']) {
  test(`Cleanup ${failure} is reported and retried before any new connection`, async () => {
    let disconnects = 0, connects = 0;
    const h = fixture(channel => {
      if (channel === 'get-connections') return connections;
      if (channel === 'connect-db') { connects++; return { success: true }; }
      if (channel === 'get-schemas') return connects > 1 ? { success: true, schemas: ['demo'] } : { success: false, error: 'Simulated schema failure' };
      if (channel === 'disconnect-db') {
        if (++disconnects < 3) {
          if (failure === 'rejection') throw new Error('Simulated cleanup rejection');
          return false;
        }
        return true;
      }
      throw new Error('Unexpected IPC: ' + channel);
    });
    await h.settle(); click(h.button('connect')); await h.settle();
    assert.equal(h.alerts.at(-1), 'connection_cleanup_failed_retry');
    click(h.button('connect')); await h.settle();
    assert.equal(connects, 1); assert.equal(disconnects, 2);
    assert.equal(h.alerts.at(-1), 'connection_cleanup_failed_retry');
    click(h.button('connect')); await h.settle();
    assert.equal(disconnects, 3); assert.equal(connects, 2); assert.equal(h.logins.length, 1);
  });
}

test('Pending failed-login cleanup holds the connection guard until completion', async () => {
  const closing = deferred();
  const h = fixture(channel => {
    if (channel === 'get-connections') return connections;
    if (channel === 'connect-db') return { success: true };
    if (channel === 'get-schemas') return { success: false, error: 'Simulated schema failure' };
    if (channel === 'disconnect-db') return closing.promise;
    throw new Error('Unexpected IPC: ' + channel);
  });
  await h.settle(); const connect = h.button('connect'); click(connect); await h.settle(); click(connect);
  assert.equal(h.button('connect').props.disabled, true);
  assert.equal(h.calls.filter(call => call.channel === 'connect-db').length, 1);
  closing.resolve(true); await h.settle();
  assert.equal(h.button('connect').props.disabled, false);
});

test('Saved-connection filtering never changes order, draft or original reorder indices', async () => {
  const records = connections.map((value, index) => ({ ...value, environmentLabel: index === 1 ? 'Staging' : 'Production', database: 'database_' + index, user: 'account_' + index }));
  const h = fixture(channel => channel === 'get-connections' ? records : { success: true }); await h.settle();
  const originalMove = h.move('ArrowDownward', 0);
  h.field('connection_name_save_as').props.onChange({ target: { value: 'Draft stays' } }); h.render();
  for (const term of [' saved b ', 'STAGING', 'database_1', 'account_1']) {
    h.field('ux_search_connections').props.onChange({ target: { value: term } }); h.render();
    assert.deepEqual(h.order(), ['Saved B']);
    assert.equal(h.move('ArrowUpward', 0).props.disabled, true);
    click(h.move('ArrowUpward', 0));
    assert.equal(h.calls.some(call => call.channel === 'save-connections-order'), false);
    assert.equal(h.field('connection_name_save_as').props.value, 'Draft stays');
  }
  h.field('ux_search_connections').props.onChange({ target: { value: 'missing' } }); h.render();
  assert.deepEqual(h.order(), []);
  assert.ok(h.nodes().some(node => node.children.includes('ux_no_connections_match')));
  h.field('ux_search_connections').props.onChange({ target: { value: '' } }); h.render();
  assert.deepEqual(h.order(), records.map(value => value.name));
  click(originalMove); await h.settle();
  assert.deepEqual(h.order(), ['Saved B', 'Saved A', 'Saved C']);
});
