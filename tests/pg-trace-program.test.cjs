// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { buildPgTraceProgram } = loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts', {
  '../../sqlTokens': loadTypeScript('src/features/postgresql/sqlTokens.ts'),
  '@/features/stored/traceBlockEnd': loadTypeScript('src/features/stored/traceBlockEnd.ts'),
  '@/shared/utils/dateFormatter': { getPostgresFormatForValue: value => value }
});
function generate(body, header = 'RETURNS numeric') {
  return buildPgTraceProgram({ schema: 'My"Schema', objectType: 'FUNCTION',
    sourceText: `CREATE FUNCTION demo.f()\n${header}\nLANGUAGE plpgsql\nAS $body$\nBEGIN\n${body}\nEND;\n$body$;`,
    finalArgs: {}, argumentsList: [], inputDateFormat: '', t: key => key });
}

test('Dynamic SQL placeholders inside strings, dollar values and comments are preserved while real positional arguments are rejected', () => {
  const result = generate("  EXECUTE 'SELECT $1' USING 7;\n  -- $2 is user documentation\n  RETURN length($value$literal $3$value$);");
  assert.ok(result.includes("EXECUTE 'SELECT $1' USING 7;")); assert.ok(result.includes('$value$literal $3$value$'));
  assert.throws(() => generate('  RETURN $1;'), /trace_unsupported_source/);
});

test('Loop completion is logged after END LOOP with a stable identity so EXIT reaches it', () => {
  const result = generate('  FOR k IN 1..3 LOOP\n    EXIT WHEN k = 2;\n  END LOOP;\n  RETURN 7;');
  assert.match(result, /END LOOP;\n\s+RAISE NOTICE '\[TRACE LOOP_END\] L1';/);
  assert.match(result, /\[TRACE LOOP_START\] L1/);
});

test('Multiline returns preserve SQL expressions, quoted semicolons, comments, and original line numbers', () => {
  const result = generate("  RETURN\n    CASE WHEN true THEN length('RETURN; --')\n    /* ; RETURN NEXT */ ELSE 0 END -- trailing comment\n    ;");
  assert.match(result, /"My""Schema"\."__placeholder__"/);
  assert.match(result, /\[TRACE LINE\] 6/);
  assert.ok(result.includes("CASE WHEN true THEN length('RETURN; --')\n    /* ; RETURN NEXT */ ELSE 0 END -- trailing comment\n"));
  assert.equal((result.match(/json_build_object\('name', 'RETURN'/g) || []).length, 1);
  assert.match(result, /EXIT trace_block;[\s\S]*END;\n[^\n]*\n {2}ROLLBACK;\nEND;/);
});

test('Dollar-quoted literals and variables beginning with return are not treated as return statements', () => {
  const result = generate("  return_value := length($text$RETURN NEXT; 'quoted'$text$);\n  RETURN return_value;");
  assert.ok(result.includes('return_value := length($text$RETURN NEXT;'));
  assert.match(result, /'value', \(return_value\)/);
});

for (const [body, header] of [
  ['  RETURN NEXT 1;', 'RETURNS numeric'], ['  RETURN QUERY SELECT 1;', 'RETURNS numeric'],
  ['  RETURN 1;', 'RETURNS SETOF numeric'], ['  RETURN;', 'RETURNS TABLE(value numeric)'],
  ['  IF true THEN RETURN 1; END IF;', 'RETURNS numeric'], ['  RETURN 1; RETURN 2;', 'RETURNS numeric']
]) test(`Unsupported trace source is rejected before SQL generation: ${header} / ${body}`, () => {
  assert.throws(() => generate(body, header), /trace_(unsupported_source|set_returning_unsupported)/);
});
