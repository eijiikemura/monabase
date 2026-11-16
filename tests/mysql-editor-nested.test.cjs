// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),{loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {mysqlLocalSymbols,mysqlErrorLocation}=loadTypeScript('src/features/mysql/mysqlEditor.ts');
test('MySQL completion reads parameters and only currently visible locals without scanning comments or strings',()=>{
 const text="CREATE FUNCTION f(p_value DECIMAL(12,2)) RETURNS INT BEGIN DECLARE total INT DEFAULT 0; /* DECLARE fake INT; */ BEGIN DECLARE total VARCHAR(20); DECLARE inner_value INT; SET total='DECLARE liar INT;'; ";let symbols=mysqlLocalSymbols(text,text.length);assert.equal(symbols.find(s=>s.label==='total').detail,'VARCHAR');assert.ok(symbols.some(s=>s.label==='p_value'));assert.ok(symbols.some(s=>s.label==='inner_value'));assert.ok(!symbols.some(s=>['fake','liar'].includes(s.label)));symbols=mysqlLocalSymbols(text+'END; ',text.length+5);assert.equal(symbols.find(s=>s.label==='total').detail,'INT');assert.ok(!symbols.some(s=>s.label==='inner_value'));
});
test('MySQL line mapping handles selections, leading whitespace and duplicate statements and rejects invalid diagnostics',()=>{
 const source='SELECT 1;\n\n  SELECT 2\nFROM\nWHERE nope;',statement='SELECT 2\nFROM\nWHERE nope';assert.equal(mysqlErrorLocation(source,statement,12,3),null);assert.equal(mysqlErrorLocation(source,statement,source.indexOf('SELECT 2'),3),5);for(const line of [0,-1,NaN,4,'2',1.5])assert.equal(mysqlErrorLocation(source,statement,source.indexOf('SELECT 2'),line),null);
});
test('MySQL nested trace compiler rejects expired locals/cursors, same-scope duplicates and excessive nesting',()=>{
 const {buildTraceProgram}=require('../electron/mysql/traceProgram'),base={schema:'db',name:'f',kind:'FUNCTION',parameters:[]},compile=body=>buildTraceProgram({...base,source:'CREATE FUNCTION db.f() RETURNS INT BEGIN '+body+' END'},'mbt_trace_nested');
 for(const body of ['BEGIN DECLARE gone INT; END; RETURN gone;','DECLARE x INT; DECLARE x INT; RETURN 1;','BEGIN DECLARE c CURSOR FOR SELECT 1; END; OPEN c; RETURN 1;','BEGIN '.repeat(33)+'RETURN 1;'+' END;'.repeat(33)])assert.throws(()=>compile(body));const p=compile('DECLARE x INT; BEGIN DECLARE x VARCHAR(10); SET x=\'a\'; END; RETURN x;');assert.ok(p.types['B1.x']);assert.ok(p.sql.includes('_limited=1 OR'));
});
test('MySQL editor completion excludes strings/comments and lint marks only the unchanged failed source',()=>{
 const {EditorState}=require('@codemirror/state'),{CompletionContext}=require('@codemirror/autocomplete');let lint;
 const module=loadTypeScript('src/features/mysql/useMysqlEditorExtensions.ts',{react:{useMemo:fn=>fn()},'@codemirror/lang-sql':require('@codemirror/lang-sql'),'@codemirror/lint':{linter:fn=>{lint=fn;return [];}}});
 const source='CREATE FUNCTION f(p_arg INT) RETURNS INT BEGIN DECLARE local_value INT; SET local_value=lo',extensions=module.useMysqlEditorExtensions({source,line:1,message:'parse error'},true),state=EditorState.create({doc:source,extensions});
 const results=state.languageDataAt('autocomplete',state.doc.length).filter(v=>typeof v==='function').map(fn=>fn(new CompletionContext(state,state.doc.length,true)));assert.ok(results.some(r=>r?.options?.some(o=>o.label==='local_value')));assert.ok(results.some(r=>r?.options?.some(o=>o.label==='p_arg')));assert.ok(results.some(r=>r?.options?.some(o=>o.label==='COALESCE')));assert.equal(lint({state}).length,1);assert.equal(lint({state:EditorState.create({doc:source+' '})}).length,0);
 for(const suffix of [" 'local_",' /* local_',' -- local_']){const s=EditorState.create({doc:source+suffix,extensions}),custom=s.languageDataAt('autocomplete',s.doc.length).at(-1);assert.equal(custom(new CompletionContext(s,s.doc.length,true)),null);}
 const caseSource='BEGIN DECLARE outer_value INT; SELECT CASE WHEN 1 THEN 2 END; SET outer_';assert.ok(mysqlLocalSymbols(caseSource,caseSource.length).some(s=>s.label==='outer_value'));
 const condition='BEGIN DECLARE failure CONDITION FOR SQLSTATE \'45000\'; SET f';assert.ok(!mysqlLocalSymbols(condition,condition.length).some(s=>s.label==='failure'));
});
