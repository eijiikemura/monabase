// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('Component coverage documentation tracks every TSX file and valid test references without claiming a coverage percentage', () => {
  const root = path.resolve(__dirname, '..');
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  const files = walk(path.join(root, 'src')).filter(file => file.endsWith('.tsx')).map(file => path.relative(root, file).split(path.sep).join('/')).sort();
  const document = fs.readFileSync(path.join(root, 'docs/COMPONENT_TEST_COVERAGE.md'), 'utf8');
  const listed = [...document.matchAll(/^\| \[(src\/[^\]]+\.tsx)\]\(\.\.\/([^)]+)\)/gm)];
  assert.deepEqual(listed.map(match => match[1]).sort(), files, 'Update the reviewed coverage map when adding/removing components.');
  assert.ok(listed.every(match => match[1] === match[2]));
  for (const match of document.matchAll(/\]\(\.\.\/(tests\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root, match[1])), `Missing test reference: ${match[1]}`);
  assert.ok(document.includes(`**${files.length} TSX files**`));
});
