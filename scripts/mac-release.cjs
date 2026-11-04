// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname,'..');
const manifest = require('../package.json');
const plist = createRequire(require.resolve('app-builder-lib/package.json'))('plist');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function commandFailure(file,result) {
  if(path.basename(file)==='xcrun'&&/No Keychain password item found/i.test(result.stderr || '')) {
    return 'Notary keychain profile not found. Use notarytool store-credentials locally, then retry with that profile name.';
  }
  return `${path.basename(file)} failed (${result.error?.code || result.status}); no credential values were logged.`;
}
function run(file,args,options={}) {
  const result=spawnSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,...options});
  // Do not print subprocess arguments or raw authentication errors.
  assert.ok(!result.error&&result.status===0,commandFailure(file,result));
  return result;
}
function parseIdentities(text,selector='') {
  const identities=Array.from(text.matchAll(/\b([A-F0-9]{40})\s+"(Developer ID Application: [^"\r\n]+\(([A-Z0-9]{10})\))"/g),m=>({hash:m[1],name:m[2],team:m[3]}));
  const matches=identities.filter(identity=>!selector||identity.hash===selector.toUpperCase()||identity.name.includes(selector));
  assert.equal(matches.length,1,'Select one valid Developer ID Application certificate with MONABASE_MAC_SIGN_IDENTITY (fingerprint or name fragment).');
  return matches[0];
}
function signingIdentity() {
  return parseIdentities(run('/usr/bin/security',['find-identity','-v','-p','codesigning']).stdout,process.env.MONABASE_MAC_SIGN_IDENTITY || '');
}
function requireUploadConsent(args) {
  assert.ok(args.includes('--allow-apple-upload'),'Apple upload was not authorized. Use --allow-apple-upload only after reviewing this app and DMG.');
}
function artifacts(directory,state) {
  return { app:path.join(directory,'mac-arm64',`${manifest.productName}.app`),
    dmg:path.join(directory,`${manifest.productName}-${state.version}-mac-arm64.dmg`),
    zip:path.join(directory,'app-for-notary.zip') };
}
function save(directory,state) {
  const file=path.join(directory,'mac-release.json');fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
}
function load(directory) {
  directory=path.resolve(directory);
  assert.ok(directory.startsWith(root+path.sep),'Release directory must be inside this checkout.');
  const state=JSON.parse(fs.readFileSync(path.join(directory,'mac-release.json'),'utf8'));
  assert.equal(state.bundleId,manifest.build.appId);assert.equal(state.version,manifest.version);
  assert.match(state.identity.hash,/^[A-F0-9]{40}$/);assert.match(state.identity.team,/^[A-Z0-9]{10}$/);
  const files=artifacts(directory,state);
  assert.equal(sha256(path.join(files.app,'Contents/Resources/app.asar')),state.asarSha256,'App content changed since signing.');
  return {directory,state,files};
}
function details(file) {
  const result=run('/usr/bin/codesign',['-d','--verbose=4',file]);return result.stdout+result.stderr;
}
function signedDetails(text,team,requireRuntime=false) {
  assert.ok(text.includes('Authority=Developer ID Application:'),'Developer ID signature is required.');
  assert.ok(text.includes('TeamIdentifier='+team),'Unexpected signing team.');
  assert.ok(/^Timestamp=/m.test(text),'Secure signing timestamp is required.');
  if(requireRuntime)assert.match(text,/flags=.*runtime/,'Hardened Runtime is required.');
}
function walk(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(directory,entry.name);return entry.isSymbolicLink()?[]:entry.isDirectory()?walk(file):[file];
  });
}
function verifyApp(appPath,team) {
  run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',appPath]);
  const info=plist.parse(fs.readFileSync(path.join(appPath,'Contents/Info.plist'),'utf8'));
  assert.equal(info.CFBundleIdentifier,manifest.build.appId);assert.equal(info.CFBundleShortVersionString,manifest.version);
  signedDetails(details(appPath),team,true);
  const appEntitlements=plist.parse(run('/usr/bin/codesign',['-d','--entitlements','-','--xml',appPath]).stdout);
  assert.deepEqual(Object.keys(appEntitlements).sort(),['com.apple.security.cs.allow-jit','com.apple.security.cs.disable-library-validation']);
  assert.ok(Object.values(appEntitlements).every(value=>value===true));
  const binaries=walk(path.join(appPath,'Contents')).filter(file=>{
    const fd=fs.openSync(file,'r'),header=Buffer.alloc(4);try{fs.readSync(fd,header,0,4,0);}finally{fs.closeSync(fd);}
    return ['cffaedfe','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex'));
  });
  assert.ok(binaries.length>=5,'Expected the app and Electron helper/framework executables.');
  let helpers=0;
  for(const file of binaries) {
    run('/usr/bin/codesign',['--verify','--strict',file]);signedDetails(details(file),team);
    if(/Helper[^/]*\.app\/Contents\/MacOS\//.test(file)) {
      helpers++;
      const entitlements=plist.parse(run('/usr/bin/codesign',['-d','--entitlements','-','--xml',file]).stdout);
      assert.deepEqual(entitlements,{'com.apple.security.cs.allow-jit':true},'Helpers must not gain main-process exceptions.');
    }
  }
  assert.ok(helpers>=3,'Expected signed Electron helpers.');
  return {machOBinaries:binaries.length,helpers,bundleId:info.CFBundleIdentifier,version:info.CFBundleShortVersionString};
}
async function buildDmg(directory,state,prepackaged) {
  const {build,Platform,Arch}=require('electron-builder');
  const profile=require('../build/mac/distribution.cjs');
  const env={...process.env};delete env.CSC_LINK;delete env.CSC_KEY_PASSWORD;
  // No automatic notary call is enabled by the profile, even if APPLE_* variables exist.
  const options={targets:Platform.MAC.createTarget('dmg',Arch.arm64),publish:'never',
    config:{...profile,directories:{...profile.directories,output:directory},mac:{...profile.mac,identity:state.identity.hash}}};
  if(prepackaged)options.prepackaged=prepackaged;
  await build(options);
  const files=artifacts(directory,state);
  run('/usr/bin/codesign',['--force','--sign',state.identity.hash,'--timestamp',files.dmg],{timeout:300000,env});
  run('/usr/bin/codesign',['--verify','--strict',files.dmg]);signedDetails(details(files.dmg),state.identity.team);
}
async function buildRelease(output) {
  assert.equal(process.platform,'darwin','Mac release builds require macOS.');
  assert.ok(!process.env.CSC_LINK&&!process.env.CSC_KEY_PASSWORD,'Use the installed keychain identity; certificate import/export is not performed.');
  const identity=signingIdentity();
  const directory=output?path.resolve(output):path.join(root,'release/mac-developer-id',`${manifest.version}-${Date.now()}`);
  assert.ok(directory.startsWith(root+path.sep),'Build directory must be inside this checkout.');
  assert.ok(!fs.existsSync(directory),'Refusing to overwrite an existing release directory.');fs.mkdirSync(directory,{recursive:true});
  const state={bundleId:manifest.build.appId,version:manifest.version,identity,notarized:false,createdAt:new Date().toISOString()};
  await buildDmg(directory,state);
  const files=artifacts(directory,state);state.asarSha256=sha256(path.join(files.app,'Contents/Resources/app.asar'));
  state.dmgSha256=sha256(files.dmg);save(directory,state);
  state.signed=verifyApp(files.app,identity.team);state.dmgSha256=sha256(files.dmg);save(directory,state);
  console.log('Signed app and DMG verified; notarization is still required.');console.log(directory);
}
function authArgs() {
  const profile=process.env.APPLE_KEYCHAIN_PROFILE;
  assert.ok(profile&&profile.trim(),'Set APPLE_KEYCHAIN_PROFILE to an existing notarytool keychain profile.');
  const args=['--keychain-profile',profile];if(process.env.APPLE_KEYCHAIN)args.push('--keychain',process.env.APPLE_KEYCHAIN);return args;
}
function notarizeArtifact(file,key,directory,state) {
  const auth=authArgs();
  const digest=sha256(file);state.submissions ||= {};
  let submission=state.submissions[key];
  if(submission)assert.equal(submission.sha256,digest,'Submitted artifact changed; do not reuse a submission for different bytes.');
  if(!submission) {
    const response=JSON.parse(run('/usr/bin/xcrun',['notarytool','submit',file,...auth,'--output-format','json'],{timeout:600000}).stdout);
    assert.match(response.id,/^[a-f0-9-]{36}$/i);
    submission={id:response.id,sha256:digest,status:response.status||'Submitted'};state.submissions[key]=submission;save(directory,state);
  }
  console.log(`Apple ${key} submission: ${submission.id}`);
  if(submission.status!=='Accepted') {
    const result=run('/usr/bin/xcrun',['notarytool','wait',submission.id,...auth,'--timeout','15m','--output-format','json'],{timeout:960000});
    const response=JSON.parse(result.stdout);submission.status=response.status;save(directory,state);
    assert.equal(submission.status,'Accepted',`Apple ${key} submission was not accepted. Inspect its notary log using the saved submission ID.`);
  }
}
async function notarizeRelease(directory,args) {
  requireUploadConsent(args);assert.equal(process.platform,'darwin');authArgs();
  const job=load(directory),{state,files}=job;directory=job.directory;
  const identity=signingIdentity();assert.equal(identity.hash,state.identity.hash,'Use the same signing identity for the app and DMG.');
  verifyApp(files.app,state.identity.team);
  if(!state.appStapled) {
    if(!fs.existsSync(files.zip))run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',files.app,files.zip],{timeout:300000});
    notarizeArtifact(files.zip,'app',directory,state);
    run('/usr/bin/xcrun',['stapler','staple',files.app]);run('/usr/bin/xcrun',['stapler','validate',files.app]);
    state.appStapled=true;save(directory,state);
  }
  if(!state.dmgRebuilt) {
    await buildDmg(directory,state,files.app);state.dmgRebuilt=true;state.dmgSha256=sha256(files.dmg);save(directory,state);
  }
  if(!state.dmgStapled) {
    assert.equal(sha256(files.dmg),state.dmgSha256);
    notarizeArtifact(files.dmg,'dmg',directory,state);
    run('/usr/bin/xcrun',['stapler','staple',files.dmg]);run('/usr/bin/xcrun',['stapler','validate',files.dmg]);
    state.dmgStapled=true;state.dmgSha256=sha256(files.dmg);save(directory,state);
  }
  const verification=verifyRelease(directory,false);
  state.notarized=true;state.verification=verification;save(directory,state);
  fs.writeFileSync(path.join(directory,'SHA256SUMS'),`${state.dmgSha256}  ${path.basename(files.dmg)}\n`);
  console.log('Apple notarization, both stapled tickets, and Gatekeeper checks passed.');
}
function verifyRelease(directory,signedOnly=false) {
  const {state,files}=load(directory);assert.equal(sha256(files.dmg),state.dmgSha256,'DMG changed since the last recorded step.');
  const signature=verifyApp(files.app,state.identity.team);
  run('/usr/bin/codesign',['--verify','--strict',files.dmg]);signedDetails(details(files.dmg),state.identity.team);
  if(!signedOnly) {
    assert.ok(state.appStapled&&state.dmgStapled,'Both app and DMG must have stapled tickets.');
    for(const file of [files.app,files.dmg])run('/usr/bin/xcrun',['stapler','validate',file]);
    run('/usr/sbin/spctl',['--assess','--type','execute','--verbose=4',files.app]);
    run('/usr/sbin/spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=4',files.dmg]);
  }
  return {...signature,gatekeeper:!signedOnly,stapled:!signedOnly};
}
module.exports={parseIdentities,requireUploadConsent,signedDetails,verifyApp,verifyRelease,commandFailure};
if(require.main===module)(async()=>{
  const [command,...args]=process.argv.slice(2);
  if(command==='build')await buildRelease(args[0]);
  else if(command==='notarize')await notarizeRelease(args[0],args);
  else if(command==='verify')console.log(JSON.stringify(verifyRelease(args[0],args.includes('--signed-only'))));
  else throw new Error('Use build [new-output-directory], notarize DIRECTORY --allow-apple-upload, or verify DIRECTORY [--signed-only].');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
