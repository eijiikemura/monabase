// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { bindSql, classifySql } = require('../electron/postgres/sqlText');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { replaceSqlBinds } = loadTypeScript('src/features/sql/sqlScript.ts');

test('Binds only SQL placeholders and leaves quoted text, nested comments, casts, and dollar bodies intact', () => {
  const source = `SELECT :name, ':name', "colon:name", E'escaped\\':name', :name::text,
    $$:name$$, $body$BEGIN :name; END$body$, :名前, :other
    -- :name
    /* :name /* :other */ :名前 */`;
  const result = bindSql(source, { name: 'value', 名前: 'Unicode', other: 42 });
  assert.equal(result.text, source.replace('SELECT :name,', 'SELECT $1,').replace(':name::text', '$1::text').replace(', :名前, :other', ', $2, $3'));
  assert.deepEqual(result.values, ['value', 'Unicode', 42]);
  const literal = replaceSqlBinds(source, { NAME: "'value'", 名前: "'Unicode'", other: '42' }, 'postgresql');
  assert.equal(literal, source.replace('SELECT :name,', "SELECT 'value',").replace(':name::text', "'value'::text").replace(', :名前, :other', ", 'Unicode', 42"));
});

test('Repeated and prefix names reuse positions without changing casts or native placeholders', () => {
  assert.deepEqual(bindSql('SELECT :id2, :id, :id2, 1::int, :missing', { id:1, id2:2, int:3 }), {
    text:'SELECT $1, $2, $1, 1::int, :missing', values:[2,1]
  });
  assert.deepEqual(bindSql('SELECT $1::int', [42]), {text:'SELECT $1::int', values:[42]});
  assert.equal(bindSql("SELECT ':name'", {name:'ignored'}).text, "SELECT ':name'");
});

test('Command classification handles comments, literal semicolons, CTE writes, and transaction-control exclusions', () => {
  assert.equal(classifySql("/* lead /* nested */ */ INSERT INTO t VALUES ('x;y')").isDml, true);
  assert.equal(classifySql('WITH inserted AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM inserted').isDml, true);
  assert.equal(classifySql("SELECT ';'; SELECT 2").canUseSavepoint, true);
  for (const sql of ['BEGIN; SELECT 1', 'SELECT 1; COMMIT', 'ROLLBACK TO SAVEPOINT user_mark',
    'SAVEPOINT user_mark', 'CALL p()', 'DO $$ BEGIN COMMIT; END $$', 'CREATE TABLE t(id int)', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']) {
    assert.equal(classifySql(sql).canUseSavepoint, false, sql);
  }
});
