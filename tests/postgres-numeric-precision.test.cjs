// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const numbers = loadTypeScript('src/shared/utils/numberValues.ts');
const dates = loadTypeScript('src/shared/utils/dateFormatter.ts');
const { createTableQueryBuilder } = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts', {
  '@/shared/utils/numberValues':numbers, '@/shared/utils/dateFormatter':dates
});
const { formatTableResultRows } = loadTypeScript('src/features/postgresql/windows/table/tableResultRows.ts', { '@/shared/utils/dateFormatter':dates });
const grid = loadTypeScript('src/features/data-grid/dataGridHelper.tsx', {
  '@/shared/utils/numberValues':numbers, '@/shared/utils/dateFormatter':dates, react:require('react'), i18next:{t:key=>key}
});

test('BIGINT, NUMERIC, and numeric arrays reach IPC without losing digits', () => {
  const pg = require('pg');
  loadModule('electron/postgres/postgresClient.js', { electron:{app:{isPackaged:true}}, pg }, {}, {strict:false});
  const big = '9007199254740993', decimal = '0.1234567890123456789012345';
  assert.equal(pg.types.getTypeParser(20)(big), big);
  assert.equal(pg.types.getTypeParser(1700)(decimal), decimal);
  assert.deepEqual(pg.types.getTypeParser(1231)(`{{${decimal},NULL},{1.0000,NaN}}`), [[decimal,null],['1.0000','NaN']]);
  assert.deepEqual(pg.types.getTypeParser(1016)(`{${big},NULL}`), [big,null]);
});

test('Table display, clipboard/export formatting, and update identities preserve exact text', () => {
  const source = {id:'9007199254740993', amount:'12345678901234567890.12345678901234567890'};
  const columns = [{COLUMN_NAME:'id',DATA_TYPE:'bigint'}, {COLUMN_NAME:'amount',DATA_TYPE:'numeric(60,20)'}];
  const row = formatTableResultRows([source], columns, '', key=>key)[0];
  const builder = createTableQueryBuilder({inputDateFormat:'',outputDateFormat:'',structureDefs:columns});
  assert.equal(row.id, source.id);
  assert.equal(row.amount, source.amount);
  for (const column of columns) {
    const value = source[column.COLUMN_NAME];
    assert.equal(builder.formatSqlValue(column,value), value);
    assert.equal(grid.getFormattedValue(value,{dbTypeName:'NUMBER'},''), value);
    const [display] = grid.buildGridColumns([{name:column.COLUMN_NAME,dbTypeName:'NUMBER'}],'');
    assert.equal(display.renderCell({value}).props.children,value);
    assert.equal(display.valueFormatter({value}), value);
  }
});

test('Numeric ordering compares exact magnitudes and fractional digits without converting to Number', () => {
  const ordered = ['-Infinity','-9007199254740993','-2','-0.00001','0','0.000000000000000000000001','0.12345678901234567890',
    '0.12345678901234567891','2','10','9007199254740992','9007199254740993','1e1000','Infinity','NaN'];
  assert.deepEqual([...ordered].reverse().sort(numbers.compareNumericValues),ordered);
  assert.equal(numbers.compareNumericValues('1.0000','1e0'),0);
  assert.equal(numbers.compareNumericValues('-0','0'),0);
  assert.equal(numbers.compareNumericValues(null,'0'),-1);
});

test('Numeric SQL literals preserve precision and reject SQL fragments', () => {
  for (const value of ['9007199254740993','1.0000000000000000000001','-1e1000','+.25']) assert.equal(numbers.numericSqlLiteral(value),value);
  for (const value of ['0; DROP TABLE t','1 OR 1=1','0x10',"1'",'']) assert.throws(()=>numbers.numericSqlLiteral(value),/Invalid numeric/);
});

test('Trace return notices preserve large integers and high precision decimal tokens', async () => {
  const {executeTracePg} = loadModule('electron/postgres/traceExecutorPg.js', {
    '../services/traceProgram': require('../electron/services/traceProgram'),
    '../i18n':{t:key=>key}, './traceDb':{TraceDatabase:class {
      static deleteDatabase() {} async init() {} async saveTraceInfo() {} async insertSteps() {} close() {}
    }}
  });
  for (const value of ['9007199254740993','0.1234567890123456789012345','1e400']) {
    const result=await executeTracePg({execute:async sql=>({success:true,rows:sql.startsWith('SELECT COUNT')?[{cnt:0}]:[],
      notices:sql.startsWith('CALL')?[`[TRACE RETURN] {"name":"RETURN","value":${value}}`]:[]})},
    {schema:'public',objectName:'precise',objectType:'FUNCTION',sourceText:'CREATE PROCEDURE __placeholder__()',skipParse:true,args:{}});
    assert.equal(result.returnValues[0].value,value);
  }
});
