// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');const Client=require('../../electron/mysql/mysqlClient');const service=require('../../electron/mysql/sessionService');
test('Dedicated MySQL session metadata preserves pending rows and restricts operations when stable protection is unavailable',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),table='MBT_'+randomBytes(6).toString('hex')+'_sessions';
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});await c.execute('CREATE TABLE `'+table+'`(id INT PRIMARY KEY) ENGINE=InnoDB');await c.execute('INSERT INTO `'+table+'` VALUES(1)');
 const r=await service.list(c);assert.equal(r.success,true,r.error);assert.equal(r.snapshot.context.canManage,false);const own=r.snapshot.sessions.find(row=>row.connectionId===String(c.main.threadId));assert.ok(own);assert.equal(own.protected,true);assert.equal(own.canKill,false);const d=await service.get(c,{id:own.id,fingerprint:own.fingerprint});assert.equal(d.success,true,d.error);assert.equal((await service.review(c,{id:own.id,fingerprint:own.fingerprint,action:'kill'})).success,false);assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+table+'`')).rows[0].n,'0');
 }finally{try{await c.rollback();await c.execute('DROP TABLE IF EXISTS `'+table+'`');}finally{await c.disconnect();}}
});
