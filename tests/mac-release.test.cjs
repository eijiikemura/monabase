// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const plist=createRequire(require.resolve('app-builder-lib/package.json'))('plist');
const manifest=require('../package.json');
const profile=require('../build/mac/distribution.cjs');
const {parseIdentities,requireUploadConsent,signedDetails,commandFailure}=require('../scripts/mac-release.cjs');

test('Developer ID profile is arm64-only and preserves Windows, Store and default CI settings',()=>{
  for(const key of ['appId','win','nsis','portable','appx','files','electronFuses'])assert.deepEqual(profile[key],manifest.build[key]);
  assert.equal(profile.forceCodeSigning,true);assert.equal(profile.mac.identity,null);
  assert.equal(profile.npmRebuild,false);
  assert.deepEqual(profile.mac.files,[...manifest.build.files,'!node_modules/cpu-features/**/*','!node_modules/ssh2/lib/protocol/crypto/build/**/*']);
  assert.equal(profile.mac.hardenedRuntime,true);assert.equal(profile.mac.notarize,false);
  assert.equal(profile.mac.strictVerify,true);assert.equal(profile.mac.preAutoEntitlements,false);
  assert.deepEqual(profile.mac.target,[{target:'dmg',arch:['arm64']}]);
  assert.equal(manifest.build.mac.identity,'-');assert.equal(manifest.build.mac.target,undefined);
  assert.equal(manifest.scripts.build,'npm run build:win');
});

test('Entitlements allow V8 JIT and main-only Oracle loading without enabling App Sandbox',()=>{
  const main=plist.parse(fs.readFileSync(profile.mac.entitlements,'utf8'));
  const inherit=plist.parse(fs.readFileSync(profile.mac.entitlementsInherit,'utf8'));
  assert.deepEqual(main,{'com.apple.security.cs.allow-jit':true,'com.apple.security.cs.disable-library-validation':true});
  assert.deepEqual(inherit,{'com.apple.security.cs.allow-jit':true});
  for(const entitlements of [main,inherit])for(const key of ['com.apple.security.app-sandbox','com.apple.security.get-task-allow','com.apple.security.cs.allow-unsigned-executable-memory'])assert.equal(entitlements[key],undefined);
});

test('Identity selection refuses development certificates and ambiguous Developer ID identities',()=>{
  const development='1) '+ 'A'.repeat(40)+' "Apple Development: Example (ABCDEFGHIJ)"';
  assert.throws(()=>parseIdentities(development),/Select one valid Developer ID/);
  const first='2) '+ 'B'.repeat(40)+' "Developer ID Application: Example (ABCDEFGHIJ)"';
  const second='3) '+ 'C'.repeat(40)+' "Developer ID Application: Other (KLMNOPQRST)"';
  assert.equal(parseIdentities(development+'\n'+first).hash,'B'.repeat(40));
  assert.throws(()=>parseIdentities(first+'\n'+second),/Select one valid Developer ID/);
  assert.equal(parseIdentities(first+'\n'+second,'C'.repeat(40)).team,'KLMNOPQRST');
});

test('Uploads require explicit consent and release signatures require a trusted team, timestamp and runtime',()=>{
  assert.throws(()=>requireUploadConsent(['release/example']),/Apple upload was not authorized/);
  assert.doesNotThrow(()=>requireUploadConsent(['release/example','--allow-apple-upload']));
  const valid='Authority=Developer ID Application: Example\nTeamIdentifier=ABCDEFGHIJ\nTimestamp=Nov 4, 2026\nflags=0x10000(runtime)';
  signedDetails(valid,'ABCDEFGHIJ',true);
  for(const invalid of [valid.replace('Developer ID Application:','Apple Development:'),valid.replace('TeamIdentifier=ABCDEFGHIJ','TeamIdentifier=OTHER'),valid.replace('Timestamp=','MissingTimestamp='),valid.replace('(runtime)','')])assert.throws(()=>signedDetails(invalid,'ABCDEFGHIJ',true));
});

test('Missing notary credentials give setup guidance without exposing authentication output',()=>{
  const stderr='No Keychain password item found for profile: private-profile\nsecret-password';
  const missing=commandFailure('/usr/bin/xcrun',{status:69,stderr});
  assert.match(missing,/notarytool store-credentials/);
  assert.ok(!missing.includes('private-profile')&&!missing.includes('secret-password'));
  assert.equal(commandFailure('/usr/bin/xcrun',{status:1,stderr:'Authentication rejected: secret-password'}),'xcrun failed (1); no credential values were logged.');
});
