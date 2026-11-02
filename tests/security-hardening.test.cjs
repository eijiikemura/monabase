// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createFilePermissions } = require('../electron/services/filePermissions');
const { normalizeAiEndpoint } = require('../electron/services/networkPolicy');
const { validateGitRemote, redactGitSecrets } = require('../electron/services/gitSecurity');
const { restrictBrowserPermissions } = require('../electron/ipc/security');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-security-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('Save capabilities reject unselected destinations, other frames, expiry and changed link targets', t => {
  const dir = directory(t), file = path.join(dir,'selected.sql'), other = path.join(dir,'other.sql');
  let now = 1;
  const permissions = createFilePermissions({ now: () => now, lifetime: 10 });
  const event = { sender: {}, senderFrame: {} };
  const token = permissions.issue(event,file);
  assert.equal(permissions.authorize(event,token,file),path.join(fs.realpathSync(dir),'selected.sql'));
  assert.throws(() => permissions.authorize(event,undefined,file), /Select the output/);
  assert.throws(() => permissions.authorize(event,token,other), /Select the output/);
  assert.throws(() => permissions.authorize({ ...event, senderFrame:{} },token,file), /Select the output/);
  assert.throws(() => permissions.authorize({ ...event, sender:{} },token,file), /Select the output/);
  now = 12; assert.throws(() => permissions.authorize(event,token,file), /Select the output/);
  assert.equal(fs.existsSync(file),false);
  if (process.platform !== 'win32') {
    fs.writeFileSync(file,'keep');fs.writeFileSync(other,'other');
    const link = path.join(dir,'link');fs.symlinkSync(file,link);
    const grant = permissions.issue(event,link);
    fs.unlinkSync(link);fs.symlinkSync(other,link);
    assert.throws(() => permissions.authorize(event,grant,link), /Select the output/);
    assert.equal(fs.readFileSync(other,'utf8'),'other');
  }
});

test('Raw save IPC cannot write without a matching OS-dialog grant', async t => {
  const dir = directory(t), file = path.join(dir,'approved.txt'), denied = path.join(dir,'denied.txt'), handlers = new Map();
  const event = { sender: {}, senderFrame:{} };
  require('../electron/ipc/files').registerFileHandlers({ ipcMain:{handle:(key,handler)=>handlers.set(key,handler)}, dialog:{showSaveDialog:async()=>({canceled:false,filePath:file})}, getWindow:()=>null,t:key=>key });
  assert.equal((await handlers.get('save-file')(event,denied,'unapproved','utf8')).success,false);
  const grant = await handlers.get('show-save-dialog')(event,{});
  assert.equal((await handlers.get('save-file')(event,denied,'unapproved','utf8',grant.writeToken)).success,false);
  assert.equal((await handlers.get('save-file')(event,file,'approved','utf8',grant.writeToken)).success,true);
  assert.equal(fs.readFileSync(file,'utf8'),'approved');assert.equal(fs.existsSync(denied),false);
});

test('Desktop save transport forwards only the token issued for the selected path', async () => {
  const calls = [];
  const {createDesktopClient} = loadTypeScript('src/shared/api/createDesktopClient.ts');
  const client = createDesktopClient({on(){return()=>{};},invoke:async(channel,...args)=>{
    calls.push([channel,...args]);return channel==='show-save-dialog'?{canceled:false,filePath:'/chosen.sql',writeToken:'permission'}:{success:true};
  }},()=>{});
  await client.invoke('show-save-dialog',{});
  await client.invoke('save-file','/chosen.sql','data','utf8','forged');
  assert.equal(calls.at(-1)[4],'permission');
  await client.invoke('save-file','/other.sql','data','utf8','forged');
  assert.equal(calls.at(-1)[4],undefined);
});

test('AI URLs require encrypted external transport and normalize only an exact localhost host', () => {
  assert.equal(normalizeAiEndpoint('http://localhost:11434/v1/'),'http://127.0.0.1:11434/v1');
  assert.equal(normalizeAiEndpoint('http://[::1]:11434/v1'),'http://[::1]:11434/v1');
  assert.equal(normalizeAiEndpoint('https://api.example/localhost/v1'),'https://api.example/localhost/v1');
  assert.equal(normalizeAiEndpoint('https://localhost.example/v1'),'https://localhost.example/v1');
  for(const value of ['http://example.com/v1','https://user:secret@example.com/v1','https://example.com/v1?token=secret','file:///tmp/config','https://example.com/#x'])assert.throws(()=>normalizeAiEndpoint(value),/security_ai_/);
});

