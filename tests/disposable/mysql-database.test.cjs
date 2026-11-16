// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {startDatabaseSandbox}=require('../helpers/mysqlDatabaseSandbox.cjs'),service=require('../../electron/mysql/databaseManagement');
test('An isolated MySQL container creates/alters database defaults with one-use review, drift protection and unchanged pending rows',{timeout:120000},async()=>{
 const sandbox=await startDatabaseSandbox(),c=sandbox.client,name='MBT_'+randomBytes(6).toString('hex');
 const draft={action:'create',name,charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci'};
 try{
 const choices=await service.options(c);assert.ok(choices.options.some(o=>o.collation===draft.collation));let review=await service.review(c,draft);assert.ok(review.sql.startsWith('CREATE DATABASE'));let r=await service.execute(c,{token:review.token});assert.equal(r.success,true,r.error);assert.equal(r.database.charset,'utf8mb4');await assert.rejects(service.execute(c,{token:review.token}),/expired/);
 await c.execute('CREATE TABLE `'+name+'`.pending(id INT PRIMARY KEY,label VARCHAR(10)) ENGINE=InnoDB');await c.execute('INSERT INTO `'+name+'`.pending VALUES(1,\'held\')');await assert.rejects(service.review(c,{...draft,action:'alter',collation:'utf8mb4_bin'}),/pending/);assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+name+'`.pending')).rows[0].n,'0');
 review=await service.review(c,{...draft,action:'alter',collation:'utf8mb4_bin'});r=await service.execute(c,{token:review.token});assert.equal(r.success,true,r.error);assert.equal(r.database.collation,'utf8mb4_bin');const columns=await c.execute('SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:schema AND COLUMN_NAME=:name',{schema:name,name:'label'},null,false,true);assert.equal(columns.rows[0].COLLATION_NAME,'utf8mb4_0900_ai_ci');
 review=await service.review(c,{...draft,action:'alter'});await c.main.promise().query('ALTER DATABASE `'+name+'` COLLATE utf8mb4_unicode_ci');await assert.rejects(service.execute(c,{token:review.token}),/changed/);for(const target of ['mysql','sys','information_schema','performance_schema'])await assert.rejects(service.review(c,{...draft,name:target}),/protected/);
 await assert.rejects(service.review(c,{...draft,name:name+'_bad',charset:'latin1'}),/collation/);c.readonly=true;await assert.rejects(service.review(c,{...draft,name:name+'_ro'}),/writable/);c.readonly=false;
 }finally{await sandbox.close();}
});
