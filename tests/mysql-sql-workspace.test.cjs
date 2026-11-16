// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { inspectSql, assertReadOnly } = require('../electron/mysql/sqlText');
const { inspectSqlPrivacy } = require('../electron/services/sqlPrivacy');
const { employeeInsert } = require('./fixtures/mysql/employees.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const { splitSqlScript, findSqlBindNames } = loadTypeScript('src/features/sql/sqlScript.ts');

test('MySQL multiline employee INSERT remains one statement; scripts respect quotes, escapes, backticks and comments', () => {
  const insert = employeeInsert('employees');
  assert.equal(splitSqlScript(insert, 'mysql').length, 1);
  assert.equal(inspectSql(insert).command, 'INSERT');
  const source = insert + '\n# separator ;\nSELECT 1--2; SELECT \'a; :fake\\\'quoted\', `semi;colon`, :real; /* ; */';
  const statements = splitSqlScript(source, 'mysql');
  assert.equal(statements.length, 3); statements.forEach(item => assert.doesNotThrow(() => inspectSql(item.text, { real: 'yes' })));
  assert.deepEqual(plain(findSqlBindNames(statements[2].text, 'mysql')), ['REAL']);
  assert.equal(splitSqlScript('SELECT name# comment ;\nFROM t; SELECT 2;;', 'mysql').length, 2);
  for (const sql of ["SELECT 'bad", 'SELECT `bad', 'SELECT 1 /* unfinished', '/*!80000 DELETE FROM t */', '/*M! DELETE FROM t */']) assert.throws(() => splitSqlScript(sql, 'mysql'), undefined, sql);
  assert.throws(() => inspectSql('SELECT 1; DELETE FROM t'), /one MySQL statement/, 'The driver still forbids multi-command execution.');
});

test('MySQL credential and prepared dynamic SQL are excluded from visible history even with hashes and escaped quotes', () => {
  for (const sql of ["ALTER USER `someone` IDENTIFIED BY 'secret'", "SET PASSWORD = 'secret'", "PREPARE s FROM 'SELECT 1'", "SELECT 1;# comment\nALTER USER u IDENTIFIED BY 'a\\'b'"]) assert.equal(inspectSqlPrivacy(sql, 'mysql').sensitive, true);
  assert.equal(inspectSqlPrivacy("SELECT 'PASSWORD and IDENTIFIED'", 'mysql').sensitive, false);
});

function fixture({errorLine}={}) {
  const hooks = createHookHarness(), calls = [], entries = [], states = [], win = new EventTarget();
  const props = { text: 'SELECT 1; SELECT 2;', bindText: '{}', schema: 'demo', editor: { current: null }, settings: { sqlHistoryEnabled: true }, busy: false, disabled: false, setBusy: value => { props.busy = value; }, onState: state => states.push(state) };
  let fail = false, cancelled = false, privateMode = false;
  const invoke = async (channel, ...args) => {
    calls.push([channel, ...args]);
    if (channel === 'inspect-sql-privacy') return args[0].map(sql => inspectSqlPrivacy(sql, args[1]));
    if (channel === 'begin-sql-batch' || channel === 'end-sql-batch') return { success: true };
    if (channel === 'execute-sql' || channel === 'explain-sql') {
      if (cancelled) win.dispatchEvent(new Event('cancel-sql-script'));
      if (fail && args[0].includes('2')) return { success: false, error: 'fixture failure', mysqlErrorLine:errorLine, transactionStatus: 'active' };
      return { success: true, command: inspectSql(args[0],args[1] || {}).command, rows: channel === 'explain-sql' ? [{ PLAN_TABLE_OUTPUT: '{"query_block":{"message":"No tables used"}}' }] : [{ value: args[0] }], metaData: [{ name: channel === 'explain-sql' ? 'PLAN_TABLE_OUTPUT' : 'value' }], executionTime: 2, transactionStatus: 'active' };
    }
    if (channel === 'cancel-execution') return { success: true };
    throw new Error('Unexpected IPC: ' + channel);
  };
  const module = loadTypeScript('src/features/mysql/useSqlExecution.ts', { react: hooks.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }, '@/features/sql/useSqlHistory': { useSqlHistory: () => ({ historyLogs: entries, addHistory: async entry => { entries.push(entry); }, clearHistory: async () => { entries.length = 0; } }) },
    '@/features/sql/sqlScript': { splitSqlScript, findSqlBindNames }
  }, { window: win, CustomEvent, crypto: require('node:crypto').webcrypto });
  let current;
  const render = () => { current = hooks.render(() => module.useSqlExecution(props)); hooks.commit(); return current; };
  render();
  return { props, calls, entries, states, hooks, render, win, get current() { return current; }, fail: () => { fail = true; }, cancel: () => { cancelled = true; }, private: () => { privateMode = true; current.setPrivateExecution(privateMode); render(); } };
}
test('MySQL scripts execute sequential single statements with exact binds/schema and retain only the latest result', async () => {
  const f = fixture(); const first = f.current.execute(); await f.current.execute(); await first; f.render();
  assert.deepEqual(plain(f.calls.filter(call => call[0] === 'execute-sql').map(call => call.slice(1, 4))), [['SELECT 1', {}, 'demo'], ['SELECT 2', {}, 'demo']]);
  assert.equal(f.current.rows[0].value, 'SELECT 2'); assert.equal(f.entries.length, 2);
  assert.equal(f.current.logs.length, 2); assert.equal(f.props.busy, false); assert.equal(f.states.at(-1).transactionStatus, 'active');
  f.props.editor.current = { view: { state: { doc:{toString:()=> 'SELECT 9'},selection: { main: { empty: false, from: 0, to: 8 } }, sliceDoc: () => 'SELECT 9' } } };
  await f.current.execute(); f.render(); assert.equal(f.current.rows[0].value, 'SELECT 9');
  f.hooks.unmount();
});
test('MySQL script errors and cancellation stop later SQL without automatic rollback or retry', async () => {
  for (const cancel of [false, true]) {
    const f = fixture(); f.props.text = 'SELECT 1; SELECT 2; SELECT 3';
    if (cancel) f.cancel(); else f.fail();
    f.render(); await f.current.execute(); f.render();
    assert.equal(f.calls.filter(call => call[0] === 'execute-sql').length, cancel ? 1 : 2);
    assert.equal(f.calls.some(call => call[0] === 'rollback-db' || call[0] === 'commit-db'), false);
    assert.equal(f.calls.at(-1)[0], 'end-sql-batch'); assert.equal(f.current.bottomTab, 1); assert.ok(f.current.error); f.hooks.unmount();
  }
});
test('MySQL private mode never persists SQL and plan snapshots bind the exact analyzed SQL rather than live editor text', async () => {
  const f = fixture(); f.props.text = 'SELECT :name'; f.props.bindText = '{"name":"private-value","unused":"never-share"}';
  f.render(); await f.current.execute(); f.render(); f.current.setIsExplainMode(true); f.render(); await f.current.execute(); f.render();
  assert.equal(f.current.explainSnapshot.sql, 'SELECT :name'); assert.equal(f.current.explainSnapshot.observedExecution.requestDurationMs, 2);
  assert.deepEqual(plain(f.current.explainSnapshot.binds.map(bind => bind.name)), ['name']);
  f.props.text = 'SELECT a_different_statement'; f.render(); assert.equal(f.current.explainSnapshot.sql, 'SELECT :name');
  const count = f.entries.length; f.private(); await f.current.execute(); f.render();
  assert.equal(f.entries.length, count); assert.equal(f.current.explainSnapshot, null); assert.equal(f.current.logs[0].sql, 'sql_private_statement_hidden'); f.hooks.unmount();
});
test('MySQL plan parser preserves nested access paths and tuning context masks embedded bind values and never reads application rows', async () => {
  const reads = [];
  const { parseMysqlPlan, buildMysqlTuningPrompt, mysqlPlanTableCandidates } = loadTypeScript('src/features/mysql/sqlPlan.ts', {
    '@/features/mysql/table/tableRepository': { backgroundRows: async (sql, binds) => {
      reads.push([sql, binds]);
      if (sql.startsWith('SHOW')) return [{ 'Create Table': 'CREATE TABLE `demo`.`orders` (`id` int PRIMARY KEY)' }];
      if (sql.includes('information_schema.STATISTICS')) return [{ INDEX_NAME: 'PRIMARY', CARDINALITY: 10 }];
      return [{ TABLE_NAME: binds.table, TABLE_ROWS: 10 }];
    } }, '@/features/sql/sqlScript': { tokenizeSql: loadTypeScript('src/features/sql/sqlScript.ts').tokenizeSql }
  });
  const rows = [{ PLAN_TABLE_OUTPUT: JSON.stringify({ query_block: { cost_info: { query_cost: '1.20' }, nested_loop: [{ table: { table_name: 'o', access_type: 'ALL', attached_condition: "o.label = 'secret-value'", rows_examined_per_scan: 20 } }] } }) }];
  const tree = parseMysqlPlan(rows); assert.equal(tree.tree[0].children[0].children[0].operation, 'ALL');
  assert.equal(tree.tree[0].children[0].children[0].table, undefined, 'An alias must never open a guessed table.');
  const snapshot = { sql: 'SELECT * FROM `demo`.`orders` o WHERE label=:label', schema: 'demo', rows, binds: [{ name: 'label', placeholder: 'label', type: 'string', value: 'secret-value' }] };
  const masked = await buildMysqlTuningPrompt(snapshot, 'MySQL 8.4', false, 'ja');
  assert.ok(!masked.includes('secret-value')); assert.match(masked, /Japanese/); assert.match(masked, /ALL/); assert.match(masked, /1.20/); assert.match(masked, /CREATE TABLE/); assert.match(masked, /estimates/);
  const shared = await buildMysqlTuningPrompt(snapshot, 'MySQL 8.4', true, 'en'); assert.match(shared, /secret-value/);
  assert.ok(reads.every(([sql]) => sql.startsWith('SHOW CREATE') || sql.includes('information_schema.')));
  assert.deepEqual(plain(mysqlPlanTableCandidates("SELECT * FROM `odd``db`.`a.b` a JOIN other b ON a.id=b.id WHERE x='FROM secret'", 'demo')), [{ schema: 'odd`db', table: 'a.b' }, { schema: 'demo', table: 'other' }]);
  assert.deepEqual(plain(mysqlPlanTableCandidates('WITH selected AS (SELECT * FROM real_table) SELECT * FROM selected', 'demo')), [{ schema: 'demo', table: 'real_table' }]);
  assert.throws(() => parseMysqlPlan([{ PLAN_TABLE_OUTPUT: '{}' }]), /Unsupported/);
  assert.throws(() => assertReadOnly(inspectSql('SELECT * FROM t FOR UPDATE')));
});

