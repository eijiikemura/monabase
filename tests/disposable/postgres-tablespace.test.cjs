// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {test}=require('node:test');
const {loadModule}=require('../helpers/loadModule.cjs');
const {safeError}=require('../../electron/postgres/tablespaceManagement');
// This configuration is separate from ordinary test connections and requires a prepared server directory.
if(process.env.MONABASE_PG_TABLESPACE_DISPOSABLE!=='1' || !process.env.MONABASE_PG_TABLESPACE_TEST_CONFIG)throw Error('Explicit disposable PostgreSQL storage opt-in and separate config are required.');
const filename=process.env.MONABASE_PG_TABLESPACE_TEST_CONFIG;
if(path.resolve(filename)===path.resolve('local/db-tests.json'))throw Error('Do not reuse ordinary DB test settings.');
const config=JSON.parse(fs.readFileSync(filename,'utf8'));
if(config.disposableDatabase!==true || !config.expectedDatabase || !config.expectedSystemIdentifier || !config.location || !config.connection)throw Error('Declare the disposable cluster identity, database, prepared empty directory and connection.');
const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});
test('Disposable PostgreSQL: create, rename and drop only a run-owned tablespace in a prepared directory',{timeout:180000},async()=>{
 const client=new Client(),name='MBT_'+randomBytes(8).toString('hex').toUpperCase(),renamed=name+'_R';let identity=null,attempted=false,failure;
 const inspect=async()=>{
  const rows=(await client.execute('SELECT current_database() AS database,system_identifier::text AS cluster FROM pg_catalog.pg_control_system()',{},null,false,true)).rows;
  assert.equal(rows[0].database,config.expectedDatabase);assert.equal(rows[0].cluster,String(config.expectedSystemIdentifier));return client.listPostgresTablespaces();
 };
 const run=async input=>{const review=await client.reviewPostgresTablespaceOperation(input);return client.executePostgresTablespaceOperation({...review.request,token:review.token,confirmName:review.request.target?.name});};
 try{
  await client.connect(config.connection);const snapshot=await inspect();assert.equal(snapshot.context.canCreate,true);assert.ok(!snapshot.tablespaces.some(row=>[name,renamed].includes(row.name) || row.location===config.location));
  const entries=(await client.execute('SELECT pg_catalog.pg_ls_dir(:location) AS entry',{location:config.location},null,false,true)).rows;assert.equal(entries.length,0,'The separately prepared server directory must be empty');
  attempted=true;await run({action:'create',newName:name,location:config.location,ownerId:snapshot.context.userId});
  let row=(await inspect()).tablespaces.find(row=>row.name===name);assert.ok(row);identity=row.identity;
  let detail=await client.getPostgresTablespaceDetail(row);await run({action:'rename',target:row,expected:detail.fingerprint,newName:renamed});
  row=(await inspect()).tablespaces.find(row=>row.name===renamed);assert.equal(row.identity,identity);detail=await client.getPostgresTablespaceDetail(row);
  await run({action:'drop',target:row,expected:detail.fingerprint});assert.ok(!(await inspect()).tablespaces.some(row=>row.identity===identity));
 }catch(error){failure=safeError(error);}
 finally{
  try{if(attempted){const row=(await inspect()).tablespaces.find(row=>[name,renamed].includes(row.name));if(row){assert.equal(row.location,config.location);if(identity)assert.equal(row.identity,identity);const detail=await client.getPostgresTablespaceDetail(row);await run({action:'drop',target:row,expected:detail.fingerprint});}}}
  catch(error){failure=failure || safeError(error);}finally{await client.disconnect();}
 }
 assert.equal(failure,undefined,JSON.stringify(failure));
});
