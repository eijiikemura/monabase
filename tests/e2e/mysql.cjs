// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-mysql-ui-'));
const real = process.env.MONABASE_MYSQL_DISPOSABLE === '1';
const development = process.env.MONABASE_MYSQL_UI_DEV === '1';
const devOrigin = process.env.MONABASE_MYSQL_UI_DEV_ORIGIN || 'http://localhost:5173';
if (development) { const url = new URL(devOrigin); assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !url.username && !url.password && url.origin === devOrigin, 'Development UI tests require a local HTTP origin.'); }
const features = process.env.MONABASE_MYSQL_UI_FEATURES === '1';
const databaseMode=process.env.MONABASE_MYSQL_UI_DATABASE==='1';let databaseSandbox;if(databaseMode&&(!real||features))throw new Error('Database UI mode requires a separate dedicated environment.');
const sshMode=process.env.MONABASE_MYSQL_UI_SSH==='1';if(sshMode&&!real)throw new Error('SSH UI requires the dedicated MySQL environment.');let sshTestServer;
if (features && !real) throw new Error('Git/AI UI fixtures require the disposable MySQL database.');
const importedObjects=[];let definitionFile='';
ipcMain.handle('open-sql-file',()=>definitionFile?{success:true,sql:definitionFile}:{success:true,canceled:true});
const aiCalls = []; let gitRoot, featureProcedure, featureChild, featureView, featureTrigger, featureFunction, clipboardText = '';
const sidebarFixtures = new Set(), builderViews = new Set();
let builderExport = '', crossTabExport = '';
ipcMain.handle('copy-to-clipboard', (_event, value) => { clipboardText = value; return true; });
const conversations = new Map();
app.disableHardwareAcceleration(); app.setPath('userData', path.join(temporary, 'profile'));
const config = { dbType: 'mysql', name: 'MySQL UI fixture', host: real ? '127.0.0.1 ' : '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test', readonly: false };
const settings = { language: 'en', theme: ['simple', 'mona', 'dark'].includes(process.env.MONABASE_MYSQL_UI_THEME) ? process.env.MONABASE_MYSQL_UI_THEME : 'simple', maxTabs: 20, sqlHistoryEnabled: true, sqlHistoryLimit: 100, outputDateFormat: 'YYYY/MM/DD HH:mm:ss', inputDateFormat: 'YYYY/MM/DD', timezone: '+09:00', numberFormat: 'comma', queryTimeout: 0 };
for (const [channel, result] of Object.entries({ 'get-connections': [config], 'load-settings': settings, 'save-connection': { success: true }, 'get-app-version': '1.0.2', 'git-status-check': { success: true, isRepo: false, repoPath: '/fixture/git', remoteUrl: null }, 'get-ai-settings': { success: true, isAiEnabled: features, endpointUrl: 'https://fixture.invalid/v1', modelName: 'fixture', apiKey: '' }, 'report-focus-state': {} })) { if (!(features && channel === 'git-status-check')) ipcMain.handle(channel, () => result); }
const history = [];
ipcMain.handle('get-sql-history', () => [...history]);
ipcMain.handle('add-sql-history', (_event, entry) => { if (settings.sqlHistoryEnabled) history.unshift({ id: String(history.length + 1), ...entry }); return [...history]; });
ipcMain.handle('clear-sql-history', () => { history.length = 0; return []; });
ipcMain.handle('inspect-sql-privacy', (_event, statements, dialect) => statements.map(sql => require('../../electron/services/sqlPrivacy').inspectSqlPrivacy(sql, dialect)));
let tuningExport = '';
ipcMain.handle('show-save-dialog', (_event, options) => ({ canceled: false, filePath: path.join(temporary, options.defaultPath === 'query-builder.json' ? 'query-builder.json' : String(options.defaultPath).startsWith('Crosstab_') ? 'Crosstab_test.json' : 'tuning_info.txt') }));
ipcMain.handle('save-file', (_event, file, content) => { assert.ok([path.join(temporary, 'tuning_info.txt'),path.join(temporary, 'query-builder.json'),path.join(temporary, 'Crosstab_test.json')].includes(file)); if (file.endsWith('query-builder.json')) builderExport = content; else if (file.endsWith('Crosstab_test.json')) crossTabExport = content; else tuningExport = content; return { success: true }; });
const state = {};
const calls = [];
let pending = false, tx = 'idle', completed = 0, pendingCancel;
const trackedIpc = { handle(channel, handler) { ipcMain.handle(channel, async (...args) => { const result = await handler(...args); if (channel === 'execute-sql' || channel === 'explain-sql') completed++; return result; }); } };
if (real) require('../../electron/ipc/database').registerDatabaseHandlers({ ipcMain: trackedIpc, state, getValidatedSettings: () => settings, t: key => key, createSshHostVerifier: options=>sshTestServer?sshTestServer.verify(options):()=>false });
else {
  ipcMain.handle('begin-sql-batch', () => ({ success: true }));
  ipcMain.handle('end-sql-batch', () => ({ success: true }));
  trackedIpc.handle('explain-sql', () => ({ success: true, rows: [{ PLAN_TABLE_OUTPUT: JSON.stringify({ query_block: { select_id: 1, message: 'No tables used' } }) }], metaData: [{ name: 'PLAN_TABLE_OUTPUT' }], executionTime: 1, transactionStatus: tx, hasUncommittedTx: pending }));
  for (const [channel, result] of Object.entries({ 'get-schemas': { success: true, schemas: ['mb_test','other_db'] }, 'get-db-info': { success: true, info: 'MySQL 8.4 UI fixture' } })) ipcMain.handle(channel, () => result);
  const self={user:'test',host:'localhost',id:JSON.stringify(['test','localhost']),plugin:null,locked:null,expired:null,protected:true,self:true,referencedRole:false,limits:{queries:0,updates:0,connections:0,concurrent:0}};
  const sessionRow={id:'1:1',connectionId:'1',threadId:null,fingerprint:'f',execution:null,user:'test',host:'localhost',database:'mb_test',command:'Sleep',seconds:'0',state:null,protected:true,canKill:false,canCancel:false,sqlText:null};
  const database={id:'mb_test',name:'mb_test',charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci'};
  ipcMain.handle('list-mysql-databases',()=>({success:true,snapshot:{databases:[database],scope:'visible',fetchedAt:new Date().toISOString()}}));
  ipcMain.handle('get-mysql-database-detail',()=>({success:true,detail:{database,objects:[{id:'orders',name:'orders',type:'TABLE',engine:'InnoDB',rows:'10',dataBytes:'65536',indexBytes:'0',parent:null}],scope:'visible',fetchedAt:new Date().toISOString()}}));
  const storage={id:'7',name:'mb_test/orders',type:'Single',rowFormat:'Dynamic',pageSize:'16384',blockSize:'4096',fileSize:'9007199254740993',allocatedSize:'65536',encryption:'N',state:'normal',files:[{id:'one',path:'./mb_test/orders.ibd',status:'NORMAL'}]};
  ipcMain.handle('list-mysql-tablespaces',()=>({success:true,snapshot:{tablespaces:[storage],fetchedAt:new Date().toISOString()}}));
  ipcMain.handle('get-mysql-tablespace-detail',()=>({success:true,detail:{tablespace:storage,tables:[{id:'9',name:'mb_test/orders',rowFormat:'Dynamic',columns:'4'}],fetchedAt:new Date().toISOString()}}));
  ipcMain.handle('list-mysql-locks',()=>({success:true,snapshot:{locks:[],fetchedAt:new Date().toISOString(),context:{server:'fixture',readonly:false,consistent:true,protectionReady:false,canManage:false}}}));
  ipcMain.handle('list-mysql-sessions',()=>({success:true,snapshot:{sessions:[sessionRow],fetchedAt:new Date().toISOString(),context:{scope:'visible',source:'processlist',readonly:false,canManage:false,protectionReady:false,eventsAvailable:false,server:'fixture'}}}));
  ipcMain.handle('get-mysql-session-detail',()=>({success:true,detail:{sessionId:sessionRow.id,fingerprint:'f',execution:null,statistics:[],statisticsAvailable:false,sqlText:null,previousSqlText:null,historyAvailable:false,fetchedAt:new Date().toISOString()}}));
  ipcMain.handle('list-mysql-accounts',()=>({success:true,snapshot:{accounts:[self],context:{server:'fixture',current:{user:self.user,host:self.host},scope:'self',readonly:false,canCreate:false,canGrant:false,canRole:false,canDrop:false,roles:'NONE'},fetchedAt:new Date().toISOString()}}));
  ipcMain.handle('get-mysql-account',()=>({success:true,detail:{target:self,grants:[],roles:[],recipients:[],grantSql:["GRANT USAGE ON *.* TO 'test'@'localhost'"],definers:[],dependenciesComplete:false,fingerprint:'self',databases:[],privileges:[],roleCandidates:[]}}));
  ipcMain.handle('connect-db',(_event,config)=>{assert.equal(config.dbType,'mysql');assert.equal(config.database,'mb_test');return {success:true};});
  ipcMain.handle('cancel-execution', () => { pendingCancel?.(); return { success: true }; });
  for (const channel of ['execute-sql', 'commit-db', 'rollback-db']) trackedIpc.handle(channel, (_event, sql) => {
    calls.push({ channel, sql });
    tx = channel === 'execute-sql' ? 'active' : 'idle';
    if (channel !== 'execute-sql') pending = false;
    else if (/^(INSERT|UPDATE|DELETE)/i.test(sql)) pending = true;
    if (sql === 'SELECT SLEEP(20)') return new Promise(resolve => { pendingCancel = () => { pendingCancel = null; resolve({ success: false, error: 'Execution cancelled', transactionStatus: tx, hasUncommittedTx: pending }); }; });
    return { success: true, rows: channel === 'execute-sql' ? [{ message: 'mysql-ui-ok' }] : [], metaData: [{ name: 'message', dbTypeName: 'VAR_STRING' }], executionTime: 1, transactionStatus: tx, hasUncommittedTx: pending, autocommit: false };
  });
}
ipcMain.handle('load-ai-debug-history',(_event,identity)=>({success:true,conversation:conversations.get('debug:'+JSON.stringify(identity))||null}));
ipcMain.handle('save-ai-debug-history',(_event,identity,conversation)=>{conversations.set('debug:'+JSON.stringify(identity),conversation);return {success:true};});
ipcMain.handle('load-ai-source-history', (_event, identity) => ({ success: true, conversation: conversations.get(JSON.stringify(identity)) || null }));
ipcMain.handle('save-ai-source-history', (_event, identity, conversation) => { conversations.set(JSON.stringify(identity), conversation); return { success: true }; });
ipcMain.handle('ask-ai', (_event, prompt, history, requestType) => {
  aiCalls.push({ prompt, history, requestType });
  if (requestType === 'query_builder') { const design = JSON.parse(builderExport); return { success: true, answer: JSON.stringify({ ...design, queryFields: design.queryFields.map(field => ({ ...field, groupBy: field.columnName === 'amount' ? 'SUM' : 'GROUP BY' })) }) }; }
  if (requestType === 'data_generator') return { success: true, answer: JSON.stringify({ schema: 'mb_test', table, generateCount: 3, rules: [{ COLUMN_NAME: 'id', ruleType: 'SEQ_NUM', seqStart: 100000, seqStep: 1 }, { COLUMN_NAME: 'label', ruleType: 'FIXED', fixedValue: 'Generated AI demo' }, { COLUMN_NAME: 'created_at', ruleType: 'FIXED', fixedValue: '2026-11-13 12:34:56' }] }) };
  if(requestType==='debug_function')return {success:true,answer:'Synthetic trace review: the recorded input is returned unchanged. No live AI request was made.'};
  if(featureFunction&&requestType==='coding_function')return {success:true,answer:JSON.stringify({status:'success',source:`CREATE FUNCTION mb_test.${featureFunction}(p_value INT) RETURNS INT DETERMINISTIC NO SQL RETURN p_value+2`,message:''})};
  if (featureTrigger && requestType === 'coding_trigger') return {success:true,answer:JSON.stringify({status:'success',source:`CREATE DEFINER=CURRENT_USER TRIGGER mb_test.${featureTrigger} BEFORE INSERT ON mb_test.${table} FOR EACH ROW BEGIN SET NEW.label=CONCAT('T2:',NEW.label); END`,message:''})};
  if (featureView && requestType === 'coding' && (prompt.includes(featureView) || JSON.stringify(history).includes(featureView))) return { success:true, answer:JSON.stringify({ status:'success', source:`CREATE OR REPLACE ALGORITHM=MERGE DEFINER=CURRENT_USER SQL SECURITY INVOKER VIEW mb_test.${featureView} AS SELECT id,label,created_at,'AI view edit' AS ai_note FROM mb_test.${table}`, message:'' }) };
  return { success: true, answer: JSON.stringify({ status: 'success', source: requestType === 'coding_procedure' ? 'CREATE PROCEDURE mb_test.' + featureProcedure + '(IN p INT) SELECT p+2' : 'SELECT 42 AS answer', message: '' }) };
});
let win;
const errors = [];
const timer = setTimeout(() => { console.error('MySQL UI test timed out.'); app.exit(1); }, features ? 120000 : 90000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = async source => { try { return await Promise.race([win.webContents.executeJavaScript(source, true), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('UI expression timed out.')), 10000))]); } catch { throw new Error('MySQL UI expression failed: ' + source + '\nRenderer errors: ' + errors.join('\n')); } };
async function wait(source) { for (let i = 0; i < 300; i++) { if (await js(source)) return; await pause(50); } throw new Error('MySQL UI condition timed out: ' + source + '\nDialog: ' + await js("document.querySelector('[role=dialog]')?.innerText || 'none'") + '\nTable: ' + await js("document.querySelector('[data-testid=mysql-table-window]')?.innerText || 'none'") + '\nView: ' + await js("document.querySelector('[data-testid=mysql-view-window]')?.innerText || 'none'") + '\nUI: ' + await js("document.body.innerText.slice(-2500)")); }
async function click(text) {
  await js(`(()=>{ const b=[...document.querySelectorAll('button')].find(b=>b.getBoundingClientRect().width>0&&(b.textContent.trim()===${JSON.stringify(text)} || (${JSON.stringify(text)}==='Execute' && ['Execute SQL','Analyze SQL execution plan'].includes(b.getAttribute('aria-label')))));if(!b)throw new Error('Missing MySQL button');b.click();return true;})()`);
}
async function enterSql(text) {
  await js(`(()=>{ const e=[...document.querySelectorAll('.cm-content')].find(e=>e.getBoundingClientRect().width>0); e.focus(); e.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));return true;})()`);
  await win.webContents.insertText(text);
  await wait(`Array.from(document.querySelectorAll('.cm-content')).some(e=>e.textContent===${JSON.stringify(text)}||[...e.querySelectorAll('.cm-line')].map(line=>line.textContent).join(String.fromCharCode(10))===${JSON.stringify(text)})`);
}
async function runSql(text, expected, statements = 1) { const before = completed; await enterSql(text); await click('Execute'); for (let i = 0; completed < before + statements && i < 400; i++) await pause(50); assert.equal(completed, before + statements, await js("document.body.innerText.slice(-1800)")); await wait(`document.body.textContent.includes(${JSON.stringify(expected)}) && ![...document.querySelectorAll('button')].find(b=>['Execute SQL','Analyze SQL execution plan'].includes(b.getAttribute('aria-label'))&&b.getBoundingClientRect().width>0).disabled`); }
async function resizeSplit(selector) {
  await wait(`!!document.querySelector(${JSON.stringify(selector)})?.querySelector('[role=separator][aria-orientation=horizontal]')`);
  const before = await js(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});const bar=root.querySelector('[role=separator][aria-orientation=horizontal]');const rect=bar.getBoundingClientRect();return {y:rect.y+rect.height/2,x:rect.x+rect.width/2,upper:root.querySelector('[data-split-upper]').getBoundingClientRect().height,lower:root.querySelector('[data-split-lower]').getBoundingClientRect().height,min:Number(bar.getAttribute('aria-valuemin')),max:Number(bar.getAttribute('aria-valuemax'))}})()`);
  // Test a direction with actual available space on the current screen/font metrics.
  const roomDown = before.max - before.upper, roomUp = before.upper - before.min;
  const delta = roomDown >= 45 ? 45 : roomUp >= 45 ? -45 : roomDown > roomUp ? roomDown : -roomUp;
  assert.ok(Math.abs(delta) >= 20, 'The split fixture needs room for a meaningful drag.');
  const completedBefore = completed;
  await js(`document.querySelector(${JSON.stringify(selector)}).querySelector('[role=separator][aria-orientation=horizontal]').dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true,clientX:${before.x},clientY:${before.y}}));true`);
  await wait(`document.querySelector(${JSON.stringify(selector)}).querySelector('[role=separator][aria-orientation=horizontal]').getAttribute('data-resizing')==='true'`);
  await js(`window.dispatchEvent(new MouseEvent('mousemove',{clientY:${before.y + delta},clientX:${before.x},bubbles:true}));true`);
  await wait(`Math.abs(document.querySelector(${JSON.stringify(selector)}).querySelector('[data-split-upper]').getBoundingClientRect().height-${before.upper + delta})<3`);
  await js("window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));true");
  await wait(`document.querySelector(${JSON.stringify(selector)}).querySelector('[role=separator][aria-orientation=horizontal]').getAttribute('data-resizing')==='false'`);
  const after = await js(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});return {upper:root.querySelector('[data-split-upper]').getBoundingClientRect().height,lower:root.querySelector('[data-split-lower]').getBoundingClientRect().height}})()`);
  assert.ok((after.lower - before.lower) * Math.sign(delta) < -15);
  await js(`document.querySelector(${JSON.stringify(selector)}).querySelector('[role=separator][aria-orientation=horizontal]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(delta > 0 ? 'ArrowUp' : 'ArrowDown')},bubbles:true,cancelable:true}));true`);
  await wait(`(document.querySelector(${JSON.stringify(selector)}).querySelector('[data-split-upper]').getBoundingClientRect().height-${after.upper})*${Math.sign(delta)} < -10`);
  assert.equal(completed, completedBefore, 'Resizing must not execute SQL.');
  return js(`document.querySelector(${JSON.stringify(selector)}).querySelector('[data-split-upper]').getBoundingClientRect().height`);
}
async function selectSidebarTable(name) {
  await js("(()=>{const e=document.querySelector('[data-mysql-table-category=mb_test]');if(e.getAttribute('aria-expanded')==='false')e.click();return true})()");
  await wait("!!document.querySelector('aside input')");
  await js(`(()=>{const e=document.querySelector('aside input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await wait(`!!document.querySelector('[data-mysql-table="${name}"]')`);
}
async function tableContext(name, text) {
  await selectSidebarTable(name);
  await js(`document.querySelector('[data-mysql-table="${name}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:170,clientY:320}));true`);
  await wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getAttribute('aria-disabled')!=='true')`);
  await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click();true`);
}
const table = 'MBT_' + randomBytes(6).toString('hex');
let created = false;
app.whenReady().then(async () => {
  try {
    if(databaseMode){databaseSandbox=await require('../helpers/mysqlDatabaseSandbox.cjs').startDatabaseSandbox();Object.assign(config,databaseSandbox.connection);}
    if(sshMode){sshTestServer=await require('../helpers/mysqlSsh.cjs').sshFixture({forward:true});Object.assign(config,sshTestServer.config,{host:'localhost',mysqlSslMode:'verify-full',mysqlSslCaFile:path.join(root,'local/mysql-test-tls/ca.pem')});}
    if (features) {
      const base = path.join(root, 'git/MonaBase/.test-runs'); fs.mkdirSync(base, { recursive: true });
      gitRoot = fs.mkdtempSync(path.join(base, 'mysql-ui-'));
      const git = require('simple-git').simpleGit(gitRoot);
      await git.init(); await git.addConfig('user.name', 'MonaBase UI test'); await git.addConfig('user.email', 'test@example.invalid');
      require('../../electron/ipc/er').registerErHandlers({ ipcMain, gitDirectory: gitRoot, t: key => require('../../src/locales/en.json')[key] || key });
      require('../../electron/ipc/git').registerGitHandlers({ ipcMain, gitDirectory: gitRoot, t: key => require('../../src/locales/en.json')[key] || key });
    }
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    win.webContents.on('preload-error', (_event, _file, error) => errors.push(error.message));
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (request, done) => done({ cancel: /^https?:/.test(request.url) && !(development && new URL(request.url).origin === devOrigin) }));
    if (development) await win.loadURL(devOrigin);
    else await win.loadFile(path.join(root, 'dist/index.html'));
    if (features) {
      const words = require('../../src/locales/en.json');
      await js(`(()=>{ const allowed=${JSON.stringify([words.confirm_close_ai_and_save, words.confirm_close_ai_and_reset])};window.confirm=message=>allowed.includes(message);return true;})()`);
    }
    await wait("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Connect')");
    await wait(`[...document.querySelectorAll('input')].some(e=>e.value===${JSON.stringify(config.name)})&&[...document.querySelectorAll('[role=combobox]')].some(e=>e.textContent.includes('MySQL 8.4'))`);
    {const words=require('../../src/locales/en.json');
    await js(`(()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent===${JSON.stringify(words.ssh_tunnel)});if(!tab||tab.getAttribute('aria-disabled')==='true')throw new Error('SSH tab unavailable');tab.click();return true})()`);
    await wait(`[...document.querySelectorAll('label')].some(e=>e.textContent.includes(${JSON.stringify(words.use_ssh_tunnel_port_forwarding)}))`);
    if(sshMode)assert.equal(await js("document.querySelector('input[type=checkbox]').checked"),true);
    await js("document.querySelector('[role=tab]').click();true");}
    await click('Connect');
    await wait("!!document.querySelector('.cm-content') || document.body.textContent.includes('The database workspace could not be opened')");
    if (await js("document.body.textContent.includes('The database workspace could not be opened')")) throw new Error('MySQL workspace render failed: ' + errors.join('\n'));
    assert.ok(await js("document.querySelector('[data-testid=connection-badge]').textContent.includes('MySQL')"));
    assert.equal(await js("!!document.querySelector('[data-testid=mysql-sql-window] [role=combobox]')"),false);
    if(!real)assert.ok(await js("document.querySelector('aside').textContent.includes('other_db')"));
    if(databaseMode){
      const words=require('../../src/locales/en.json'),name='MBT_'+randomBytes(6).toString('hex');
      await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.mysql_database_title)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-database-tab]')");
      await click(words.mysql_database_create);await wait("!!document.querySelector('[data-testid=mysql-database-editor]')");
      await js(`(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent===${JSON.stringify(words.database)});const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await wait(`[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent===${JSON.stringify(words.mysql_database_review)}&&!e.disabled)`);await click(words.mysql_database_review);await wait("!!document.querySelector('[role=dialog] pre')");assert.ok(await js("document.querySelector('[role=dialog] pre').textContent.includes('CREATE DATABASE')"));await click(words.execute);await wait("!document.querySelector('[data-testid=mysql-database-editor]')");
      await wait(`document.querySelector('aside').textContent.includes(${JSON.stringify(name)})`);await wait(`[...document.querySelectorAll('[data-testid=mysql-database-tab] [data-field=name]')].some(e=>e.textContent===${JSON.stringify(name)})`);await js(`[...document.querySelectorAll('[data-testid=mysql-database-tab] [data-field=name]')].find(e=>e.textContent===${JSON.stringify(name)}).click();true`);
      await wait(`[...document.querySelectorAll('[data-testid=mysql-database-tab] button')].some(e=>e.textContent===${JSON.stringify(words.mysql_database_alter)}&&!e.disabled)`);await click(words.mysql_database_alter);await wait("!!document.querySelector('[data-testid=mysql-database-editor]')");
      await js(`(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent===${JSON.stringify(words.mysql_database_collation)});document.getElementById(label.htmlFor).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`);await wait("!!document.querySelector('[role=option][data-value=utf8mb4_bin]')");await js("document.querySelector('[role=option][data-value=utf8mb4_bin]').click();true");await click(words.mysql_database_review);await wait("document.querySelector('[role=dialog] pre')?.textContent.includes('utf8mb4_bin')");await click(words.execute);await wait("!document.querySelector('[data-testid=mysql-database-editor]')");
      const changed=await state.client.execute('SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:name',{name},null,false,true);assert.equal(changed.rows[0].DEFAULT_COLLATION_NAME,'utf8mb4_bin');assert.equal(state.client.getMainTransactionState(),false);assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL isolated database create, reviewed defaults change, live schema/sidebar refresh and idle transaction UI passed.');return;
    }
    if(real){
      await state.client.execute('SELECT DATABASE() AS current_db',{},'information_schema');
      await runSql('SELECT DATABASE() AS current_db','mb_test');
      assert.equal((await state.client.execute('SELECT DATABASE() AS current_db')).rows[0].current_db,'mb_test');
    }

    await wait("!!document.querySelector('aside') && !!document.querySelector('header')");
    const placement = await js("(()=>{const header=document.querySelector('header');const commit=header.querySelector('button[aria-label=Commit]');const rollback=header.querySelector('button[aria-label=Rollback]');return {commit:commit.getBoundingClientRect().x,rollback:rollback.getBoundingClientRect().x,badge:header.querySelector('[data-testid=connection-badge]').getBoundingClientRect().x,view:[...header.querySelectorAll('button')].find(b=>b.textContent==='View').getBoundingClientRect().x}})()");
    assert.equal(await js("[...document.querySelectorAll('aside [role=button]')].some(e=>e.textContent.trim()==='SQL Window')"), false);
    assert.ok(placement.view < placement.commit && placement.commit < placement.rollback && placement.rollback < placement.badge);
    await js("document.querySelector('aside button[aria-label=Collapse]').click();true");
    await wait("Math.round(document.querySelector('aside').getBoundingClientRect().width)===56");
    await js("document.querySelector('aside button[aria-label=Expand]').click();true");
    await wait("!!document.querySelector('[role=separator][aria-orientation=vertical]')");
    const beforeWidth = await js("Number(document.querySelector('[role=separator]').getAttribute('aria-valuenow'))");
    await js("document.querySelector('[role=separator]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));true");
    await wait(`Number(document.querySelector('[role=separator]').getAttribute('aria-valuenow'))>${beforeWidth}`);
    await resizeSplit('[data-testid=mysql-sql-window]');
    {const words=require('../../src/locales/en.json');
    await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.mysql_storage_title)}).click();true`);
    await wait("!!document.querySelector('[data-testid=mysql-tablespace-tab]')");
    if(real){await wait(`document.querySelector('[data-testid=mysql-tablespace-tab]').textContent.includes(${JSON.stringify(words.mysql_storage_privilege_required)})`);}
    else{await wait("!!document.querySelector('[data-testid=mysql-tablespace-tab] .MuiDataGrid-cell[data-field=name]')");await js("document.querySelector('[data-testid=mysql-tablespace-tab] .MuiDataGrid-cell[data-field=name]').closest('[role=row]').click();true");await wait("document.querySelector('[data-testid=mysql-tablespace-tab]').textContent.includes('./mb_test/orders.ibd')");await js(`[...document.querySelectorAll('[data-testid=mysql-tablespace-tab] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.mysql_storage_tables)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-tablespace-tab] .MuiDataGrid-cell[data-field=name]')");}
    const storageBar='[data-testid=mysql-tablespace-tab] [role=separator]';
    const storageRatio=await js(`Number(document.querySelector('${storageBar}').getAttribute('aria-valuenow'))`);
    await js(`document.querySelector('${storageBar}').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));true`);
    await wait(`Number(document.querySelector('${storageBar}').getAttribute('aria-valuenow'))>${storageRatio}`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:${process.platform==='darwin'},ctrlKey:${process.platform!=='darwin'},bubbles:true,cancelable:true}));true`);await wait("!document.querySelector('[data-testid=mysql-tablespace-tab]')");
    console.log('MySQL storage menu, exact metadata or explicit catalog denial, details and split passed.');}
    {const words=require('../../src/locales/en.json'),before=real?state.client.getTransactionDetails():null;
    await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.mysql_database_title)}).click();true`);
    const panel='[data-testid=mysql-database-tab]';await wait(`[...document.querySelectorAll('${panel} .MuiDataGrid-cell[data-field=name]')].some(e=>e.textContent==='mb_test')`);
    await js(`[...document.querySelectorAll('${panel} .MuiDataGrid-cell[data-field=name]')].find(e=>e.textContent==='mb_test').closest('[role=row]').click();true`);
    await wait(`document.querySelector('${panel}').textContent.includes(${JSON.stringify(words.mysql_database_estimated_rows)})`);
    await wait(`document.querySelector('${panel}').textContent.includes('mb_test')&&!document.querySelector('${panel} .MuiDataGrid-overlay .MuiCircularProgress-root')`);
    if(real)assert.deepEqual(state.client.getTransactionDetails(),before);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:${process.platform==='darwin'},ctrlKey:${process.platform!=='darwin'},bubbles:true,cancelable:true}));true`);await wait("!document.querySelector('[data-testid=mysql-database-tab]')");
    console.log('MySQL database information menu, visible DB settings and read-only object list passed.');}


    await runSql("SELECT 'mysql-ui-ok' message", 'mysql-ui-ok');
    if(features){
      await enterSql("SELECT '");
      assert.equal(await js("!!document.querySelector('[data-testid=mysql-sql-window]')"),true);
      const sql='SELECT :amount AS amount, :when AS date_value, :empty AS empty_text, (:none IS NULL) AS null_test';
      await enterSql(sql);await js("document.querySelector('[data-testid=mysql-sql-window] button[aria-expanded]').click();true");
      await wait("document.querySelectorAll('[data-testid=mysql-bind-panel] input[data-mysql-bind]').length===4");
      const bindRow=name=>`[...document.querySelectorAll('[data-testid=mysql-bind-panel] p')].find(e=>e.textContent===${JSON.stringify(':'+name)}).parentElement`;
      const setInput=async(selector,value)=>js(`(()=>{const e=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      const type=async(name,value)=>{await js(`(${bindRow(name)}).querySelector('[role=combobox]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);await wait(`!!document.querySelector('[role=option][data-value=${value}]')`);await js(`document.querySelector('[role=option][data-value=${value}]').click();true`);await wait(`(${bindRow(name)}).querySelector('.MuiSelect-nativeInput').value===${JSON.stringify(value)}&&!document.querySelector('[role=listbox]')`);};
      await type('AMOUNT','NUMBER');await setInput("document.querySelector('[data-mysql-bind=AMOUNT]')",'9007199254740993.125');
      await type('WHEN','DATE');await wait("!!document.querySelector('[data-testid=mysql-bind-panel] input[type=date]')");await setInput(`(${bindRow('WHEN')}).querySelector('input[placeholder]')`,'2026/11/15');
      await js(`(${bindRow('NONE')}).querySelector('input[type=checkbox]').click();true`);
      await js("document.querySelector('[data-testid=mysql-bind-panel]').parentElement.querySelector('button[aria-label=Close]').click();true");
      await wait("!document.querySelector('[data-testid=mysql-bind-panel]')");await runSql(sql,'SELECT');
      await wait("document.querySelector('.MuiDataGrid-cell[data-field=amount]')?.textContent.replaceAll(',','')==='9007199254740993.125'");
      assert.ok(await js("document.querySelector('.MuiDataGrid-cell[data-field=date_value]').textContent.includes('2026/11/15')"));
      assert.equal(await js("document.querySelector('.MuiDataGrid-cell[data-field=empty_text]').textContent"),'');
      assert.equal(await js("document.querySelector('.MuiDataGrid-cell[data-field=null_test]').textContent"),'1');
      console.log('MySQL detected typed binds: exact decimal, configured date format, empty string and explicit NULL passed.');
      await enterSql('SELECT 1;\n\nSELECT 2\nFROM\nWHERE broken;');await click('Execute');
      await wait("[...document.querySelectorAll('[data-testid=sql-log-error-line]')].some(e=>e.textContent.startsWith('[ERROR] Line 5:'))");
      await js(`(()=>{const e=document.querySelector('[data-testid=mysql-sql-window] .cm-content');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(process.platform==='darwin'?'ArrowUp':'Home')},metaKey:${process.platform==='darwin'},ctrlKey:${process.platform!=='darwin'},bubbles:true,cancelable:true}));return true})()`);
      await wait("document.querySelector('[data-testid=mysql-sql-window] .cm-activeLineGutter')?.textContent==='1'");
      await js("[...document.querySelectorAll('[data-testid=sql-log-error-line]')].find(e=>e.textContent.startsWith('[ERROR] Line 5:')).click();true");
      await wait("!!document.querySelector('[data-testid=mysql-sql-window] .cm-activeLineGutter')&&document.querySelector('[data-testid=mysql-sql-window] .cm-activeLineGutter').textContent==='5'");
      await wait("!!document.querySelector('[data-testid=mysql-sql-window] .cm-lintRange-error')");
      await enterSql('SELECT 7');await wait("!document.querySelector('[data-testid=mysql-sql-window] .cm-lintRange-error')");
      console.log('MySQL real multiline parser error maps to line 5, log click selects it, and editing clears stale lint passed.');

    }
    const transactionButtons = async pending => {
      await wait(`['Commit','Rollback'].every(action=>{const button=document.querySelector('button[aria-label="'+action+'"]');return button && !button.disabled && (getComputedStyle(button).animationName!=='none')===${pending} && button.classList.contains('MuiButton-contained')===${pending}})`);
      assert.equal(await js("!!document.querySelector('header .MuiChip-root[role=status]')"), false);
    };
    await transactionButtons(false);
    if (real) {
      if (features) console.log('MySQL UI fixture table:', table);
      await runSql(`CREATE TABLE ${table}(id INT PRIMARY KEY, label VARCHAR(60)) ENGINE=InnoDB`, 'CREATE'); created = true;
      await runSql(`SELECT * FROM ${table}`, 'SELECT'); await transactionButtons(false);
      await runSql(`INSERT INTO ${table} VALUES(1,'uncommitted')`, 'INSERT');
      await transactionButtons(true);
      await runSql(`SELECT * FROM ${table}`, 'uncommitted'); await transactionButtons(true);
      await click('Rollback'); await transactionButtons(false);
      await runSql(`SELECT COUNT(*) n FROM ${table}`, 'SELECT');
      await wait("!!document.querySelector('.MuiDataGrid-cell[data-field=n]')");
      assert.equal(await js("document.querySelector('.MuiDataGrid-cell[data-field=n]').textContent"), '0');
      await runSql(`INSERT INTO ${table} VALUES(2,'committed')`, 'INSERT');
      await click('Commit'); await transactionButtons(false);
      await runSql(`SELECT label FROM ${table}`, 'committed'); await transactionButtons(false);
      await runSql(`SELECT 1 n; SELECT label FROM ${table}`, 'committed', 2);
    } else {
      await runSql('INSERT INTO fixture VALUES(1)', 'INSERT');
      await transactionButtons(true);
      win.webContents.debugger.attach('1.3');
      try {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await wait(`['Commit','Rollback'].every(action=>{const b=document.querySelector('button[aria-label="'+action+'"]');return getComputedStyle(b).animationName==='none' && b.classList.contains('MuiButton-contained')})`);
      } finally {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        win.webContents.debugger.detach();
      }
      await transactionButtons(true);
      await click('Commit'); await transactionButtons(false);
      assert.ok(calls.some(call => call.channel === 'commit-db'));
      await click('Rollback'); assert.ok(calls.some(call => call.channel === 'rollback-db'));
    }
    // History, JSON plan tree, and both integrated/offline tuning entry points.
    console.log('MySQL SQL UI: history and estimated plan/tuning.');
    await js("[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent==='Execution History').click();true");
    await wait("!!document.querySelector('.MuiDataGrid-cell[data-field=sql]')");
    const recalled = await js("document.querySelector('.MuiDataGrid-cell[data-field=sql]').textContent");
    await js("document.querySelector('.MuiDataGrid-cell[data-field=sql]').closest('[role=row]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true");
    await wait(`[...document.querySelectorAll('.cm-content')].some(e=>e.getBoundingClientRect().width>0&&e.textContent===${JSON.stringify(recalled)})`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
    await wait("[...document.querySelectorAll('main [role=tab]')].filter(e=>/^SQL \\d+$/.test(e.textContent.trim())).length===1");
    await js("[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent==='Result').click();true");
    await js("[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Parse').click();true");
    await runSql(real ? `SELECT label FROM ${table} WHERE id=2` : 'SELECT 7', 'MySQL execution plan');
    assert.equal(aiCalls.length, 0);
    await js("document.querySelector('[data-testid=sql-result-toolbar] button[aria-label=\"Ask AI for SQL Tuning\"]').click();true");
    if (features) {
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]') && document.querySelector('textarea[placeholder^=\"Enter an AI request\"]').value.includes('MySQL 8.4')");
      await click('Preview request'); await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('[Estimated execution plan]')"));
      assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('CREATE TABLE')"));
      assert.equal(aiCalls.length, 0, 'Opening a tuning preview must not send a request.');
      const beforeModalShortcut = completed;
      await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'F5',bubbles:true,cancelable:true}));true");
      assert.equal(completed, beforeModalShortcut, 'F5 must not execute SQL behind the AI request dialog.');
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Close').click();true");
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      await wait("!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')");
    } else {
      for (let index = 0; !tuningExport && index < 200; index++) await pause(20);
      assert.match(tuningExport, /MySQL 8.4/); assert.match(tuningExport, /Estimated execution plan/);
      assert.ok(tuningExport.includes(real ? table : 'SELECT 7'));
    }
    await js("[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='Parse').click();true");
    // Cancellation is available on the Oracle-style global indicator.
    const beforeCancel = completed;
    await enterSql("SELECT SLEEP(20); SELECT 'must-not-run-after-cancellation'"); await click('Execute');
    await wait("!!document.querySelector('[data-testid=global-loader] button')");
    for (let i = 0; i < 200 && !(real ? state.client.active : pendingCancel); i++) await pause(10);
    assert.ok(real ? state.client.active : pendingCancel);
    await click('Abort Process');
    for (let i = 0; i < 200 && completed === beforeCancel; i++) await pause(20);
    assert.equal(completed, beforeCancel + 1);
    await wait("!document.querySelector('button[aria-label=Commit]').disabled");
    await runSql(real ? `SELECT label FROM ${table}` : "SELECT 'mysql-ui-ok' message", real ? 'committed' : 'mysql-ui-ok');
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
    await wait("[...document.querySelectorAll('main [role=tab]')].filter(e=>/^SQL \\d+$/.test(e.textContent.trim())).length===2");
    await js("document.querySelectorAll('[role=tab]')[0].click();true");
    await wait("[...document.querySelectorAll('[role=tabpanel]')].filter(e=>!e.hidden).some(e=>!!e.querySelector('.MuiDataGrid-root'))");
    await wait(`document.body.textContent.includes(${JSON.stringify(real ? 'committed' : 'mysql-ui-ok')})`);
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(errors.length, 0, errors.join('\n'));
    if (features) {
      console.log('MySQL UI: starting AI SQL checks.');
      // Open SQL generation, preview exactly what is sent, then explicitly adopt.
      await js("[...document.querySelectorAll('button[aria-label=\"Ask AI\"]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      console.log('MySQL UI: AI sidebar requested.');
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')");
      console.log('MySQL UI: AI input ready.');
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Return the integer 42 as answer.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await wait("[...document.querySelectorAll('button')].some(e=>e.textContent==='Preview request'&&!e.disabled)");
      console.log('MySQL UI: opening SQL send preview.');
      await click('Preview request'); await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.ok(await js("[...document.querySelectorAll('[role=dialog] textarea')].some(e=>e.value.includes('mysql')&&e.value.includes('MySQL 8.4'))"));
      assert.equal(aiCalls.length, 0);
      console.log('MySQL UI: SQL send preview passed.');
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");
      await wait("document.body.textContent.includes('Review AI changes')");
      assert.equal(aiCalls.length, 1);
      console.log('MySQL UI: SQL review ready.');
      await js("(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent==='Change summary');const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Return the requested integer');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Apply to editor'&&!e.disabled)");
      await click('Apply to editor');
      await wait("[...document.querySelectorAll('.cm-content')].some(e=>e.getBoundingClientRect().width>0&&e.textContent==='SELECT 42 AS answer')");
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      await runSql('SELECT 42 AS answer', '42');
      console.log('MySQL UI: AI SQL adoption passed.');
      // Open the native procedure tree and exercise saved execution, source and Git.
      featureProcedure = table + '_proc';
      await state.client.main.promise().query(`CREATE PROCEDURE ${featureProcedure}(IN p INT) SELECT p+1`);
      await js("document.querySelector('[data-mysql-procedure-category=mb_test]').click();true");
      await wait(`!!document.querySelector('[data-mysql-procedure="${featureProcedure}"]')`);
      await js(`document.querySelector('[data-mysql-procedure="${featureProcedure}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await wait("!!document.querySelector('[data-testid=mysql-procedure-window] input[data-mysql-argument=p]')");
      await js("(()=>{const e=document.querySelector('[data-mysql-argument=p]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'5');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await js("[...document.querySelectorAll('[data-testid=mysql-procedure-window] button')].find(e=>e.textContent==='Execute'&&!e.disabled).click();true");
      await wait("[...document.querySelectorAll('[data-testid=mysql-procedure-window] .MuiDataGrid-cell')].some(e=>e.textContent==='6')");
      await resizeSplit('[data-testid=mysql-split-procedure]');
      await js("[...document.querySelectorAll('[data-testid=mysql-procedure-window] [role=tab]')].find(e=>e.textContent==='Information').click();true");
      await wait("document.querySelector('[data-testid=mysql-procedure-window]')?.textContent.includes('SQL SECURITY')");
      await js("[...document.querySelectorAll('[data-testid=mysql-procedure-window] [role=tab]')].find(e=>e.textContent==='Version Control').click();true");
      await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Git Commit'&&!e.disabled)");
      await click('Git Commit'); await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Record')");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Record').click();true");
      await wait("!document.querySelector('[role=dialog]')");
      const git = require('simple-git').simpleGit(gitRoot);
      assert.equal((await git.log()).total, 1);
      console.log('MySQL UI: native source Git commit passed.');
      assert.ok((await git.raw(['ls-tree','--name-only','-r','HEAD'])).includes('MonaBase/MYSQL/mb_test/PROCEDURE/'));
      await js("[...document.querySelectorAll('main [role=tab]')].find(e=>e.textContent==='Source').click();true");
      await js("[...document.querySelectorAll('button[aria-label=\"Ask AI\"]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')&&!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]').disabled");
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Return p plus two instead of plus one, keeping the procedure identity.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await wait("[...document.querySelectorAll('button')].some(e=>e.textContent==='Preview request'&&!e.disabled)");
      await click('Preview request');
      await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.ok(await js(`document.querySelector('[role=dialog] textarea').value.includes(${JSON.stringify(featureProcedure)})`));
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");
      await wait("document.body.textContent.includes('Review AI changes')");
      await js("(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent==='Change summary');const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Add two in the MySQL draft');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Apply to editor'&&!e.disabled)");
      await click('Apply to editor');
      await wait("[...document.querySelectorAll('.cm-content')].some(e=>e.getBoundingClientRect().width>0&&e.textContent.includes('SELECT p+2'))");
      const native = await state.client.execute(`SHOW CREATE PROCEDURE ${featureProcedure}`, {}, null, false, true);
      assert.ok(native.rows[0]['Create Procedure'].includes('SELECT p+1'));
      console.log('MySQL UI: source draft adoption passed.');
      assert.equal(aiCalls.length, 2); assert.equal(aiCalls[1].requestType, 'coding_procedure');
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      await js("[...document.querySelectorAll('[data-testid=mysql-procedure-window] button')].find(e=>e.textContent==='Compile'&&!e.disabled).click();true");
      await wait("!!document.querySelector('[role=dialog] input')");
      await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureProcedure)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("!document.querySelector('[role=dialog]')");
      assert.ok((await state.client.getProcedure({schema:'mb_test',name:featureProcedure})).source.includes('SELECT p+2'));
      await js("[...document.querySelectorAll('[data-testid=mysql-procedure-window] [role=tab]')].find(e=>e.textContent==='Version Control').click();true");
      await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Git Commit'&&!e.disabled)");
      assert.equal((await git.log()).total, 2);
      console.log('MySQL UI: adopted source Git commit passed.');
      await js("[...document.querySelectorAll('main [role=tab]')].find(e=>e.textContent==='Version History').click();true");
      await wait("[...document.querySelectorAll('main .MuiDataGrid-row')].filter(e=>e.getBoundingClientRect().width>0).length===2");
      await js("[...document.querySelectorAll('main [role=tab]')].find(e=>e.textContent.trim()==='SQL 1').click();true");
      await wait("[...document.querySelectorAll('.cm-content')].some(e=>e.getBoundingClientRect().width>0&&e.textContent==='SELECT 42 AS answer')");
      await js(`[...document.querySelectorAll('main [role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(featureProcedure)}).click();true`);
      await wait("[...document.querySelectorAll('main .MuiDataGrid-row')].filter(e=>e.getBoundingClientRect().width>0).length===2");
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(errors.length, 0, errors.join('\n'));
      // Open the native table window and exercise edits through the real UI and main transaction.
      console.log('MySQL UI: checking table tabs, native edits and transaction refresh.');
      featureChild = table + '_child';
      await state.client.main.promise().query(`CREATE TABLE ${featureChild}(id INT PRIMARY KEY, parent_id INT, FOREIGN KEY(parent_id) REFERENCES ${table}(id)) ENGINE=InnoDB`);
      await selectSidebarTable(table);
      await js(`document.querySelector('[data-mysql-table="${table}"]').click();true`);
      assert.equal(await js("!!document.querySelector('[data-testid=mysql-table-window]')"), false);
      await js(`document.querySelector('[data-mysql-table="${table}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await wait("!!document.querySelector('[data-testid=mysql-table-window]') && document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]')?.textContent==='committed' && !document.querySelector('button[aria-label=Commit]').disabled");
      await resizeSplit('[data-testid=mysql-split-data]');
      console.log('MySQL UI: checking Oracle-style result header sorting and applied filter markers.');
      const headerWords = require('../../src/locales/en.json');
      await state.client.execute(`INSERT INTO ${table} VALUES(1,'another')`);
      await js("document.querySelector('[data-testid=mysql-table-data] button[aria-label=Refresh]').click();true");
      await wait("document.querySelectorAll('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=id]').length===2 && !document.querySelector('button[aria-label=Commit]').disabled");
      const resultIds = "JSON.stringify([...document.querySelectorAll('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=id]')].map(e=>e.textContent))";
      const headerClick = async field => { await js(`document.querySelector('[data-testid=mysql-table-data] [role=columnheader][data-field=${field}]').click();true`); };
      await headerClick('id');
      await wait(`${resultIds}==='["1","2"]' && !document.querySelector('button[aria-label=Commit]').disabled`);
      await headerClick('id');
      await wait(`${resultIds}==='["2","1"]' && !document.querySelector('button[aria-label=Commit]').disabled`);
      await headerClick('label');
      await wait(`${resultIds}==='["1","2"]' && !document.querySelector('button[aria-label=Commit]').disabled`);
      const filterMarker = `[data-testid=mysql-table-data] [role=columnheader][data-field=label] [aria-label="${headerWords.filter_applied}"]`;
      const setFilter = async value => { await js(`(()=>{const input=document.querySelector('[data-testid=mysql-table-data] [title=label]').parentElement.querySelector('input[placeholder]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); };
      await setFilter('committed');
      assert.equal(await js(`!!document.querySelector(${JSON.stringify(filterMarker)})`), false);
      await js("[...document.querySelectorAll('[data-testid=mysql-table-data] button')].find(e=>e.textContent==='Execute').click();true");
      await wait(`!!document.querySelector(${JSON.stringify(filterMarker)}) && ${resultIds}==='["2"]' && !document.querySelector('button[aria-label=Commit]').disabled`);
      await setFilter('');
      assert.equal(await js(`!!document.querySelector(${JSON.stringify(filterMarker)})`), true, 'Draft input must not replace the applied-result marker.');
      await headerClick('id');
      await wait(`!document.querySelector(${JSON.stringify(filterMarker)}) && ${resultIds}==='["1","2"]' && !document.querySelector('button[aria-label=Commit]').disabled`);
      await click('Rollback');
      await wait(`${resultIds}==='["2"]' && !document.querySelector('button[aria-label=Commit]').disabled`);
      await js("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true");
      await wait("!!document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell--editing input')");
      await js("(()=>{const e=document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell--editing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'grid-edited');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await pause(100);
      await js("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell--editing input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));true");
      await wait("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]')?.textContent==='grid-edited' && !document.querySelector('button[aria-label=Commit]').disabled");
      assert.equal((await state.client.execute(`SELECT label FROM ${table}`, {}, null, false, true)).rows[0].label, 'committed');
      await click('Rollback');
      await wait("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]')?.textContent==='committed' && !document.querySelector('button[aria-label=Commit]').disabled");
      await wait("!!document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row input[type=checkbox]') && !document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row input[type=checkbox]').disabled && !document.querySelector('button[aria-label=Commit]').disabled");
      await js("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row input[type=checkbox]').click();true");
      const words = require('../../src/locales/en.json');
      await wait(`[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')===${JSON.stringify(words.edit_selected_row_enter_ctrl_e)}&&!e.disabled)`);
      await js(`[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(words.edit_selected_row_enter_ctrl_e)}).click();true`);
      await wait("!!document.querySelector('[role=dialog] input')");
      await js("(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.startsWith('label ('));const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'dialog-edited');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("!document.querySelector('[role=dialog]') && document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]')?.textContent==='dialog-edited'");
      await click('Commit');
      await wait("!document.querySelector('button[aria-label=Commit]').disabled");
      assert.equal((await state.client.execute(`SELECT label FROM ${table}`, {}, null, false, true)).rows[0].label, 'dialog-edited');
      // Structure changes require a SQL preview; the comment is applied only after Execute.
      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='Structure').click();true");
      await wait("!!document.querySelector('[data-testid=mysql-table-structure]')");
      for(const key of ['mysql_table_structure_help','mysql_auto_increment_observed_help','mysql_status_hint'])assert.equal(await js(`document.body.textContent.includes(${JSON.stringify(words[key])})`),false);
      assert.equal(await js("document.querySelector('[data-testid=mysql-structure-checks]').getAttribute('aria-expanded')"),'false');
      assert.equal(await js("document.querySelector('[data-testid=mysql-structure-triggers]').getAttribute('aria-expanded')"),'false');
      const structureSplitHeight = await resizeSplit('[data-testid=mysql-split-structure]');
      await wait(`[...document.querySelectorAll('[data-testid=mysql-table-structure] button')].some(e=>e.textContent===${JSON.stringify(words.change_table_comment)}&&!e.disabled)`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-table-structure] button')].find(e=>e.textContent===${JSON.stringify(words.change_table_comment)}).click();true`);
      await wait("!!document.querySelector('[role=dialog] textarea')");
      await js("(()=>{const e=document.querySelector('[role=dialog] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Reviewed MySQL UI comment');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.preview)}).click();true`);
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");
      assert.ok(await js("document.querySelector('[role=dialog]').textContent.includes('Reviewed MySQL UI comment')"));
      const beforeDdl = await state.client.execute(`SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA='mb_test' AND TABLE_NAME='${table}'`, {}, null, false, true);
      assert.equal(beforeDdl.rows[0].TABLE_COMMENT, '');
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("!document.querySelector('[role=dialog]') && document.querySelector('[data-testid=mysql-table-structure]')?.textContent.includes('Reviewed MySQL UI comment')");
      assert.equal((await state.client.execute(`SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA='mb_test' AND TABLE_NAME='${table}'`, {}, null, false, true)).rows[0].TABLE_COMMENT, 'Reviewed MySQL UI comment');
      // Edit the full column definition through the production dialog and verify persisted metadata.
      const columnRowId=await js("(()=>{const grid=document.querySelector('[data-testid=mysql-table-structure] .MuiDataGrid-root');const cell=[...grid.querySelectorAll('.MuiDataGrid-cell[data-field=COLUMN_NAME]')].find(e=>e.textContent==='label');const id=cell?.closest('[role=row]')?.getAttribute('data-id');grid.querySelector('.MuiDataGrid-virtualScroller').scrollLeft=10000;return id})()");
      await wait(`!!document.querySelector('[data-testid=mysql-table-structure] [data-id="${columnRowId}"] [data-field=__actions] button')`);
      await js(`document.querySelector('[data-testid=mysql-table-structure] [data-id="${columnRowId}"] [data-field=__actions] button').click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-column-editor] input') && !document.querySelector('[data-testid=mysql-column-editor] [role=status]')");
      const setColumnInput=async(label,value)=>{await js(`(()=>{const p=document.querySelector('[data-testid=mysql-column-editor]');const label=[...p.querySelectorAll('label')].find(e=>e.textContent===${JSON.stringify(label)});const e=document.getElementById(label?.htmlFor);if(!e)throw new Error('Column field missing');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);};
      await setColumnInput(words.length,'150');await setColumnInput(words.comment,'Reviewed column comment');
      await js(`[...document.querySelectorAll('[data-testid=mysql-column-editor] button')].find(e=>e.textContent===${JSON.stringify(words.preview)}).click();true`);
      await wait("document.querySelector('[data-testid=mysql-column-editor]').textContent.includes('CHANGE COLUMN')");
      assert.equal(await js(`[...document.querySelectorAll('[data-testid=mysql-column-editor] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).disabled`),true);
      await setColumnInput(words.mysql_table_confirm_name.replace('{{name}}',table),table);
      await js(`[...document.querySelectorAll('[data-testid=mysql-column-editor] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
      await wait("!document.querySelector('[data-testid=mysql-column-editor]') && !document.querySelector('button[aria-label=Commit]').disabled");
      const editedColumn=(await state.client.execute("SELECT CHARACTER_MAXIMUM_LENGTH,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mb_test' AND TABLE_NAME=:table AND COLUMN_NAME='label'",{table},null,false,true)).rows[0];assert.equal(editedColumn.CHARACTER_MAXIMUM_LENGTH,'150');assert.equal(editedColumn.COLUMN_COMMENT,'Reviewed column comment');
      for (const tab of ['Structure', 'Relation', 'ER Diagram', 'Statistics']) {
        await js(`[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(tab)}).click();true`);
        await wait(`document.querySelector('[data-testid=mysql-table-window]')?.textContent.includes(${JSON.stringify(tab)})`);
        await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      }
      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='Statistics').click();true");
      await resizeSplit('[data-testid=mysql-split-statistics]');
      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='Structure').click();true");
      await wait(`Math.abs(document.querySelector('[data-testid=mysql-split-structure] [data-split-upper]').getBoundingClientRect().height-${structureSplitHeight})<2`);
      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='ER Diagram').click();true");
      await wait("document.querySelectorAll('[data-testid=mysql-table-er] .react-flow__node').length===2 && document.querySelectorAll('[data-testid=mysql-table-er] .react-flow__edge').length===1");
      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='Source').click();true");
      await wait(`document.querySelector('[data-testid=mysql-table-window] .cm-content')?.textContent.includes(${JSON.stringify(table)})`);
      await wait("!!document.querySelector('[data-testid=mysql-table-source]') && [...document.querySelectorAll('[data-testid=mysql-table-source] button')].some(e=>e.textContent==='Git Commit'&&!e.disabled)");
      assert.equal(await js("!!document.querySelector('[data-testid=mysql-table-source] button[aria-label=\"Ask AI\"]')"), false);
      assert.equal(await js("document.querySelector('[data-testid=mysql-table-source] .cm-content').getAttribute('aria-readonly')"), 'true');
      assert.ok(await js("document.querySelector('[data-testid=mysql-table-source] .cm-content').textContent.includes('Reviewed MySQL UI comment')"));
      await js("[...document.querySelectorAll('[data-testid=mysql-table-source] button')].find(e=>e.textContent==='Git Commit').click();true");
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Record')");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Record').click();true");
      await wait("!document.querySelector('[role=dialog]')");
      assert.equal((await git.log()).total, 3);
      await js("[...document.querySelectorAll('[data-testid=mysql-table-source] [role=tab]')].find(e=>e.textContent==='Version History').click();true");
      await wait("document.querySelectorAll('[data-testid=mysql-table-source] .MuiDataGrid-row').length===1");

      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='Data').click();true");
      await wait("!!document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]')");
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(errors.length, 0, errors.join('\n'));
      await wait("!!document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row input[type=checkbox]') && !document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row input[type=checkbox]').disabled && !document.querySelector('button[aria-label=Commit]').disabled");
      await js("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row input[type=checkbox]').click();true");
      await wait(`[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')===${JSON.stringify(words.delete_selected_rows)}&&!e.disabled)`);
      await js(`[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(words.delete_selected_rows)}).click();true`);
      await wait("!!document.querySelector('[role=dialog]')");
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.delete)}).click();true`);
      await wait("!document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-row') && !document.querySelector('button[aria-label=Commit]').disabled");
      await click('Rollback');
      await wait("document.querySelector('[data-testid=mysql-table-data] .MuiDataGrid-cell[data-field=label]')?.textContent==='dialog-edited' && !document.querySelector('button[aria-label=Commit]').disabled");
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('MySQL table UI assertions passed.');
      console.log('MySQL UI: checking Oracle-style table context menus and creation.');
      await tableContext(table, words.copy_table_name); for (let i=0;i<100 && clipboardText!==table;i++) await pause(10); assert.equal(clipboardText, table);
      await js(`navigator.clipboard.readText=async()=>${JSON.stringify('id\tlabel\n3\tfrom-sidebar')};true`);
      await tableContext(table, words.import);
      await wait(`document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(words.data_import_settings)})`);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.import_preview)}).click();true`);
      await wait("!!document.querySelector('[data-testid=import-preview]')");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
      assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n, '2');
      assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${table}`, {}, null, false, true)).rows[0].n, '1');
      await tableContext(table, words.export);
      await wait(`document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(words.data_export_settings)})`);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.export_2)}).click();true`);
      await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
      assert.ok(clipboardText.includes('from-sidebar')); assert.ok(clipboardText.includes('dialog-edited'));
      await click('Rollback'); await wait("!document.querySelector('button[aria-label=Commit]').disabled");
      const made = table + '_made', copied = table + '_copy', renamed = table + '_renamed';
      sidebarFixtures.add(made); sidebarFixtures.add(copied); sidebarFixtures.add(renamed);
      await wait(`[...document.querySelectorAll('aside button')].some(e=>e.getAttribute('aria-label')===${JSON.stringify(words.create_new_table)}&&!e.disabled)`);
      await js(`[...document.querySelectorAll('aside button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(words.create_new_table)}).click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-create-table]')");
      const setInput = async (labelText, value, scope = '[role=dialog]') => {
        await js(`(()=>{const label=[...document.querySelectorAll(${JSON.stringify(scope + ' label')})].find(e=>e.textContent===${JSON.stringify(labelText)});const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      };
      await setInput(words.table_name, made, '[data-testid=mysql-create-table]');
      for (const [name,type,primary] of [['id','INT',true],['label','VARCHAR(80)',false]]) {
        await js(`[...document.querySelectorAll('[data-testid=mysql-create-table] button')].find(e=>e.textContent===${JSON.stringify(words.add_column_2)}).click();true`);
        await wait(`document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(words.column_definition)})`);
        await setInput(words.column_name, name); await setInput(words.data_type, type);
        if (primary) await js("[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent==='PK').querySelector('input').click();true");
        await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.save)}).click();true`);
        await wait("!document.querySelector('[role=dialog]')");
      }
      await js(`[...document.querySelectorAll('[data-testid=mysql-create-table] button')].find(e=>e.textContent===${JSON.stringify(words.create_table)}).click();true`);
      await wait("document.querySelector('[role=dialog]')?.textContent.includes('CREATE TABLE')");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait(`!document.querySelector('[role=dialog]') && !!document.querySelector('[data-mysql-table="${made}"]') && !document.querySelector('button[aria-label=Commit]').disabled`);
      await tableContext(made, words.open_in_sql_window);
      await wait(`Array.from(document.querySelectorAll('.cm-content')).some(e=>e.getBoundingClientRect().width>0&&e.textContent.includes(${JSON.stringify(made)}))`);
      await runSql(`INSERT INTO mb_test.${made} VALUES(1,'created-ui')`, 'INSERT');
      await tableContext(made, words.copy_table);
      await wait("!!document.querySelector('[role=dialog] input')");
      await setInput(words.new_table_name, copied);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.preview)}).click();true`);
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
      assert.equal((await state.client.execute(`SELECT label FROM ${copied}`)).rows[0].label, 'created-ui');
      await tableContext(copied, words.rename_table); await wait("!!document.querySelector('[role=dialog] input')");
      await setInput(words.new_table_name, renamed);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.preview)}).click();true`);
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
      for (const [menu,destructive] of [[words.gather_stats_analyze_2,false],[words.truncate,true],[words.drop,true]]) {
        await tableContext(renamed, menu);
        await wait("!!document.querySelector('[role=dialog]')");
        await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.preview)}).click();true`);
        if (destructive) await setInput(words.mysql_table_confirm_name.replace('{{name}}',renamed), renamed);
        await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");
        await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
        await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
        if (menu===words.truncate) assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${renamed}`)).rows[0].n,'0');
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('MySQL Oracle-style sidebar assertions passed.');
    }
    if (features) {
      const words = require('../../src/locales/en.json');
      if (featureChild) { await state.client.execute(`DROP TABLE ${featureChild}`); featureChild = ''; }
      await state.client.execute(`ALTER TABLE ${table} MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT, ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await click('View');
      await wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent===${JSON.stringify(words.data_generator)})`);
      await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.data_generator)}).click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-data-generator]')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-data-generator] button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(words.select_table)}).click();true`);
      await wait(`!![...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.includes(${JSON.stringify(table)}))`);
      await js(`[...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.includes(${JSON.stringify(table)})).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await wait(`!document.querySelector('[role=dialog]') && document.querySelector('[data-testid=mysql-data-generator]').textContent.includes('id')`);
      await wait(`[...document.querySelectorAll('[data-testid=mysql-data-generator] button')].some(e=>e.textContent===${JSON.stringify(words.generation_preview)}&&!e.disabled)`);
      await click(words.generation_preview);
      await wait("!!document.querySelector('[role=dialog] table')");
      assert.ok(await js(`document.querySelector('[data-testid=mysql-data-generator]').textContent.includes(${JSON.stringify(words.generation_auto_increment_help)})`));
      assert.equal(errors.length, 0, errors.join('\n'));
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Close').click();window.__generatorAlerts=[];window.alert=message=>window.__generatorAlerts.push(message);true");
      const beforeGeneratorAi = aiCalls.length;
      await js(`[...document.querySelectorAll('[data-testid=mysql-data-generator] button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(words.ask_ai)}).click();true`);
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]') && document.querySelector('textarea[placeholder^=\"Enter an AI request\"]').value.includes('MySQL 8.4. InnoDB.')");
      await click('Preview request'); await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.equal(aiCalls.length, beforeGeneratorAi);
      assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('CREATE TABLE')"));
      const beforeGenerated = completed;
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");
      await wait("window.__generatorAlerts.length===1");
      assert.equal(aiCalls.length, beforeGeneratorAi + 1); assert.equal(completed, beforeGenerated, 'Applying AI rules must not insert rows.');
      await wait("[...document.querySelectorAll('[data-testid=mysql-data-generator] input')].some(e=>e.value==='Generated AI demo')");
      const expectedConfirmation = words.generation_confirm_target.replace('{{schema}}', 'mb_test').replace('{{table}}', table).replace('{{count}}', '3');
      await js(`(()=>{const previous=window.confirm;window.confirm=message=>message===${JSON.stringify(expectedConfirmation)}||previous(message);return true})()`);
      await click(words.generation_preview); await wait("!!document.querySelector('[role=dialog] table')");
      assert.ok(await js("document.querySelector('[role=dialog] table').textContent.includes('2026/11/13 12:34:56')"));
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait("window.__generatorAlerts.length===2");
      assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${table} WHERE label='Generated AI demo'`)).rows[0].n, '3');
      await js("document.querySelector('button[aria-label=Rollback]').click();true");
      await wait("!document.querySelector('button[aria-label=Rollback]').disabled");
      assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${table} WHERE label='Generated AI demo'`)).rows[0].n, '0');
      console.log('MySQL Oracle-style data-generator picker, AI preview/rules, execution and rollback passed.');
    }
    if (features) {
      const words = require('../../src/locales/en.json');
      const child = table + '_qb', view = table + '_qv';
      await state.client.execute(`CREATE TABLE ${child} (id INT PRIMARY KEY, parent_id INT, amount DECIMAL(30,18), FOREIGN KEY(parent_id) REFERENCES ${table}(id)) ENGINE=InnoDB`); sidebarFixtures.add(child);
      await state.client.main.promise().query(`CREATE VIEW ${view} AS SELECT id,label FROM ${table}`); builderViews.add(view);
      const parentId = (await state.client.execute(`SELECT MIN(id) n FROM ${table}`)).rows[0].n;
      await state.client.execute(`INSERT INTO ${child} VALUES (1,${parentId},17.5)`);
      await click('View'); await wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.startsWith('Query Builder'))");
      await js("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.startsWith('Query Builder')).click();true");
      await wait("!!document.querySelector('[data-testid=query-builder-empty]')");
      const design = { version: 1, dbType: 'mysql', selectedSchema: 'mb_test', queryTables: [
        { id: 'bp', name: '"mb_test"."' + table + '"', columns: ['id','label','created_at'], x: 20, y: 20 },
        { id: 'bc', name: '"mb_test"."' + child + '"', columns: ['id','parent_id','amount'], x: 240, y: 20 }
      ], queryFields: [], queryJoins: [] };
      await js(`(()=>{const input=document.querySelector('[data-testid=query-builder] input[type=file]');const data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(design))}],'mysql-query.json',{type:'application/json'}));Object.defineProperty(input,'files',{configurable:true,value:data.files});input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      await wait("document.querySelectorAll('[data-testid=query-builder-table]').length===2");
      for (const [tableId,column] of [['bp','label'],['bc','amount']]) await js(`document.querySelector('[data-table-id=${tableId}] [data-query-column=${column}]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await wait("document.querySelectorAll('[data-query-field-id]').length===2");
      await js(`(()=>{const data=new DataTransfer();data.setData('application/query-fields',JSON.stringify([{tableId:'bp',tableName:${JSON.stringify(design.queryTables[0].name)},colName:'id'}]));document.querySelector('[data-table-id=bc] [data-query-column=parent_id]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));return true})()`);
      await wait(`document.querySelector('[data-testid=query-builder-canvas] svg').textContent.includes(${JSON.stringify(words.inner_join)})`);
      await js(`document.querySelector('[data-testid=query-builder] button[aria-label=${JSON.stringify(words.save)}]').click();true`);
      for (let i=0; !builderExport && i<100; i++) await pause(20); assert.equal(JSON.parse(builderExport).dbType, 'mysql'); assert.equal(JSON.parse(builderExport).queryJoins.length, 1);
      await js(`document.querySelector('[data-testid=query-builder] button[aria-label=${JSON.stringify(words.ask_ai_to_generate_sql)}]').click();true`);
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]') && document.body.textContent.includes('Preview request')");
      await wait(`document.body.textContent.includes(${JSON.stringify(words.describe_the_sql_you_want_to_create)})`);
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Summarize the amount by parent label using SUM.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await wait("[...document.querySelectorAll('button')].some(e=>e.textContent==='Preview request'&&!e.disabled)");
      const beforeAi = aiCalls.length, beforeSql = completed;
      await click('Preview request'); await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('MySQL 8.4')")); assert.equal(aiCalls.length,beforeAi);
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");
      await wait("document.querySelector('[role=dialog]')?.textContent.includes('Review query builder proposal')");
      assert.ok(await js("document.querySelector('[role=dialog]').textContent.includes('SUM(t2.`amount`)')")); assert.equal(completed,beforeSql);
      await click(words.qb_apply_proposal); await wait("!document.querySelector('[role=dialog]')"); assert.equal(completed,beforeSql);
      await js(`[...document.querySelectorAll('[data-testid=query-builder-toolbar] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
      await wait("document.querySelector('[data-testid=query-builder]').textContent.includes('17.500000000000000000')");
      assert.ok(history.some(entry => entry.sql.includes('SUM(t2.`amount`)'))); assert.equal(state.client.getMainTransactionState(),true);
      await js("document.querySelector('button[aria-label=Rollback]').click();true"); await wait("!document.querySelector('button[aria-label=Rollback]').disabled");
      assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${child}`)).rows[0].n,'0');
      await click(words.design_view);
      await js(`[...document.querySelectorAll('[data-testid=query-builder-toolbar] button')].find(e=>e.textContent===${JSON.stringify(words.add)}).click();true`);
      await wait("document.querySelectorAll('[role=dialog] [role=combobox]').length===2");
      await js("document.querySelectorAll('[role=dialog] [role=combobox]')[1].dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));true");
      await wait("!!document.querySelector('[role=option][data-value=VIEW]')"); await js("document.querySelector('[role=option][data-value=VIEW]').click();true");
      await wait(`[...document.querySelectorAll('[role=dialog] [role=option]')].some(e=>e.textContent.includes(${JSON.stringify(view)}))`);
      await js(`[...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.includes(${JSON.stringify(view)})).click();true`);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.add)}).click();true`);
      await wait("document.querySelectorAll('[data-testid=query-builder-table]').length===3 && !document.querySelector('[role=dialog]')");
      assert.equal(errors.length,0,errors.join('\n'));
      console.log('MySQL Oracle-style query-builder import, fields, join, AI review, execution, rollback and view picker passed.');
    }
    if (features) {
      const words = require('../../src/locales/en.json'), target = table + '_ct', view = target + 'v';
      await state.client.execute(`CREATE TABLE ${target} (region VARCHAR(30), category VARCHAR(30), amount DECIMAL(20,4), stamp DATETIME) ENGINE=InnoDB`); sidebarFixtures.add(target);
      await state.client.main.promise().query(`CREATE VIEW ${view} AS SELECT * FROM ${target}`); builderViews.add(view);
      await state.client.execute(`INSERT INTO ${target} VALUES ('North','A',1.25,'2026-01-01'),('North','B',2.75,'2026-01-02'),('South','A',4,'2026-04-01')`);
      await click('View'); await wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.startsWith(${JSON.stringify(words.cross_tabulation)}))`);
      await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.startsWith(${JSON.stringify(words.cross_tabulation)})).click();true`);
      await wait("!!document.querySelector('[data-testid=cross-tab]') && !document.querySelector('[data-testid=cross-tab]').disabled");
      const selectObject = async name => {
        await js("document.querySelectorAll('[data-testid=cross-tab] [role=combobox]')[2].dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));true");
        await wait(`!!document.querySelector('[role=option][data-value="${name}"]')`);
        await js(`document.querySelector('[role=option][data-value="${name}"]').click();true`);
        await js(`[...document.querySelectorAll('[data-testid=cross-tab] button')].find(e=>e.textContent===${JSON.stringify(words.start_setup)}).click();true`);
        await wait(`!document.querySelector('[data-testid=cross-tab]').disabled && document.querySelector('[data-testid=cross-tab]').textContent.includes(${JSON.stringify(words.pivot_settings)})`);
      };
      const aggregate = async (filter = false) => {
        await js(`[...document.querySelectorAll('[data-testid=cross-tab] button')].find(e=>e.textContent===${JSON.stringify(filter ? words.execute : words.execute_cross_tab)}).click();true`);
        await wait("!document.querySelector('[data-testid=cross-tab]').disabled && document.querySelector('[data-testid=cross-tab] .MuiDataGrid-cell')?.textContent==='North'");
      };
      await selectObject(target); await aggregate();
      assert.ok(await js("document.querySelector('[data-testid=cross-tab]').textContent.includes('1.2500') && document.querySelector('[data-testid=cross-tab]').textContent.includes('2.7500')"));
      assert.equal(state.client.getMainTransactionState(),true);
      await click(words.chart); await wait("!!document.querySelector('[data-testid=cross-tab] .recharts-bar')");
      for (const type of ['line','area']) {
        await js("document.querySelector('[data-testid=cross-tab-chart-toolbar] [role=combobox]').dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));true");
        await wait(`!!document.querySelector('[role=option][data-value=${type}]')`); await js(`document.querySelector('[role=option][data-value=${type}]').click();true`);
        await wait(`!!document.querySelector('[data-testid=cross-tab] .recharts-${type}')`);
      }
      await js(`[...document.querySelectorAll('[data-testid=cross-tab] button')].find(e=>e.textContent===${JSON.stringify(words.save)}).click();true`);
      for(let i=0;!crossTabExport&&i<100;i++)await pause(20); assert.equal(JSON.parse(crossTabExport).dbType,'mysql');
      await js(`(()=>{const input=document.querySelector('[data-testid=cross-tab] input[type=file]');const data=new DataTransfer();data.items.add(new File([${JSON.stringify(crossTabExport)}],'cross-tab.json',{type:'application/json'}));Object.defineProperty(input,'files',{configurable:true,value:data.files});input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      await wait(`window.__generatorAlerts.at(-1)===${JSON.stringify(words.settings_restored_click_execute_cross_tab_to_see_results)} && !document.querySelector('[data-testid=cross-tab]').disabled && !document.querySelector('[data-testid=cross-tab] .MuiDataGrid-cell')`);
      await aggregate(); await click(words.filter_condition);
      await js("(()=>{const e=document.querySelector('[data-testid=cross-tab] [title=region]').parentElement.querySelector('input[placeholder]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'North');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await aggregate(true); await wait("![...document.querySelectorAll('[data-testid=cross-tab] .MuiDataGrid-cell')].some(e=>e.textContent==='South')");
      await click(words.execution_log); assert.ok(await js("document.querySelector('[data-testid=cross-tab]').textContent.includes('CASE WHEN q.COL_VALUE')"));
      await js("document.querySelectorAll('[data-testid=cross-tab] [role=combobox]')[1].dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));true");
      await wait("!!document.querySelector('[role=option][data-value=VIEW]')"); await js("document.querySelector('[role=option][data-value=VIEW]').click();true");
      await wait("!document.querySelector('[data-testid=cross-tab]').disabled"); await selectObject(view); await aggregate(); assert.equal(state.client.getMainTransactionState(),true);
      await js("document.querySelector('button[aria-label=Rollback]').click();true");await wait("!document.querySelector('button[aria-label=Rollback]').disabled");
      assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${target}`)).rows[0].n,'0'); assert.equal(errors.length,0,errors.join('\n'));
      console.log('MySQL Oracle-style cross-tab setup, exact results, charts, settings, filters, log, view and rollback passed.');
    }
    if (features) {
      const words = require('../../src/locales/en.json'), name = table + '_er', view = table + '_qv';
      await state.client.execute(`INSERT INTO ${table}(label) VALUES('ER pending')`);
      await click('View'); await wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.startsWith(${JSON.stringify(words.er_diagram_viewer)}))`);
      await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.startsWith(${JSON.stringify(words.er_diagram_viewer)})).click();true`);
      await wait("!!document.querySelector('[data-testid=er-diagram-window]') && document.querySelector('[data-testid=er-diagram-window]').getAttribute('aria-busy')==='false'");
      await js("document.querySelectorAll('[data-testid=er-diagram-window] [role=combobox]')[1].dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));true");
      await wait(`!!document.querySelector('[role=option][data-value="${table}"]')`); await js(`document.querySelector('[role=option][data-value="${table}"]').click();true`);
      await click(words.draw_er_diagram);
      await wait(`!!document.querySelector('[data-testid=er-diagram-window] .react-flow__node[data-id="${table}"]') && !!document.querySelector('[data-testid=er-diagram-window] .react-flow__edge')`);
      assert.ok(await js("document.querySelector('[data-testid=er-diagram-window]').textContent.includes('Reviewed MySQL UI comment')")); assert.equal(state.client.getMainTransactionState(),true);
      await click(words.custom_er_diagram_virtual_relations); await click(words.create_new_er_diagram);
      await wait("[...document.querySelectorAll('[data-testid=er-diagram-window] button')].some(e=>e.textContent==='Git Commit'&&!e.disabled)");
      await js(`(()=>{const label=[...document.querySelectorAll('[data-testid=er-diagram-window] label')].find(e=>e.textContent===${JSON.stringify(words.er_diagram_name)});const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await click(words.add_table_2); await wait("document.querySelectorAll('[role=dialog] [role=combobox]').length===2");
      const chooseCategory = async value => {
        await js("document.querySelectorAll('[role=dialog] [role=combobox]')[1].dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));true");
        await wait(`!!document.querySelector('[role=option][data-value=${value}]')`); await js(`document.querySelector('[role=option][data-value=${value}]').click();true`);
      };
      await chooseCategory('TABLE'); await wait(`[...document.querySelectorAll('[role=dialog] [role=option]')].some(e=>e.textContent.includes(${JSON.stringify(table)}))`);
      await js(`[...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.startsWith(${JSON.stringify(table+'mb_test')})).click();true`);
      await chooseCategory('VIEW'); await wait(`[...document.querySelectorAll('[role=dialog] [role=option]')].some(e=>e.textContent.includes(${JSON.stringify(view)}))`);
      await js(`[...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.includes(${JSON.stringify(view)})).click();true`);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.add)}).click();true`);
      await wait("!document.querySelector('[role=dialog]') && document.querySelectorAll('[data-testid=er-diagram-window] .react-flow__node').length===2");
      await click(words.add_relation_2); await wait("document.querySelectorAll('[role=dialog] [role=combobox]').length===4");
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.save)}).click();true`);
      await wait("!!document.querySelector('[data-testid=er-diagram-window] .react-flow__edge')");
      await js("[...document.querySelectorAll('[data-testid=er-diagram-window] button')].find(e=>e.textContent==='Git Commit').click();true"); await wait("!!document.querySelector('[role=dialog] textarea')");
      await js("(()=>{const e=document.querySelector('[role=dialog] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Create MySQL ER diagram');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.record)}).click();true`);
      await wait(`!document.querySelector('[role=dialog]') && [...document.querySelectorAll('[data-testid=er-diagram-window] button')].some(e=>e.textContent===${JSON.stringify(words.compare_history)}&&!e.disabled)`);
      const file = path.join(gitRoot,'MonaBase','MYSQL','ErDiagram',name+'.json'); assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).nodes.length,2);
      await click(words.compare_history); await wait("!!document.querySelector('[data-testid=er-diagram-window] .MuiDataGrid-row')");
      await js("document.querySelector('[data-testid=er-diagram-window] .MuiDataGrid-row').click();true");
      await wait(`document.querySelectorAll('[data-testid=er-diagram-window] .react-flow__node').length===4 && [...document.querySelectorAll('[data-testid=er-diagram-window] button')].some(e=>e.textContent===${JSON.stringify(words.restore_to_selected_version)}&&!e.disabled)`);
      await js(`(()=>{const previous=window.confirm;window.confirm=message=>message===${JSON.stringify(words.er_confirm_restore_canvas)}||previous(message);return true})()`);
      await click(words.restore_to_selected_version); await wait("document.querySelectorAll('[data-testid=er-diagram-window] .react-flow__node').length===2");
      assert.equal(state.client.getMainTransactionState(),true); await js("document.querySelector('button[aria-label=Rollback]').click();true"); await wait("!document.querySelector('button[aria-label=Rollback]').disabled"); assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${table} WHERE label='ER pending'`)).rows[0].n,'0');
      assert.equal(errors.length,0,errors.join('\n')); console.log('MySQL Oracle-style ER auto generation, table/view picker, virtual relation, Git commit/history/restore and pending transaction passed.');
    }
    if (features) {
      const words = require('../../src/locales/en.json'), indexName = table + '_ix', renamed = table + '_renamed';
      console.log('MySQL UI: checking Oracle-style index category, creation, definition, visibility, rename and deletion.');
      const setIndexField = async (label, value, dialog = false) => {
        const scope = dialog ? '[role=dialog]' : '[data-testid=mysql-index-window]';
        await js(`(()=>{const label=[...document.querySelectorAll('${scope} label')].find(e=>e.textContent===${JSON.stringify(label)});if(!label)throw new Error('Index field not found');const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      };
      const indexButton = async label => {
        await wait(`[...document.querySelectorAll('[data-testid=mysql-index-window] button')].some(e=>e.textContent===${JSON.stringify(label)}&&!e.disabled)`);
        await js(`[...document.querySelectorAll('[data-testid=mysql-index-window] button')].find(e=>e.textContent===${JSON.stringify(label)}).click();true`);
      };
      const indexContext = async (name, label) => {
        await js(`document.querySelector('[data-mysql-index="${name}"][data-mysql-index-table="${table}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:320}));true`);
        await wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent===${JSON.stringify(label)}&&e.getAttribute('aria-disabled')!=='true')`);
        await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(label)}).click();true`);
      };
      const executeReview = async () => {
        await wait(`[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent===${JSON.stringify(words.execute)}&&!e.disabled)`);
        await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
        await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
      };
      await js("document.querySelector('[data-mysql-index-category=mb_test]').click();true");
      await wait(`!!document.querySelector('aside button[aria-label=${JSON.stringify(words.create_index_index)}]')`);
      await js(`document.querySelector('aside button[aria-label=${JSON.stringify(words.create_index_index)}]').click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-index-window]')");
      await indexButton(words.select_table);
      await wait(`!![...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.includes(${JSON.stringify(table)}))`);
      await js(`[...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.startsWith(${JSON.stringify(table+'mb_test')})).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await wait(`!document.querySelector('[role=dialog]') && !!document.querySelector('[data-testid=mysql-index-window] button[aria-label="Add label"]')`);
      await setIndexField(words.index_name, indexName);
      await js(`document.querySelector('[data-testid=mysql-index-window] button[aria-label="Add label"]').closest('[role=button]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
      await js(`document.querySelector('[data-testid=mysql-index-window] button[aria-label="Add created_at"]').closest('[role=button]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));true`);
      await js(`document.querySelector('[data-testid=mysql-index-window] button[aria-label=${JSON.stringify(words.mysql_index_add_selected)}]').click();true`);
      await indexButton(words.create); await wait("!!document.querySelector('[role=dialog]')");
      assert.equal((await state.client.execute('SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table AND INDEX_NAME=:name', { schema:'mb_test', table, name:indexName },null,false,true)).rows[0].n,'0');
      await executeReview();
      await wait(`!!document.querySelector('[data-mysql-index="${indexName}"][data-mysql-index-table="${table}"]')`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-index-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.statistics)}).click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-index-window] .MuiDataGrid-cell[data-field=CARDINALITY]')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-index-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.source)}).click();true`);
      await wait(`document.querySelector('[data-testid=mysql-index-window] .cm-content').textContent.includes(${JSON.stringify('KEY `'+indexName+'`')})`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-index-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.edit)}).click();true`);
      await indexContext(indexName, words.mysql_index_toggle_visibility); await executeReview();
      assert.equal((await state.client.execute('SELECT IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:table AND INDEX_NAME=:name', { schema:'mb_test', table, name:indexName },null,false,true)).rows[0].IS_VISIBLE,'NO');
      await indexContext(indexName, words.mysql_index_rename); await setIndexField(words.index_name, renamed); await indexButton(words.change); await executeReview();
      await wait(`!!document.querySelector('[data-mysql-index="${renamed}"][data-mysql-index-table="${table}"]')`);
      await js(`document.querySelector('[data-mysql-index="${renamed}"][data-mysql-index-table="${table}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await indexContext(renamed, words.delete); await setIndexField(words.index_name, renamed, true); await executeReview();
      await wait(`!document.querySelector('[data-mysql-index="${renamed}"][data-mysql-index-table="${table}"]')`);
      assert.equal(errors.length,0,errors.join('\n')); console.log('MySQL Oracle-style index category, create review, statistics/source, visibility, rename, exact-name delete and sidebar refresh passed.');
    }
    if (features) {
      const words=require('../../src/locales/en.json'); featureView=table+'_manage_view'; builderViews.add(featureView);
      console.log('MySQL UI: checking Oracle-style view category, data, native source, AI draft, compile, Git and deletion.');
      await js("document.querySelector('[data-mysql-view-category=mb_test]').click();true");
      await wait(`!!document.querySelector('aside button[aria-label=${JSON.stringify(words.new_view_opens_sql_window)}]')`);
      await js(`(()=>{const e=document.querySelector('aside input[aria-label=${JSON.stringify(words.search.replace('{{category}}',words.view_2))}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureView)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await js(`document.querySelector('aside button[aria-label=${JSON.stringify(words.new_view_opens_sql_window)}]').click();true`);
      await wait("[...document.querySelectorAll('.cm-content')].some(e=>e.getBoundingClientRect().width>0&&e.textContent.includes('NEW_VIEW_NAME'))");
      await runSql(`CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW mb_test.${featureView} AS SELECT id,label,created_at FROM mb_test.${table}`,'CREATE');
      await wait(`!!document.querySelector('[data-mysql-view="${featureView}"]')`);
      await state.client.execute(`INSERT INTO ${table}(label) VALUES('View pending')`);
      await js(`document.querySelector('[data-mysql-view="${featureView}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
      await wait("!!document.querySelector('[data-testid=mysql-view-window] .MuiDataGrid-cell[data-field=label]') && document.querySelector('[data-testid=mysql-view-window]').textContent.includes('View pending')");
      assert.equal(await js("!!document.querySelector('[data-testid=mysql-view-window] button[aria-label=\"Add new record (Ctrl+I)\"]')"),false);
      assert.equal(await js("!!document.querySelector('[data-testid=mysql-view-window] .MuiDataGrid-cell--editable')"),false); await transactionButtons(true);
      await click('Rollback');await transactionButtons(false);await wait("!document.querySelector('[data-testid=mysql-view-window]').textContent.includes('View pending')");
      assert.ok(await js("/^\\d{4}\\/\\d{2}\\/\\d{2}/.test(document.querySelector('[data-testid=mysql-view-window] .MuiDataGrid-cell[data-field=created_at]').textContent)"));
      await resizeSplit('[data-testid=mysql-view-window]');
      const viewTab=async key=>{await js(`[...document.querySelectorAll('[data-testid=mysql-view-window] [role=tab]')].find(e=>e.textContent.replace(/^\\* /,'')===${JSON.stringify(words[key])}).click();true`);};
      await viewTab('edit'); await wait("!!document.querySelector('[data-testid=mysql-view-window] .cm-content') && !document.querySelector('[data-testid=mysql-view-window] button[aria-label=\"Ask AI\"]').disabled");
      const beforeAi=aiCalls.length;
      await js("document.querySelector('[data-testid=mysql-view-window] button[aria-label=\"Ask AI\"]').click();true");
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')&&!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]').disabled");
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Add the constant AI view edit as ai_note. Keep all existing columns and security settings.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await click('Preview request');await wait("!!document.querySelector('[role=dialog] textarea')");assert.equal(aiCalls.length,beforeAi);
      assert.ok(await js(`document.querySelector('[role=dialog] textarea').value.includes(${JSON.stringify(featureView)})`));
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");await wait("document.body.textContent.includes('Review AI changes')");
      await js("(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent==='Change summary');const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Add a view display field');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Apply to editor'&&!e.disabled)");await click('Apply to editor');
      await wait("document.querySelector('[data-testid=mysql-view-window] .cm-content').textContent.includes('ai_note')");
      assert.equal((await state.client.execute("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND TABLE_NAME=:name AND COLUMN_NAME='ai_note'",{schema:'mb_test',name:featureView},null,false,true)).rows[0].n,'0');
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      await js(`[...document.querySelectorAll('[data-testid=mysql-view-window] button')].find(e=>e.textContent===${JSON.stringify(words.compile_save)}).click();true`);await wait("!!document.querySelector('[role=dialog] pre')");
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
      await wait("!document.querySelector('[role=dialog]') && !document.querySelector('button[aria-label=Commit]').disabled");
      const file=path.join(gitRoot,'MonaBase','MYSQL','mb_test','VIEW','.objects-v2',require('../../electron/services/gitSourceNames').sourceFileName(featureView));await wait("!document.querySelector('[data-testid=mysql-view-window] .MuiAlert-standardError')");assert.ok(fs.readFileSync(file,'utf8').includes('ai_note'));
      await viewTab('data');await wait("!!document.querySelector('[data-testid=mysql-view-window] .MuiDataGrid-cell[data-field=ai_note]')");assert.equal(await js("document.querySelector('[data-testid=mysql-view-window] .MuiDataGrid-cell[data-field=ai_note]').textContent"),'AI view edit');
      await viewTab('view_information');await wait("document.querySelector('[data-testid=mysql-view-window]').textContent.includes('SECURITY_TYPE: INVOKER')");
      await viewTab('version_control');await wait("document.querySelector('[data-testid=mysql-view-window]').textContent.includes('Git Commit')");
      await js(`document.querySelector('[data-mysql-view="${featureView}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:170,clientY:320}));true`);
      await wait(`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent===${JSON.stringify(words.delete)})`);await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.delete)}).click();true`);
      await wait("!!document.querySelector('[role=dialog] input')");await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureView)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
      await wait(`!document.querySelector('[data-mysql-view="${featureView}"]')&&!document.querySelector('[role=dialog]')`);assert.equal(fs.existsSync(file),false);builderViews.delete(featureView);
      assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL Oracle-style view creation, native pending/rollback data, date format, split, AI preview/adoption, reviewed compile, real Git, information and exact-name deletion passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json');featureTrigger=table+'_trigger';
      console.log('MySQL UI: checking table-linked trigger creation, compound execution, AI/Git, replacement and deletion.');
      const openTableStructure=async()=>{await tableContext(table,words.open);await wait("!!document.querySelector('[data-testid=mysql-table-window]')");await js(`[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.structure)}).click();true`);await wait("!document.querySelector('button[aria-label=Commit]').disabled");};
      await openTableStructure();
      await js(`(()=>{const p=document.querySelector('[data-testid=mysql-structure-triggers]')?.closest('.MuiPaper-root');if(!p)throw new Error('Trigger section missing');[...p.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(words.add)}).click();return true})()`);
      await wait("!!document.querySelector('[data-testid=mysql-trigger-window]')");
      assert.ok(await js(`document.querySelector('[data-testid=mysql-trigger-window]').textContent.includes(${JSON.stringify(table)})`));
      await js(`(()=>{const label=[...document.querySelectorAll('[data-testid=mysql-trigger-window] label')].find(e=>e.textContent===${JSON.stringify(words.trigger_name)});const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureTrigger)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await enterSql("BEGIN SET NEW.label=CONCAT('T:',NEW.label); END");
      const compileTrigger=async existing=>{
        await wait(`[...document.querySelectorAll('[data-testid=mysql-trigger-window] button')].some(e=>e.textContent===${JSON.stringify(words.compile_save)}&&!e.disabled)`);
        await js(`[...document.querySelectorAll('[data-testid=mysql-trigger-window] button')].find(e=>e.textContent===${JSON.stringify(words.compile_save)}).click();true`);await wait("!!document.querySelector('[role=dialog] pre')");
        if(existing)await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureTrigger)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);await wait("!document.querySelector('[role=dialog]')&&!document.querySelector('button[aria-label=Commit]').disabled");
      };
      await compileTrigger(false);assert.ok((await state.client.getTrigger({schema:'mb_test',name:featureTrigger})).body.includes('T:'));
      await state.client.execute(`INSERT INTO ${table}(label) VALUES('native trigger')`);assert.equal((await state.client.execute(`SELECT COUNT(*) n FROM ${table} WHERE label='T:native trigger'`)).rows[0].n,'1');await state.client.rollback();
      await js(`document.querySelector('[data-testid=mysql-trigger-window] button[aria-label="Ask AI"]').click();true`);await wait(`!!document.querySelector('textarea[placeholder^="Enter an AI request"]')&&!document.querySelector('textarea[placeholder^="Enter an AI request"]').disabled`);
      await js(`(()=>{const e=document.querySelector('textarea[placeholder^="Enter an AI request"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Change the prefix from T: to T2:, preserving the trigger and table.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await click('Preview request');await wait("!!document.querySelector('[role=dialog] textarea')");await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");await wait("document.body.textContent.includes('Review AI changes')");
      await js("(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent==='Change summary');const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Update trigger prefix');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");await click('Apply to editor');await wait("document.querySelector('[data-testid=mysql-trigger-window] .cm-content').textContent.includes('T2:')");
      assert.ok(!(await state.client.getTrigger({schema:'mb_test',name:featureTrigger})).body.includes('T2:'));
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");await compileTrigger(true);
      const file=path.join(gitRoot,'MonaBase','MYSQL','mb_test','TRIGGER','.objects-v2',require('../../electron/services/gitSourceNames').sourceFileName(featureTrigger));assert.ok(fs.readFileSync(file,'utf8').includes('T2:'));
      await openTableStructure();await js("(()=>{const b=document.querySelector('[data-testid=mysql-structure-triggers]');if(b.getAttribute('aria-expanded')==='false')b.click();return true})()");await wait(`document.querySelector('[data-testid=mysql-table-structure]').textContent.includes(${JSON.stringify(featureTrigger)})`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-table-structure] button')].find(e=>e.textContent===${JSON.stringify(featureTrigger)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-trigger-window]')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-trigger-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.source)}).click();true`);await wait("document.querySelector('[data-testid=mysql-trigger-window] .cm-content').textContent.includes('CREATE DEFINER')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-trigger-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_tab)}).click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-trigger-trace-panel]')");
      await wait(`[...document.querySelectorAll('[data-testid=mysql-trigger-trace-panel] button')].some(e=>e.textContent===${JSON.stringify(words.mysql_trace_run)}&&!e.disabled)`);
      await js(`(()=>{const e=document.querySelector('[data-testid=mysql-trigger-trace-panel] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,JSON.stringify({label:'trace input'}));e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-trigger-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_run)}&&!e.disabled).click();true`);
      await wait("document.querySelector('[data-testid=mysql-trigger-trace-panel]').textContent.includes('T2:trace input')");
      await transactionButtons(false);await resizeSplit('[data-testid=mysql-split-trigger-trace]');
      await js(`[...document.querySelectorAll('[data-testid=mysql-trigger-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_next)}).click();true`);
      await wait("document.querySelector('[data-testid=mysql-trigger-trace-panel]').textContent.includes('NEW.label:')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-trigger-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_ai)}&&!e.disabled).click();true`);
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')");
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Explain the recorded NEW.label before and after assignment.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      const beforeTriggerAi=aiCalls.length;await click('Preview request');await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('native row aliases')"));assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('trigger_outcome')"));assert.equal(aiCalls.length,beforeTriggerAi);
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Close').click();true");
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      console.log('MySQL real selected-trigger firing, NEW/OLD replay, rollback and AI preview passed.');
      await js("document.querySelector('[data-mysql-trigger-category=mb_test]').click();true");await wait(`!!document.querySelector('[data-mysql-trigger="${featureTrigger}"]')`);await js(`document.querySelector('[data-mysql-trigger="${featureTrigger}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:170,clientY:320}));true`);
      await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.delete)}).click();true`);await wait("!!document.querySelector('[role=dialog] input')");await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureTrigger)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
      await wait(`!document.querySelector('[data-mysql-trigger="${featureTrigger}"]')&&!document.querySelector('[role=dialog]')`);assert.equal(fs.existsSync(file),false);
      await openTableStructure();await wait(`!document.querySelector('[data-testid=mysql-table-structure]').textContent.includes(${JSON.stringify(featureTrigger)})`);assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL Oracle-style table/sidebar trigger entry, create, native compound firing/rollback, AI draft, reviewed replace, Git/source and deletion passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json');
      // Previous feature checks can fill the configured tab limit. Close only this test's unused tabs.
      for(let i=0;i<30;i++){
        const label=await js(`[...document.querySelectorAll('main [role=tab] button[aria-label^="Close "]')].find(e=>!['Close SQL 1',${JSON.stringify('Close '+featureProcedure)}].includes(e.getAttribute('aria-label')))?.getAttribute('aria-label')||''`);
        if(!label)break;
        await wait(`[...document.querySelectorAll('main button[aria-label]')].some(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}&&!e.disabled)`);
        await js(`[...document.querySelectorAll('main button[aria-label]')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}).click();true`);
        await wait(`![...document.querySelectorAll('main button[aria-label]')].some(e=>e.getAttribute('aria-label')===${JSON.stringify(label)})`);
      }
      const deleteProcedure=async()=>{
        await wait(`!!document.querySelector('[data-mysql-procedure="${featureProcedure}"]')`);
        await js(`document.querySelector('[data-mysql-procedure="${featureProcedure}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:170,clientY:320}));true`);
        await wait(`[...document.querySelectorAll('[data-testid=mysql-procedure-menu] [role=menuitem]')].some(e=>e.textContent===${JSON.stringify(words.delete)}&&e.getAttribute('aria-disabled')!=='true')`);
        await js(`[...document.querySelectorAll('[data-testid=mysql-procedure-menu] [role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.delete)}).click();true`);
        await wait("!!document.querySelector('[role=dialog] input')");
        await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureProcedure)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");
        await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
        await wait(`!document.querySelector('[data-mysql-procedure="${featureProcedure}"]')&&!document.querySelector('[role=dialog]')`);
      };
      await deleteProcedure();
      await js(`document.querySelector('aside button[aria-label=${JSON.stringify(words.create_procedure)}]').click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-procedure-window] input') && [...document.querySelectorAll('[data-testid=mysql-procedure-window] label')].some(e=>e.textContent==='Procedure name')");
      await js(`(()=>{const label=[...document.querySelectorAll('[data-testid=mysql-procedure-window] label')].find(e=>e.textContent==='Procedure name');const input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(featureProcedure)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await wait(`document.querySelector('[data-testid=mysql-procedure-window] .cm-content').textContent.includes(${JSON.stringify(featureProcedure)})`);
      await js("[...document.querySelectorAll('[data-testid=mysql-procedure-window] button')].find(e=>e.textContent==='Compile'&&!e.disabled).click();true");
      await wait("!!document.querySelector('[role=dialog] pre')");
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait(`!!document.querySelector('[data-mysql-procedure="${featureProcedure}"]')&&!document.querySelector('[role=dialog]') && !!document.querySelector('[data-mysql-argument=p_value]')`);
      const info=await state.client.getProcedure({schema:'mb_test',name:featureProcedure});assert.equal(info.parameters[0].name,'p_value');
      await deleteProcedure();await assert.rejects(()=>state.client.getProcedure({schema:'mb_test',name:featureProcedure}));
      assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL Oracle-style procedure sidebar, new source template, reviewed creation, argument metadata and exact-name deletion passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json');featureFunction=table+'_fn';
      console.log('MySQL UI: checking Oracle-style function category, scalar return, AI, compilation, Git and deletion.');
      await js("document.querySelector('[data-mysql-function-category=mb_test]').click();true");
      await wait(`!!document.querySelector('aside button[aria-label=${JSON.stringify(words.create_function)}]')`);
      await js(`document.querySelector('aside button[aria-label=${JSON.stringify(words.create_function)}]').click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-function-window] input')");
      await js(`(()=>{const label=[...document.querySelectorAll('[data-testid=mysql-function-window] label')].find(e=>e.textContent===${JSON.stringify(words.function_name)});const input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(featureFunction)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await wait(`document.querySelector('[data-testid=mysql-function-window] .cm-content').textContent.includes(${JSON.stringify(featureFunction)})`);
      const compileFunction=async existing=>{
        await js("[...document.querySelectorAll('[data-testid=mysql-function-window] button')].find(e=>e.textContent==='Compile'&&!e.disabled).click();true");
        await wait("!!document.querySelector('[role=dialog] pre')");
        if(existing){await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureFunction)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);}
        await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
        await wait("!document.querySelector('[role=dialog]')&&!document.querySelector('[data-testid=mysql-function-window] button[aria-label=\"Ask AI\"]').disabled");
      };
      await compileFunction(false);await wait(`!!document.querySelector('[data-mysql-function="${featureFunction}"]')&&!!document.querySelector('[data-mysql-argument=p_value]')`);
      await js("(()=>{const e=document.querySelector('[data-mysql-argument=p_value]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'41');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      await js("[...document.querySelectorAll('[data-testid=mysql-function-window] button')].find(e=>e.textContent==='Execute'&&!e.disabled).click();true");
      await wait("document.querySelector('[data-mysql-output=RETURN_VALUE]')?.textContent.includes('41')");await transactionButtons(false);await resizeSplit('[data-testid=mysql-split-function]');
      await js(`[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_tab)}).click();true`);
      await wait("!!document.querySelector('[data-testid=mysql-trace-panel]')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_run)}&&!e.disabled).click();true`);
      await wait("document.querySelector('[data-testid=mysql-trace-panel]').textContent.includes('RETURN_VALUE: 41')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_next)}).click();true`);
      await wait("document.querySelector('[data-testid=mysql-trace-panel]').textContent.includes('p_value: 41')");
      await js(`[...document.querySelectorAll('[data-testid=mysql-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_ai)}&&!e.disabled).click();true`);
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')");
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Explain the recorded input and return value.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      const beforeTraceAi=aiCalls.length;await click('Preview request');await wait("!!document.querySelector('[role=dialog] textarea')");
      assert.ok(await js("document.querySelector('[role=dialog] textarea').value.includes('original_source_1_based')"));assert.equal(aiCalls.length,beforeTraceAi);
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Close').click();true");
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");
      console.log('MySQL real routine trace, saved source replay, exact variables and AI evidence preview passed.');

      await js("[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent==='Information').click();true");await wait("document.querySelector('[data-testid=mysql-function-window]').textContent.includes('RETURNS')");
      await js("[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent==='Source').click();true");
      await js("document.querySelector('[data-testid=mysql-function-window] button[aria-label=\"Ask AI\"]').click();true");
      await wait("!!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]')&&!document.querySelector('textarea[placeholder^=\"Enter an AI request\"]').disabled");
      await js("(()=>{const e=document.querySelector('textarea[placeholder^=\"Enter an AI request\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Return p_value plus two, retaining the function identity, input parameter and return type.');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
      const beforeAi=aiCalls.length;await click('Preview request');await wait("!!document.querySelector('[role=dialog] textarea')");assert.equal(aiCalls.length,beforeAi);assert.ok(await js(`document.querySelector('[role=dialog] textarea').value.includes(${JSON.stringify(featureFunction)})`));
      await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Send').click();true");await wait("document.body.textContent.includes('Review AI changes')");
      await js("(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent==='Change summary');const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Return the input plus two');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");await click('Apply to editor');await wait("document.querySelector('[data-testid=mysql-function-window] .cm-content').textContent.includes('RETURN p_value+2')");
      assert.ok(!(await state.client.getFunction({schema:'mb_test',name:featureFunction})).source.includes('RETURN p_value+2'));assert.equal(aiCalls.at(-1).requestType,'coding_function');
      await js("[...document.querySelectorAll('button[aria-label=Close]')].find(e=>e.getBoundingClientRect().width>0).click();true");await compileFunction(true);
      const current=await state.client.getFunction({schema:'mb_test',name:featureFunction});assert.ok(current.source.includes('RETURN p_value+2'));
      const file=path.join(gitRoot,'MonaBase','MYSQL','mb_test','FUNCTION','.objects-v2',require('../../electron/services/gitSourceNames').sourceFileName(featureFunction));assert.equal(fs.readFileSync(file,'utf8'),current.native);
      await js("[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent==='Version Control').click();true");await wait("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Git Commit'&&!e.disabled)");
      await js("[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent==='Version History').click();true");await wait("document.querySelectorAll('[data-testid=mysql-function-window] .MuiDataGrid-row').length===2");
      await js(`document.querySelector('[data-mysql-function="${featureFunction}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:170,clientY:320}));true`);
      await wait(`[...document.querySelectorAll('[data-testid=mysql-function-menu] [role=menuitem]')].some(e=>e.textContent===${JSON.stringify(words.mysql_function_copy_name)})`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-function-menu] [role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.mysql_function_copy_name)}).click();true`);await wait(`document.body.textContent.length>0`);assert.equal(clipboardText,featureFunction);
      await js(`document.querySelector('[data-mysql-function="${featureFunction}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:170,clientY:320}));true`);
      await wait(`[...document.querySelectorAll('[data-testid=mysql-function-menu] [role=menuitem]')].some(e=>e.textContent===${JSON.stringify(words.delete)}&&e.getAttribute('aria-disabled')!=='true')`);await js(`[...document.querySelectorAll('[data-testid=mysql-function-menu] [role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.delete)}).click();true`);
      await wait("!!document.querySelector('[role=dialog] input')");await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(featureFunction)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");
      await wait(`!document.querySelector('[data-mysql-function="${featureFunction}"]')&&!document.querySelector('[role=dialog]')`);assert.equal(fs.existsSync(file),false);await assert.rejects(()=>state.client.getFunction({schema:'mb_test',name:featureFunction}));assert.equal(errors.length,0,errors.join('\n'));
      console.log('MySQL Oracle-style function create, scalar execution, source/information/Git, split, mock AI review, native compile, copy and exact-name deletion passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json');
      console.log('MySQL UI: checking AUTO_INCREMENT live value, review, implicit commit and actual numbering.');
      await selectSidebarTable(table);await js(`document.querySelector('[data-mysql-table="${table}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);await wait("!!document.querySelector('[data-testid=mysql-table-window] .MuiDataGrid-cell')");
      await js("[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent==='Structure').click();true");await wait("!!document.querySelector('[data-testid=mysql-auto-increment]')");
      const before=await state.client.execute(`SELECT id FROM ${table} ORDER BY id`);
      assert.ok(before.rows.length>0);await state.client.execute(`UPDATE ${table} SET label='auto increment pending' WHERE id=:id`,{id:before.rows[0].id});
      await js(`[...document.querySelectorAll('[data-testid=mysql-auto-increment] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_auto_increment_change)}).click();true`);await wait("!!document.querySelector('[role=dialog] input')");
      await js(`(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent===${JSON.stringify(words.mysql_auto_increment_new_value)});const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2000000');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.preview)}).click();true`);await wait("!!document.querySelector('[role=dialog] pre')");assert.ok(await js("document.querySelector('[role=dialog]').textContent.includes('AUTO_INCREMENT = 2000000')"));assert.ok(await js(`document.querySelector('[role=dialog]').textContent.includes(${JSON.stringify(words.mysql_auto_increment_warning)})`));
      assert.equal(await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').disabled"),true);
      await js(`(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent===${JSON.stringify(words.mysql_table_confirm_name.replace('{{name}}',table))});const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(table)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await wait("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent==='Execute'&&!e.disabled)");await js("[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent==='Execute').click();true");await wait("!document.querySelector('[role=dialog]')&&document.querySelector('[data-testid=mysql-auto-increment]').textContent.includes('2000000')");
      assert.equal(state.client.getMainTransactionState(),false);await state.client.rollback();assert.deepEqual((await state.client.execute(`SELECT id FROM ${table} ORDER BY id`)).rows,before.rows);await state.client.execute(`INSERT INTO ${table}(label) VALUES('new auto id')`);assert.equal((await state.client.execute('SELECT LAST_INSERT_ID() n')).rows[0].n,'2000000');await state.client.rollback();
      await js(`[...document.querySelectorAll('[data-testid=mysql-table-structure] button')].find(e=>e.textContent===${JSON.stringify(words.refresh)}).click();true`);await wait("document.querySelector('[data-testid=mysql-auto-increment]').textContent.includes('2000001')");assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL AUTO_INCREMENT live metadata, exact-name SQL review, implicit commit, unchanged IDs, generated ID and refresh passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json'),name=table+'_positive',renamed=name+'_renamed';
      console.log('MySQL UI: checking table-linked CHECK creation, source, enforcement, rename and deletion.');
      const openStructure=async()=>{await tableContext(table,words.open);await wait("!!document.querySelector('[data-testid=mysql-table-window]')");await js(`[...document.querySelectorAll('[data-testid=mysql-table-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.structure)}).click();true`);await wait("!document.querySelector('button[aria-label=Commit]').disabled");};
      const clickCheck=async key=>{await js(`[...document.querySelectorAll('[data-testid=mysql-check-window] button')].find(e=>e.textContent===${JSON.stringify(words[key])}).click();true`);};
      const setName=async value=>{await js(`(()=>{const p=document.querySelector('[data-testid=mysql-check-window]');const label=[...p.querySelectorAll('label')].find(e=>e.textContent.startsWith(${JSON.stringify(words.constraint_name_required)}));const e=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);};
      const confirmCheck=async expected=>{
        await wait("!!document.querySelector('[role=dialog] input')");
        assert.equal(await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).disabled`),true);
        await js(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(expected)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await js(`[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.execute)}).click();true`);
        await wait("!document.querySelector('[role=dialog]')&&!document.querySelector('button[aria-label=Commit]').disabled");
      };
      const nativeCheck=async constraint=>(await state.client.execute("SELECT ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='mb_test' AND TABLE_NAME=:table AND CONSTRAINT_NAME=:constraint",{table,constraint},null,false,true)).rows;
      await openStructure();await js(`(()=>{const p=document.querySelector('[data-testid=mysql-structure-checks]').closest('.MuiPaper-root');[...p.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(words.add)}).click();return true})()`);
      await wait("!!document.querySelector('[data-testid=mysql-check-window] input:not([disabled])')&&!document.querySelector('[data-testid=mysql-check-window] [role=status]')");
      await setName(name);await enterSql('CHAR_LENGTH(label) > 0');await js("document.querySelector('[data-testid=mysql-check-window] input[type=checkbox]').click();true");await clickCheck('create');
      await wait("document.querySelector('[role=dialog]')?.textContent.includes('NOT ENFORCED')");assert.equal((await nativeCheck(name)).length,0);await confirmCheck(name);
      await wait("document.querySelector('[data-testid=mysql-check-window]')?.textContent.includes('Edit Check Constraint')&&!document.querySelector('[data-testid=mysql-check-window] [role=status]')");assert.equal((await nativeCheck(name))[0].ENFORCED,'NO');
      await js(`[...document.querySelectorAll('[data-testid=mysql-check-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.source)}).click();true`);await wait(`document.querySelector('[data-testid=mysql-check-source]').textContent.includes(${JSON.stringify(name)})`);
      await js("document.querySelector('[data-testid=mysql-check-window] button[aria-label=Copy]').click();true");assert.ok(clipboardText.includes(name));assert.ok(clipboardText.includes('NOT ENFORCED'));
      await js(`[...document.querySelectorAll('[data-testid=mysql-check-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.edit)}).click();true`);
      assert.equal(await js("document.querySelector('[data-testid=mysql-check-condition] .cm-content').getAttribute('contenteditable')"),'false');
      await js("document.querySelector('[data-testid=mysql-check-window] input[type=checkbox]').click();true");await clickCheck('change');await confirmCheck(name);assert.equal((await nativeCheck(name))[0].ENFORCED,'YES');
      await setName(renamed);await clickCheck('change');await wait("document.querySelector('[role=dialog]').textContent.includes('DROP CHECK')");await confirmCheck(name);assert.equal((await nativeCheck(name)).length,0);assert.equal((await nativeCheck(renamed))[0].ENFORCED,'YES');
      await openStructure();await js("(()=>{const b=document.querySelector('[data-testid=mysql-structure-checks]');if(b.getAttribute('aria-expanded')==='false')b.click();return true})()");await wait(`document.querySelector('[data-testid=mysql-table-structure]').textContent.includes(${JSON.stringify(renamed)})`);
      await js(`[...document.querySelectorAll('[data-testid=mysql-table-structure] button')].find(e=>e.textContent===${JSON.stringify(renamed)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-check-window]')");
      assert.equal(await js(`[...document.querySelectorAll('main [role=tab]')].filter(e=>e.textContent===${JSON.stringify(renamed)}).length`),1);
      await openStructure();await js(`(()=>{const cell=[...document.querySelectorAll('[data-testid=mysql-table-structure] [data-field=CONSTRAINT_NAME]')].find(e=>e.textContent===${JSON.stringify(renamed)});cell.closest('[role=row]').querySelector('[data-field=__actions] button').click();return true})()`);await confirmCheck(renamed);await wait("!document.querySelector('[data-testid=mysql-check-window]')");assert.equal((await nativeCheck(renamed)).length,0);
      await openStructure();await wait(`!document.querySelector('[data-testid=mysql-table-structure]').textContent.includes(${JSON.stringify(renamed)})`);assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL CHECK create/source/copy, enforced state, atomic rename, dedicated table routing and exact-name delete passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json'),prefix=table+'_import',f=prefix+'_f',p=prefix+'_p',tr=prefix+'_tr';importedObjects.push(['FUNCTION',f],['PROCEDURE',p],['TRIGGER',tr]);
      definitionFile=`DELIMITER $$\nCREATE FUNCTION mb_test.${f}(v INT) RETURNS INT DETERMINISTIC BEGIN RETURN v+1; END$$\nCREATE PROCEDURE mb_test.${p}() BEGIN SELECT 7 AS output_value; END$$\nCREATE TRIGGER mb_test.${tr} BEFORE INSERT ON mb_test.${table} FOR EACH ROW SET NEW.label=CONCAT('I:',NEW.label)$$\nDELIMITER ;\n`;
      await click('View');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.mysql_definition_import)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-definition-import]')");await click(words.open);await wait(`document.querySelector('[data-testid=mysql-definition-import] textarea').value.includes(${JSON.stringify(f)})`);
      await js("document.querySelector('[data-testid=mysql-definition-import] input[type=checkbox]').click();true");await click(words.mysql_database_review);await wait("document.querySelectorAll('[data-testid=mysql-definition-import] details').length===3");await click(words.execute);
      await wait(`[...document.querySelectorAll('[data-testid=mysql-definition-import] button')].some(e=>e.textContent===${JSON.stringify(words.close)}&&!e.disabled)`);assert.equal(Number((await state.client.execute('SELECT mb_test.'+f+'(4) value')).rows[0].value),5);
      await state.client.execute('INSERT INTO '+table+"(label) VALUES('imported')");assert.equal((await state.client.execute('SELECT COUNT(*) n FROM '+table+" WHERE label='I:imported'")).rows[0].n,'1');await state.client.rollback();
      for(const [kind,name] of importedObjects){const file=path.join(gitRoot,'MonaBase','MYSQL','mb_test',kind,'.objects-v2',require('../../electron/services/gitSourceNames').sourceFileName(name));assert.ok(fs.readFileSync(file,'utf8').includes(name));}
      await click(words.close);await wait("!document.querySelector('[data-testid=mysql-definition-import]')");assert.equal(errors.length,0,errors.join('\n'));console.log('MySQL real mixed definition file, SQL review, one-use apply, native trigger rollback and opt-in Git snapshots passed.');
    }
    if(features){
      const words=require('../../src/locales/en.json'),ownedTable=table+'_trace_rows',ownedFunction=table+'_trace_cursor';
      const query=sql=>state.client.main.promise().query(sql);
      const openFunction=async()=>{await js(`window.dispatchEvent(new CustomEvent('mysql-open-object',{detail:{schema:'mb_test',name:${JSON.stringify(ownedFunction)},type:'FUNCTION'}}));true`);await wait(`document.querySelector('[data-testid=mysql-function-window]')?.textContent.includes(${JSON.stringify(ownedFunction)})`);};
      try{
        await query(`CREATE TABLE ${ownedTable}(id INT PRIMARY KEY,amount INT) ENGINE=InnoDB`);
        await query(`INSERT INTO ${ownedTable} VALUES(1,10),(2,20),(999,777)`);await state.client.commit();
        await query(`CREATE FUNCTION ${ownedFunction}() RETURNS INT DETERMINISTIC READS SQL DATA BEGIN
DECLARE done INT DEFAULT 0; DECLARE v INT DEFAULT 0; DECLARE total INT DEFAULT 0;
DECLARE cur CURSOR FOR SELECT amount FROM ${ownedTable} ORDER BY id;
DECLARE CONTINUE HANDLER FOR NOT FOUND SET done=1;
OPEN cur;
read_loop: LOOP
FETCH cur INTO v;
IF done=1 THEN LEAVE read_loop; END IF;
BEGIN
DECLARE v_copy INT DEFAULT 0;
SET v_copy=v;
SET total=total+v_copy;
END;
END LOOP read_loop;
CLOSE cur;
RETURN total;
END`);
        await openFunction();
        await wait(`document.querySelector('[data-testid=mysql-function-window] .cm-content')?.textContent.includes(${JSON.stringify(ownedTable)})`);
        const savedEditorSource=(await require('../../electron/mysql/procedureService').getProcedure(state.client,{schema:'mb_test',name:ownedFunction},'FUNCTION')).source;
        await enterSql('CREATE FUNCTION demo(p_input INT) RETURNS INT BEGIN DECLARE local_value INT; SET local_');
        await js("(()=>{const e=[...document.querySelectorAll('[data-testid=mysql-function-window] .cm-content')].find(e=>e.getBoundingClientRect().width>0);e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',ctrlKey:true,bubbles:true,cancelable:true}));return true})()");
        await wait("[...document.querySelectorAll('.cm-tooltip-autocomplete [role=option]')].some(e=>e.textContent.includes('local_value'))");
        await js("[...document.querySelectorAll('[data-testid=mysql-function-window] .cm-content')].find(e=>e.getBoundingClientRect().width>0).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));true");
        await enterSql(savedEditorSource);
        await wait(`document.querySelector('[data-testid=mysql-function-window] .cm-content')?.textContent.includes(${JSON.stringify(ownedTable)})`);
        await js("[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent==='Information').click();true");
        await wait(`document.querySelector('[data-testid=mysql-routine-dependencies]')?.textContent.includes(${JSON.stringify(ownedTable)})`);
        await js(`[...document.querySelectorAll('[data-testid=mysql-routine-dependencies] button')].find(e=>e.textContent.includes(${JSON.stringify(ownedTable)})).click();true`);
        await wait(`[...document.querySelectorAll('[data-testid=mysql-table-data]')].some(e=>e.getBoundingClientRect().width>0&&e.textContent.includes('777'))`);
        await openFunction();await js(`[...document.querySelectorAll('[data-testid=mysql-function-window] [role=tab]')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_tab)}).click();true`);
        await wait("!!document.querySelector('[data-testid=mysql-trace-fixtures] textarea')");
        await js(`(()=>{const e=document.querySelector('[data-testid=mysql-trace-fixtures] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify({[ownedTable]:[{id:1,amount:10},{id:2,amount:20}]}))});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await wait(`[...document.querySelectorAll('[data-testid=mysql-trace-panel] button')].some(e=>e.textContent===${JSON.stringify(words.mysql_trace_run)}&&!e.disabled)`);
        await js(`[...document.querySelectorAll('[data-testid=mysql-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_run)}).click();true`);
        await wait("document.querySelector('[data-testid=mysql-trace-panel]')?.textContent.includes('RETURN_VALUE: 30')");
        await js(`[...document.querySelectorAll('[data-testid=mysql-trace-panel] button')].find(e=>e.textContent===${JSON.stringify(words.mysql_trace_next)}).click();true`);
        await wait("document.querySelector('[data-testid=mysql-trace-panel]').textContent.includes('total: 0')");
        assert.equal(Number((await query('SELECT SUM(amount) n FROM '+ownedTable))[0][0][0]),807);
        assert.equal(errors.length,0,errors.join('\n'));
        console.log('MySQL routine dependency navigation, explicit SQL fixtures, cursor/NOT FOUND trace replay and unchanged original rows passed.');
      }finally{
        await state.client.rollback();
        const identity=require('../../electron/services/traceFiles').createTraceIdentity(state.client.lastConfig,{schema:'mb_test',objectName:ownedFunction,objectType:'FUNCTION'});
        require('../../electron/services/traceStore').createTraceDatabase('mysql').deleteDatabase(identity);
        await query('DROP FUNCTION IF EXISTS '+ownedFunction);await query('DROP TABLE IF EXISTS '+ownedTable);
      }
    }
    {
      const words=require('../../src/locales/en.json'),before=real?state.client.getTransactionDetails():null;
      await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.user_settings)}).click();true`);
      await wait(`document.querySelector('[data-testid=mysql-user-role-tab]')?.textContent.includes(${JSON.stringify(words.mysql_user_self_scope)})`);
      await wait("document.querySelector('[data-testid=mysql-user-role-tab]').textContent.includes('SHOW GRANTS')");
      assert.equal(await js(`[...document.querySelectorAll('[data-testid=mysql-user-role-tab] button')].find(e=>e.textContent===${JSON.stringify(words.create_new)}).disabled`),true);
      const ratio=await js("Number(document.querySelector('[data-testid=mysql-user-role-tab] [role=separator]').getAttribute('aria-valuenow'))");await js("document.querySelector('[data-testid=mysql-user-role-tab] [role=separator]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));true");await wait(`Number(document.querySelector('[data-testid=mysql-user-role-tab] [role=separator]').getAttribute('aria-valuenow'))>${ratio}`);
      if(real)assert.deepEqual(state.client.getTransactionDetails(),before);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:${process.platform==='darwin'},ctrlKey:${process.platform!=='darwin'},bubbles:true,cancelable:true}));true`);await wait("!document.querySelector('[data-testid=mysql-user-role-tab]')");
      console.log('MySQL DBA user menu, restricted own-account/grants view, protected actions, split and main transaction preservation passed.');
      await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.object_privileges)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-object-privilege-tab]')");assert.equal(await js(`[...document.querySelectorAll('[data-testid=mysql-object-privilege-tab] button')].find(e=>e.textContent===${JSON.stringify(words.refresh)}).disabled`),true);
      if(real){
       await js(`[...document.querySelectorAll('[data-testid=mysql-object-privilege-tab] button')].find(e=>e.textContent===${JSON.stringify(words.target_object_2)}).click();true`);await wait(`[...document.querySelectorAll('[role=dialog] [role=option]')].some(e=>e.textContent.includes(${JSON.stringify(table)}))`);await js(`[...document.querySelectorAll('[role=dialog] [role=option]')].find(e=>e.textContent.includes(${JSON.stringify(table)})).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);await wait(`document.querySelector('[data-testid=mysql-object-privilege-tab]')?.textContent.includes(${JSON.stringify(words.mysql_obj_limited)})`);assert.equal(await js("[...document.querySelectorAll('[data-testid=mysql-object-privilege-tab] .MuiDataGrid-row input[type=checkbox]')].some(e=>!e.disabled)"),false);assert.deepEqual(state.client.getTransactionDetails(),before);
      }
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:${process.platform==='darwin'},ctrlKey:${process.platform!=='darwin'},bubbles:true,cancelable:true}));true`);await wait("!document.querySelector('[data-testid=mysql-object-privilege-tab]')");
      console.log('MySQL DBA object privileges menu, target selection and restricted main-session preservation passed.');
      await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.session_management)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-session-tab] .MuiDataGrid-row')");assert.equal(await js(`[...document.querySelectorAll('[data-testid=mysql-session-tab] button')].find(e=>e.textContent===${JSON.stringify(words.kill_session)}).disabled`),true);
      if(real){const pid=String(state.client.main.threadId);await js(`(()=>{const label=[...document.querySelectorAll('[data-testid=mysql-session-tab] label')].find(e=>e.textContent===${JSON.stringify(words.session_search)}),input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(pid)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await wait(`[...document.querySelectorAll('[data-testid=mysql-session-tab] [data-field=connectionId]')].some(e=>e.textContent===${JSON.stringify(pid)})`);await js(`[...document.querySelectorAll('[data-testid=mysql-session-tab] [data-field=connectionId]')].find(e=>e.textContent===${JSON.stringify(pid)}).closest('[role=row]').click();true`);await wait("document.querySelector('[data-testid=mysql-session-tab]').textContent.includes('"+words.mysql_session_selected.split('{{id}}')[0]+"')");assert.deepEqual(state.client.getTransactionDetails(),before);}
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:${process.platform==='darwin'},ctrlKey:${process.platform!=='darwin'},bubbles:true,cancelable:true}));true`);await wait("!document.querySelector('[data-testid=mysql-session-tab]')");console.log('MySQL DBA session menu, protected own connection and unchanged main transaction passed.');
      await click('DBA');await js(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(words.lock_management)}).click();true`);await wait("!!document.querySelector('[data-testid=mysql-lock-tab]')");
      if(real){await wait(`document.querySelector('[data-testid=mysql-lock-tab]').textContent.includes(${JSON.stringify(words.mysql_lock_read_failed)})`);assert.deepEqual(state.client.getTransactionDetails(),before);}
      assert.equal(await js(`[...document.querySelectorAll('[data-testid=mysql-lock-tab] button')].find(e=>e.textContent===${JSON.stringify(words.lock_kill_selected)}).disabled`),true);console.log('MySQL DBA lock menu, explicit catalog-denied state, protected actions and main transaction preservation passed.');



    }
    if (features) console.log('MySQL Git/AI assertions completed.');
    if (process.env.MONABASE_MYSQL_UI_CAPTURE === '1') {
      win.show();
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const captureDirectory = path.join(root, 'local/mysql-implementation-20261112');
      fs.mkdirSync(captureDirectory, { recursive: true });
      const capture = path.join(captureDirectory, `ui-alignment-${settings.theme}-${Date.now()}.png`);
      fs.writeFileSync(capture, (await Promise.race([win.webContents.capturePage(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('MySQL UI capture timed out.')), 10000))])).toPNG(), { flag: 'wx' });
      console.log('MySQL UI capture:', capture);
    }
    console.log(`MySQL ${development ? 'development ESM' : 'production build'} / ${real ? 'real-database' : 'mock'} UI checks passed.`);
  } finally {
    if (features) console.log('MySQL UI: cleaning disposable fixtures.');
    if(state.client&&featureTrigger){const identity=require('../../electron/services/traceFiles').createTraceIdentity(state.client.lastConfig,{schema:'mb_test',objectName:featureTrigger,objectType:'TRIGGER'});require('../../electron/services/traceStore').createTraceDatabase('mysql').deleteDatabase(identity);}
    if(state.client&&featureFunction){const identity=require('../../electron/services/traceFiles').createTraceIdentity(state.client.lastConfig,{schema:'mb_test',objectName:featureFunction,objectType:'FUNCTION'});require('../../electron/services/traceStore').createTraceDatabase('mysql').deleteDatabase(identity);}
    if (state.client) {
      try { await state.client.rollback();for(const [kind,name] of importedObjects.reverse())await state.client.main.promise().query('DROP '+kind+' IF EXISTS `'+name+'`'); for (const view of builderViews) await state.client.main.promise().query(`DROP VIEW IF EXISTS ${view}`); if(featureFunction)await state.client.main.promise().query(`DROP FUNCTION IF EXISTS ${featureFunction}`); if (featureProcedure) await state.client.main.promise().query(`DROP PROCEDURE IF EXISTS ${featureProcedure}`); for (const extra of [...sidebarFixtures].reverse()) await state.client.execute(`DROP TABLE IF EXISTS ${extra}`); if (featureChild) await state.client.execute(`DROP TABLE IF EXISTS ${featureChild}`); if (created) await state.client.execute(`DROP TABLE ${table}`); }
      finally { await state.client.disconnect(); }
    }
    if(databaseSandbox)await databaseSandbox.close();
    if(sshTestServer)await sshTestServer.close();
    if (gitRoot) fs.rmSync(gitRoot, { recursive: true, force: true });
  }
}).then(() => { clearTimeout(timer); win?.destroy(); fs.rmSync(temporary, { recursive: true, force: true }); app.quit(); }).catch(error => { console.error(error.stack); app.exit(1); });