test('MySQL malformed trailing SQL is rejected before any statement runs and disabled/history-off states are respected', async () => {
  const f = fixture();
  f.props.text = "SELECT 1; SELECT 'unterminated"; f.render(); await f.current.execute(); f.render();
  assert.equal(f.calls.some(call => call[0] === 'execute-sql' || call[0] === 'begin-sql-batch'), false);
  assert.equal(f.props.busy, false); assert.match(f.current.error, /Unclosed SQL quote/);
  f.props.text = 'SELECT 1'; f.props.disabled = true; f.render(); await f.current.execute();
  assert.equal(f.calls.length, 0);
  f.props.disabled = false; f.props.settings.sqlHistoryEnabled = false; f.render(); await f.current.execute(); f.render();
  assert.equal(f.entries.length, 0); assert.equal(f.current.rows[0].value, 'SELECT 1'); f.hooks.unmount();
});


test('MySQL SQL DDL refreshes all loaded object categories rather than only TABLE',async()=>{
  const f=fixture(),events=[];f.win.addEventListener('refresh-sidebar',event=>events.push(event.detail));
  f.props.text='CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `other`.`v` AS SELECT 1 id';f.render();await f.current.execute();f.render();
  assert.equal(events.length,1);assert.equal(events[0].objType,undefined);assert.equal(events[0].schema,undefined);assert.equal(f.current.error,'');f.hooks.unmount();
});

