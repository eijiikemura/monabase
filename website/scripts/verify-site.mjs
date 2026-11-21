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
const decodeAttribute = value => value.replace(/&(?:amp|quot|lt|gt|#39|#x27);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'" })[entity]);
function verifySocial(html, locale, slug, content) {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head, 'Missing HTML head');
  const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeAttribute(value)]));
  const metas = new Map();
  for (const tag of head.matchAll(/<meta\b[^>]*>/g)) {
    const attrs = attributes(tag[0]);
    const key = attrs.property ?? attrs.name;
    if (!key || (!key.startsWith('og:') && !key.startsWith('twitter:'))) continue;
    assert.ok(!metas.has(key), `Duplicate social tag: ${locale}/${slug}/${key}`);
    metas.set(key, attrs.content);
  }
  const title = slug ? `${content.pages.find(page => `guides/${page.slug}` === slug).title} | MonaBase` : content.ui.social_title;
  const description = slug ? content.pages.find(page => `guides/${page.slug}` === slug).summary : content.ui.social_description;
  const url = new URL(sitePath(locale, slug), SITE.origin).href;
  assert.equal(metas.get('og:url'), url);
  assert.equal(metas.get('og:title'), title);
  assert.equal(metas.get('twitter:title'), title);
  assert.equal(metas.get('og:description'), description);
  assert.equal(metas.get('twitter:description'), description);
  assert.equal(metas.get('twitter:card'), 'summary_large_image');
  assert.equal(metas.get('twitter:site'), '@eijiikemura');
  assert.equal(metas.get('og:locale'), locale === 'ja' ? 'ja_JP' : 'en_US');
  assert.equal(metas.get('og:type'), slug ? 'article' : 'website');
  const image = `${SITE.origin}${SITE.base}/social/monabase-${locale}-v1.png`;
  assert.equal(metas.get('og:image'), image);
  assert.equal(metas.get('twitter:image'), image);
  assert.equal(metas.get('og:image:alt'), content.ui.social_image_alt);
  assert.equal(metas.get('twitter:image:alt'), content.ui.social_image_alt);
  assert.equal(metas.get('og:image:width'), '1200');
  assert.equal(metas.get('og:image:height'), '630');
  const canonicals = [...head.matchAll(/<link\b[^>]*>/g)].map(match => attributes(match[0])).filter(attrs => attrs.rel === 'canonical');
  assert.equal(canonicals.length, 1);
  assert.equal(canonicals[0].href, url);
  assert.ok(fs.existsSync(path.join(dist, `social/monabase-${locale}-v1.png`)));
}
let pages = 0, links = 0;
for (const locale of ['en', 'ja']) {
  const content = siteContent(translator(locale));
  for (const slug of ['', ...content.pages.map(page => `guides/${page.slug}`)]) {
    const pathname = sitePath(locale, slug);
    const filename = path.join(dist, pathname.slice(SITE.base.length), 'index.html');
    assert.ok(fs.existsSync(filename), `Missing built page: ${pathname}`);
    const html = fs.readFileSync(filename, 'utf8');
    verifySocial(html, locale, slug, content);
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
    assert.ok(!html.includes('guides/video-tutorials'), `Removed tutorial navigation returned: ${pathname}`);
    assert.ok(!html.includes('UC8rzI4OrnXZd2-2WmCj0vkg'), `Removed YouTube channel returned: ${pathname}`);
    assert.ok(!fs.existsSync(path.join(dist, locale === 'ja' ? 'ja/guides/video-tutorials/index.html' : 'guides/video-tutorials/index.html')), 'Removed guide must not be published');
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
const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
assert.ok(sitemap.endsWith('\n</urlset>\n'));
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const expectedUrls = ['en', 'ja'].flatMap(locale => ['', ...siteContent(translator(locale)).pages.map(page => `guides/${page.slug}`)]
  .map(slug => new URL(sitePath(locale, slug), SITE.origin).href));
assert.deepEqual(sitemapUrls.sort(), expectedUrls.sort(), 'Standalone sitemap must match all published pages');
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length, 'Duplicate sitemap URL');
console.log(`Verified standalone sitemap.xml: ${sitemapUrls.length} canonical URLs without child sitemaps.`);
