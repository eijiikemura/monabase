// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadModule } = require('./helpers/loadModule.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Run actual generation up to the database compilation step.
async function generateOracle(sourceText, objectName = 'NEW_PROCEDURE', objectType = 'PROCEDURE', skipParse = false) {
  const { executeTrace } = loadModule('electron/oracle/traceExecutor.js', {
    '../i18n': { t: (key, values) => require('../electron/i18n').translate(key, 'ja', values) },
    oracledb: { OUT_FORMAT_OBJECT: 1 }, './traceDb': {}
  }, {}, { strict: false });
  const compiled = [];
  const connection = {
    async execute(sql) {
      if (sql.includes('FROM ALL_PROCEDURES')) return { rows: [{ SUBPROGRAM_ID: 1 }] };
      if (sql.includes('SELECT COUNT(*)')) return { rows: [{ CNT: 0 }] };
      if (sql.includes('LAST_DDL_TIME')) return { rows: [] };
      if (sql.includes("GET_DDL('PACKAGE_SPEC'")) return { rows: [{ DDL: 'CREATE OR REPLACE PACKAGE DEMO AS PROCEDURE RUN; END DEMO;' }] };
      if (sql.includes("GET_DDL('PACKAGE_BODY'")) return { rows: [{ DDL: sourceText }] };
      if (/^CREATE/i.test(sql)) {
        compiled.push(sql);
        if (objectType !== 'PACKAGE' || compiled.length === 2) throw new Error('Compilation stopped by test');
      }
      return { rows: [] };
    }
  };
  await assert.rejects(executeTrace(connection, {
    schema: 'MY_USER', objectName, objectType, sourceText, args: {}, argTypes: {}, argDirections: {}, subProgram: objectType === 'PACKAGE' ? 'RUN' : undefined, subProgramId: 1, skipParse
  }), /Compilation stopped by test/);
  return compiled;
}

test('Oracle debug procedures and functions omit final closing names', async () => {
  for (const [name, endName, type] of [
    ['NEW_PROCEDURE', 'NEW_PROCEDURE', 'PROCEDURE'],
    ['Mixed_Name', '"Mixed_Name"', 'PROCEDURE'],
    ['NEW_FUNCTION', 'new_function', 'FUNCTION'],
    ['プロシージャ_1', '"プロシージャ_1"', 'PROCEDURE'],
    ['プロシージャ', '"プロシージャ_1"', 'PROCEDURE'],
    ['NEW_FUNCTION', '"Different_Name"', 'FUNCTION']
  ]) {
    const [sql] = await generateOracle(`CREATE OR REPLACE ${type} "MY_USER"."${name}"\n${type === 'FUNCTION' ? 'RETURN NUMBER\n' : ''}IS\nBEGIN\n  NULL;\nEND ${endName}; -- 終了\n/* Trailing comment. */`, name, type);
    const debugName = `MONA_${name.toUpperCase()}_1`;
    assert.ok(sql.includes(`"MY_USER"."${debugName}"`));
    assert.ok(sql.includes('END; -- 終了'), sql);
    assert.ok(sql.endsWith('/* Trailing comment. */'));
  }
});

test('Oracle removes final closing names with comments and a SQL script delimiter', async () => {
  const [sql] = await generateOracle('CREATE OR REPLACE PROCEDURE NEW_PROCEDURE\nIS\nBEGIN\nNULL;\nEND /* Keep this comment. */ "別の名前";\n/');
  assert.ok(sql.endsWith('END /* Keep this comment. */;'), sql);
});

test('Oracle preserves nested closing names, strings, comments, and unnamed END statements', async () => {
  const [sql] = await generateOracle(`CREATE OR REPLACE PROCEDURE NEW_PROCEDURE\nIS\n  PROCEDURE INNER_PROC IS\n  BEGIN\n    NULL;\n  END INNER_PROC;\nBEGIN\n  DBMS_OUTPUT.PUT_LINE('END NEW_PROCEDURE;');\nEND; -- END NEW_PROCEDURE;`);
  assert.ok(sql.includes('END INNER_PROC;'));
  assert.ok(sql.includes("'END NEW_PROCEDURE;'"));
  assert.ok(sql.includes('END; -- END NEW_PROCEDURE;'));
});

test('Oracle package specifications and bodies use matching closing names', async () => {
  const compiled = await generateOracle('CREATE OR REPLACE PACKAGE BODY DEMO AS\nPROCEDURE RUN IS\nBEGIN\nNULL;\nEND RUN;\nEND DEMO;', 'DEMO', 'PACKAGE');
  assert.equal(compiled.length, 2);
  for (const sql of compiled) assert.ok(sql.includes('END "MONA_DEMO_1";'));
  assert.ok(compiled[1].includes('END RUN;'));
});

test('Oracle replaces placeholders in generated trigger programs', async () => {
  const [sql] = await generateOracle('CREATE OR REPLACE PROCEDURE __placeholder__ AS\nBEGIN\nNULL;\nEND;', 'TRG_TEST', 'PROCEDURE', true);
  assert.ok(sql.includes('PROCEDURE "MONA_TRG_TEST_1"'));
  assert.ok(sql.endsWith('END;'));
});

const blockModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('src/features/stored/traceBlockEnd.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: blockModule.exports });
const { findTraceBlockEnd, removeTraceBlockEndName } = blockModule.exports;

test('Both databases identify only the final named block END', () => {
  for (const end of ['END;', 'end test_proc;', 'END "日本語名"; -- 終了']) {
    const lines = ['BEGIN', '  BEGIN', '    NULL;', '  END inner_block;', end, '$body$;', '/*', 'END fake;', '*/'];
    assert.equal(findTraceBlockEnd(lines), 4);
    assert.match(removeTraceBlockEndName(lines[4]), /^end\s*;/i);
    assert.equal(lines[3], '  END inner_block;');
  }
});

test('Comments, strings, and control statements are not mistaken for the closing END', () => {
  const lines = ['BEGIN', "  value := '複数行", 'END fake;', "文字列';", 'END real_name;', '-- END fake;', 'END IF;', 'END LOOP;', 'END CASE;'];
  assert.equal(findTraceBlockEnd(lines), 4);
  assert.equal(findTraceBlockEnd(['-- END fake;', 'END IF;', 'END LOOP;']), -1);
});
