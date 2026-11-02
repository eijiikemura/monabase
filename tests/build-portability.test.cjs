// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { generateKeyPairSync } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { finished } = require('node:stream/promises');
// The locked ESLint toolchain supplies the YAML reader; no new dependency is required.
const yaml = require('js-yaml');

const releaseWorkflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8'));

test('Package extraction reads real nested ASAR files with native and Windows path semantics', async t => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const asar = require('@electron/asar');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-asar-path-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const input = path.join(temporary, 'input'), archive = path.join(temporary, 'app.asar');
  fs.mkdirSync(path.join(input, 'electron/services'), { recursive: true });
  const content = '// Packaged storage fixture\nmodule.exports = {};\n';
  fs.writeFileSync(path.join(input, 'electron/services/storagePaths.js'), content);
  fs.writeFileSync(path.join(input, 'package.json'), '{"name":"fixture"}');
  // This locked ASAR version returns a stream before its final write has finished.
  await finished(await asar.createPackage(input, archive));
  const native = require('../scripts/verify-package.cjs');
  assert.equal(native.readArchiveFile(archive, 'electron/services/storagePaths.js').toString(), content);

  // Use the locked ASAR library's actual Windows tree lookup, even on a Mac runner.
  const { Filesystem } = loadModule(require.resolve('@electron/asar/lib/filesystem'), { path: path.win32 }, {}, { strict: false });
  const tree = new Filesystem('C:/package');
  const header = asar.getRawHeader(archive);
  tree.setHeader(header.header, header.headerSize);
  assert.throws(() => tree.getFile('electron/services/storagePaths.js'), /not found/);
  const reads = [];
  const windows = loadModule('scripts/verify-package.cjs', {
    'node:path': path.win32,
    '@electron/asar': { extractFile: (file, name) => {
      reads.push(name);
      assert.ok(tree.getFile(name));
      return asar.extractFile(file, name.split(path.win32.sep).join(path.sep));
    } }
  }, {}, { strict: false });
  assert.equal(windows.readArchiveFile(archive, 'electron/services/storagePaths.js').toString(), content);
  assert.equal(windows.readArchiveFile(archive, 'package.json').toString(), '{"name":"fixture"}');
  assert.equal(reads[0], path.win32.join('electron', 'services', 'storagePaths.js'));
});

test('Repository attributes keep LF checkouts with core.autocrlf enabled and preserve binary artwork', async t => {
  const { createGitRepository } = require('./helpers/gitRepository.cjs');
  const h = await createGitRepository(t);
  const source = '// Sample source\nexport const value = 1;\n';
  const image = fs.readFileSync(path.join(__dirname, '../src/assets/icon.png'));
  await h.git.addConfig('core.autocrlf', 'true', false, 'local');
  fs.copyFileSync(path.join(__dirname, '../.gitattributes'), path.join(h.repo, '.gitattributes'));
  fs.writeFileSync(path.join(h.repo, 'sample.ts'), source);
  fs.writeFileSync(path.join(h.repo, 'sample.png'), image);
  await h.git.add(['.gitattributes', 'sample.ts', 'sample.png']);
  fs.unlinkSync(path.join(h.repo, 'sample.ts'));
  fs.unlinkSync(path.join(h.repo, 'sample.png'));
  await h.git.raw(['checkout-index', '--all', '--force']);
  assert.equal(fs.readFileSync(path.join(h.repo, 'sample.ts'), 'utf8'), source);
  assert.deepEqual(fs.readFileSync(path.join(h.repo, 'sample.png')), image);
});