test('MySQL SQL window has no schema selector and uses the connection database for execution, AI and tuning',()=>{
 const {componentHarness}=require('./helpers/componentHarness.cjs');let executionInput,aiInput;
 const f=componentHarness('src/features/mysql/SqlWindow.tsx',{database:'connected_db',tabId:3,initialSql:'SELECT * FROM `other_db`.`orders`',settings:{theme:'simple',outputDateFormat:'YYYY-MM-DD'},active:false,busy:false,disabled:false,aiEnabled:false,setBusy(){},onState(){},onOpenAi(){}},{dependencies:{
 './SqlBindPanel':'SqlBindPanel','@codemirror/view':{EditorView:{}},'@uiw/react-codemirror':'Editor','./useMysqlEditorExtensions':{useMysqlEditorExtensions:()=>[]},'../useMysqlEditorExtensions':{useMysqlEditorExtensions:()=>[]},'@codemirror/lang-sql':{sql:()=>[],MySQL:{}},'sql-formatter':{format:s=>s},
 './useMysqlEditorAi':{useMysqlEditorAi:input=>{aiInput=input;return {displaySql:input.text,isGenerating:false};}},
 './useSqlExecution':{useSqlExecution:input=>{executionInput=input;return {metadata:[],notices:[],error:'',rows:[],logs:[],historyLogs:[],setError(){},execute(){}};}},
 '@/features/sql/SqlEditorToolbar':'Toolbar','@/features/sql/SqlWindowBottom':'Results','@/features/sql/SqlFileActions':'Files','@/features/sql/SqlPrivacyToggle':'Privacy','@/features/ai/AiRequestButton':'AiButton',
 '@/features/sql/SqlPaneLayout':{SqlPaneControls:'Panes',useSqlPaneLayout:()=>({mode:'split',height:260,rootRef:{current:null},separatorProps:{}})},'@/features/data-grid/dataGridHelper':{buildGridColumns:()=>[]}
 }});
 assert.equal(f.nodes().some(n=>n.type==='TextField'&&n.props.select),false);assert.equal(executionInput.schema,'connected_db');assert.equal(aiInput.schema,'connected_db');assert.equal(f.node('Results').props.selectedSchema,'connected_db');assert.equal(executionInput.text,'SELECT * FROM `other_db`.`orders`');f.unmount();
});

test('MySQL execution maps selected parser failures to the original editor and never exposes private error locations',async()=>{
 const source='SELECT 0;\n\nSELECT 2\nFROM\nWHERE nope;',start=source.indexOf('SELECT 2'),selected='SELECT 2\nFROM\nWHERE nope';
 for(const privateMode of [false,true]){const f=fixture({errorLine:3});f.props.text=source;f.props.editor.current={view:{state:{doc:{toString:()=>source},selection:{main:{empty:false,from:start,to:start+selected.length}},sliceDoc:()=>selected}}};f.fail();f.render();if(privateMode)f.private();await f.current.execute();f.render();if(privateMode){assert.equal(f.current.editorError,null);assert.equal(f.current.logs[0].errorLines[0],'sql_sensitive_error_hidden');}else{assert.equal(f.current.editorError.line,5);assert.equal(f.current.editorError.source,source);assert.match(f.current.logs[0].errorLines[0],/^\[ERROR\] Line 5:/);}f.hooks.unmount();}
});
