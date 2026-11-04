// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
// Use the readers supplied by the locked packaging toolchain; no runtime dependency is added.
const packagingRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const { DOMParser } = packagingRequire('@xmldom/xmldom');
const root = path.resolve(__dirname, '..');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
function verifyPng(buffer, asset) {
  assert.ok(buffer.length >= 33 && buffer.subarray(0,8).equals(pngSignature), `Not a PNG: ${asset.name}`);
  assert.equal(buffer.toString('ascii',12,16), 'IHDR', `Invalid PNG header: ${asset.name}`);
  assert.equal(buffer.readUInt32BE(16),asset.width,`Wrong width: ${asset.name}`);
  assert.equal(buffer.readUInt32BE(20),asset.height,`Wrong height: ${asset.name}`);
  assert.equal(hash(buffer),asset.sha256,`Wrong branding or changed bytes: ${asset.name}`);
}
function verifyAssets(directory = path.join(root, 'build/appx')) {
  const contract = JSON.parse(fs.readFileSync(path.join(root,'build/appx-assets.json'),'utf8'));
  assert.equal(contract.source,'src/assets/icon.png');
  assert.equal(hash(fs.readFileSync(path.join(root,contract.source))),contract.sourceSha256,'Regenerate AppX assets after changing the product icon.');
  const expected = new Set(contract.assets.map(asset=>asset.name));
  assert.equal(expected.size,contract.assets.length,'Duplicate AppX asset names.');
  for (const name of ['StoreLogo','Square44x44Logo','Square150x150Logo','Wide310x150Logo','SmallTile','LargeTile']) {
    for (const scale of [100,125,150,200,400]) assert.ok(expected.has(`${name}${scale===100?'':`.scale-${scale}`}.png`),`Missing tile variant: ${name} ${scale}`);
  }
  assert.deepEqual(fs.readdirSync(directory).filter(name=>!name.startsWith('.')&&!name.endsWith('.db')).sort(),[...expected].sort(),'Unexpected or missing AppX assets.');
  for (const asset of contract.assets) {
    assert.equal(path.basename(asset.name),asset.name,'Asset name must be a basename.');
    verifyPng(fs.readFileSync(path.join(directory,asset.name)),asset);
  }
  return contract;
}
async function verifyContents(entries, read, manifest = require('../package.json'), contract = verifyAssets()) {
  const names = entries.map(name=>name.replaceAll('\\','/'));
  assert.equal(new Set(names.map(name=>name.toLowerCase())).size,names.length,'Duplicate package entries.');
  assert.ok(names.includes('AppxManifest.xml'),'Missing AppxManifest.xml.');
  const xml = (await read('AppxManifest.xml')).toString('utf8');
  assert.ok(Buffer.byteLength(xml) <= 1024*1024 && !/<!DOCTYPE|<!ENTITY/i.test(xml),'Unsupported manifest declarations or size.');
  const errors = [];
  const doc = new DOMParser({ errorHandler: { warning: message=>errors.push(message), error: message=>errors.push(message), fatalError: message=>errors.push(message) } }).parseFromString(xml,'application/xml');
  assert.deepEqual(errors,[],'Invalid AppX XML.');
  const foundation = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10';
  const uap = 'http://schemas.microsoft.com/appx/manifest/uap/windows10';
  const element = (namespace,tag) => {
    const matches = doc.getElementsByTagNameNS(namespace,tag);
    assert.equal(matches.length,1,`Expected one ${tag}.`); return matches.item(0);
  };
  const identity = element(foundation,'Identity');
  for (const [name,value] of Object.entries({Name:manifest.build.appx.identityName,Publisher:manifest.build.appx.publisher,ProcessorArchitecture:'x64',Version:manifest.version+'.0'})) {
    assert.equal(identity.getAttribute(name),value,`Store identity changed: ${name}`);
  }
  assert.equal(element(foundation,'Application').getAttribute('Id'),manifest.build.appx.applicationId,'Store applicationId changed.');
  for (const [tag,value] of [['DisplayName',manifest.build.appx.displayName],['PublisherDisplayName',manifest.build.appx.publisherDisplayName]]) {
    assert.equal(element(foundation,'Properties').getElementsByTagNameNS(foundation,tag).item(0)?.textContent,value,`Store property changed: ${tag}`);
  }
  const actualLanguages = Array.from(doc.getElementsByTagNameNS(foundation,'Resource')).map(node=>node.getAttribute('Language')).sort();
  assert.deepEqual(actualLanguages,[...manifest.build.appx.languages].sort(),'Store languages changed.');
  const visual = element(uap,'VisualElements'), tile = element(uap,'DefaultTile');
  const references = [element(foundation,'Logo').textContent,visual.getAttribute('Square44x44Logo'),visual.getAttribute('Square150x150Logo'),tile.getAttribute('Wide310x150Logo'),tile.getAttribute('Square71x71Logo'),tile.getAttribute('Square310x310Logo')];
  const required = ['StoreLogo.png','Square44x44Logo.png','Square150x150Logo.png','Wide310x150Logo.png','SmallTile.png','LargeTile.png'];
  assert.deepEqual(references.map(name=>name.replaceAll('\\','/')),required.map(name=>'assets/'+name),'Unexpected manifest tile references.');
  const assetNames = new Set(contract.assets.map(asset=>'assets/'+asset.name));
  assert.deepEqual(names.filter(name=>/^assets\//i.test(name)&&!name.endsWith('/')).sort(),[...assetNames].sort(),'Default, extra, or missing packaged tile assets.');
  assert.ok(names.includes('resources.pri'),'Missing scaled/target-size resource index.');
  for (const asset of contract.assets) verifyPng(await read('assets/'+asset.name),asset);
  for (const node of Array.from(doc.getElementsByTagName('*'))) for (const attribute of Array.from(node.attributes || [])) {
    if (/\.png$/i.test(attribute.value)) assert.ok(assetNames.has(attribute.value.replaceAll('\\','/')),`Unknown visual asset: ${attribute.value}`);
  }
  console.log(`Verified Store identity, XML tile references, resources.pri and ${contract.assets.length} branded AppX images.`);
}
async function verifyArchive(filename) {
  const contract = verifyAssets();
  const zip = await packagingRequire('unzipper').Open.file(filename);
  assert.ok(zip.files.length < 50000,'Too many package entries.');
  const entries = new Map(zip.files.map(file=>[file.path.replaceAll('\\','/'),file]));
  await verifyContents(zip.files.map(file=>file.path),async name=>{
    const file=entries.get(name);assert.ok(file,`Missing package member: ${name}`);
    assert.ok(file.uncompressedSize<=4*1024*1024,`Oversized visual asset: ${name}`);
    return file.buffer();
  },require('../package.json'),contract);
  console.log(`Verified package: ${filename}`);
}
function latestArchive(directory) {
  const candidates = fs.readdirSync(directory).filter(name=>/\.(appx|msix)$/i.test(name)).map(name=>path.join(directory,name));
  assert.ok(candidates.length,'No AppX/MSIX found. Build a Store package or pass its path explicitly.');
  return candidates.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
}
module.exports = { verifyPng, verifyAssets, verifyContents, verifyArchive };
if (require.main === module) (async()=>{
  if (process.argv[2]==='--assets') { const result=verifyAssets();console.log(`Verified ${result.assets.length} AppX source assets; no default fallback is needed.`); }
  else await verifyArchive(!process.argv[2] || process.argv[2]==='--latest' ? latestArchive(path.join(root,'release')) : path.resolve(process.argv[2]));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