test('Release preparation is manual, default-branch-only and separates build, attestation and publication permissions', () => {
  const workflow = releaseWorkflow;
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.match(workflow.jobs.check.if, /!github.event.repository.fork/);
  assert.match(workflow.jobs.check.if, /github.event.repository.default_branch/);
  assert.equal(workflow.jobs.build.needs, 'check');
  assert.equal(workflow.jobs.build.permissions, undefined);
  assert.equal(workflow.jobs.attest.needs, 'build');
  assert.deepEqual(workflow.jobs.attest.permissions, { contents: 'read', 'id-token': 'write', attestations: 'write' });
  assert.equal(workflow.jobs.draft.needs, 'attest');
  assert.deepEqual(workflow.jobs.draft.permissions, { contents: 'write', attestations: 'read' });
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.notEqual(job['runs-on'], 'self-hosted');
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^actions\/[\w-]+@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
      if (['attest', 'draft'].includes(jobName)) {
        assert.ok(!step.uses?.startsWith('actions/checkout@'));
        assert.ok(!/\bnpm\b/.test(step.run || ''));
      }
    }
  }
  const draft = workflow.jobs.draft.steps.find(step => step.run).run;
  assert.match(draft, /gh attestation verify/);
  for (const flag of ['--repo', '--signer-workflow', '--source-digest', '--deny-self-hosted-runners', '--verify-tag', '--draft']) {
    assert.ok(draft.includes(flag));
  }
  assert.ok(draft.indexOf('gh attestation verify') < draft.indexOf('gh release create'));
  assert.ok(!draft.includes('--clobber'));
  for (const job of [workflow.jobs.attest, workflow.jobs.draft]) {
    const download = job.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
    assert.equal(download.with['run-id'], undefined);
    assert.equal(download.with.repository, undefined);
  }
});

test('Linux common and integration tests remain enabled without Linux packaging', () => {
  const ci = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8'));
  assert.equal(ci.jobs.check['runs-on'], 'ubuntu-latest');
  assert.ok(ci.jobs.check.steps.some(step => step.run === 'npm run check'));
  assert.deepEqual(ci.jobs.package.strategy.matrix.os, ['windows-latest', 'macos-latest']);
  const integration = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/integration.yml'), 'utf8'));
  for (const name of ['postgres', 'oracle', 'electron-ui']) {
    const job = integration.jobs[name];
    assert.match(job['runs-on'], /^ubuntu-/);
    assert.ok(job.steps.some(step => step.run?.includes(name === 'electron-ui' ? 'npm run test:ui' : 'npm run test:db')));
  }
});

test('Distribution targets have distinct OS and architecture names with both Windows launch modes', () => {
  const { build, scripts, productName } = require('../package.json');
  assert.equal(productName, 'MonaBase');
  assert.deepEqual(build.win.target, ['nsis', 'portable']);
  assert.deepEqual(build.mac.target, [{ target: 'dmg', arch: ['arm64'] }]);
  assert.ok(scripts['build:mac'].includes('--arm64'));
  assert.equal(build.linux, undefined);
  assert.equal(scripts['build:linux'], undefined);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.oneClick, false);
  assert.equal(build.nsis.allowToChangeInstallationDirectory, true);
  const names = [build.nsis.artifactName, build.portable.artifactName, build.mac.artifactName];
  assert.equal(new Set(names).size, 3);
  for (const name of names) assert.ok(name.includes('${arch}') && name.includes('${version}'));
  for (const platform of ['win', 'mac']) assert.ok(scripts[`build:${platform}`].includes('--publish never'));
  const matrix = releaseWorkflow.jobs.build.strategy.matrix.include;
  assert.deepEqual(matrix.map(entry => [entry.platform, entry.arch]), [['win', 'x64'], ['mac', 'arm64']]);
  // Exercise the locked builder's real filename expansion for every supported download.
  const { expandMacro } = require('app-builder-lib/out/util/macroExpander');
  const { Arch, getArtifactArchName } = require('builder-util');
  const info = { productName, sanitizedProductName: productName, version: '1.0.0' };
  const expected = releaseWorkflow.jobs.attest.steps.find(step => step.run).run;
  for (const [pattern, arch, ext] of [[build.nsis.artifactName, Arch.x64, 'exe'], [build.portable.artifactName, Arch.x64, 'exe'],
    [build.mac.artifactName, Arch.arm64, 'dmg']]) {
    const name = expandMacro(pattern, getArtifactArchName(arch, ext), info, { ext });
    assert.ok(expected.includes(name.replace('1.0.0', '$version')), `Workflow does not accept builder output: ${name}`);
  }
});

