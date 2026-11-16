// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { mysqlCrossTab } = require('../helpers/mysqlCrossTab.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { quoteMysql: q } = loadTypeScript('src/features/mysql/table/tableModel.ts');
test('Disposable MySQL cross-tab: aggregates, exact decimals, dates, classes, views and reversible main-session reads', { timeout: 60000 }, async t => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE,'1');
  const client=new MysqlClient(), observer=new MysqlClient(), base='MBT_'+randomBytes(6).toString('hex'), view=base+'_v'; let f;
  const config={ dbType:'mysql',host:'127.0.0.1',port:'13306',database:'mb_test',user:'test',password:'test' };
  try {
    await client.connect(config); await observer.connect(config);
    await client.execute(`CREATE TABLE ${q(base)} (region VARCHAR(40), category VARCHAR(80), amount DECIMAL(40,18), stamp DATETIME, age INT, numeric_text VARCHAR(80), date_text VARCHAR(40)) ENGINE=InnoDB`);
    await client.main.promise().query(`CREATE VIEW ${q(view)} AS SELECT * FROM ${q(base)}`);
    await client.execute(`INSERT INTO ${q(base)} VALUES ('North','USD',1.25,'2026-01-02',10,'12.5','20260102'),('North','USD',2.75,'2026-02-03',19,'20.5','20260203'),('South','USD',NULL,'2026-04-04',31,'-5','20260404'),('South','ROW_VALUE',4,'2026-12-31',9,'7','20261231'),('Exact','雪',12345678901234567890.123456789012345678,'2025-12-31',21,'8','20251231'),('North',NULL,99,'2026-01-01',15,'0','20260101')`);
    f=await mysqlCrossTab(async(channel,sql,binds)=>{
      assert.ok(['execute-sql','execute-sql-bg'].includes(channel));
      try{return {success:true,...await client.execute(sql,binds,null,false,channel==='execute-sql-bg'),...client.getTransactionDetails()};}catch(error){return {success:false,error:error.message,...client.getTransactionDetails()};}
    });
    await f.waitFor(s=>!s.isLoading && s.objects.includes(base));
    f.state.handleChangeObject({target:{value:base}}); await f.flush(); await f.state.handleFetchColumns(); await f.flush(); assert.equal(f.state.columns.length,7,f.alerts.join('\n'));
    const cell=(region,category)=>{const col=f.state.pivotColumns.find(c=>c.headerName===category);const row=f.state.pivotRows.find(row=>row.ROW_VALUE===region);return row[col.field];};
    await t.test('All five native aggregate methods preserve NULL and exact decimal results',async()=>{
      for(const agg of ['SUM','COUNT','AVG','MIN','MAX']){
        f.state.setAggType(agg); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,0,f.alerts.join('\n'));
        assert.equal(String(cell('North','USD')),agg==='COUNT'?'2':agg==='SUM'?'4.000000000000000000':agg==='AVG'?'2.0000000000000000000000':agg==='MIN'?'1.250000000000000000':'2.750000000000000000');
        assert.equal(cell('South','USD'),agg==='COUNT'?'0':null);
      }
      f.state.setAggType('SUM'); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(cell('Exact','雪'),'12345678901234567890.123456789012345678');
      assert.equal(cell('South','ROW_VALUE'),'4.000000000000000000'); assert.equal(f.states.at(-1).hasUncommittedTx,true);
      assert.equal((await observer.execute(`SELECT COUNT(*) n FROM ${q(base)}`)).rows[0].n,'0'); await observer.rollback();
    });
    await t.test('Date groups and integer classes use native MySQL expressions in numeric order',async()=>{
      f.state.handleRowFieldChange({target:{value:'stamp'}}); f.state.setRowDateGroup('QUARTER'); f.state.handleColFieldChange({target:{value:'age'}}); f.state.setColNumGroup({enable:true,start:10,end:30,step:10}); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,0,f.alerts.join('\n'));
      assert.deepEqual(Array.from(f.state.pivotColumns.slice(1).map(c=>c.headerName)),['<10','10-19','20-29','>30']); assert.ok(f.state.pivotRows.some(row=>row.ROW_VALUE==='2026-Q1'));
      f.state.handleRowFieldChange({target:{value:'date_text'}}); f.state.setRowCastType('DATE'); f.state.setRowDateFormat('YYYYMMDD'); f.state.setRowDateGroup('MONTH');
      f.state.handleColFieldChange({target:{value:'numeric_text'}}); f.state.setColCastType('NUMBER'); f.state.setColNumGroup({enable:true,start:0,end:30,step:10}); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,0,f.alerts.join('\n')); assert.ok(f.state.pivotRows.some(row=>row.ROW_VALUE==='2026-01'));
      await client.execute(`UPDATE ${q(base)} SET date_text=LEFT(date_text,6)`); f.state.setRowDateFormat('YYYYMM'); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,0,f.alerts.join('\n')); assert.ok(f.state.pivotRows.some(row=>row.ROW_VALUE==='2026-01'));
    });
    await t.test('Literal filters, failed conversions and empty data keep the transaction and previous results',async()=>{
      f.state.handleConditionChange('region','value','North'); f.state.handleConditionChange('amount','value','2'); f.state.handleConditionChange('amount','operator','>='); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.pivotRows.length,2,f.alerts.join('\n'));
      f.state.handleClearConditions(); await f.flush(); await client.execute(`INSERT INTO ${q(base)} VALUES ('Bad','USD',1,'2026-01-01',1,'bad-number','not-a-date')`);
      const previous=JSON.stringify(f.state.pivotRows); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,2); assert.equal(JSON.stringify(f.state.pivotRows),previous); assert.equal(client.getMainTransactionState(),true);
      await client.execute(`DELETE FROM ${q(base)} WHERE region='Bad'`);
      f.state.handleConditionChange('region','value','not-present'); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,2); assert.equal(JSON.stringify(f.state.pivotRows),previous);
    });
    await t.test('More than 200 actual categories stop without presenting a partial pivot',async()=>{
      await client.execute(`INSERT INTO ${q(base)} VALUES `+Array.from({length:201},(_,i)=>`('Limit','cat${i}',1,'2026-01-01',1,'1','202601')`).join(','));
      f.state.handleClearConditions(); f.state.handleRowFieldChange({target:{value:'region'}}); f.state.handleColFieldChange({target:{value:'category'}}); await f.flush(); f.state.handleConditionChange('region','value','Limit'); await f.flush();
      const previous=JSON.stringify(f.state.pivotRows); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,2); assert.equal(f.alerts.at(-1),'cross_tab_category_limit:201'); assert.equal(JSON.stringify(f.state.pivotRows),previous); assert.equal(client.getMainTransactionState(),true);
      await client.execute(`DELETE FROM ${q(base)} WHERE region='Limit'`);
    });
    await t.test('View metadata and plain aggregate reads retain pending rows and rollback removes them',async()=>{
      f.state.handleChangeObjectType({target:{value:'VIEW'}}); await f.waitFor(s=>!s.isLoading && s.objects.includes(view)); f.state.handleChangeObject({target:{value:view}}); await f.flush(); await f.state.handleFetchColumns(); await f.flush(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,0,f.alerts.join('\n'));
      assert.equal(client.getMainTransactionState(),true); await client.rollback(); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.states.at(-1).hasUncommittedTx,false); assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${q(base)}`)).rows[0].n,'0');
      assert.ok(!f.calls.some(c=>/commit|rollback/.test(c[0])));
    });
  }finally{
    f?.unmount(); await client.rollback().catch(()=>{}); await observer.rollback().catch(()=>{}); await client.main?.promise().query(`DROP VIEW IF EXISTS ${q(view)}`).catch(()=>{}); await client.execute(`DROP TABLE IF EXISTS ${q(base)}`).catch(()=>{}); await client.disconnect(); await observer.disconnect();
  }
});
