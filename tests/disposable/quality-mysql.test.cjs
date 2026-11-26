// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');
const Client=require('../../electron/mysql/mysqlClient');
const {startDatabaseSandbox}=require('../helpers/mysqlDatabaseSandbox.cjs');
const {verifyQualityDatabase}=require('../helpers/qualityDatabase.cjs');
test('MySQL isolated sandbox: data validation tools',{timeout:120000},async t=>{
 const sandbox=await startDatabaseSandbox();
 try{
  await sandbox.client.main.promise().query('CREATE DATABASE mb_test');
  await t.test('Real MySQL quality workflows',async child=>verifyQualityDatabase(child,'mysql',new Client(),new Client(),{...sandbox.connection,dbType:'mysql',database:'mb_test'}));
 }finally{await sandbox.close();}
});
