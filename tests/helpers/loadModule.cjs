// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '../..');

function evaluateModule(source, file, dependencies = {}, globals = {}, { strict = true } = {}) {
  const filename = path.resolve(projectRoot, file);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const context = {
    Buffer, console, process, setTimeout, clearTimeout, Date, Uint8Array, URL, AbortController,
    ...globals, module, exports: module.exports,
    __dirname: path.dirname(filename), __filename: filename,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (!strict) return nativeRequire(name);
      throw new Error(`Missing test dependency in ${file}: ${name}`);
    }
  };
  vm.runInNewContext(source, context, { filename });
  return module.exports;
}

function loadModule(file, dependencies = {}, globals = {}, options) {
  const source = fs.readFileSync(path.resolve(projectRoot, file), 'utf8');
  return evaluateModule(source, file, dependencies, globals, options);
}

module.exports = { loadModule, evaluateModule };
