// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Client=require('../../electron/mysql/mysqlClient');
const {verifyQualityDatabase}=require('../helpers/qualityDatabase.cjs');
test('MySQL: data masking, result comparison and stored regression tests',{timeout:90000},async t=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');
 await verifyQualityDatabase(t,'mysql',new Client(),new Client(),{dbType:'mysql',host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});
});
