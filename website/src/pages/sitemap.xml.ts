// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { APIRoute } from 'astro';
import { SITE, sitePath } from '../config.ts';
import { siteContent } from '../content/site.ts';
import { translator } from '../i18n/index.ts';

export const prerender = true;

// Keep the XML intentionally minimal; route additions come from the manual's source model.
export const GET: APIRoute = () => {
  const pages = siteContent(translator('en')).pages;
  const locations = (['en', 'ja'] as const).flatMap(locale =>
    ['', ...pages.map(page => `guides/${page.slug}`)].map(route =>
      new URL(sitePath(locale, route), SITE.origin).href
    )
  );
  const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const entries = locations.map(location => `  <url>\n    <loc>${escapeXml(location)}</loc>\n  </url>`);
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries, '</urlset>', ''].join('\n');
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
