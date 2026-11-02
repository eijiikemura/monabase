// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { createHookHarness } = require('../helpers/renderHook.cjs');
const { createDatabaseIpc } = require('../helpers/ddlEditors.cjs');
const { scanSql } = require('../../electron/services/sqlTokens');
const { safeAiError } = require('../../electron/services/aiErrors');
const { authorizeEffect, createPaidSession } = require('./effect.cjs');
const { getAiDatabaseContext } = require('../../electron/services/aiDatabaseContext');
const { buildRequestEvidence, emptyRequestBrief } = loadTypeScript('src/features/ai/requestEvidence.ts');
const { readKey } = require('./runner.cjs');
const q = value => '"' + value.replaceAll('"', '""') + '"';
const qualified = (schema,name) => `${q(schema)}.${q(name)}`;
const common = { i18next: { t: key => key }, '@/shared/api/desktop': { ipcRenderer: {} } };
const stored = loadTypeScript('src/features/stored/storedCreation.ts',common);
const packages = loadTypeScript('src/features/stored/packageCreation.ts',common);
const coding = loadTypeScript('src/features/ai/codingResponse.ts',common);
const triggers = loadTypeScript('src/features/ai/triggerBodyResponse.ts',{'./codingResponse':coding});
const shippingSpec = '送料はp_amountがNULLならNULL、200以上なら0、それ未満（負数を含む）なら10。入力値は変更しません。';
function plan(token = `MBT_${randomBytes(6).toString('hex').toUpperCase()}`) {
  assert.match(token,/^MBT_[A-F0-9]{12}$/);
  const result=[];
  for(const db of ['postgresql','oracle']) {
    const schema=db==='oracle'?'TEST':'test';
    for(const kind of ['FUNCTION','PROCEDURE','TRIGGER',...(db==='oracle'?['PACKAGE','PACKAGE BODY']:[])]) {
      const name=token+({FUNCTION:'_FN',PROCEDURE:'_PR',TRIGGER:'_TR',PACKAGE:'_PK','PACKAGE BODY':'_PK'}[kind]);
      const table=token+(kind==='TRIGGER'?'_TT':kind.startsWith('PACKAGE')?'_KT':'_PT');
      const spec={db,schema,kind,name,table,qualified:qualified(schema,name),target:qualified(schema,table)};
      const number=db==='oracle'?'NUMBER':'numeric';
      spec.request=kind==='FUNCTION'?`${spec.qualified}(p_amount ${number})というファンクションを作成してください。戻り値は${number}。${shippingSpec}`
        :kind==='PROCEDURE'?`${spec.qualified}(p_id ${db==='oracle'?'IN NUMBER':'IN integer'}, p_delta IN ${number}, p_changed OUT ${db==='oracle'?'NUMBER':'integer'})というプロシージャを作成してください。${spec.target}でID=p_idの行だけAMOUNTを増減し、更新件数をp_changedで返してください。AMOUNTもp_deltaもNULLならそれぞれ0として計算します。該当なし・p_idがNULLなら更新0件です。他行・SHIPPING・NOTEを変更せず、COMMIT/ROLLBACKをしません。`
        :kind==='TRIGGER'?`対象テーブル${spec.target}のトリガー${q(name)}を新規作成してください。BEFORE INSERT OR UPDATE、FOR EACH ROWにしてください。INSERT時およびAMOUNTの値が実際に変わるUPDATE時だけ、SHIPPINGを計算します。NULL→値、値→NULLも変更として扱います。送料はAMOUNTがNULLならNULL、200以上なら0、それ未満（負数を含む）なら10。NOTEだけの変更・AMOUNTが同じ値のUPDATEではSHIPPINGをそのまま保持します。ID・AMOUNT・NOTEを変更せず、他の表への書込みやCOMMITをしません。NEW/OLDの列名は二重引用符で保持してください。`
        :`${spec.qualified}の${kind==='PACKAGE'?'仕様部':'本体'}を作成してください。shipping(p_amount IN NUMBER) RETURN NUMBERとshipping(p_amount IN NUMBER,p_priority IN NUMBER) RETURN NUMBERのオーバーロード2つ、adjust(p_id IN NUMBER,p_delta IN NUMBER,p_changed OUT NUMBER)を含めます。${shippingSpec} 2引数版は基本送料へp_priority=1の場合だけ5を加算し、それ以外（NULLを含む）は基本送料のままです。p_amountがNULLなら2引数版もNULL。adjustは${spec.target}のID=p_idだけAMOUNTへp_deltaを足し、更新件数を返します。AMOUNT/p_deltaはNULLなら0、対象なし・p_id=NULLなら更新0件。他行・SHIPPING・NOTEは変更せず、COMMIT/ROLLBACKはしません。`;
      spec.request+=`\nスキーマ・オブジェクト・列名は指定どおりの二重引用符を保持し、${db==='postgresql'?'PL/pgSQL':'PL/SQL'}で実装してください。テーブル列は"ID" ${db==='oracle'?'NUMBER':'integer'} PRIMARY KEY, "AMOUNT" ${number}, "SHIPPING" ${number}, "NOTE" ${db==='oracle'?'VARCHAR2(40)':'varchar(40)'}です。指定オブジェクト以外の定義、動的SQL、DB権限・設定変更、外部処理、トランザクション確定は不要です。`;
      result.push(spec);
    }
  }
  return result;
}
function generation(spec) {
  const h=createHookHarness(), applied=[];
  const {useAiCodingGeneration}=loadTypeScript('src/features/ai/useAiCodingGeneration.ts',{
    react:h.react,'react-i18next':{useTranslation:()=>({t:key=>key,i18n:{language:'ja'}})},
    '../stored/storedCreation':stored,'../stored/packageCreation':packages,'./codingResponse':coding,'./triggerBodyResponse':triggers
  },{queueMicrotask,window:{addEventListener(){},removeEventListener(){}}});
  const options={dbType:spec.db,schema:spec.schema,objectName:spec.name,objectType:spec.kind,sourceText:'',setSourceText:source=>applied.push({source}),isNew:true,isActive:true,onStart(){},triggerTargetType:'TABLE',triggerSettings:JSON.stringify({timing:'BEFORE',events:['INSERT','UPDATE'],forEachRow:true}),applyTriggerResponse:(source,settings)=>applied.push({source,settings})};
  const g=h.render(()=>useAiCodingGeneration(options));h.commit();
  return {prompt:g.responseTarget.getReferencePrompt(),adopt(answer){g.responseTarget.start();const review=g.responseTarget.review(answer);assert.ok(review);review.apply();assert.equal(applied.length,1);return applied[0];},dispose:()=>h.unmount()};
}
function inspectSource(source,spec) {
  assert.ok(typeof source==='string'&&source.length<20000);
  const expand=text=>scanSql(text,spec.db).flatMap(token=>token.kind==='quoted'&&token.text.startsWith('$')?expand(token.text.replace(/^\$[^$]*\$/,'').replace(/\$[^$]*\$$/,'')):[token]);
  const tokens=expand(source),words=tokens.filter(t=>t.kind==='word').map(t=>t.text.toUpperCase());
  const denied=new Set(['ALTER','DROP','TRUNCATE','GRANT','REVOKE','COMMIT','ROLLBACK','EXECUTE','EXEC','PRAGMA','AUTONOMOUS_TRANSACTION','SECURITY','SET_CONFIG','COPY','CALL','DO','DELETE','INSERT','MERGE','SELECT','PERFORM']);
  assert.ok(!words.some(w=>denied.has(w)||/^(?:DBMS_|UTL_|PG_|DBLINK)/.test(w)),'Source contains an operation outside the reviewed program fixture.');
  assert.equal(words.filter(w=>w==='CREATE').length,spec.kind==='TRIGGER'?0:1,'Only one program definition is permitted.');
  const code=tokens.map(t=>t.text).join(' ');
  for(const match of code.matchAll(/\bUPDATE\s+("[^"]+"\s*\.\s*"[^"]+")/gi)) {
    assert.equal(match[1].replace(/\s+/g,''),spec.target);
    assert.ok(spec.kind==='PROCEDURE'||spec.kind==='PACKAGE BODY');
  }
  for(let i=0;i<tokens.length;i++)if(tokens[i].kind==='word'&&tokens[i].text.toUpperCase()==='UPDATE') {
    assert.ok(spec.kind==='PROCEDURE'||spec.kind==='PACKAGE BODY');
    assert.equal(tokens[i+1]?.text,q(spec.schema));assert.equal(tokens[i+2]?.text,'.');assert.equal(tokens[i+3]?.text,q(spec.table));
  }
  for(let i=0;i<tokens.length-2;i++) if(tokens[i].kind==='quoted'&&tokens[i].text.startsWith('"')&&tokens[i+1].text==='.'&&tokens[i+2].kind==='quoted') {
    assert.equal(tokens[i].text,q(spec.schema),'Only the dedicated schema may be referenced.');
    assert.ok([q(spec.name),q(spec.table)].includes(tokens[i+2].text),'Only run-owned qualified objects may be referenced.');
  }
  return source.replace(/\n\s*\/\s*$/,'').trim();
}
function validateAnswer(answer,spec) {
  const response=spec.kind==='TRIGGER'?triggers.parseTriggerCodingResponse(answer,spec.db,'TABLE'):coding.parseCodingResponse(answer);
  assert.equal(response.status,'success','AI must provide an implementation rather than a question/error.');
  if(spec.kind==='TRIGGER') {
    triggers.validateTriggerBody(response.source);assert.equal(response.settings.timing,'BEFORE');assert.equal(response.settings.forEachRow,true);assert.deepEqual([...response.settings.events].sort(),['INSERT','UPDATE']);
  } else {
    const identity=spec.kind.startsWith('PACKAGE')?packages.parsePackageIdentity(response.source,spec.schema,spec.kind):stored.parseStoredIdentity(response.source,spec.db,spec.schema,spec.kind);
    assert.equal(identity.schema,spec.schema);assert.equal(identity.objectName,spec.name);
  }
  inspectSource(response.source,spec);
  const g=generation(spec);try{return g.adopt(answer);}finally{g.dispose();}
}
function diagnosticTrigger(answer,spec) {
  assert.equal(spec.kind,'TRIGGER');
  const value=JSON.parse(answer);assert.equal(value.status,'success');assert.equal(Object.hasOwn(value,'message'),false);
  const adopted=validateAnswer(JSON.stringify({...value,message:''}),spec);
  assert.equal(adopted.source,value.source,'Diagnostic envelope completion must never change AI code.');
  return adopted;
}
const digest = value=>createHash('sha256').update(value).digest('hex');
function loadReviewed(file,hash) {
  const text=fs.readFileSync(file,'utf8');assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(digest(text),hash,'Saved code changed after review.');
  const record=JSON.parse(text);assert.equal(record.entries.length,8);
  const expected=plan(record.token);
  for(let i=0;i<expected.length;i++){assert.deepEqual(record.entries[i].spec,expected[i]);if(!['rejected','blocked'].includes(record.entries[i].status))validateAnswer(record.entries[i].answer,expected[i]);}
  return record;
}
async function prepare(apiKey, resumeFile, only, model='gpt-4o-mini') {
  const environments = new Map();
  const environmentFor = async db => {
    if (environments.has(db)) return environments.get(db);
    const config = JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8'))[db];
    assert.equal(config.user, 'test'); assert.equal(config.schema, 'test');
    const Client = loadModule(`electron/${db === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`, { electron: { app: { isPackaged: true } } }, {}, { strict: false });
    const client = new Client();
    try {
      await client.connect(config);
      const environment = await getAiDatabaseContext(client, db);
      assert.equal(environment.schema.toLowerCase(), 'test');
      environments.set(db, environment); return environment;
    } catch { throw new Error(`${db}: dedicated AI environment read failed.`); }
    finally { await client.disconnect(); }
  };
  let record=resumeFile?JSON.parse(fs.readFileSync(resumeFile,'utf8')):null;
  const specs=plan(record?.token);
  record??={generatedAt:new Date().toISOString(),token:specs[0].name.slice(0,16),entries:[]};
  for(const entry of record.entries)assert.deepEqual(entry.spec,specs.find(s=>s.db===entry.spec.db&&s.kind===entry.spec.kind));
  const directory=path.resolve('local/ai-test-reports');fs.mkdirSync(directory,{recursive:true});
  const file=resumeFile?path.resolve(resumeFile):path.join(directory,`program-responses-${Date.now()}.json`);
  for(const spec of specs) {
    if(only&&!only.includes(`${spec.db}:${spec.kind.replaceAll(' ','_')}`))continue;
    const previous=record.entries.find(e=>e.spec.db===spec.db&&e.spec.kind===spec.kind);
    if(previous?.status==='format-checked-not-executed'&&(!only||previous.model===model)){validateAnswer(previous.answer,spec);console.log(`REUSED ${spec.db} ${spec.kind}; no API request`);continue;}
    const g=generation(spec);
    const requestType='coding_'+(spec.kind.startsWith('PACKAGE')?'package':spec.kind.toLowerCase());
    const paid=createPaidSession(apiKey,globalThis.fetch,{requestType,maxRequests:1,model});
    try {
      const header=spec.kind==='PACKAGE BODY'?record.entries.find(e=>e.spec.kind==='PACKAGE')?.adopted?.source:'';
      if(spec.kind==='PACKAGE BODY'&&!header){const entry=previous||{spec};Object.assign(entry,{status:'blocked',error:'The AI package header was rejected.'});if(!previous)record.entries.push(entry);fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});continue;}
      const response=await paid.ask([g.prompt,buildRequestEvidence(await environmentFor(spec.db), {
        ...emptyRequestBrief(), expectedResult: spec.request,
        constraints: 'Preserve the exact requested schema, object identity, argument types and return types. Do not change transaction control. Use only the declared test fixtures.'
      }),spec.request,...(header?['対応する仕様部（この宣言を保って本体を実装してください）:',header]:[]),
        `The exact object name is ${spec.qualified}. The requested object kind is ${spec.kind}. The name has already been supplied; do not ask for it again.`,
        '最終回答はJSONオブジェクト1つだけにしてください。status,source,messageの全項目（トリガーではsettingsも）を必須とし、成功時もmessageは空文字列で含めてください。実装コード全文はsourceのJSON文字列へ格納し、改行・引用符をエスケープしてください。例示の「トリガー本体」をそのまま返したり、JSONの後へ別のコードを追加したりしないでください。',
        ...(spec.kind==='TRIGGER'?['NEW/OLDは擬似レコード名なので二重引用符で囲まないでください。列名だけNEW."AMOUNT"や:NEW."AMOUNT"のように二重引用符を保持してください。',
          'The source property must contain only the actual DECLARE/BEGIN ... END; block text, not another JSON object and not a placeholder. Put settings beside source, never inside it. Do not add code outside the JSON object. Do not wrap the SQL block in braces or extra quotes.']:[])].join('\n\n'));
      const entry=previous||{spec};
      if(previous?.answer)entry.attempts=[...(entry.attempts||[]),{answer:entry.answer,usage:entry.usage,status:entry.status,model:entry.model||'gpt-4o-mini'}];
      Object.assign(entry,{answer:response.answer,usage:response.usage,status:'received-not-validated',model});if(!previous)record.entries.push(entry);
      fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
      try{entry.adopted=validateAnswer(response.answer,spec);entry.status='format-checked-not-executed';delete entry.error;}
      catch(error){entry.status='rejected';entry.error=safeAiError(error.message,apiKey);console.log(`REJECTED ${spec.db} ${spec.kind}: ${entry.error}`);}
      fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
      console.log(`RECEIVED ${spec.db} ${spec.kind}; input=${response.usage.promptTokens}, output=${response.usage.completionTokens}`);
    } finally{g.dispose();paid.dispose();}
  }
  console.log(`Saved for source review: ${path.relative(process.cwd(),file)}; sha256=${digest(fs.readFileSync(file))}`);
  if(record.entries.some(entry=>['rejected','blocked'].includes(entry.status)))process.exitCode=1;
  return file;
}

