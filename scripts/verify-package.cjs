// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// electron-builder supplies this archive reader through the locked development dependencies.
const asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const { evaluateModule } = require('../tests/helpers/loadModule.cjs');

function findArchives(directory) {
  if (directory.endsWith('.asar') && fs.statSync(directory).isFile()) return [directory];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.name === 'app.asar' && entry.isFile()) return [file];
    return entry.isDirectory() && !entry.name.endsWith('.unpacked') ? findArchives(file) : [];
  });
}

function readArchiveFile(archive, filename) {
  return asar.extractFile(archive, path.normalize(filename));
}

async function verify(archive) {
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  for (const required of ['package.json', 'node_modules/ssh2/lib/client.js', 'node_modules/pg/lib/index.js', 'node_modules/oracledb/lib/oracledb.js', 'node_modules/simple-git/package.json', 'LICENSE', 'dist/index.html', 'electron/main.js', 'electron/preload.js',
    'electron/services/dataSafety.js', 'electron/services/jsonFiles.js', 'electron/services/sshHostKeys.js',
    'electron/services/credentialFiles.js', 'electron/services/sqlPrivacy.js', 'electron/services/aiErrors.js', 'electron/services/boundedFiles.js', 'electron/ai/requestLimits.js', 'electron/services/filePermissions.js', 'electron/services/networkPolicy.js', 'electron/services/gitSecurity.js', 'electron/services/gitClient.js', 'electron/postgres/tlsOptions.js',
    'electron/services/traceStore.js', 'electron/postgres/sqlText.js',
    'electron/services/traceFiles.js', 'electron/services/workspacePaths.js', 'electron/services/gitSourceNames.js',
    'electron/services/storagePaths.js', 'electron/i18n.js', 'src/locales/en.json', 'src/locales/ja.json', 'src/assets/icon.png']) {
    assert.ok(files.includes(required), `Missing packaged file: ${required}`);
  }
  assert.ok(files.some(file => /^dist\/assets\/.+\.js$/.test(file)), 'Renderer assets are missing.');
  for (const file of files) {
    assert.ok(!/^(?:local|git|trace|ai|tests|scripts)(?:\/|$)/.test(file) && !['AGENTS.md', 'settings.json'].includes(file),
      `Local-only data was packaged: ${file}`);
  }
  const manifest = JSON.parse(readArchiveFile(archive, 'package.json').toString());
  assert.equal(manifest.main, 'electron/main.js');
  const appMatch = archive.match(/^(.*\.app)[/\\]/);
  const directory = path.dirname(path.dirname(archive));
  const binary = appMatch ? appMatch[1] : [manifest.productName + '.exe', manifest.name + '.exe', manifest.productName, manifest.name]
    .filter(Boolean).map(name => path.join(directory, name)).find(file => fs.existsSync(file));
  assert.ok(binary, 'Packaged executable is missing.');
  if (binary.endsWith('.exe')) {
    assert.ok(!files.some(file => file.startsWith('node_modules/cpu-features/') || file.startsWith('node_modules/ssh2/lib/protocol/crypto/build/')), 'Windows must use the portable SSH fallback.');
    assert.ok(files.some(file => /^node_modules\/oracledb\/build\/Release\/oracledb-[^/]+-win32-x64\.node$/.test(file)), 'Oracle Windows Node-API binary is missing.');
  }
  const wire = await getCurrentFuseWire(binary);
  for (const [name, enabled] of Object.entries({ RunAsNode: false, EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false, OnlyLoadAppFromAsar: true, EnableEmbeddedAsarIntegrityValidation: true })) {
    assert.equal(String.fromCharCode(wire[FuseV1Options[name]]), enabled ? '1' : '0', `Unexpected packaged fuse: ${name}`);
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-package-'));
  try {
    const { createStoragePaths, prepareStorage } = evaluateModule(
      readArchiveFile(archive, 'electron/services/storagePaths.js').toString(), path.join(archive, 'electron/services/storagePaths.js'),
      {}, {}, { strict: false }
    );
    const bundledServices = {};
    for (const name of ['workspacePaths', 'boundedFiles', 'dataSafety', 'jsonFiles', 'traceFiles', 'traceStore']) {
      const filename = `electron/services/${name}.js`;
      bundledServices[name] = evaluateModule(readArchiveFile(archive, filename).toString(), path.join(archive, filename),
        { './boundedFiles': bundledServices.boundedFiles, './dataSafety': bundledServices.dataSafety, './workspacePaths': bundledServices.workspacePaths, './traceFiles': bundledServices.traceFiles,
          './jsonFiles': bundledServices.jsonFiles, './storagePaths': { getStoragePaths() { throw new Error('Explicit package storage paths required.'); } }, '../i18n': { t: key => key } }, {}, { strict: false });
    }
    for (const portable of [false, true]) {
      const userData = path.join(temporary, portable ? 'portable-profile' : 'installed-profile');
      const portableDirectory = path.join(temporary, 'portable');
      const app = { isPackaged: true, getPath: name => name === 'exe' ? path.join(temporary, 'application', 'MonaBase') : userData };
      const paths = createStoragePaths(app, { env: portable ? { PORTABLE_EXECUTABLE_DIR: portableDirectory } : {} });
      assert.equal(paths.baseDirectory, portable ? portableDirectory : userData);
      assert.ok(!paths.traceDirectory.includes('.asar'));
      prepareStorage(paths, path.join(temporary, 'legacy-traces'));
      for (const database of ['oracle', 'postgres']) {
        const filename = `electron/${database}/traceDb.js`;
        const { TraceDatabase } = evaluateModule(readArchiveFile(archive, filename).toString(), path.join(archive, filename), {
          '../services/storagePaths': { getStoragePaths: () => paths }, '../i18n': { t: key => key },
          '../services/traceStore': bundledServices.traceStore
        }, {}, { strict: false });
        const store = new TraceDatabase('PACKAGE_CHECK');
        await store.init();
        await store.insertSteps([{ lineNum: 1, loopPath: '', variables: {}, logText: 'package check' }]);
        store.close();
        const reopened = new TraceDatabase('PACKAGE_CHECK');
        await reopened.init();
        assert.equal((await reopened.getTraceSteps()).length, 1);
        assert.ok(reopened.dbPath.startsWith(paths.traceDirectory + path.sep));
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Verified security fuses, bundled files and installed/portable trace storage: ${archive}`);
}

module.exports = { findArchives, readArchiveFile, verify };

if (require.main === module) {
  (async () => {
    const archives = findArchives(path.resolve(process.argv[2] || 'release'));
    assert.ok(archives.length, 'No app.asar found. Build an unpacked application first.');
    for (const archive of archives) await verify(archive);
  })().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
