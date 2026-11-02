// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { formatDataTypeString } = loadTypeScript('src/features/er/formatDataType.ts');

test('ER types distinguish fixed storage precision from SQL type modifiers', () => {
  for (const [type, length, scale, expected] of [
    ['integer', 32, 0, 'INTEGER'], ['bigint', 64, 0, 'BIGINT'], ['smallint', 16, 0, 'SMALLINT'],
    ['double precision', 53, null, 'DOUBLE PRECISION'], ['real', 24, null, 'REAL'],
    ['NUMBER', 12, 2, 'NUMBER(12, 2)'], ['numeric', 12, 0, 'NUMERIC(12, 0)'],
    ['VARCHAR2', 80, null, 'VARCHAR2(80)'], ['character varying', 80, null, 'VARCHAR(80)'],
    ['character', 1, 0, 'CHAR(1)'], ['FLOAT', 126, null, 'FLOAT(126)'],
    ['text', null, null, 'TEXT'], ['boolean', null, null, 'BOOLEAN'],
    ['timestamp without time zone', 6, null, 'TIMESTAMP'], ['timestamp with time zone', 6, null, 'TIMESTAMP WITH TIME ZONE']
  ]) assert.equal(formatDataTypeString(type, length, scale), expected);
});
