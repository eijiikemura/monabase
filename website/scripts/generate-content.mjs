// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { root, extract } from './extract-i18n.mjs';
import { siteContent } from '../src/content/site.ts';
import { translator } from '../src/i18n/index.ts';
import { SITE, sitePath } from '../src/config.ts';
extract({ check: true });
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.copyFileSync(path.join(root, '../src/assets/icon.png'), path.join(root, 'public/favicon.png'));
const directory = path.join(root, 'src/content/docs');
fs.mkdirSync(directory, { recursive: true });
const generated = [];
function write(relative, frontmatter, body) {
  const file = path.join(directory, relative);
  generated.push(relative);
  const content = `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n{/* Generated from src/content/site.ts and src/i18n. Do not edit. */}\n\n${body}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content);
}
function tableMarkdown(table) {
  const cell = value => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  if (table.headers.length < 2 || table.rows.some(row => row.length !== table.headers.length)) {
    throw new Error(`Invalid manual table dimensions: ${table.title}`);
  }
  const markdown = [
    `| ${table.headers.map(cell).join(' | ')} |`,
    `| ${table.headers.map(() => '---').join(' | ')} |`,
    ...table.rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
  return `<div class="manual-table-scroll" role="region" aria-label={${JSON.stringify(table.title)}} tabindex={0}>\n\n${markdown}\n\n</div>`;
}
for (const locale of ['en', 'ja']) {
  const content = siteContent(translator(locale)), { ui } = content;
  const prefix = locale === 'ja' ? 'ja/' : '';
  fs.mkdirSync(path.join(root, 'src/content/i18n'), { recursive: true });
  fs.writeFileSync(path.join(root, `src/content/i18n/${locale}.json`), JSON.stringify({ 'search.label': ui.search_label }, null, 2) + '\n');
  write(`${prefix}404.mdx`, { title: ui.not_found_title, editUrl: false }, `${ui.not_found_body}\n\n[${ui.back_manual}](${sitePath(locale)})`);
  write(`${prefix}index.mdx`, { title: ui.manual_title, description: ui.manual_description, template: 'splash', editUrl: false },
    `import Landing from ${JSON.stringify(path.relative(path.join(directory, prefix), path.join(root, 'src/components/Landing.astro')).split(path.sep).join('/'))};\n\n<Landing locale="${locale}" />`);
  for (const page of content.pages) {
    const relative = `${prefix}guides/${page.slug}.mdx`;
    const componentPath = name => JSON.stringify(path.relative(path.dirname(path.join(directory, relative)), path.join(root, `src/components/${name}.astro`)).split(path.sep).join('/'));
    const sectionContent = sections => sections.flatMap(section => [
      `## ${section.title}`, section.body,
      ...(section.image ? [`<Screenshot locale=${JSON.stringify(locale)} name=${JSON.stringify(section.image)} alt=${JSON.stringify(section.title)} caption=${JSON.stringify(ui.screenshot_note)} />`] : []),
    ]);
    const howTo = [
      `## ${ui.how_to}`,
      page.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
      ...(page.code ? ['```sql\n' + page.code + '\n```'] : []),
    ];
    const databaseNotes = (page.oracle || page.postgresql)
      ? [`## ${ui.db_notes}`, ...(page.oracle ? ['### Oracle', page.oracle] : []), ...(page.postgresql ? ['### PostgreSQL', page.postgresql] : [])]
      : [];
    const tableContent = (page.tables ?? []).flatMap(table => [`## ${table.title}`, table.description, tableMarkdown(table)]);
    const traceSections = page.sections ?? [];
    // Trace manual: keep its existing notes first, then place the workflow
    // immediately before the five detailed operation tables.
    const extraContent = page.slug === 'trace'
      ? [...sectionContent(traceSections.slice(0, 2)), ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : []),
         ...howTo, ...sectionContent(traceSections.slice(2)), ...tableContent]
      : page.slug === 'ai'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : []),
         ...tableContent]
      : page.slug === 'git'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...tableContent, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'getting-started'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...tableContent, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'connection'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'transaction-control'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...tableContent, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'workspace'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...tableContent, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-pdb'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...tableContent, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-schemas'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-directories'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-tablespaces'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-users'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-privileges'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-locks'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'admin-sessions'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes, ...tableContent,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : page.slug === 'er-diagrams'
      ? [...sectionContent(page.sections ?? []), ...howTo, ...tableContent, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])]
      : [...tableContent, ...sectionContent(page.sections ?? []), ...howTo, ...databaseNotes,
         ...(page.note ? [`:::note[${ui.remember}]\n${page.note}\n:::`] : [])];
    const body = [
      `import DbBadges from ${componentPath('DbBadges')};`,
      ...(page.image ? [`import Screenshot from ${componentPath('Screenshot')};`] : []),
      `<DbBadges databases={${JSON.stringify(page.databases)}} label=${JSON.stringify(ui.db_support)} />`,
      page.intro,
      ...(page.image ? [`<Screenshot locale=${JSON.stringify(locale)} name=${JSON.stringify(page.image)} alt=${JSON.stringify(page.summary)} caption=${JSON.stringify(ui.screenshot_note)} />`] : []),
      ...extraContent,
      `## ${ui.related}`,
      `[${ui.back_manual}](${sitePath(locale)}#screens) · [${ui.read_manual}](${sitePath(locale, 'guides/getting-started')})`,
    ];
    const renderedBody = page.slug === 'privacy-policy'
      ? [page.intro, ...sectionContent(page.sections ?? [])].join('\n\n')
      : body.join('\n\n');
    write(relative, { title: page.title, description: page.summary, editUrl: `${SITE.repository}/edit/main/website/src/content/site.ts` }, renderedBody);
  }
}
// Remove only files previously generated by this script, never authored content.
const manifestPath = path.join(root, '.generated/content-manifest.json');
if (fs.existsSync(manifestPath)) {
  for (const previous of JSON.parse(fs.readFileSync(manifestPath, 'utf8'))) {
    if (generated.includes(previous)) continue;
    const file = path.resolve(directory, previous);
    if (!file.startsWith(directory + path.sep)) throw new Error('Invalid generated content path.');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Generated from src/content/site.ts')) fs.unlinkSync(file);
  }
}
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(generated, null, 2) + '\n');
console.log(`Generated ${generated.length} bilingual Starlight pages.`);