async function verifyPrograms(record,configs,log=console.log) {
  const reports=[];
  for(const db of ['postgresql','oracle']) {
    const config={...configs[db]};assert.equal(config.user,'test');assert.equal(config.schema,'test');
    const Client=loadModule(`electron/${db==='oracle'?'oracle/oracleClient':'postgres/postgresClient'}.js`,{electron:{app:{isPackaged:true}}},{},{strict:false});
    const main=new Client(),observer=new Client(),created=[],tables=new Set(),ownedFunctions=[];
    const schema=db==='oracle'?'TEST':'test';
    const sql=(text,binds={})=>main.execute(text,binds);
    const assertRows=async(target,expected)=>assert.deepEqual(Array.from((await sql(`SELECT "ID","AMOUNT","SHIPPING","NOTE" FROM ${target} ORDER BY "ID"`)).rows,r=>[Number(r.ID),r.AMOUNT==null?null:Number(r.AMOUNT),r.SHIPPING==null?null:Number(r.SHIPPING),r.NOTE]),expected);
    const scalar=async(target,amount,priority)=>{
      if(db==='postgresql')return (await sql(`SELECT ${target}(CAST(:amount AS numeric)) AS "VALUE"`,{amount})).rows[0].VALUE;
      const oracle=require('oracledb');
      const result=await main.connection.execute(`BEGIN :result := ${target}(:amount${priority===undefined?'':', :priority'}); END;`,{result:{dir:oracle.BIND_OUT,type:oracle.NUMBER},amount,...(priority===undefined?{}:{priority})});return result.outBinds.result;
    };
    const checkFee=async(target,checks)=>{let n=0;for(const [amount,expected,priority]of checks){const value=await scalar(target,amount,priority);assert.equal(value==null?null:Number(value),expected,`Incorrect fee for amount=${amount}, priority=${priority}`);n++;}return n;};
    const callProc=async(target,id,delta)=>{
      if(db==='postgresql')return Number((await sql(`CALL ${target}(:id,CAST(:delta AS numeric),NULL)`,{id,delta})).rows[0].p_changed);
      const oracle=require('oracledb');const result=await main.connection.execute(`BEGIN ${target}(:id,:delta,:changed); END;`,{id,delta,changed:{dir:oracle.BIND_OUT,type:oracle.NUMBER}});return Number(result.outBinds.changed);
    };
    const checkProc=async(target,table)=>{
      const baseline=[[1,100,77,'keep1'],[2,250,88,'keep2'],[3,null,99,'keep3']];
      await sql(`INSERT INTO ${table} VALUES(1,100,77,'keep1')`);await sql(`INSERT INTO ${table} VALUES(2,250,88,'keep2')`);await sql(`INSERT INTO ${table} VALUES(3,NULL,99,'keep3')`);await main.commit();
      const checks=[[1,25,1,125],[1,-30,1,70],[1,null,1,100],[999,7,0,null],[null,7,0,null],[3,7,1,7]];
      for(const[id,delta,count,amount]of checks){if(db==='postgresql')await sql('BEGIN');assert.equal(await callProc(target,id,delta),count);const expected=baseline.map(r=>[...r]);if(count)expected.find(r=>r[0]===id)[1]=amount;await assertRows(table,expected);
        const seen=(await observer.execute(`SELECT "AMOUNT" FROM ${table} WHERE "ID"=1`)).rows[0].AMOUNT;assert.equal(Number(seen),100,'Procedure must not commit pending edits.');await main.rollback();await assertRows(table,baseline);}
      return checks.length;
    };
    try {
      try{await main.connect({...config,queryTimeout:30});await observer.connect({...config,queryTimeout:30});}catch{throw new Error(`${db}: dedicated program test connection failed.`);}
      const connectedSchema=String(Object.values((await sql(db==='oracle'?'SELECT USER FROM DUAL':'SELECT current_schema()')).rows[0])[0]);assert.equal(connectedSchema,schema);
      for(const entry of record.entries.filter(e=>e.spec.db===db)) {
        const spec=entry.spec;
        let diagnostic=false,adopted;
        if(entry.status==='rejected'&&spec.kind==='TRIGGER'){
          try{adopted=diagnosticTrigger(entry.answer,spec);diagnostic=true;}catch{}
        }
        if(['rejected','blocked'].includes(entry.status)&&!diagnostic){reports.push({database:db,kind:spec.kind,status:entry.status,error:entry.error,checks:0});log(`FAIL ${db} ${spec.kind}: ${entry.error}`);continue;}
        adopted??=validateAnswer(entry.answer,spec);let checks=0;
        try {
        if(spec.kind!=='FUNCTION'&&!tables.has(spec.table)) {
          await sql(`CREATE TABLE ${spec.target} ("ID" ${db==='oracle'?'NUMBER':'integer'} PRIMARY KEY,"AMOUNT" ${db==='oracle'?'NUMBER':'numeric'},"SHIPPING" ${db==='oracle'?'NUMBER':'numeric'},"NOTE" ${db==='oracle'?'VARCHAR2(40)':'varchar(40)'})`);tables.add(spec.table);created.push({kind:'TABLE',target:spec.target});
        }
        if(spec.kind==='TRIGGER') {
          // Seed an existing exceptional fee before installing the trigger, so NOTE-only preservation is unambiguous.
          await sql(`INSERT INTO ${spec.target} VALUES(99,199,77,'baseline')`);await main.commit();
          const invoke=createDatabaseIpc(main,db);const result=await invoke(db==='oracle'?'save-oracle-trigger':'save-postgres-trigger',{schema,tableName:spec.table,triggerName:spec.name,isNew:true,...adopted.settings,body:adopted.source,updateColumns:[],aliasNew:'NEW',aliasOld:'OLD'});
          assert.equal(result.success,true,'Production trigger save failed.');
          if(db==='postgresql'){const metadata=(await invoke('get-postgres-trigger',{schema,tableName:spec.table,triggerName:spec.name})).trigger;assert.equal(metadata.function_schema,schema);assert.match(metadata.function_name,/^mb_trg_[a-f0-9]{32}$/);ownedFunctions.push(`${qualified(metadata.function_schema,metadata.function_name)}()`);}
          else created.push({kind:'TRIGGER',target:spec.qualified});
          for(const[id,amount,expected]of [[1,199,10],[2,200,0],[3,201,0],[4,null,null],[5,-1,10]]){await sql(`INSERT INTO ${spec.target} VALUES(:id,:amount,77,'seed')`,{id,amount});assert.equal((await sql(`SELECT "SHIPPING" FROM ${spec.target} WHERE "ID"=:id`,{id})).rows[0].SHIPPING==null?null:Number((await sql(`SELECT "SHIPPING" FROM ${spec.target} WHERE "ID"=:id`,{id})).rows[0].SHIPPING),expected);checks++;}
          await sql(`UPDATE ${spec.target} SET "NOTE"='edited' WHERE "ID"=99`);await sql(`UPDATE ${spec.target} SET "AMOUNT"=199 WHERE "ID"=99`);
          assert.equal(Number((await sql(`SELECT "SHIPPING" FROM ${spec.target} WHERE "ID"=99`)).rows[0].SHIPPING),77);checks++;
          for(const[amount,fee]of [[200,0],[null,null],[199,10]]){await sql(`UPDATE ${spec.target} SET "AMOUNT"=:amount WHERE "ID"=1`,{amount});const row=(await sql(`SELECT "SHIPPING" FROM ${spec.target} WHERE "ID"=1`)).rows[0];assert.equal(row.SHIPPING==null?null:Number(row.SHIPPING),fee);checks++;}
          assert.equal(Number((await sql(`SELECT "AMOUNT" FROM ${spec.target} WHERE "ID"=2`)).rows[0].AMOUNT),200);await main.rollback();
        } else {
          if(spec.kind==='PACKAGE BODY')created.push({kind:'PACKAGE BODY',target:spec.qualified});
          if(spec.kind!=='PACKAGE BODY'){
            const existing=await sql(db==='oracle'?'SELECT COUNT(*) AS "N" FROM USER_OBJECTS WHERE OBJECT_NAME=:name':'SELECT COUNT(*) AS "N" FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema AND p.proname=:name',{name:spec.name,...(db==='postgresql'?{schema}:{})});assert.equal(Number(existing.rows[0].N),0);
            created.push({kind:spec.kind,target:spec.qualified+(db==='postgresql'?(spec.kind==='FUNCTION'?'(numeric)':'(integer,numeric)'):'')});
          }
          await sql(inspectSource(adopted.source,spec));await main.commit();
          if(db==='oracle'){const errors=(await sql('SELECT TEXT FROM USER_ERRORS WHERE NAME=:name AND TYPE=:objectType AND ATTRIBUTE=\'ERROR\'',{name:spec.name,objectType:spec.kind})).rows;assert.equal(errors.length,0,'Oracle compilation failed: '+Array.from(errors,row=>row.TEXT).join(' '));}
          if(spec.kind==='PACKAGE'){
            const members=(await sql('SELECT PROCEDURE_NAME FROM USER_PROCEDURES WHERE OBJECT_NAME=:name',{name:spec.name})).rows;
            assert.equal(members.filter(row=>row.PROCEDURE_NAME==='SHIPPING').length,2);
            assert.equal(members.filter(row=>row.PROCEDURE_NAME==='ADJUST').length,1);checks=2;
          }
          if(spec.kind==='FUNCTION')checks=await checkFee(spec.qualified,[[null,null],[-1,10],[0,10],[199,10],[199.99,10],[200,0],[201,0],['9007199254740993',0]]);
          if(spec.kind==='PROCEDURE')checks=await checkProc(spec.qualified,spec.target);
          if(spec.kind==='PACKAGE BODY'){
            checks+=await checkFee(spec.qualified+'.shipping',[[null,null],[-1,10],[199,10],[200,0],[201,0],[null,null,1],[199,15,1],[200,5,1],[200,0,0],[199,10,null]]);
            checks+=await checkProc(spec.qualified+'.adjust',spec.target);
          }
        }
        reports.push({database:db,kind:spec.kind,name:spec.name,model:entry.model||'gpt-4o-mini',checks,status:diagnostic?'format-rejected-code-passed':'passed',source:adopted.source,settings:adopted.settings,usage:entry.usage});log(`${diagnostic?'FORMAT FAIL / CODE PASS':'PASS'} ${db} ${spec.kind}: ${checks} semantic cases`);
        } catch(error){await main.rollback();reports.push({database:db,kind:spec.kind,name:spec.name,model:entry.model||'gpt-4o-mini',status:'failed',formatRejected:diagnostic,error:safeAiError(error.message),checks,source:adopted.source,usage:entry.usage});log(`FAIL ${db} ${spec.kind}: ${safeAiError(error.message)}`);}
      }
    } finally {
      const failures=[];try{await main.rollback();}catch{failures.push('rollback');}
      for(const obj of created.reverse())try{await sql(`DROP ${obj.kind} ${obj.target}${db==='oracle'&&obj.kind==='TABLE'?' PURGE':''}`);}catch(error){if(![4043].includes(error.errorNum)&&!['ORA-04043','42883','42P01'].includes(error.code))failures.push(`drop ${obj.kind} ${obj.target}`);}
      for(const target of ownedFunctions)try{await sql(`DROP FUNCTION ${target}`);}catch{failures.push(`drop function ${target}`);}
      try{await main.commit();}catch{failures.push('cleanup commit');}
      if(created.length)try{
        const result=await sql(db==='oracle'?'SELECT COUNT(*) AS "N" FROM USER_OBJECTS WHERE SUBSTR(OBJECT_NAME,1,16)=:token':`SELECT COUNT(*) AS "N" FROM (SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=:schema UNION ALL SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema) owned WHERE left(name,16)=:token`,{token:record.token||record.entries[0].spec.name.slice(0,16),...(db==='postgresql'?{schema}:{})});
        assert.equal(Number(result.rows[0].N),0);
        for(const target of ownedFunctions)assert.equal(Number((await sql('SELECT COUNT(*) AS "N" FROM pg_proc WHERE oid=to_regprocedure(:target)',{target})).rows[0].N),0);
      }catch{failures.push('catalog cleanup verification');}
      for(const c of [main,observer])try{await c.disconnect();}catch{failures.push('disconnect');}
      assert.deepEqual(failures,[],'Program test cleanup failed.');
    }
  }
  return reports;
}
async function main() {
  const args=process.argv.slice(2);
  if(process.env.CI&&process.env.CI!=='false')throw new Error('Program AI/DB checks are forbidden in CI.');
  assert.equal(process.env.MONABASE_DB_TEST_ALLOW_WRITE,'1');assert.ok(process.env.MONABASE_TEST_CONFIG,'Dedicated DB configuration is required.');
  const configs=JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG,'utf8'));
  if(args.length===1&&args[0]==='--fixtures-only') {
    assert.ok(!process.env.CI||process.env.CI==='false');assert.equal(process.env.MONABASE_DB_TEST_ALLOW_WRITE,'1');
    const {referenceAnswer}=require('./program-fixtures.cjs');const specs=plan();
    const reports=await verifyPrograms({token:specs[0].name.slice(0,16),entries:specs.map(spec=>({spec,answer:referenceAnswer(spec)}))},configs);
    assert.ok(reports.every(report=>report.status==='passed'));console.log(`PASS ${reports.reduce((n,report)=>n+report.checks,0)} real DB fixture checks; zero AI requests.`);return;
  }
  if(args[0]?.startsWith('--verify=')) {
    assert.ok(!process.env.CI||process.env.CI==='false');assert.equal(process.env.MONABASE_DB_TEST_ALLOW_WRITE,'1');assert.equal(args.length,2);
    const file=args[0].slice(9),hash=args[1].replace(/^--review-sha256=/,'');const record=loadReviewed(file,hash);
    const reports=await verifyPrograms(record,configs);
    const output=path.resolve('local/ai-test-reports',`program-effect-${Date.now()}.json`);fs.writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),responseFile:path.relative(process.cwd(),file),reviewSha256:hash,reports},null,2)+'\n',{mode:0o600});
    const failed=reports.filter(r=>r.status!=='passed').length;console.log(`${failed?'FAIL':'PASS'} program semantics; nonpassing=${failed}; report=${path.relative(process.cwd(),output)}`);if(failed)process.exitCode=1;return;
  }
  const resume=args.find(arg=>arg.startsWith('--resume='))?.slice(9);
  const only=args.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
  const model=args.find(arg=>arg.startsWith('--model='))?.slice(8)||'gpt-4o-mini';assert.ok(['gpt-4o-mini','gpt-4.1-mini','gpt-6-luna'].includes(model));
  if(only)assert.ok(only.length&&only.every(key=>plan('MBT_012345ABCDEF').some(s=>`${s.db}:${s.kind.replaceAll(' ','_')}`===key)));
  assert.ok(args.filter(arg=>arg.startsWith('--resume=')).length<=1);
  authorizeEffect(args.filter(arg=>!arg.startsWith('--resume=')&&!arg.startsWith('--only=')&&!arg.startsWith('--model=')));console.log(`Program AI tests: ${only?.length||8} requests maximum, ${model}, ${model==='gpt-6-luna'?4096:1024} completion tokens each. Source is saved for review, not executed. Enter the authorized key on stdin.`);
  let key=await readKey();try{await prepare(key,resume,only,model);}catch(error){throw new Error(safeAiError(error.message,key));}finally{key='';}
}
if(require.main===module)main().catch(error=>{console.error(safeAiError(error.code==='ERR_ASSERTION'?error.message:(error.code||error.message)));process.exitCode=1;});
module.exports={plan,generation,inspectSource,validateAnswer,diagnosticTrigger,loadReviewed,digest,verifyPrograms,prepare};
