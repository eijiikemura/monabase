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
  assert.equal(en.pages.length, 39);
  assert.equal(new Set(en.pages.map(page => page.slug)).size, en.pages.length);
  assert.deepEqual(en.pages.map(page => [page.slug, page.databases]), ja.pages.map(page => [page.slug, page.databases]));
  for (const [locale, content] of [['en', en], ['ja', ja]]) for (const page of content.pages) {
    assert.ok(content.groups.some(group => group.slug === page.group));
    const informational = ['contact', 'privacy-policy'].includes(page.slug);
    assert.ok(page.title && page.summary && page.intro);
    assert.ok(informational ? page.steps.length === 0 : page.steps.length >= 3);
    assert.ok(page.databases.every(database => ['oracle', 'postgresql', 'mysql'].includes(database)));
    assert.equal(page.databases.length === 0, informational || page.slug === 'video-tutorials');
    assert.equal(Boolean(page.image), !informational && !['database-support', 'video-tutorials'].includes(page.slug), `Screenshot scope: ${locale}/${page.slug}`);
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
  assert.deepEqual(en.pages.find(page => page.slug === 'admin-schemas').databases, ['postgresql','mysql']);
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
    assert.deepEqual(page.databases, ['oracle', 'postgresql', 'mysql']);
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


test('MySQL badges follow actual capabilities and include bilingual operating differences',()=>{
  const supported=['getting-started','database-support','connection','transaction-control','workspace','styles','settings','sql','query-builder','tables','views','indexes','check-constraints','stored-programs','triggers','git','ai','trace','er-diagrams','data-generator','cross-tab','admin-sessions','admin-locks','admin-privileges','admin-users','admin-tablespaces','admin-schemas'];
  for(const locale of ['en','ja']){
    const pages=siteContent(translator(locale)).pages;
    assert.deepEqual(pages.filter(p=>p.databases.includes('mysql')).map(p=>p.slug).sort(),[...supported].sort());
    for(const page of pages){assert.equal(Boolean(page.mysql),supported.includes(page.slug) && !['getting-started','database-support','settings','styles','workspace','query-builder','check-constraints','git','ai','er-diagrams','data-generator','cross-tab'].includes(page.slug),page.slug);if(page.mysql){assert.ok(page.mysql.intro.trim());assert.ok(!Object.hasOwn(page.mysql, 'tables'), 'No separate MySQL operation table');}}
    for(const slug of ['types','sequences','packages','materialized-views','materialized-view-logs','synonyms','database-links','admin-pdb','admin-directories'])assert.ok(!pages.find(p=>p.slug===slug).databases.includes('mysql'),slug);
    assert.ok(pages.find(p=>p.slug==='trace').mysql.intro);
    assert.ok(pages.find(p=>p.slug==='admin-tablespaces').mysql.intro);
    assert.ok(!pages.some(page => page.mysql && !page.oracle && !page.postgresql), 'No MySQL-only differences sections');
    const comparison = pages.find(page => page.slug === 'transaction-control').tables.find(table => table.title.includes('MySQL'));
    assert.equal(comparison.rows.filter(row => row[0].startsWith('MySQL')).length, 3);
    assert.doesNotMatch(JSON.stringify(siteContent(translator(locale))), /(?:v?1\.0\.1|MonaBase 1\.1)/);
  }
});

test('Database support centralizes verified versions without versioned MySQL marketing', () => {
  for (const locale of ['en', 'ja']) {
    const content = siteContent(translator(locale));
    const support = content.pages.find(page => page.slug === 'database-support');
    assert.equal(support.group, 'start');
    assert.equal(content.pages[1], support);
    assert.deepEqual(support.tables[0].rows.map(row => row[1]), ['23.26.3.0.0 (Oracle Database Free)', '16.15', '8.4.13']);
    assert.doesNotMatch(content.ui.hero_intro, /MySQL\s+8\.4/);
    assert.ok(!support.image, 'An environment reference does not need an unrelated application screenshot');
    for (const page of content.pages) assert.doesNotMatch(page.intro, /MySQL\s+8\.4/);
  }
});

test('DB administration guides provide detailed MySQL reference tables in both languages', () => {
  const slugs = ['admin-sessions', 'admin-locks', 'admin-privileges', 'admin-users', 'admin-tablespaces'];
  const structures = [];
  for (const locale of ['en', 'ja']) {
    const pages = siteContent(translator(locale)).pages;
    structures.push(slugs.map(slug => {
      const page = pages.find(item => item.slug === slug);
      const tables = page.tables.filter(table => table.title.startsWith('MySQL'));
      assert.equal(tables.length, 3, `${locale}/${slug}: list, details and actions/scope`);
      assert.ok(tables.reduce((count, table) => count + table.rows.length, 0) >= 9, `${locale}/${slug}: sufficient operating detail`);
      assert.ok(tables.every(table => table.description && table.headers.length === 3));
      assert.ok(page.tables.some(table => /Oracle/.test(table.title)), `${locale}/${slug}: preserve Oracle reference`);
      assert.ok(page.tables.some(table => /PostgreSQL/.test(table.title)), `${locale}/${slug}: preserve PostgreSQL reference`);
      return tables.map(table => table.rows.length);
    }));
    const sessions = JSON.stringify(pages.find(page => page.slug === 'admin-sessions').tables);
    assert.match(sessions, /KILL QUERY/);
    assert.match(sessions, /KILL CONNECTION/);
    const users = JSON.stringify(pages.find(page => page.slug === 'admin-users').tables);
    assert.match(users, /user@host/);
    const storage = JSON.stringify(pages.find(page => page.slug === 'admin-tablespaces').tables);
    assert.match(storage, /INNODB_TABLESPACES/);
    assert.match(storage, /read-only|参照専用/);
  }
  assert.deepEqual(structures[0], structures[1]);
});

test('The standalone sitemap contains separate canonical URLs for both languages without an index or extensions', async () => {
  const { GET } = await import('../src/pages/sitemap.xml.ts');
  const response = GET({});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/xml; charset=utf-8');
  const xml = await response.text();
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'));
  assert.ok(xml.endsWith('\n</urlset>\n'));
  assert.doesNotMatch(xml, /sitemapindex|xhtml:|lastmod|\/404\//);
  const actual = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const expected = ['en', 'ja'].flatMap(locale => ['', ...siteContent(translator(locale)).pages.map(page => `guides/${page.slug}`)]
    .map(route => new URL(sitePath(locale, route), SITE.origin).href));
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(actual.sort(), expected.sort());
});

test('Video tutorials use the official channel and localized guide without implying database coverage', () => {
  assert.equal(SITE.youtube, 'https://www.youtube.com/channel/UC8rzI4OrnXZd2-2WmCj0vkg');
  for (const locale of ['en', 'ja']) {
    const content = siteContent(translator(locale));
    const page = content.pages.find(page => page.slug === 'video-tutorials');
    assert.equal(page.group, 'start');
    assert.deepEqual(page.databases, []);
    assert.ok(!page.image);
    assert.ok(page.intro.includes(SITE.youtube));
    assert.ok(!page.intro.includes('{{youtubeUrl}}'));
    assert.equal(page.tables[0].rows.length, 5);
    assert.ok(content.ui.videos_title && content.ui.videos_body && content.ui.videos_channel && content.ui.videos_guide);
  }
});
