// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const manifest = require('../package.json');
const { verifyAssets, verifyPng, verifyContents } = require('../scripts/verify-appx.cjs');
const AppXTarget = require('app-builder-lib/out/targets/AppxTarget').default;
const { AppInfo } = require('app-builder-lib/out/appInfo');
const { Arch } = require('builder-util');
const root = path.resolve(__dirname,'..');

async function buildManifest(temporary) {
  const target = Object.create(AppXTarget.prototype);
  target.options = { ...manifest.build.win, ...manifest.build.appx };
  const info = { metadata:manifest, config:manifest.build, appDir:root };
  target.packager = { appInfo:new AppInfo(info), info, config:manifest.build, platformSpecificBuildOptions:manifest.build.win, getResource:async()=>null };
  const output = path.join(temporary,'AppxManifest.xml');
  await target.writeManifest(output,Arch.x64,manifest.build.appx.publisher,verifyAssets().assets.map(asset=>asset.name));
  return fs.readFileSync(output);
}

test('Store registration stays unchanged while only Store builds select AppX with validation', () => {
  assert.equal(manifest.version,require('../package-lock.json').packages[''].version);
  for (const [key,value] of Object.entries({ applicationId:'MonaBase',identityName:'EijiIkemura.MonaBase',publisher:'CN=BD235DDE-3495-4169-8486-0E9653BDBC89',publisherDisplayName:'Eiji Ikemura',displayName:'MonaBase' })) assert.equal(manifest.build.appx[key],value);
  assert.deepEqual(manifest.build.appx.languages,['en-US','ja-JP']);
  assert.ok(manifest.scripts['build:store'].startsWith('node scripts/verify-appx.cjs --assets &&'));
  assert.ok(manifest.scripts['build:store'].includes('--win appx --x64 --config.npmRebuild=false --publish never'));
  assert.ok(manifest.scripts['build:store'].endsWith('node scripts/verify-appx.cjs --latest'));
  assert.deepEqual(manifest.build.win.target,['nsis','portable']);
  assert.equal(manifest.build.npmRebuild,undefined);
  assert.equal(manifest.build.directories.buildResources,undefined);
});

test('Locked builder resolves every tile from branded assets without vendor fallback', async () => {
  const contract = verifyAssets();
  assert.equal(contract.assets.length,40);
  const vm = { toVmFile:file=>file,pathSep:path.sep };
  const assets = await AppXTarget.computeUserAssets(vm,'/missing-vendor',path.join(root,'build/appx'));
  assert.equal(assets.allAssets.length,40);
  assert.ok(assets.allAssets.every(file=>file.startsWith(path.join(root,'build/appx')+path.sep)));
  assert.ok(!assets.mappings.some(line=>line.includes('SampleAppx')));
  // This is the actual builder fallback taken before the fix.
  const defaults = await AppXTarget.computeUserAssets(vm,'/vendor',null);
  assert.equal(defaults.allAssets.length,4);
  assert.ok(defaults.mappings.every(line=>line.includes('SampleAppx')));
});

test('Preflight refuses missing tiles and replacement artwork before packaging', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'monabase-appx-assets-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  fs.cpSync(path.join(root,'build/appx'),temporary,{recursive:true});
  fs.rmSync(path.join(temporary,'StoreLogo.png'));
  assert.throws(()=>verifyAssets(temporary),/Unexpected or missing AppX assets/);
  fs.copyFileSync(path.join(root,'build/appx/StoreLogo.png'),path.join(temporary,'StoreLogo.png'));
  const asset=verifyAssets().assets.find(asset=>asset.name==='StoreLogo.png');
  const corrupt=fs.readFileSync(path.join(temporary,asset.name));corrupt[corrupt.length-1]^=1;
  fs.writeFileSync(path.join(temporary,asset.name),corrupt);
  assert.throws(()=>verifyAssets(temporary),/Wrong branding/);
  const dimensions=fs.readFileSync(path.join(root,'build/appx',asset.name));dimensions.writeUInt32BE(1,16);
  assert.throws(()=>verifyPng(dimensions,asset),/Wrong width/);
});

test('Real builder manifest includes all tile sizes and passes package-content validation', async t => {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'monabase-appx-manifest-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const xml=await buildManifest(temporary),contract=verifyAssets();
  const entries=['AppxManifest.xml','resources.pri',...contract.assets.map(asset=>'assets/'+asset.name)];
  const read=async name=>name==='AppxManifest.xml'?xml:fs.readFileSync(path.join(root,'build/appx',path.basename(name)));
  await verifyContents(entries,read);
  await assert.rejects(verifyContents(entries.filter(name=>name!=='resources.pri'),read),/Missing scaled/);
  await assert.rejects(verifyContents([...entries,'assets/SampleAppx.44x44.png'],read),/Default, extra/);
  const changed=xml.toString().replace('Name="EijiIkemura.MonaBase"','Name="Wrong.Application"');
  await assert.rejects(verifyContents(entries,async name=>name==='AppxManifest.xml'?Buffer.from(changed):read(name)),/Store identity changed/);
  await assert.rejects(verifyContents(entries,async name=>name==='assets/StoreLogo.png'?Buffer.alloc(100):read(name)),/Not a PNG/);
});
