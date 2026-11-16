// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useMemo} from 'react';
import {sql,MySQL} from '@codemirror/lang-sql';
import {linter} from '@codemirror/lint';
import type {CompletionContext} from '@codemirror/autocomplete';
import {mysqlBuiltins,mysqlLocalSymbols,type MysqlEditorError} from './mysqlEditor';
export function useMysqlEditorExtensions(issue?:MysqlEditorError|null,locals=false){
 return useMemo(()=>[sql({dialect:MySQL}),MySQL.language.data.of({autocomplete:(context:CompletionContext)=>{
  if(context.tokenBefore(['String','LineComment','BlockComment','QuotedIdentifier']))return null;
  const word=context.matchBefore(/\w*/);if(!word||word.from===word.to&&!context.explicit||context.matchBefore(/\.\w*/))return null;
  return {from:word.from,options:[...(locals?mysqlLocalSymbols(context.state.doc.toString(),context.pos):[]),...mysqlBuiltins]};
 }}),linter(view=>{if(!issue||view.state.doc.toString()!==issue.source||issue.line>view.state.doc.lines)return [];const line=view.state.doc.line(issue.line);return [{from:line.from,to:line.to,severity:'error',message:issue.message}];})],[issue,locals]);
}