test('Release checksums require every expected artifact and reject missing or extra files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-release-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets');
  fs.mkdirSync(assets);
  const names = ['win-x64-Setup.exe', 'win-x64-Portable.exe', 'mac-arm64.dmg']
    .map(name => `MonaBase-1.0.0-${name}`);
  for (const name of names) fs.writeFileSync(path.join(assets, name), 'test distribution');
  // macOS supplies shasum; Linux and Git Bash supply sha256sum.
  const source = releaseWorkflow.jobs.attest.steps.find(step => step.run).run;
  const script = process.platform === 'darwin' ? source.replace('sha256sum --', 'shasum -a 256 --') : source;
  const bash = process.platform === 'win32' ? path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash';
  const run = () => spawnSync(bash, ['-c', script], { cwd: root, env: { ...process.env, RELEASE_TAG: 'v1.0.0' }, encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(assets, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 3);
  fs.rmSync(path.join(assets, 'SHA256SUMS'));
  fs.rmSync(path.join(assets, names[0]));
  assert.notEqual(run().status, 0);
  fs.writeFileSync(path.join(assets, names[0]), 'test distribution');
  fs.writeFileSync(path.join(assets, 'MonaBase-1.0.0-mac-x64.dmg'), 'unsupported Intel distribution');
  assert.notEqual(run().status, 0);
  fs.rmSync(path.join(assets, 'MonaBase-1.0.0-mac-x64.dmg'));
  fs.writeFileSync(path.join(assets, 'MonaBase-1.0.0-linux-x86_64.AppImage'), 'unsupported Linux distribution');
  assert.notEqual(run().status, 0);
});

test('Windows packaging preserves the common application allowlist', () => {
  const { build } = require('../package.json');
  for (const pattern of build.files) assert.ok(build.win.files.includes(pattern));
  assert.ok(!build.win.files.includes('**/*'));
});

test('Windows build skips optional native recompilation without suppressing dependency collection or other builds', () => {
  const { build, scripts } = require('../package.json');
  assert.ok(scripts['build:win'].includes('--config.npmRebuild=false'));
  assert.equal(build.beforeBuild, undefined);
  assert.equal(build.npmRebuild, undefined);
  assert.ok(!scripts['build:unpacked'].includes('npmRebuild=false'));
});

test('SSH establishes a verified encrypted session with both optional native accelerators absent', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ssh-fallback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['ssh2', 'asn1', 'bcrypt-pbkdf', 'safer-buffer', 'tweetnacl']) {
    const source = path.dirname(require.resolve(`${name}/package.json`));
    fs.cpSync(source, path.join(root, 'node_modules', name), { recursive: true,
      filter: file => !file.endsWith('.node') && !file.split(path.sep).includes('build') });
  }
  const copiedSsh = path.join(root, 'node_modules/ssh2');
  const { Client, Server, utils } = require(copiedSsh);
  assert.equal(require(path.join(copiedSsh, 'lib/protocol/crypto.js')).bindingAvailable, false);
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const expectedKey = utils.parseKey(privateKey).getPublicSSH();
  const server = new Server({ hostKeys: [privateKey] }, connection => {
    connection.on('error', () => {});
    connection.on('authentication', context => context.method === 'password' && context.username === 'test' && context.password === 'test' ? context.accept() : context.reject());
    connection.on('ready', () => connection.on('session', accept => accept().on('exec', (accept, _reject, info) => {
      const stream = accept();
      assert.equal(info.command, 'verify-fallback'); stream.write('fallback verified'); stream.exit(0); stream.end();
    })));
  });
  const client = new Client();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const result = await new Promise((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => client.exec('verify-fallback', (error, stream) => {
        if (error) return reject(error);
        let text = ''; stream.on('error', reject); stream.on('data', chunk => { text += chunk; }); stream.on('close', () => resolve(text));
      }));
      client.connect({ host: '127.0.0.1', port: server.address().port, username: 'test', password: 'test',
        hostVerifier: key => key.equals(expectedKey), readyTimeout: 5000 });
    });
    assert.equal(result, 'fallback verified');
  } finally {
    client.end();
    await new Promise(resolve => server.close(resolve));
  }
});
