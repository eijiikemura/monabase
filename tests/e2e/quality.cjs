// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'monabase-quality-ui-'));
app.disableHardwareAcceleration();app.setPath('userData',path.join(temporary,'profile'));
let db='oracle',language='en',saved=[],calls=0,checkCalls=0,win;
const settings=require('../../electron/services/settings').createSettingsStore({app:{isReady:()=>true,getLocale:()=>language},SETTINGS_FILE:path.join(temporary,'settings.json'),t:k=>k,setLanguage(){}}).load();
ipcMain.handle('load-settings',()=>({...settings,language}));
ipcMain.handle('get-connections',()=>[{name:'Quality fixture',dbType:db,user:'test',database:'test',host:'fixture.invalid',password:''}]);
for(const [channel,value]of Object.entries({'connect-db':{success:true},'get-schemas':{success:true,schemas:['test']},'get-db-info':{success:true,info:'Quality fixture'},'get-ai-settings':{success:true,isAiEnabled:false},'git-status-check':{success:true,isRepo:false},'get-sql-history':[],'get-objects':{success:true,objects:[]},'get-columns':{success:true,columns:[]},'get-app-version':'1.1.1','report-focus-state':{},'get-focus-diagnostics':[],'execute-sql-bg':{success:true,rows:[]}}))ipcMain.handle(channel,()=>value);
ipcMain.handle('show-save-dialog',()=>({canceled:false,filePath:path.join(temporary,'result.json'),writeToken:'fixture'}));
ipcMain.handle('save-file',(_e,_file,text)=>{saved.push(JSON.parse(text));return{success:true};});
ipcMain.handle('execute-stored',()=>{calls++;return{success:true,returnValues:[{name:'RETURN_VALUE',value:15}],hasUncommittedTx:true};});
ipcMain.handle('execute-regression-check',()=>{checkCalls++;return{success:true,rows:[{n:17}],metaData:[{name:'n'}],executionTime:1,hasUncommittedTx:true};});
ipcMain.handle('inspect-sql-privacy', (_event, statements, dialect) => statements.map(sql => require('../../electron/services/sqlPrivacy').inspectSqlPrivacy(sql, dialect)));
ipcMain.handle('begin-sql-batch',()=>({success:true}));
ipcMain.handle('end-sql-batch',()=>({success:true}));
ipcMain.handle('add-sql-history',()=>[]);
ipcMain.handle('execute-sql',()=>({success:true,rows:[{email:'demo@example.invalid'}],metaData:[{name:'email',dbTypeName:'VARCHAR'}],executionTime:1,hasUncommittedTx:false}));
const errors=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const js=code=>win.webContents.executeJavaScript(code,true);
async function wait(code){for(let i=0;i<150;i++){if(await js(code))return;await pause(80);}throw Error('Quality UI timeout: '+code);}
async function click(selector,text){await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing quality control: '+${JSON.stringify(text)});e.click();return true})()`);}
async function file(index,value){await js(`(()=>{const e=[...document.querySelectorAll('[role=dialog] input[type=file]')][${index}],transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(value))}],'result.json',{type:'application/json'}));e.files=transfer.files;e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await pause(100);}
async function select(label,value){await js(`(()=>{const label=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()===${JSON.stringify(label)});label.closest('.MuiFormControl-root').querySelector('[role=combobox]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`);await wait("!!document.querySelector('[role=listbox]')");await js(`document.querySelector('[role=option][data-value="${value}"]').click();true`);}
const timer=setTimeout(()=>{console.error('Quality UI timed out');app.exit(1);},120000);
app.whenReady().then(async()=>{
 win=new BrowserWindow({width:1400,height:1000,show:false,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 win.webContents.session.webRequest.onBeforeRequest({urls:['<all_urls>']},(request,done)=>done({cancel:/^https?:/.test(request.url)}));
 for(const database of ['oracle','postgresql','mysql'])for(const lang of ['en','ja']){
  db=database;language=lang;const words=JSON.parse(fs.readFileSync(path.join(root,'src/locales',lang+'.json'),'utf8'));
  await win.loadFile(path.join(root,'dist/index.html'));await wait(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===${JSON.stringify(words.connect)})`);await click('button',words.connect);
  await wait(`Array.from(document.querySelectorAll('header button')).some(e=>e.textContent.trim()===${JSON.stringify(words.quality_tools)})`);await click('header button',words.quality_tools);await click('[role=menuitem]',words.quality_masking);
  await wait("!!document.querySelector('[role=dialog] input[type=file]')");
  const snapshot={format:'monabase-result',version:1,columns:['email'],rows:[['private@example.com'],['private@example.com'],[null]]};
  await file(0,snapshot);await wait(`Array.from(document.querySelectorAll('[role=dialog] label')).some(e=>e.textContent===${JSON.stringify(words.quality_mask_rule)})`);await select(words.quality_mask_rule,'email');await click('[role=dialog] button',words.quality_mask_generate);await wait("!!document.querySelector('[role=dialog] table')");
  const priorSaves=saved.length;await click('[role=dialog] button',words.quality_mask_export);for(let attempt=0;attempt<100&&saved.length===priorSaves;attempt++)await pause(20);assert.ok(saved.length>priorSaves);const masked=saved.at(-1);assert.equal(masked.rows[0][0],masked.rows[1][0]);assert.ok(!JSON.stringify(masked).includes('private@example.com'));assert.equal(masked.rows[2][0],null);
  await click('[role=dialog] [role=tab]',words.quality_comparison);await file(1,snapshot);await file(2,{...snapshot,rows:[snapshot.rows[2],snapshot.rows[0],snapshot.rows[1]]});await click('[role=dialog] button',words.quality_compare);
  await wait(`document.querySelector('[role=dialog]').textContent.includes(${JSON.stringify(words.quality_equal)})`);
  await click('[role=dialog] [role=tab]',words.quality_regression);
  const request={schema:'test',objectName:'loop_sum',objectType:'FUNCTION',args:{p:5},argTypes:{p:'INT'},argDirections:{p:'IN'},inputDateFormat:'YYYY-MM-DD'},suite={format:'monabase-regression',version:1,dbType:db,cases:[{id:'one',name:'loop sum',request,expected:{returnValues:[{name:'RETURN_VALUE',value:15}],resultSets:[]},checks:[{sql:'SELECT n FROM fixture',binds:{},expected:{format:'monabase-result',version:1,columns:['n'],rows:[[17]]}}]}]};
  await file(3,suite);const before=calls;assert.equal(await js(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent===${JSON.stringify(words.quality_run_suite)});return b.disabled})()`),true);assert.equal(calls,before);
  // The comparison checkbox is hidden; choose the visible regression confirmation explicitly.
  await js("(()=>{const e=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')].find(e=>e.getBoundingClientRect().width>0);if(!e.checked)e.click();return true})()");
  await click('[role=dialog] button',words.quality_run_suite);await wait(`document.querySelector('[role=dialog]').textContent.includes(${JSON.stringify(words.quality_passed)})`);assert.equal(calls,before+1);assert.ok(checkCalls>0);
  await click('[role=dialog] button',words.quality_add_case);await wait("JSON.parse(document.querySelector('[role=dialog] textarea').value).cases.length===2");
  await click('[role=dialog] button',words.close);await wait("!document.querySelector('[role=dialog]')");
  await js("window.dispatchEvent(new CustomEvent('open-sql-tab',{detail:{initialSql:\"SELECT 'demo@example.invalid' AS email\"}}));true");
  await wait("[...document.querySelectorAll('.cm-content')].some(e=>e.getBoundingClientRect().width>0)");
  if(db==='postgresql'){
   await js(`(()=>{const input=[...document.querySelectorAll('input')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(words.schema_selection)}&&e.closest('.MuiFormControl-root').getBoundingClientRect().width>0);const control=input?input.closest('.MuiFormControl-root').querySelector('[role=combobox]'):[...document.querySelectorAll('[role=combobox]')].find(e=>e.getBoundingClientRect().width>0&&e.getAttribute('aria-label')===${JSON.stringify(words.schema_selection)});control.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`);
   await wait("!!document.querySelector('[role=option][data-value=test]')");await js("document.querySelector('[role=option][data-value=test]').click();true");
  }
  await js(`[...document.querySelectorAll('button')].find(e=>e.getBoundingClientRect().width>0&&e.getAttribute('aria-label')===${JSON.stringify(words.execute_sql)}).click();true`);
  await wait(`[...document.querySelectorAll('[data-testid=sql-result-toolbar] button')].some(e=>e.getBoundingClientRect().width>0&&!e.disabled&&e.getAttribute('aria-label')===${JSON.stringify(words.quality_comparison)})`);
  await js(`[...document.querySelectorAll('[data-testid=sql-result-toolbar] button')].find(e=>e.getBoundingClientRect().width>0&&e.getAttribute('aria-label')===${JSON.stringify(words.quality_comparison)}).click();true`);
  await wait("!!document.querySelector('[role=dialog]')");
  assert.equal(await js("[...document.querySelectorAll('[role=dialog] button')].filter(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()==="+JSON.stringify(words.quality_use_current)+").every(e=>!e.disabled)"),true);
  console.log('Quality UI: masking, comparison, guarded suite, captured execution:',db,lang);
 }
 assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timer);win?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.quit();});
