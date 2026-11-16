// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const Client=require('../../electron/mysql/mysqlClient'),service=require('../../electron/mysql/databaseService');
test('Dedicated MySQL database information shows visible settings and all supported object kinds without committing rows',{timeout:20000},async()=>{
 assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');const c=new Client(),base='MBT_'+randomBytes(6).toString('hex');
 try{await c.connect({host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test'});await c.execute('CREATE TABLE `'+base+'`(id INT PRIMARY KEY) ENGINE=InnoDB');await c.execute('CREATE VIEW `'+base+'_v` AS SELECT id FROM `'+base+'`');
 // Fixture-only native creation; product routine edits continue to require reviewed editors.
 for(const sql of ['CREATE PROCEDURE `'+base+'_p`() SELECT 1','CREATE FUNCTION `'+base+'_f`() RETURNS INT DETERMINISTIC RETURN 1','CREATE TRIGGER `'+base+'_t` BEFORE INSERT ON `'+base+'` FOR EACH ROW SET NEW.id=NEW.id'])await c.main.promise().query(sql);
 await c.execute('INSERT INTO `'+base+'` VALUES(1)');const before=c.getTransactionDetails();const r=await service.list(c);assert.equal(r.success,true,r.error);assert.equal(r.snapshot.scope,'visible');const row=r.snapshot.databases.find(row=>row.name==='mb_test');assert.ok(row.charset&&row.collation);const d=await service.get(c,{name:'mb_test'});assert.equal(d.success,true,d.error);for(const [name,type] of [[base,'TABLE'],[base+'_v','VIEW'],[base+'_p','PROCEDURE'],[base+'_f','FUNCTION'],[base+'_t','TRIGGER']])assert.ok(d.detail.objects.some(row=>row.name===name&&row.type===type),type);assert.deepEqual(c.getTransactionDetails(),before);await c.rollback();assert.equal((await c.execute('SELECT COUNT(*) n FROM `'+base+'`')).rows[0].n,'0');
 }finally{try{await c.rollback();for(const [type,suffix] of [['TRIGGER','_t'],['PROCEDURE','_p'],['FUNCTION','_f'],['VIEW','_v'],['TABLE','']])await c.main.promise().query('DROP '+type+' IF EXISTS `'+base+suffix+'`');}finally{await c.disconnect();}}
});
