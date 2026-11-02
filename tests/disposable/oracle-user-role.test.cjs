// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {test}=require('node:test');
const {loadModule}=require('../helpers/loadModule.cjs');
const {safeError}=require('../../electron/oracle/userRoleManagement');
if(process.env.MONABASE_ORACLE_USER_DISPOSABLE!=='1' || !process.env.MONABASE_ORACLE_USER_TEST_CONFIG)throw Error('Explicit disposable Oracle user opt-in and separate config are required.');
const filename=process.env.MONABASE_ORACLE_USER_TEST_CONFIG;
if(path.resolve(filename)===path.resolve('local/db-tests.json'))throw Error('Do not use ordinary DB settings.');
const config=JSON.parse(fs.readFileSync(filename,'utf8'));
if(config.disposableDatabase!==true || !config.expectedDatabase || !config.expectedContainer || !config.connection)throw Error('Declare a disposable database/container and independent connection.');
const Client=loadModule('electron/oracle/oracleClient.js',{electron:{app:{isPackaged:true}}},{},{strict:false});
test('Disposable Oracle: manage only run-owned local users, roles, credentials, grants, quotas and owned objects',{timeout:180000},async()=>{
 const client=new Client(),prefix='MBT_'+randomBytes(6).toString('hex').toUpperCase(),names=[prefix+'_User',prefix+'_Role'],owned=new Map();let attempted=false,failure;
 const passwords=[randomBytes(10).toString('hex')+'Aa1!',randomBytes(10).toString('hex')+'Bb2!'];
 const inspect=async()=>{const s=await client.listManagedUserRoles();assert.equal(s.context.database,config.expectedDatabase);assert.equal(s.context.container,config.expectedContainer);assert.notEqual(s.context.containerId,'1');assert.equal(s.context.scope,'all');return s;};
 const run=async(input,password)=>{const r=await client.reviewUserRoleOperation(input);return client.executeUserRoleOperation({...r.request,token:r.token,confirmName:r.request.target?.name,...(password?{password}:{})});};
 const target=async(name,action,extra={})=>{const row=(await inspect()).principals.find(row=>row.name===name);assert.ok(row);assert.equal(row.identity,owned.get(name));const d=await client.getManagedUserRoleDetail(row);return{action,target:row,expected:d.fingerprint,...extra};};
 const authenticate=async(password,expected=null,create=false)=>{const oracle=require('oracledb');let worker,code=null;try{worker=await oracle.getConnection({...client.dbLinkConnectOptions,user:names[0],password});if(create)await worker.execute('CREATE TABLE "'+prefix+'_TABLE" (id NUMBER)');}catch(error){code=error.errorNum || 'unknown';}finally{if(worker)await worker.close();}assert.equal(code,expected,'Disposable authentication/DDL result differs from expected code');};
 try{
  await client.connect(config.connection);const s=await inspect();assert.ok(s.context.canCreateUser && s.context.canCreateRole);assert.ok(!s.principals.some(row=>names.includes(row.name)));attempted=true;
  for(const [i,name]of names.entries()){await run({action:'create',kind:i===0?'USER':'ROLE',newName:name},i===0?passwords[0]:undefined);owned.set(name,(await inspect()).principals.find(row=>row.name===name).identity);}
  for(const privilege of ['CREATE SESSION','CREATE TABLE'])await run(await target(names[0],'grant',{privilegeKind:'SYSTEM',privilege,admin:false}));
  await run(await target(names[0],'grant',{privilegeKind:'ROLE',privilege:names[1],admin:false}));
  await authenticate(passwords[0]);await run(await target(names[0],'password'),passwords[1]);await authenticate(passwords[1]);await authenticate(passwords[0],1017);
  await run(await target(names[0],'lock',{locked:true}));await authenticate(passwords[1],28000);await run(await target(names[0],'lock',{locked:false}));
  const row=(await inspect()).principals.find(row=>row.name===names[0]),detail=await client.getManagedUserRoleDetail(row),tablespace=detail.quotas.find(row=>row.tablespace===detail.target.defaultTablespace);assert.ok(tablespace,'A permanent default tablespace is required');
  await run(await target(names[0],'quota',{tablespace:tablespace.tablespace,amount:'2',unit:'M',unlimited:false}));await authenticate(passwords[1],null,true);
  await assert.rejects(client.reviewUserRoleOperation(await target(names[0],'drop',{cascade:false})),/has_objects/);
  await run(await target(names[0],'revoke',{privilegeKind:'ROLE',privilege:names[1]}));await run(await target(names[0],'drop',{cascade:true}));await run(await target(names[1],'drop',{cascade:false}));
  assert.ok(!(await inspect()).principals.some(row=>names.includes(row.name)));
 }catch(error){failure={...safeError(error),runOwnedNames:names};}
 finally{
  try{if(attempted){for(const name of names){const row=(await inspect()).principals.find(row=>row.name===name);if(row){assert.ok(owned.has(name) && owned.get(name)===row.identity,'Unconfirmed principal identity requires manual inspection; do not remove it automatically');const d=await client.getManagedUserRoleDetail(row);await run({action:'drop',target:row,expected:d.fingerprint,cascade:row.kind==='USER'});}}}}
  catch(error){failure=failure || {...safeError(error),runOwnedNames:names};}finally{await client.disconnect();}
 }
 assert.equal(failure,undefined,JSON.stringify(failure));
});
