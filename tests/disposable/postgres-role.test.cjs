// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {test}=require('node:test');
const {loadModule}=require('../helpers/loadModule.cjs');
const {safeError}=require('../../electron/postgres/roleManagement');
if(process.env.MONABASE_PG_ROLE_DISPOSABLE!=='1' || !process.env.MONABASE_PG_ROLE_TEST_CONFIG)throw Error('Explicit disposable PostgreSQL role opt-in and separate config are required.');
const filename=process.env.MONABASE_PG_ROLE_TEST_CONFIG;
if(path.resolve(filename)===path.resolve('local/db-tests.json'))throw Error('Do not reuse ordinary DB test settings.');
const config=JSON.parse(fs.readFileSync(filename,'utf8'));
if(config.disposableDatabase!==true || !config.expectedDatabase || !config.expectedSystemIdentifier || !config.connection)throw Error('Declare the disposable cluster identity, database and connection.');
const Client=loadModule('electron/postgres/postgresClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});
test('Disposable PostgreSQL: manage only run-owned roles, verify password authentication and clean up without changing the actor',{timeout:180000},async()=>{
 const client=new Client(),prefix='MBT_'+randomBytes(8).toString('hex').toUpperCase(),names=[prefix+'_User',prefix+'_Group'];
 const passwords=[randomBytes(24).toString('hex')+"'\\Aa",randomBytes(24).toString('hex')+"'\\Bb"],owned=new Map();let attempted=false,failure;
 const inspect=async()=>{const row=(await client.execute('SELECT current_database() AS database,system_identifier::text AS cluster FROM pg_catalog.pg_control_system()',{},null,false,true)).rows[0];assert.equal(row.database,config.expectedDatabase);assert.equal(row.cluster,String(config.expectedSystemIdentifier));const snapshot=await client.listManagedRoles();assert.ok(snapshot.context.version>=160000,'Disposable role lifecycle requires PostgreSQL 16+');assert.equal(snapshot.roles.find(row=>row.oid===snapshot.context.userId).superuser,true);return snapshot;};
 const run=async(input,password)=>{const review=await client.reviewRoleOperation(input);return client.executeRoleOperation({...review.request,token:review.token,confirmName:review.request.target?.name,...(password?{password}:{})});};
 const target=async(name,action,extra={})=>{const row=(await inspect()).roles.find(row=>row.name===name);assert.ok(row);assert.equal(row.identity,owned.get(name));const detail=await client.getManagedRoleDetail(row);return{action,target:row,expected:detail.fingerprint,...extra};};
 const authenticate=async(password,expectedCode=null)=>{
  const params=client.client.connectionParameters,{Client:RawClient}=require('pg');
  const worker=new RawClient({host:params.host,port:params.port,database:params.database,user:names[0],password,ssl:params.ssl,connectionTimeoutMillis:10000});worker.on('error',()=>{});
  let code=null;try{await worker.connect();await worker.query('SELECT 1');}catch(error){code=error.code || 'unknown';}finally{await worker.end().catch(()=>{});}assert.equal(code,expectedCode,'Disposable authentication result differs from expected code');
 };
 try{
  const connection={...config.connection};await client.connect(connection);const snapshot=await inspect();assert.ok(!snapshot.roles.some(role=>names.includes(role.name)));attempted=true;
  for(const [index,name]of names.entries()){await run({action:'create',newName:name,login:index===0,passwordMode:index===0?'set':'none'},index===0?passwords[0]:undefined);const role=(await inspect()).roles.find(role=>role.name===name);assert.ok(role);owned.set(name,role.identity);}
  await authenticate(passwords[0]);await run(await target(names[0],'password',{passwordMode:'set'}),passwords[1]);await authenticate(passwords[1]);await authenticate(passwords[0],'28P01');
  const group=(await inspect()).roles.find(role=>role.name===names[1]);
  await run(await target(names[0],'grant',{roleId:group.oid,grantorId:'10',admin:true,inherit:false,set:true}));
  let detail=await client.getManagedRoleDetail((await inspect()).roles.find(role=>role.name===names[0]));assert.equal(detail.memberships.find(row=>row.roleId===group.oid).admin,true);
  await run(await target(names[0],'revoke',{roleId:group.oid,grantorId:'10',revokeOption:'admin'}));
  await run(await target(names[0],'revoke',{roleId:group.oid,grantorId:'10',revokeOption:'membership'}));
  await run(await target(names[0],'login',{enabled:false}));await authenticate(passwords[1],'28000');await run(await target(names[0],'login',{enabled:true}));
  await run(await target(names[0],'superuser',{enabled:true}));await run(await target(names[0],'superuser',{enabled:false}));
  await run(await target(names[0],'password',{passwordMode:'none'}));await authenticate(passwords[1],'28P01');
  for(const name of names)await run(await target(name,'drop'));assert.ok(!(await inspect()).roles.some(role=>names.includes(role.name)));
 }catch(error){failure=safeError(error);}
 finally{
  try{if(attempted){for(const name of [...names].reverse()){const row=(await inspect()).roles.find(role=>role.name===name);if(row){assert.ok(!owned.has(name) || owned.get(name)===row.identity,'Do not delete a replaced role');const detail=await client.getManagedRoleDetail(row);await run({action:'drop',target:row,expected:detail.fingerprint});}}}}
  catch(error){failure=failure || safeError(error);}finally{await client.disconnect();}
 }
 assert.equal(failure,undefined,JSON.stringify(failure));
});