test('Git URLs reject embedded secrets and helper protocols while preserving supported local and SSH remotes', () => {
  for(const value of ['https://github.com/example/repo.git','git@github.com:example/repo.git','ssh://git@github.com/example/repo','../remote.git',path.resolve('local-remote.git')])assert.equal(validateGitRemote(value),value);
  for(const value of ['https://token@github.com/example/repo.git','https://user:password@github.com/repo','ssh://git:password@host/repo','https://host/repo?token=private','ext::command','-c config=value','remote\npath'])assert.throws(()=>validateGitRemote(value),/security_git_/);
  assert.ok(!redactGitSecrets('ssh://demo:DUMMY_SECRET@host/repo').includes('DUMMY_SECRET'));
  assert.ok(!redactGitSecrets('git+ssh://demo:DUMMY_SECRET@host/repo').includes('DUMMY_SECRET'));
  const redacted=redactGitSecrets('https://user:secret@host/repo?token=another');
  assert.ok(!redacted.includes('secret')&&!redacted.includes('another')&&!redacted.includes('user:'));
});

test('Browser privileges are denied while developer tools remain enabled in the main window', () => {
  const handlers = {};
  restrictBrowserPermissions({setPermissionRequestHandler:h=>handlers.request=h,setPermissionCheckHandler:h=>handlers.check=h,setDevicePermissionHandler:h=>handlers.device=h,on:(key,h)=>handlers[key]=h});
  let allowed;
  handlers.request(null,'media',value=>{allowed=value;});assert.equal(allowed,false);
  assert.equal(handlers.check(),false);assert.equal(handlers.device(),false);
  let denied=false;handlers['will-download']({preventDefault(){denied=true;}});assert.equal(denied,true);
  const source=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');
  assert.ok(source.includes('toggleDevTools'));
  const fuses=require('../package.json').build.electronFuses;
  assert.equal(fuses.runAsNode,false);assert.equal(fuses.enableNodeOptionsEnvironmentVariable,false);
  assert.equal(fuses.enableNodeCliInspectArguments,false);assert.equal(fuses.onlyLoadAppFromAsar,true);assert.equal(fuses.enableEmbeddedAsarIntegrityValidation,true);
});

