// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Authoring tool: images are committed, so deployed builds do not depend on local fonts.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { root } from './extract-i18n.mjs';
import { siteContent } from '../src/content/site.ts';
import { translator } from '../src/i18n/index.ts';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const dataImage = buffer => `data:image/png;base64,${buffer.toString('base64')}`;
const logo = dataImage(fs.readFileSync(path.join(root, '../src/assets/icon.png')));
const output = path.join(root, 'public/social');
fs.mkdirSync(output, { recursive: true });
for (const locale of ['en', 'ja']) {
  const { ui } = siteContent(translator(locale));
  const capture = await sharp(path.join(root, `../docs/screenshots/manual/${locale}/sql-workspace.png`))
    .resize({ width: 780 }).png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#101d30"/><stop offset="1" stop-color="#183b49"/></linearGradient>
  <clipPath id="screen"><rect x="706" y="169" width="780" height="410" rx="16"/></clipPath></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1170" cy="50" r="260" fill="#5de4cf" opacity=".04"/>
  <rect x="54" y="52" width="78" height="78" rx="20" fill="white"/>
  <image href="${logo}" x="62" y="60" width="62" height="62"/>
  <g fill="white" font-family="Arial, Hiragino Sans, sans-serif">
  <text x="151" y="110" font-size="57" font-weight="700">MonaBase</text>
  <text x="56" y="235" font-size="43" font-weight="700">${escape(ui.social_tagline_first)}</text>
  <text x="56" y="296" font-size="43" font-weight="700">${escape(ui.social_tagline_second)}</text>
  <g font-size="19" fill="#b8cfdd"><text x="58" y="360">Oracle Database</text><text x="250" y="360">PostgreSQL</text><text x="404" y="360">MySQL</text></g>
  <path d="M56 390H582" stroke="#5de4cf" stroke-width="2" opacity=".6"/>
  <text x="56" y="442" font-size="21" fill="#70e6d4">${escape(ui.social_features)}</text>
  <text x="56" y="558" font-size="21" fill="#b8cfdd">eijiikemura.github.io/monabase</text>
  </g>
  <rect x="692" y="155" width="800" height="440" rx="24" fill="#000" opacity=".2"/>
  <image href="${dataImage(capture)}" x="706" y="169" width="780" height="439" clip-path="url(#screen)"/>
  <rect x="706" y="169" width="780" height="410" rx="16" fill="none" stroke="#5de4cf" stroke-opacity=".35"/>
  </svg>`;
  const filename = path.join(output, `monabase-${locale}-v1.png`);
  await sharp(Buffer.from(svg)).png().toFile(filename);
  console.log(`Created ${path.relative(root, filename)} (1200×630)`);
}
