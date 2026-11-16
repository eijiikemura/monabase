// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, sitePath } from '../src/config.ts';
import { siteContent } from '../src/content/site.ts';
import { translator } from '../src/i18n/index.ts';
const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
let pages = 0, links = 0;
for (const locale of ['en', 'ja']) {
  const content = siteContent(translator(locale));
  for (const slug of ['', ...content.pages.map(page => `guides/${page.slug}`)]) {
    const pathname = sitePath(locale, slug);
    const filename = path.join(dist, pathname.slice(SITE.base.length), 'index.html');
    assert.ok(fs.existsSync(filename), `Missing built page: ${pathname}`);
    const html = fs.readFileSync(filename, 'utf8');
    assert.match(html, new RegExp(`<html[^>]+lang="${locale}"`));
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `Expected one page heading: ${pathname}`);
    const counterpart = sitePath(locale === 'en' ? 'ja' : 'en', slug);
    assert.ok(html.includes(`value="${counterpart}"`), `Language switch loses the current page: ${pathname}`);
    if (slug) {
      const page = content.pages.find(page => `guides/${page.slug}` === slug);
      for (const database of page.databases) assert.ok(html.includes(`db-badge ${database}`), `Missing database badge: ${pathname}`);
      assert.equal(html.includes('db-badge mysql'),page.databases.includes('mysql'),`Incorrect MySQL badge: ${pathname}`);
      if (['admin-sessions', 'admin-locks', 'admin-privileges', 'admin-users', 'admin-tablespaces'].includes(page.slug)) {
        const mysqlTables = page.tables.filter(table => table.title.startsWith('MySQL'));
        assert.equal(mysqlTables.length, 3, `Missing MySQL DBA reference tables: ${pathname}`);
        for (const table of mysqlTables) assert.ok(html.includes(table.title), `Missing built MySQL DBA heading: ${pathname}/${table.title}`);
      }
      if (['getting-started', 'settings', 'styles', 'workspace', 'query-builder', 'check-constraints', 'git', 'ai', 'er-diagrams', 'data-generator', 'cross-tab'].includes(page.slug)) {
        assert.ok(!html.includes('id="mysql"'), `Shared features must not have a MySQL-only note: ${pathname}`);
        assert.ok(!html.includes(`id="${locale === 'ja' ? 'dbごとの違い' : 'database-specific-behavior'}"`), `Unnecessary database differences: ${pathname}`);
      }
      assert.ok(!html.includes(locale === 'ja' ? '— Oracle／PostgreSQLの操作説明' : '— Oracle / PostgreSQL reference'), `Unnecessary reference suffix: ${pathname}`);
      if(page.mysql){const notes = html.indexOf(`id="${locale === 'ja' ? 'dbごとの違い' : 'database-specific-behavior'}"`);const mysql = html.indexOf('id="mysql"');assert.ok(notes >= 0 && mysql > notes,`MySQL must be inside database differences: ${pathname}`);assert.ok(!/<h2[^>]*id="mysql"/.test(html),`MySQL must not be a top-level section: ${pathname}`);}
    }
    assert.ok(!html.includes(locale === 'ja' ? 'MySQLでの操作と違い' : 'MySQL operations and differences'), `Removed MySQL operation section returned: ${pathname}`);
    assert.ok(html.includes(`href="${sitePath(locale, 'guides/styles')}"`), `Missing style-guide navigation: ${pathname}`);
    if (slug) {
      const sidebarStart = html.indexOf('id="starlight__sidebar"');
      const sidebarEnd = html.indexOf('</nav>', sidebarStart);
      assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart, `Missing sidebar navigation: ${pathname}`);
      assert.ok(html.slice(sidebarStart, sidebarEnd).includes(`href="${sitePath(locale, 'guides/database-support')}"`), `Missing database-support sidebar entry: ${pathname}`);
    }
    if (slug === 'guides/getting-started') {
      assert.ok(!html.includes('Oracle Database 12'), `Version requirement must stay in the environment guide: ${pathname}`);
    }
    const currentPage = slug ? content.pages.find(page => `guides/${page.slug}` === slug) : null;
    if (!slug || currentPage?.image) assert.ok(html.includes(`data-screenshot-locale="${locale}"`), `Missing localized screenshot: ${pathname}`);
    if (slug) {
      const page = content.pages.find(page => `guides/${page.slug}` === slug);
      for (const image of [...(page.image ? [page.image] : []), ...(page.sections ?? []).flatMap(section => section.image ? [section.image] : [])]) {
        assert.ok(html.includes(`data-screenshot="${image}"`), `Wrong guide screenshot: ${pathname}/${image}`);
      }
    } else { assert.ok(html.includes('db-badge mysql'),`Landing page lacks MySQL: ${pathname}`); }
    if (!slug) assert.ok(html.includes(`href="${sitePath(locale, 'guides/styles')}"`), `Missing style guide link: ${pathname}`);
    for (const match of html.matchAll(/<(?:a|img|script|link)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
      const target = match[1].replaceAll('&amp;', '&');
      if (/^(?:https?:|mailto:|data:|#)/.test(target)) continue;
      const url = new URL(target, new URL(pathname, SITE.origin));
      assert.ok(url.origin === SITE.origin && url.pathname.startsWith(SITE.base + '/'), `Link escapes Pages base: ${target} in ${pathname}`);
      const relative = decodeURIComponent(url.pathname.slice(SITE.base.length)).replace(/^\//, '');
      let resolved = path.resolve(dist, relative);
      assert.ok(resolved === dist || resolved.startsWith(dist + path.sep), 'Built resource escaped the output folder');
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) resolved = path.join(resolved, 'index.html');
      assert.ok(fs.existsSync(resolved), `Broken local resource: ${target} in ${pathname}`);
      links++;
    }
    pages++;
  }
}
assert.ok(fs.existsSync(path.join(dist, 'pagefind/pagefind.js')), 'Search index was not built');
console.log(`Verified ${pages} bilingual pages, language counterparts, DB badges and ${links} local resources under ${SITE.base}/.`);