test('AI handlers reject insecure settings before persistence and never follow response redirects', async t => {
  const http = require('node:http');
  const { EventEmitter } = require('node:events');
  const dir = directory(t), settingsFile = path.join(dir,'ai-settings.json');
  fs.writeFileSync(settingsFile,'{}');
  let forwarded = 0, requests = 0, saved = 0;
  const server = http.createServer((request,response) => {
    if (request.url === '/capture') forwarded++;
    requests++; response.writeHead(307,{Location:'/capture'});response.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const handlers = new Map(), sender = Object.assign(new EventEmitter(),{id:17,isDestroyed:()=>false});
  require('../electron/ipc/ai').registerAiHandlers({ipcMain:{handle:(key,handler)=>handlers.set(key,handler)},app:{isPackaged:true},BrowserWindow:{getAllWindows:()=>[]},
    aiSettingsStore:{save:()=>{saved++;return{};},load:()=>({isAiEnabled:true,apiKey:'dummy-test-key',modelName:'test-model',endpointUrl:`http://127.0.0.1:${server.address().port}/v1`})},
    AI_CONFIG_FILE:settingsFile,AI_DIR:dir,AI_USAGE_DIR:path.join(dir,'usage'),AI_SOURCE_DIR:path.join(dir,'source'),AI_DEBUG_DIR:path.join(dir,'debug'),t:key=>key});
  const rejected = await handlers.get('save-ai-settings')({}, {isAiEnabled:true,endpointUrl:'http://external.example/v1'});
  assert.equal(rejected.success,false);assert.equal(saved,0);
  const answer = await handlers.get('ask-ai')({sender},'Fictional SQL',[],'query_builder','redirect-test');
  assert.equal(answer.success,false);assert.equal(requests,1);assert.equal(forwarded,0);
});

for (const file of ['ci.yml', 'integration.yml']) {
  const original = fs.readFileSync(path.join(__dirname, '../.github/workflows', file), 'utf8').replaceAll('\r\n', '\n');
  for (const [ending, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
    // Normalize line endings without relaxing the explicit security-policy layout.
    const workflow = original.replaceAll('\n', eol).replaceAll('\r\n', '\n');
    test(`${file} (${ending}): maintainer CI accepts only push and manual dispatch with read-only permissions`, () => {
      // Reject alternate trigger layouts rather than silently accepting an unchecked policy.
      const block = workflow.match(/^on:\n((?:[ \t].*\n|\n)*)/m)?.[1];
      assert.ok(block, 'The workflow must use an explicit event mapping.');
      const triggers = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]).sort();
      assert.deepEqual(triggers, ['push', 'workflow_dispatch']);
      assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
      assert.ok(!/\b(?:contents|packages|actions|id-token|pull-requests):\s*write\b/.test(workflow));
      assert.ok(!workflow.includes('self-hosted'));
    });
    test(`${file} (${ending}): external actions are pinned and checkout does not retain credentials`, () => {
      const actions = [...workflow.matchAll(/^\s+- uses: ([^\s#]+).*$/gm)];
      assert.ok(actions.length > 0);
      for (const [, action] of actions) assert.match(action, /^actions\/(?:checkout|setup-node)@[a-f0-9]{40}$/);
      const checkouts = [...workflow.matchAll(/^ {6}- uses: actions\/checkout@[^\n]+\n((?: {8}.*\n)*)/gm)];
      assert.ok(checkouts.length > 0);
      for (const checkout of checkouts) assert.match(checkout[1], /^ {10}persist-credentials: false$/m);
      assert.ok(!workflow.includes('${{ secrets.'));
    });
  }
}
test('Disposable CI database services use immutable image digests and update PR configuration stays absent', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/integration.yml'), 'utf8');
  const images = [...workflow.matchAll(/^ {8}image: (\S+)$/gm)].map(match => match[1]);
  assert.equal(images.length, 2);
  assert.match(images[0], /^postgres:16@sha256:[a-f0-9]{64}$/);
  assert.match(images[1], /^gvenzl\/oracle-free:23-slim-faststart@sha256:[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(__dirname, '../.github/dependabot.yml')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../.github/pull_request_template.md')), false);
});

test('Integration setup confines SYSDBA to the disposable service and keeps the Electron sandbox enabled', () => {
  const yaml = require('js-yaml');
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/integration.yml'), 'utf8'));
  const setup = workflow.jobs.oracle.steps.find(step => step.name?.startsWith('Prepare object-management'));
  assert.equal(setup.env.ORACLE_CONTAINER_ID, '${{ job.services.oracle.id }}');
  assert.match(setup.run, /docker exec --interactive "\$ORACLE_CONTAINER_ID" sqlplus -s '\/ as sysdba'/);
  assert.match(setup.run, /WHENEVER OSERROR EXIT FAILURE/);
  assert.match(setup.run, /WHENEVER SQLERROR EXIT FAILURE/);
  assert.match(setup.run, /ALTER SESSION SET CONTAINER = FREEPDB1;/);
  assert.match(setup.run, /GRANT SELECT ON SYS\.V_\$SESSION TO MONABASE_TEST;/);
  assert.ok(!/GRANT (?:DBA|SYSDBA|ALTER SYSTEM)\b/.test(setup.run));
  assert.ok(!setup.run.includes('password'));
  const steps = workflow.jobs['electron-ui'].steps;
  const sandboxIndex = steps.findIndex(step => step.name?.startsWith('Configure the Electron sandbox'));
  const uiIndex = steps.findIndex(step => step.run?.includes('xvfb-run'));
  assert.ok(sandboxIndex >= 0 && sandboxIndex < uiIndex);
  const sandbox = steps[sandboxIndex].run;
  assert.match(sandbox, /node -e "require\('electron'\)"/);
  assert.match(sandbox, /sudo chown root:root "\$sandbox"/);
  assert.match(sandbox, /sudo chmod 4755 "\$sandbox"/);
  assert.ok(!steps.some(step => /--no-sandbox|disable-setuid-sandbox/.test(step.run || '')));
});
