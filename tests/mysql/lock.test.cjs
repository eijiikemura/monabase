// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');const Client=require('../../electron/mysql/mysqlClient');const locks=require('../../electron/mysql/lockService');
test('Dedicated MySQL lock reads explicitly report unavailable catalogs and preserve pending own-table work',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),table='MBT_'+randomBytes(6).toString('hex')+'_locks';
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});await c.execute('CREATE TABLE `'+table+'`(id INT PRIMARY KEY) ENGINE=InnoDB');await c.execute('INSERT INTO `'+table+'` VALUES(1)');let visible=true;
 try{await c.execute('SELECT COUNT(*) n FROM performance_schema.data_locks',{},null,false,true);}catch(error){assert.match(error.message,/^ER_(TABLEACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR|SPECIFIC_ACCESS_DENIED_ERROR):/);visible=false;}
 const result=await locks.list(c);if(visible){assert.equal(result.success,true,result.error);assert.ok(result.snapshot.locks.some(row=>row.table===table));assert.ok(result.snapshot.locks.filter(row=>row.table===table).every(row=>row.protected&&!row.canKill));}else{assert.equal(result.success,false);assert.equal(result.error,'mysql_lock_read_failed');assert.equal(result.snapshot,undefined);}
 assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+table+'`')).rows[0].n,'0');
 }finally{try{await c.rollback();await c.execute('DROP TABLE IF EXISTS `'+table+'`');}finally{await c.disconnect();}}
});
