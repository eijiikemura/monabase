// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { extract, extractKeys, root } from '../scripts/extract-i18n.mjs';
import { SITE, sitePath } from '../src/config.ts';
import { siteContent } from '../src/content/site.ts';
import { translator } from '../src/i18n/index.ts';

test('Extraction parses actual literal calls without treating comments or string contents as keys', () => {
  const source = `// t('comment')\nconst example = "t('not-a-call')"; t('save'); t('save'); t('open');`;
  assert.deepEqual(extractKeys(source), ['open', 'save']);
  assert.throws(() => extractKeys('t(dynamicKey)'), /literal English keys/);
});
test('All authored website keys have nonempty English and Japanese translations', () => {
  extract({ check: true });
  assert.throws(() => translator('en')('missing_key'), /Missing en website translation/);
});
test('Both locales expose the same unique routes, database capabilities and guide structure', () => {
  const en = siteContent(translator('en')), ja = siteContent(translator('ja'));
  assert.equal(en.pages.length, 37);
  assert.equal(new Set(en.pages.map(page => page.slug)).size, en.pages.length);
  assert.deepEqual(en.pages.map(page => [page.slug, page.databases]), ja.pages.map(page => [page.slug, page.databases]));
  for (const [locale, content] of [['en', en], ['ja', ja]]) for (const page of content.pages) {
    assert.ok(content.groups.some(group => group.slug === page.group));
    const informational = ['contact', 'privacy-policy'].includes(page.slug);
    assert.ok(page.title && page.summary && page.intro);
    assert.ok(informational ? page.steps.length === 0 : page.steps.length >= 3);
    assert.ok(page.databases.every(database => ['oracle', 'postgresql'].includes(database)));
    assert.equal(page.databases.length === 0, informational);
    assert.equal(Boolean(page.image), !informational, `Screenshot scope: ${locale}/${page.slug}`);
    for (const image of [...(page.image ? [page.image] : []), ...(page.sections ?? []).flatMap(section => section.image ? [section.image] : [])]) {
      const screenshot = fs.readFileSync(path.join(root, '../docs/screenshots/manual', locale, `${image}.png`));
      assert.equal(screenshot.subarray(1, 4).toString(), 'PNG');
      assert.equal(screenshot.readUInt32BE(16), 1600, `Unexpected screenshot width: ${page.slug}/${image}`);
    }
    for (const table of page.tables ?? []) {
      assert.ok(table.title && table.description && table.headers.length >= 2 && table.rows.length);
      for (const row of table.rows) {
        assert.equal(row.length, table.headers.length, `Table cell count must match its headers: ${table.title}`);
        assert.ok(row.every(cell => typeof cell === 'string' && cell.trim()));
      }
    }
  }
  for (const slug of ['packages', 'synonyms', 'database-links', 'materialized-view-logs', 'admin-pdb', 'admin-directories']) {
    assert.deepEqual(en.pages.find(page => page.slug === slug).databases, ['oracle']);
  }
  assert.deepEqual(en.pages.find(page => page.slug === 'admin-schemas').databases, ['postgresql']);
});
test('GitHub Pages paths retain the project base and the selected guide across languages', () => {
  assert.equal(SITE.origin, 'https://eijiikemura.github.io');
  assert.equal(sitePath('en'), '/monabase/');
  assert.equal(sitePath('ja'), '/monabase/ja/');
  assert.equal(sitePath('ja', '/guides/git/'), '/monabase/ja/guides/git/');
});
test('Website dependencies stay independent of the desktop app and use their own lockfile', () => {
  const website = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const desktop = JSON.parse(fs.readFileSync(path.join(root, '../package.json'), 'utf8'));
  assert.ok(website.dependencies.astro && website.dependencies['@astrojs/starlight']);
  assert.equal(desktop.dependencies.astro, undefined);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies, website.dependencies);
});

test('Every guide has distinct English and Japanese captures rather than a reused English image', () => {
  const pages = siteContent(translator('en')).pages;
  const images = new Set(pages.flatMap(page => [...(page.image ? [page.image] : []), ...(page.sections ?? []).flatMap(section => section.image ? [section.image] : [])]));
  assert.equal(images.size, 35);
  for (const image of images) {
    const screenshot = locale => fs.readFileSync(path.join(root, '../docs/screenshots/manual', locale, `${image}.png`));
    assert.notDeepEqual(screenshot('en'), screenshot('ja'), `Both locales reuse the same screenshot: ${image}`);
  }
});

test('The start category includes all three app styles with the same bilingual structure', () => {
  for (const locale of ['en', 'ja']) {
    const page = siteContent(translator(locale)).pages.find(page => page.slug === 'styles');
    assert.equal(page.group, 'start');
    assert.deepEqual(page.databases, ['oracle', 'postgresql']);
    assert.deepEqual([page.image, ...page.sections.flatMap(section => section.image ? [section.image] : [])], ['style-mona', 'style-simple', 'style-dark']);
    assert.equal(page.steps.length, 4);
    const variants = ['mona', 'simple', 'dark'].map(theme => fs.readFileSync(path.join(root, '../docs/screenshots/manual', locale, `style-${theme}.png`)).toString('base64'));
    assert.equal(new Set(variants).size, 3, `Styles must use different captures: ${locale}`);
  }
});

test('All manual screenshots use explicit asset imports so new files are available in dev and build', () => {
  const registry = path.join(root, 'src/content/screenshots.ts');
  const source = ts.createSourceFile(registry, fs.readFileSync(registry, 'utf8'), ts.ScriptTarget.Latest, true);
  const imported = new Set(source.statements.filter(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith('.png'))
    .map(node => path.resolve(path.dirname(registry), node.moduleSpecifier.text)));
  for (const locale of ['en', 'ja']) {
    const directory = path.join(root, '../docs/screenshots/manual', locale);
    for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.png'))) {
      assert.ok(imported.has(path.join(directory, file)), `Missing explicit screenshot import: ${locale}/${file}`);
    }
  }
  for (const file of imported) assert.ok(fs.existsSync(file), `Screenshot import is missing: ${file}`);
});
