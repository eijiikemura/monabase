// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { postgresColumnKind, postgresCastType } = loadTypeScript('src/features/postgresql/columnTypes.ts');
const { createTableQueryBuilder } = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts');
const builder = createTableQueryBuilder({ schema: 'test', inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD', structureDefs: [] });
const column = (DATA_TYPE, extra = {}) => ({ COLUMN_NAME: 'value', DATA_TYPE, ...extra });
test('PostgreSQL catalog identity prevents user-defined names from imitating built-in types', () => {
  for (const name of ['PrintStatus', 'DateStatus', 'BooleanState', 'TextStatus', 'ByteaState', 'IntervalState']) {
    const definition = column(`"Case Schema"."${name}"`, { PG_TYPE_SCHEMA: 'Case Schema', PG_TYPE_NAME: name, PG_TYPE_KIND: 'e', PG_TYPE_CATEGORY: 'E' });
    assert.equal(postgresColumnKind(definition), 'other');
    assert.equal(builder.formatSqlValue(definition, " open's "), `' open''s '::"Case Schema"."${name}"`);
  }
  assert.equal(postgresColumnKind(column('integer', { PG_TYPE_SCHEMA: 'custom', PG_TYPE_NAME: 'integer', PG_TYPE_KIND: 'd' })), 'other');
});
test('PostgreSQL built-in matching is exact and retains numeric modifiers without classifying arrays or domains as numbers', () => {
  for (const type of ['integer', 'numeric(12, 2)', 'double precision', 'real']) assert.equal(postgresColumnKind(column(type)), 'number');
  for (const type of ['integer[]', 'PrintStatus', 'interval', '"OrderState"']) assert.equal(postgresColumnKind(column(type)), 'other');
  assert.equal(postgresColumnKind(column('timestamp(6) without time zone')), 'timestamp');
  assert.equal(postgresColumnKind(column('text')), 'text'); assert.equal(postgresColumnKind(column('bytea')), 'binary');
  assert.equal(builder.formatSqlValue(column('numeric(38,20)'), '9007199254740993.1234567890123456789'), '9007199254740993.1234567890123456789');
});
test('PostgreSQL casts preserve exact identifiers, quoted schema names and fallback type spelling', () => {
  assert.equal(builder.formatSqlValue(column('"test"."OrderState"'), 'open'), `'open'::"test"."OrderState"`);
  assert.equal(postgresCastType(column('ignored', { PG_TYPE_SCHEMA: 's"x', PG_TYPE_NAME: 'Type"Name' })), '"s""x"."Type""Name"');
  assert.equal(postgresColumnKind(column('numeric', { PG_TYPE_CATEGORY: 'A' })), 'other');
});
