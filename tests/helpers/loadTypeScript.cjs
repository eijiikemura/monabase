// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { evaluateModule } = require('./loadModule.cjs');

function loadTypeScript(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
    .replaceAll('import.meta.env.DEV', 'false');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
  }).outputText;
  // Load real internal modules by default; explicit stubs and external boundaries remain unchanged.
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const staticImports = new Set(syntax.statements.flatMap(statement =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text] : []));
  const resolved = { ...dependencies };
  for (const match of code.matchAll(/require\(["'](@\/[^"']+|\.{1,2}\/[^"']+)["']\)/g)) {
    const name = match[1];
    if (Object.hasOwn(resolved, name)) continue;
    // Keep dynamic relative imports lazy, especially platform workspaces and UI dialogs.
    if (!name.startsWith('@/') && !staticImports.has(name)) continue;
    const base = name.startsWith('@/')
      ? path.resolve(__dirname, '../../src', name.slice(2))
      : path.resolve(path.dirname(path.resolve(__dirname, '../..', file)), name);
    const target = ['.ts', '.tsx'].map(extension => base + extension).find(candidate => fs.existsSync(candidate));
    if (target) resolved[name] = loadTypeScript(target, dependencies, globals);
  }
  return evaluateModule(code, file, resolved, globals);
}

module.exports = { loadTypeScript };
