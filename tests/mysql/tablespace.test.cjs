// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient'),service=require('../../electron/mysql/tablespaceService');
test('Dedicated MySQL storage reports actual catalog denial or readable metadata and preserves pending own-table work',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),table='MBT_'+randomBytes(6).toString('hex')+'_storage';
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});await c.execute('CREATE TABLE `'+table+'`(id INT PRIMARY KEY) ENGINE=InnoDB');await c.execute('INSERT INTO `'+table+'` VALUES(1)');const before=c.getTransactionDetails();let denied=false;
 try{await c.execute('SELECT SPACE FROM information_schema.INNODB_TABLESPACES LIMIT 1',{},null,false,true);}catch(error){assert.match(error.message,/^ER_(SPECIFIC_ACCESS_DENIED_ERROR|TABLEACCESS_DENIED_ERROR|DBACCESS_DENIED_ERROR):/);denied=true;}
 const r=await service.list(c);if(denied){assert.equal(r.success,false);assert.equal(r.error,'mysql_storage_privilege_required');assert.equal(r.snapshot,undefined);}else{assert.equal(r.success,true,r.error);const row=r.snapshot.tablespaces.find(row=>row.name.toLowerCase()===('mb_test/'+table).toLowerCase());assert.ok(row);const d=await service.get(c,{id:row.id,name:row.name});assert.equal(d.success,true,d.error);assert.ok(d.detail.tables.some(item=>item.name.toLowerCase()===('mb_test/'+table).toLowerCase()));}
 assert.deepEqual(c.getTransactionDetails(),before);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+table+'`')).rows[0].n,'0');
 }finally{try{await c.rollback();await c.execute('DROP TABLE IF EXISTS `'+table+'`');}finally{await c.disconnect();}}
});
