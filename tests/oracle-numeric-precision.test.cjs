// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadModule}=require('./helpers/loadModule.cjs');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const numbers=loadTypeScript('src/shared/utils/numberValues.ts');
const dates=loadTypeScript('src/shared/utils/dateFormatter.ts');
const {createTableQueryBuilder}=loadTypeScript('src/features/oracle/windows/table/tableQueryBuilder.ts',{
 '@/shared/utils/numberValues':numbers,'@/shared/utils/dateFormatter':dates
});

test('Oracle numeric fetches retain large integers and decimals while keeping safe integer metadata numeric',async()=>{
 const driver={OUT_FORMAT_OBJECT:1,DB_TYPE_NUMBER:2010,STRING:2001};
 const OracleClient=loadModule('electron/oracle/oracleClient.js',{
  electron:{app:{isPackaged:true}},oracledb:driver,'./traceExecutor':{}
 },{},{strict:false});
 const client=new OracleClient();
 client.connection={execute:async(sql,binds,options)=>{
  assert.equal(sql,'SELECT precise_values FROM test');
  const handler=options.fetchTypeHandler({dbType:driver.DB_TYPE_NUMBER});
  assert.equal(handler.type,driver.STRING);
  assert.equal(options.fetchTypeHandler({dbType:2001}),undefined);
  return {rows:[{ID:handler.converter('9007199254740993'),AMOUNT:handler.converter('0.1234567890123456789012345'),
    LINE:handler.converter('7'),EMPTY:handler.converter(null)}],metaData:[]};
 }};
 const result=await client.execute('SELECT precise_values FROM test');
 assert.deepEqual(JSON.parse(JSON.stringify(result.rows[0])),{ID:'9007199254740993',AMOUNT:'0.1234567890123456789012345',LINE:7,EMPTY:null});
});

test('Oracle update SQL preserves large IDs and decimal digits',()=>{
 const builder=createTableQueryBuilder({schema:'APP',inputDateFormat:'',outputDateFormat:'',structureDefs:[]});
 for(const value of ['9007199254740993','0.1234567890123456789012345']) assert.equal(builder.formatSqlValue({DATA_TYPE:'NUMBER'},value),value);
});

test('Oracle NUMBER output binds use strings to retain decimal precision',async()=>{
 const driver={OUT_FORMAT_OBJECT:1,STRING:2001,NUMBER:2010,DATE:2011,BIND_OUT:3003,BIND_INOUT:3002,BIND_IN:3001};
 const OracleClient=loadModule('electron/oracle/oracleClient.js',{
  electron:{app:{isPackaged:true}},oracledb:driver,'./traceExecutor':{}
 },{},{strict:false});
 const client=new OracleClient();
 client.connection={execute:async(sql,binds)=>{
  if(sql.includes('DBMS_OUTPUT.GET_LINES')) return {outBinds:{lines:[]}};
  if(sql.includes('DBMS_OUTPUT.ENABLE')) return {};
  assert.equal(binds.mb_arg_0.type,driver.STRING);
  return {outBinds:{mb_arg_0:'0.1234567890123456789012345'}};
 }};
 const result=await client.executeStored({schema:'APP',objectName:'PRECISION',objectType:'PROCEDURE',args:{amount:''},argTypes:{amount:'NUMBER'},argDirections:{amount:'OUT'}});
 assert.equal(result.success,true);
 assert.equal(result.returnValues[0].value,'0.1234567890123456789012345');
});
