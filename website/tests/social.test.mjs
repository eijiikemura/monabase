// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { root } from '../scripts/extract-i18n.mjs';
import { socialHead, socialImagePath } from '../src/social.ts';
import { siteContent } from '../src/content/site.ts';
import { translator } from '../src/i18n/index.ts';

for (const locale of ['en', 'ja']) {
  test(`${locale} social cards use public localized PNGs, absolute URLs and page-specific metadata`, () => {
    const { ui, pages } = siteContent(translator(locale));
    for (const page of [{ title: ui.social_title, summary: ui.social_description, slug: '' }, ...pages.map(page => ({ ...page, slug: `guides/${page.slug}` }))]) {
      const head = socialHead(locale, page.title, page.summary, ui.social_image_alt, page.slug);
      const meta = new Map();
      for (const item of head) {
        if (item.tag !== 'meta') continue;
        const key = item.attrs.property ?? item.attrs.name;
        assert.ok(!meta.has(key), `Duplicate card metadata: ${key}`);
        meta.set(key, item.attrs.content);
      }
      const expectedPath = `/monabase/${locale === 'ja' ? 'ja/' : ''}${page.slug ? `${page.slug}/` : ''}`;
      assert.equal(meta.get('og:url'), `https://eijiikemura.github.io${expectedPath}`);
      assert.equal(meta.get('og:description'), page.summary);
      assert.equal(meta.get('twitter:description'), page.summary);
      assert.ok(meta.get('og:title').includes(page.title));
      assert.equal(meta.get('twitter:title'), meta.get('og:title'));
      assert.equal(meta.get('twitter:card'), 'summary_large_image');
      assert.equal(meta.get('twitter:site'), '@eijiikemura');
      assert.equal(meta.get('og:image'), `https://eijiikemura.github.io/monabase/social/monabase-${locale}-v1.png`);
      assert.equal(meta.get('twitter:image'), meta.get('og:image'));
      assert.equal(meta.get('og:image:alt'), ui.social_image_alt);
      assert.equal(meta.get('og:locale'), locale === 'ja' ? 'ja_JP' : 'en_US');
    }
    const filename = path.join(root, 'public', socialImagePath(locale).slice('/monabase/'.length));
    const image = fs.readFileSync(filename);
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 630);
    assert.ok(image.length < 1024 * 1024, 'Social image must remain lightweight');
  });
}
test('English and Japanese sharing images are independently localized', () => {
  const image = locale => fs.readFileSync(path.join(root, `public/social/monabase-${locale}-v1.png`));
  assert.notDeepEqual(image('en'), image('ja'));
});
