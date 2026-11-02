// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const en = require('../src/locales/en.json');
const ja = require('../src/locales/ja.json');
const { translate } = require('../electron/i18n');

const root = path.resolve(__dirname, '..');
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|tsx|js)$/.test(file) ? [file] : [];
  });
}

test('Translation calls use English keys present in both catalogs', () => {
  for (const file of [...sourceFiles(path.join(root, 'src')), ...sourceFiles(path.join(root, 'electron'))]) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && /^(?:t|[\w.]+\.t)$/.test(node.expression.getText(source))) {
        const key = node.arguments[0];
        if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) {
          assert.match(key.text, /^[\x20-\x7e]+$/, file);
          assert.ok(en[key.text], `${file}: missing English translation for ${key.text}`);
          assert.ok(ja[key.text], `${file}: missing Japanese translation for ${key.text}`);
        } else if (key) {
          assert.ok(!ts.isTemplateExpression(key), `${file}: use a static key with interpolation`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

test('Catalogs preserve interpolation variables and contain no Japanese keys or empty values', () => {
  const placeholders = value => [...value.matchAll(/\{\{(.*?)\}\}/g)].map(match => match[1]).sort();
  for (const catalog of [en, ja]) {
    for (const [key, value] of Object.entries(catalog)) {
      assert.match(key, /^[\x20-\x7e]+$/);
      assert.ok(value.length > 0, key);
      if (en[key] && ja[key]) assert.deepEqual(placeholders(en[key]), placeholders(ja[key]), key);
    }
  }
});

test('Main-process translations support English fallback, Japanese, interpolation, and plurals', () => {
  assert.equal(translate('save'), 'Save');
  assert.equal(translate('save', 'ja'), '保存');
  assert.equal(translate('save', 'fr'), 'Save');
  assert.equal(translate('target_user', 'en', { user: '<admin>' }), 'Target user: <admin>');
  assert.equal(translate('aggregated_rows', 'en', { count: 1 }), 'Aggregated 1 row');
  assert.equal(translate('aggregated_rows', 'en', { count: 2 }), 'Aggregated 2 rows');
  assert.equal(translate('aggregated_rows', 'ja', { count: 2 }), '2件 集計完了');
});

test('All coding request types require completion independently of streaming after key migration', () => {
  const source = ts.createSourceFile('main.js', fs.readFileSync(path.join(root, 'electron/ipc/ai.js'), 'utf8'), ts.ScriptTarget.Latest, true);
  let expression, streamExpression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'sourceResponse') expression = node.initializer.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'stream') streamExpression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  assert.ok(streamExpression);
  for (const requestType of ['sql_generation', 'coding_procedure', 'coding_function', 'coding_trigger', 'coding_package']) {
    assert.equal(vm.runInNewContext(expression, { options: { stream: true }, requestType }), true, requestType);
    assert.equal(vm.runInNewContext(expression, { options: { stream: false }, requestType }), true, requestType);
    for (const stream of [true, false]) {
      assert.equal(vm.runInNewContext(streamExpression, { options: { stream }, sourceResponse: true }), stream, requestType);
    }
    assert.ok(en[requestType] && ja[requestType], requestType);
  }
  assert.equal(vm.runInNewContext(expression, { options: { stream: true }, requestType: 'sql_tuning' }), false);
  assert.equal(vm.runInNewContext(streamExpression, { options: { stream: true }, sourceResponse: false }), false);
});
