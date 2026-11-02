// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {splitSqlScript,findSqlBindNames,replaceSqlBinds}=loadTypeScript('src/features/sql/sqlScript.ts');
const plain=value=>JSON.parse(JSON.stringify(value));

for(const db of ['oracle','postgresql']) {
  test(`${db}: Scripts preserve quoted semicolons, escaped quotes, comments, and source line offsets`,()=>{
    const script="-- SELECT 'BEGIN';\nSELECT 'a;b', 'it''s;ok', \"column;name\" FROM example;\n/* ; */\nSELECT :value FROM example;";
    const result=splitSqlScript(script,db);
    assert.equal(result.length,2);
    assert.equal(result[0].text,"SELECT 'a;b', 'it''s;ok', \"column;name\" FROM example");
    assert.equal(result[1].text,'SELECT :value FROM example');
    assert.deepEqual(plain(result.map(item=>item.lineOffset)),[1,3]);
  });
  test(`${db}: Bind discovery and replacement ignore literals, comments, quoted names, and assignment`,()=>{
    const sql="SELECT :value, :VALUE2, ':ignored', \"colon:column\", :名前 FROM t -- :comment\n/* :block */";
    assert.deepEqual(plain(findSqlBindNames(sql,db)),['VALUE','VALUE2','名前']);
    assert.equal(replaceSqlBinds(sql,{value:'42'},db),sql.replace('SELECT :value','SELECT 42'));
    assert.deepEqual(plain(findSqlBindNames('x := 3;',db)),[]);
  });
}

test('PostgreSQL dollar bodies, tagged DO blocks, casts, and escaped strings remain intact',()=>{
 const sql="SELECT 'x'::text, E'it\\'s;:hidden', $$;:body$$;\nDO $tag$ BEGIN RAISE NOTICE ';'; END $tag$; SELECT :input::int;";
 const result=splitSqlScript(sql,'postgresql');
 assert.equal(result.length,3);
 assert.ok(result[1].text.startsWith('DO $tag$'));
 assert.deepEqual(plain(findSqlBindNames(sql,'postgresql')),['INPUT']);
 assert.equal(replaceSqlBinds(sql,{text:'wrong',input:'42'},'postgresql'),sql.replace(':input::int','42::int'));
});

test('PostgreSQL SQL-language BEGIN ATOMIC bodies retain internal statements',()=>{
 const result=splitSqlScript('CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1; SELECT CASE WHEN true THEN 2 ELSE 3 END; END; SELECT 4;','postgresql');
 assert.equal(result.length,2);
 assert.ok(result[0].text.endsWith('END'));
});

test('Oracle q-quotes protect apostrophes, delimiters, bind text, and slash-only lines',()=>{
 const sql="SELECT q'[it's;:hidden\n/\n]' FROM dual; SELECT nq'!;:also_hidden!' FROM dual; SELECT :visible FROM dual;";
 const result=splitSqlScript(sql,'oracle');
 assert.equal(result.length,3);
 assert.deepEqual(plain(findSqlBindNames(sql,'oracle')),['VISIBLE']);
});

test('Oracle mixed SQL and PL/SQL scripts retain anonymous blocks, packages, and slash delimiters',()=>{
 const script="SELECT 1 FROM dual;\nBEGIN\n NULL;\n IF true THEN NULL; END IF;\nEND;\n/\nCREATE OR REPLACE PACKAGE pkg AS\n PROCEDURE p;\nEND;\n/\nSELECT 2 FROM dual;";
 const result=splitSqlScript(script,'oracle');
 assert.equal(result.length,4);
 assert.ok(result[1].text.endsWith('END;'));
 assert.ok(result[2].text.includes('PROCEDURE p;'));
 assert.equal(result[3].text,'SELECT 2 FROM dual');
});

test('Oracle trigger record references are never treated as external input binds',()=>{
 const source='CREATE TRIGGER example BEFORE INSERT ON t REFERENCING NEW AS next_row FOR EACH ROW BEGIN :next_row.id := :NEW.id; END;\n/';
 assert.deepEqual(plain(findSqlBindNames(source,'oracle')),[]);
 assert.equal(replaceSqlBinds(source,{next_row:'wrong',NEW:'wrong'},'oracle'),source);
});
