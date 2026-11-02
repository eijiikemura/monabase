// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { promisify } = require('node:util');
const { test } = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-build-compat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  for (const [name, content] of Object.entries({
    'main.js': 'module.exports = 1;',
    'nested/helper.js': 'module.exports = 2;',
    'nested/ignored.txt': 'ignore me',
    '.hidden.js': 'hidden',
  })) fs.writeFileSync(path.join(source, name), content);
  return { root, source };
}

test('Patched matching supports callable CommonJS, named ESM and legacy glob options', async () => {
  const match = require('minimatch');
  const esm = await import('minimatch');
  const upstream = require('minimatch-v11');
  assert.equal(match, upstream.minimatch);
  assert.equal(esm.default, match);
  assert.equal(esm.Minimatch, match.Minimatch);
  assert.equal(esm.minimatch, match);
  assert.equal(esm.GLOBSTAR, match.GLOBSTAR);
  assert.deepEqual(Object.keys(esm).filter(key => key !== 'default').sort(), Object.keys(upstream).sort());
  for (const [file, pattern, options, expected] of [
    ['nested/main.js', '**/*.{js,ts}', {}, true],
    ['nested/main.txt', '**/*.{js,ts}', {}, false],
    ['nested/main.js', '*.js', { matchBase: true }, true],
    ['.hidden.js', '*.js', {}, false],
    ['.hidden.js', '*.js', { dot: true }, true],
    ['nested/main.js', '**/!(ignored).js', {}, true],
    ['nested/ignored.js', '**/!(ignored).js', {}, false],
    ['MAIN.JS', '*.js', { nocase: true }, true],
  ]) {
    assert.equal(match(file, pattern, options), expected);
    assert.equal(new esm.Minimatch(pattern, options).match(file), expected);
  }
  assert.deepEqual(match.match(['a.js', 'b.txt'], '*.js'), ['a.js']);
  assert.deepEqual(match.braceExpand('a.{js,ts}'), ['a.js', 'a.ts']);
  assert.equal(match.defaults({ dot: true })('.hidden.js', '*.js'), true);
});

test('ESLint React rules still report forbidden prop patterns and honor allowed components', () => {
  const { Linter } = require('eslint');
  const linter = new Linter();
  const config = {
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react: require('eslint-plugin-react') },
    rules: { 'react/forbid-component-props': ['error', { forbid: [{ propNamePattern: 'data-*', allowedForPatterns: ['Allowed*'] }] }] },
  };
  const messages = linter.verify('const view = <Widget data-private="x" />;', config);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'react/forbid-component-props');
  assert.deepEqual(linter.verify('const view = <AllowedWidget data-private="x" />;', config), []);
});

test('Legacy callback glob and patched promise glob traverse the same selected files', async t => {
  const { source } = fixture(t);
  const legacyGlob = require('glob');
  const rimrafRequire = createRequire(createRequire(require.resolve('quick-temp')).resolve('rimraf'));
  const modernGlob = rimrafRequire('glob');
  const expected = ['main.js', 'nested/helper.js'];
  // glob v7 uses slashes; newer glob uses native Windows separators by default.
  const normalizedFiles = files => files.map(file => file.replaceAll('\\', '/')).sort();
  assert.deepEqual(normalizedFiles(await promisify(legacyGlob)('**/*.js', { cwd: source })), expected);
  assert.deepEqual(normalizedFiles(legacyGlob.sync('**/*.js', { cwd: source })), expected);
  assert.deepEqual(normalizedFiles(await modernGlob.glob('**/*.js', { cwd: source })), expected);
  assert.deepEqual(normalizedFiles(modernGlob.globSync('**/*.js', { cwd: source })), expected);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(modernGlob.glob('**/*', { cwd: source, signal: controller.signal }), { name: 'AbortError' });
});

test('ASAR packing and directory comparison preserve matching and unpacked files', async t => {
  const { root, source } = fixture(t);
  const asar = require('@electron/asar');
  const archive = path.join(root, 'fixture.asar');
  await asar.createPackageWithOptions(source, archive, { unpack: '**/helper.js' });
  assert.equal(asar.extractFile(archive, 'main.js').toString(), 'module.exports = 1;');
  assert.equal(asar.extractFile(archive, path.join('nested', 'helper.js')).toString(), 'module.exports = 2;');
  assert.equal(fs.readFileSync(path.join(`${archive}.unpacked`, 'nested', 'helper.js'), 'utf8'), 'module.exports = 2;');
  const copy = path.join(root, 'copy');
  fs.cpSync(source, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'nested', 'ignored.txt'), 'different but excluded');
  const compare = require('dir-compare');
  assert.equal((await compare.compare(source, copy, { compareContent: true, includeFilter: '*.js', excludeFilter: '.hidden.js' })).same, true);
  fs.writeFileSync(path.join(copy, 'nested', 'helper.js'), 'different source');
  assert.equal((await compare.compare(source, copy, { compareContent: true, includeFilter: '*.js' })).same, false);
});

test('Patched wait-on validation accepts the existing file resource contract', async t => {
  const { source } = fixture(t);
  await require('wait-on')({ resources: [path.join(source, 'main.js')], timeout: 2000, interval: 20, window: 0 });
  const result = require('joi').string().email({ multiple: true }).validate('first@example.com,second@example.com');
  assert.equal(result.error, undefined);
});
