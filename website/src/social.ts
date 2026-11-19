// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { SITE, sitePath } from './config.ts';

export const SOCIAL_IMAGE = { width: 1200, height: 630 };
export function socialImagePath(locale: 'en' | 'ja') {
  return `${SITE.base}/social/monabase-${locale}-v1.png`;
}

/** Frontmatter head entries replace matching Starlight defaults rather than duplicating them. */
export function socialHead(locale: 'en' | 'ja', title: string, description: string, imageAlt: string, slug = '') {
  const url = new URL(sitePath(locale, slug), SITE.origin).href;
  const image = new URL(socialImagePath(locale), SITE.origin).href;
  const pageTitle = slug ? `${title} | ${SITE.title}` : title;
  const property = (name: string, content: string) => ({ tag: 'meta', attrs: { property: name, content } });
  const named = (name: string, content: string) => ({ tag: 'meta', attrs: { name, content } });
  return [
    { tag: 'title', content: pageTitle },
    property('og:type', slug ? 'article' : 'website'),
    property('og:title', pageTitle), property('og:description', description), property('og:url', url),
    property('og:site_name', SITE.title),
    property('og:locale', locale === 'ja' ? 'ja_JP' : 'en_US'),
    property('og:locale:alternate', locale === 'ja' ? 'en_US' : 'ja_JP'),
    property('og:image', image), property('og:image:secure_url', image),
    property('og:image:type', 'image/png'),
    property('og:image:width', String(SOCIAL_IMAGE.width)), property('og:image:height', String(SOCIAL_IMAGE.height)),
    property('og:image:alt', imageAlt),
    named('twitter:card', 'summary_large_image'), named('twitter:site', '@eijiikemura'), named('twitter:creator', '@eijiikemura'),
    named('twitter:title', pageTitle), named('twitter:description', description),
    named('twitter:image', image), named('twitter:image:alt', imageAlt),
  ];
}
