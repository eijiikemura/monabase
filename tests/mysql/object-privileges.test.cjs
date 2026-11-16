// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomBytes}=require('node:crypto');const Client=require('../../electron/mysql/mysqlClient');const service=require('../../electron/mysql/objectPrivileges');
test('Dedicated MySQL object privilege references disclose partial scope and preserve pending main-session rows',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex'),schema='mb_test';
 try{await c.connect({host:'127.0.0.1',port:'13306',database:schema,user:'test',password:'test'});await c.execute('CREATE TABLE `'+base+'`(id INT PRIMARY KEY) ENGINE=InnoDB');await c.execute('CREATE VIEW `'+base+'_v` AS SELECT id FROM `'+base+'`');
 for(const [type,definition] of [['PROCEDURE','() SELECT 1'],['FUNCTION','() RETURNS INT DETERMINISTIC RETURN 1']])await c.enqueue(()=>c.run(c.main,{sql:`CREATE ${type} \`${base}_r\`${definition}`,command:'CREATE'}));
 await c.execute('INSERT INTO `'+base+'` VALUES(1)');
 for(const [type,name] of [['TABLE',base],['VIEW',base+'_v'],['PROCEDURE',base+'_r'],['FUNCTION',base+'_r']]){
 const r=await service.get(c,{schema,name,type});assert.equal(r.success,true,r.error);assert.equal(r.detail.scope,'visible');assert.equal(r.detail.complete,false);assert.equal(r.detail.mutable,false);assert.equal(c.getMainTransactionState(),true);assert.ok(!JSON.stringify(r).includes('CREATE FUNCTION'));
 const denied=await service.review(c,{target:r.detail.target,grantee:r.detail.current,privilege:r.detail.privileges[0],action:'grant',expected:r.detail.fingerprint});assert.equal(denied.success,false);assert.equal(c.getMainTransactionState(),true);
 }
 assert.equal((await service.get(c,{schema:'mysql',name:'user',type:'TABLE'})).error,'mysql_obj_protected');await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+base+'`')).rows[0].n,'0');
 }finally{try{await c.rollback();for(const type of ['PROCEDURE','FUNCTION'])await c.enqueue(()=>c.run(c.main,{sql:`DROP ${type} IF EXISTS \`${base}_r\``,command:'DROP'}));await c.execute('DROP VIEW IF EXISTS `'+base+'_v`');await c.execute('DROP TABLE IF EXISTS `'+base+'`');}finally{await c.disconnect();}}
});
