// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

test('The desktop request and event contracts match the preload allowlists', () => {
  const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
  const source = ts.createSourceFile('desktopContract.ts', fs.readFileSync(path.join(root, 'src/shared/api/desktopContract.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  for (const [name, variable] of [['DesktopRequests', 'invokeChannels'], ['DesktopEvents', 'eventChannels']]) {
    const contract = source.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === name);
    const expected = contract.members.map(member => member.name.text).sort();
    const array = preload.match(new RegExp(`const ${variable} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))[1];
    const actual = [...array.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
    assert.deepEqual(expected, actual);
  }
});

function diagnostics(code, paths = path) {
  const file = paths.join(root, 'src/shared/api/contract-type-test.ts');
  const config = ts.readConfigFile(path.join(root, 'tsconfig.app.json'), ts.sys.readFile).config;
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const canonical = name => host.getCanonicalFileName(paths.normalize(name));
  host.getSourceFile = (name, ...args) => canonical(name) === canonical(file)
    ? ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true) : getSourceFile(name, ...args);
  const program = ts.createProgram([file], options, host);
  const source = program.getSourceFile(file);
  assert.ok(source, 'The virtual contract file must be loaded before checking diagnostics.');
  return program.getSemanticDiagnostics(source);
}

for (const [label, paths] of [['native', path], ['Windows separators', path.win32]]) {
  test(`Desktop contracts accept valid calls and reject incorrect channels, arguments, and result fields (${label})`, () => {
    const good = `
      import type { Invoke, EventListener } from './desktopContract';
      declare const invoke: Invoke;
      const settings = await invoke('load-settings');
      await invoke('save-settings', { ...settings, queryTimeout: 0 });
      const schemas = await invoke('get-schemas');
      if (schemas.success) schemas.schemas.map(name => name.toUpperCase());
      const detailed = await invoke('get-schemas', false, true);
      if (detailed.success) detailed.schemas.map(row => row.USERNAME);
      const query = await invoke<{ COUNT: number }>('execute-sql-bg', 'SELECT 1');
      if (query.success) query.rows.map(row => row.COUNT.toFixed());
      const onUsage: EventListener<'ai-usage-history-updated'> = (_event, year) => year.toFixed();
      void onUsage;
    `;
    assert.deepEqual(diagnostics(good, paths).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
    const bad = `
      import type { Invoke, EventListener } from './desktopContract';
      declare const invoke: Invoke;
      await invoke('unknown-channel');
      await invoke('copy-to-clipboard', 123);
      await invoke('get-columns', 'APP');
      const settings = await invoke('load-settings');
      settings.queryTimeout.toUpperCase();
      await invoke('save-settings', { ...settings, queryTimeout: 'unlimited' });
      const onUsage: EventListener<'ai-usage-history-updated'> = (_event, year) => year.toUpperCase();
      void onUsage;
    `;
    assert.equal(diagnostics(bad, paths).length, 6);
  });
}
