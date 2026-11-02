// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
export const root = fileURLToPath(new URL('../', import.meta.url));
export function extractKeys(source) {
  const keys = new Set();
  const file = ts.createSourceFile('site.ts', source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const [arg] = node.arguments;
      if (!arg || !ts.isStringLiteral(arg)) throw new Error('Website translations require literal English keys.');
      keys.add(arg.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...keys].sort();
}
export function extract({ check = false } = {}) {
  const keys = extractKeys(fs.readFileSync(path.join(root, 'src/content/site.ts'), 'utf8'));
  for (const locale of ['en', 'ja']) {
    const file = path.join(root, `src/i18n/${locale}.json`);
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const missing = keys.filter(key => !Object.hasOwn(catalog, key) || typeof catalog[key] !== 'string' || !catalog[key].trim());
    const unused = Object.keys(catalog).filter(key => !keys.includes(key));
    if (check && (missing.length || unused.length)) throw new Error(`${locale}: missing ${missing.join(', ')}; unused ${unused.join(', ')}`);
    if (!check) {
      // Preserve existing translations, including removed keys, until an author reviews them.
      const merged = Object.fromEntries([...new Set([...keys, ...Object.keys(catalog)])].sort().map(key => [key, catalog[key] ?? '']));
      fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
      if (missing.length) console.log(`${locale}: fill ${missing.length} empty translations before building.`);
    }
  }
  console.log(`${keys.length} website translation keys ${check ? 'verified' : 'extracted'} for en and ja.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) extract({ check: process.argv.includes('--check') });
