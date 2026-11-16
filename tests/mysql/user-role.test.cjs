// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');const Client=require('../../electron/mysql/mysqlClient');const service=require('../../electron/mysql/userRoleService');
const config={host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'};
test('Dedicated MySQL account references preserve pending work without granting administrative privileges',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),table='MBT_'+randomBytes(6).toString('hex')+'_account';try{
 await c.connect(config);await c.execute('CREATE TABLE `'+table+'`(id INT PRIMARY KEY) ENGINE=InnoDB');await c.execute('INSERT INTO `'+table+'` VALUES(1)');
 const list=await service.list(c);assert.equal(list.success,true,list.error);assert.equal(list.snapshot.context.scope,'self');assert.equal(list.snapshot.accounts.length,1);assert.equal(list.snapshot.context.canCreate,false);assert.equal(list.snapshot.accounts[0].protected,true);
 const detail=await service.get(c,list.snapshot.context.current);assert.equal(detail.success,true,detail.error);assert.ok(detail.detail.grantSql.length>0);assert.equal(c.getMainTransactionState(),true);assert.ok(!JSON.stringify(detail).includes('authentication_string'));
 const denied=await service.review(c,{action:'create',target:{user:table.slice(0,30),host:'localhost'},kind:'USER',locked:false});assert.equal(denied.success,false);assert.equal(c.getMainTransactionState(),true);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+table+'`')).rows[0].n,'0');
 }finally{try{await c.rollback();await c.execute('DROP TABLE IF EXISTS `'+table+'`');}finally{await c.disconnect();}}
});
test('A rejected MySQL authentication closes initialization promptly and the client can reconnect',{timeout:10000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client();try{await assert.rejects(()=>c.connect({...config,password:randomBytes(24).toString('hex')}),/connection failed/);assert.equal(c.connections.length,0);assert.equal(c.main,null);await c.connect(config);assert.equal((await c.execute('SELECT 1 n')).rows[0].n,'1');}finally{await c.disconnect();}
});
