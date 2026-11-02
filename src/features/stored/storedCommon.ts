// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { argumentMode, hasArgumentDefault, type ArgumentModes } from '@/features/stored/routineArguments';
import { finiteNumericSqlLiteral } from '@/shared/utils/numberValues';
import type { Completion } from '@codemirror/autocomplete';

import { ipcRenderer } from "@/shared/api/desktop";
import i18next from 'i18next';
import { splitSqlScript, tokenizeSql } from '@/features/sql/sqlScript';

import { DEFAULT_DATETIME_FORMAT, getOracleDateFormat} from "@/shared/utils/dateFormatter";

export interface ArgInfo {
  ARGUMENT_NAME: string;
  DATA_TYPE: string;
  IN_OUT: string;
  POSITION: number;
  DEFAULT_LENGTH: number;
  DEFAULT_VALUE?: string;
  DEFAULTED?: string; 
}

export interface CompileError {
  line: number;
  col: number;
  text: string;
}

export function validateArguments(argumentsList: ArgInfo[], argValues: Record<string, string>, modes: ArgumentModes = {}): string | null {
  for (const arg of argumentsList.filter(a => a.POSITION > 0 && a.IN_OUT !== 'OUT')) {
    const mode = argumentMode(arg, modes, argValues);
    if (mode === 'default' && !hasArgumentDefault(arg)) return i18next.t('routine_default_unavailable');
    const value = argValues[arg.ARGUMENT_NAME];
    // Missing and empty inputs are SQL NULL; whitespace remains an explicit value.
    if (mode === 'value' && value !== undefined && value !== '' && /^(NUMBER|INTEGER|INT[248]?|NUMERIC|DECIMAL|FLOAT|DOUBLE|REAL|PLS_INTEGER|BINARY_INTEGER|BINARY_FLOAT|BINARY_DOUBLE)\b/i.test(arg.DATA_TYPE)) {
      try { finiteNumericSqlLiteral(value); } catch { return i18next.t('argument_is_numeric_but_an_invalid_value_is_entered', { name: arg.ARGUMENT_NAME, type: arg.DATA_TYPE }); }
    }
  }
  return null;
}

export function buildFinalArgs(argumentsList: ArgInfo[], argValues: Record<string, string>, modes: ArgumentModes = {}): Record<string, string | null> {
  const finalArgs: Record<string, string | null> = {};
  for (const arg of argumentsList.filter(a => a.POSITION > 0)) {
    const mode = arg.IN_OUT !== 'OUT' ? argumentMode(arg, modes, argValues) : 'value';
    if (mode === 'default') continue;
    const value = argValues[arg.ARGUMENT_NAME];
    finalArgs[arg.ARGUMENT_NAME] = mode === 'null' || value === undefined || value === '' ? null : value;
  }
  return finalArgs;
}

export function buildArgTypes(argumentsList: ArgInfo[]): { [key: string]: string } {
  const argTypes: { [key: string]: string } = {};
  argumentsList.filter(a => a.POSITION > 0).forEach(arg => {
    argTypes[arg.ARGUMENT_NAME] = arg.DATA_TYPE;
  });
  return argTypes;
}

export function buildArgDirections(argumentsList: ArgInfo[]): { [key: string]: string } {
  const argDirs: { [key: string]: string } = {};
  argumentsList.filter(a => a.POSITION > 0).forEach(arg => {
    argDirs[arg.ARGUMENT_NAME] = arg.IN_OUT;
  });
  return argDirs;
}

export async function checkAndClearOldTrace(schema: string, objectName: string, objectType: string, savedCompileDate: string | null, clearCallback: () => void): Promise<boolean> {
  if (!savedCompileDate) return true; 
  try {
    const typeBase = objectType.split(' ')[0]; 

    // Read the current format settings and convert them for Oracle.
    let inputFmt = DEFAULT_DATETIME_FORMAT;
    try {
      const settings = await ipcRenderer.invoke('load-settings');
      if (settings && settings.inputDateFormat) {
        inputFmt = settings.inputDateFormat;
      }
    } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    const oracleFormat = getOracleDateFormat(inputFmt);

    // Replace the hardcoded YYYY-MM-DD HH24:MI:SS format with oracleFormat.
    const sqlText = 'SELECT TO_CHAR(MAX(LAST_DDL_TIME), :format) AS DDL_TIME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE LIKE :type';
    const res = await ipcRenderer.invoke('execute-sql-bg', sqlText, { format: oracleFormat, owner: schema, name: objectName, type: typeBase + '%' });
    
    if (res.success && res.rows && res.rows.length > 0) {
      const currentCompileDate = res.rows[0].DDL_TIME;
      if (currentCompileDate && currentCompileDate !== savedCompileDate) {
        alert(i18next.t("program_has_been_updated_stale_trace_info_discarded_please_execute_trace_again"));
        await ipcRenderer.invoke('delete-trace-db', { schema, objectName, objectType: objectType.startsWith('PACKAGE') ? 'PACKAGE' : objectType });
        clearCallback();
        return false;
      }
    }
    return true;
  } catch { return true; }
}

export function oracleCompileStatement(source: string): string {
  if (splitSqlScript(source, 'oracle').length !== 1) throw new Error(i18next.t('compile_one_program_at_a_time'));
  // Remove only client delimiters; slash-only lines in comments and quoted text remain byte-for-byte intact.
  const separators = tokenizeSql(source, 'oracle').filter(token => token.kind === 'symbol' && token.text === '/' &&
    source.slice(source.lastIndexOf('\n', token.start - 1) + 1, source.indexOf('\n', token.end) < 0 ? source.length : source.indexOf('\n', token.end)).trim() === '/');
  let text = '', start = 0;
  for (const token of separators) { text += source.slice(start, token.start); start = token.end; }
  return (text + source.slice(start)).trim();
}

export function oracleCompileLineOffset(source: string) {
  const first = tokenizeSql(source, 'oracle')[0];
  return first ? source.slice(0, first.start).split('\n').length - 1 : 0;
}

export async function executeCompile(schema: string, objectName: string, sourceText: string, objectType = 'PROCEDURE'): Promise<{ success: boolean; isSyntaxError: boolean; errors: CompileError[]; messages: string[]; }> {
  const statement = oracleCompileStatement(sourceText);
  const executed = await ipcRenderer.invoke('execute-sql', statement);
  if (!executed.success) {
    return { success: false, isSyntaxError: false, errors: [],
      messages: (executed.error || i18next.t('compilation_failed')).split('\n').map(error => `[ERROR] ${error}`) };
  }

  await ipcRenderer.invoke('delete-trace-db', { schema, objectName, objectType: objectType.startsWith('PACKAGE') ? 'PACKAGE' : objectType });
  const errSql = 'SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = :type ORDER BY SEQUENCE';
  const errRes = await ipcRenderer.invoke<{ LINE: number; POSITION: number; TEXT: string }>('execute-sql-bg', errSql,
    { owner: schema, name: objectName, type: objectType });
  if (!errRes.success) {
    return { success: false, isSyntaxError: false, errors: [], messages: [errRes.error || i18next.t('failed_to_check_compilation_results')] };
  }
  const errors: CompileError[] = (errRes.rows || []).map(row => ({ line: row.LINE + oracleCompileLineOffset(sourceText), col: row.POSITION, text: row.TEXT }));
  return { success: errors.length === 0, isSyntaxError: errors.length > 0, errors,
    messages: errors.map(error => `[ERROR] Line ${error.line}, Col ${error.col}: ${error.text}`) };
}

export function parseLocalCompletions(sourceText: string): Completion[] {
  const completions: Completion[] = [];
  const seen = new Set<string>();

  const add = (label: string, type: string, detail: string) => {
    const key = label.toUpperCase();
    if (!seen.has(key)) { seen.add(key); completions.push({ label, type, detail }); }
  };

  const lines = sourceText.split('\n');
  let inDeclaration = false; let inBegin = false;
  
  const isPackage = /CREATE\s+(OR\s+REPLACE\s+)?PACKAGE\s+(?!BODY)/i.test(sourceText);
  if (isPackage) inDeclaration = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') continue;
    if (/^BEGIN\b/i.test(trimmed)) { inBegin = true; inDeclaration = false; }
    if (inBegin && /^END\b/i.test(trimmed) && !/^END\s+(IF|LOOP|CASE)\b/i.test(trimmed)) { inBegin = false; }
    if (!inBegin && /\b(IS|AS|DECLARE)$/i.test(trimmed) && !/^CREATE\b/i.test(trimmed)) { inDeclaration = true; }

    const curMatch = trimmed.match(/CURSOR\s+([a-zA-Z0-9_]+)/i);
    // Translate autocomplete details.
    if (curMatch) add(curMatch[1], 'class', i18next.t("cursor"));

    const typeMatch = trimmed.match(/TYPE\s+([a-zA-Z0-9_]+)\s+IS\s+(TABLE|VARRAY|RECORD)/i);
    // Translate autocomplete details.
    if (typeMatch) add(typeMatch[1], 'type', i18next.t("array_type", { type: typeMatch[2].toUpperCase() }));

    if (inDeclaration && !inBegin) {
      if (!/^(TYPE|CURSOR|PRAGMA|PROCEDURE|FUNCTION)\s+/i.test(trimmed)) {
        const varMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_%.]+)(?:\s*:=|\s*;|\s+NOT\s+NULL|\(|;)/i);
        if (varMatch) {
          const vName = varMatch[1].toUpperCase(); const vType = varMatch[2].toUpperCase();
          const reserved = ['BEGIN', 'END', 'IF', 'ELSIF', 'ELSE', 'FOR', 'WHILE', 'LOOP', 'RETURN', 'CREATE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TYPE', 'CURSOR', 'PRAGMA'];
          // Translate autocomplete details.
          if (!reserved.includes(vName) && !reserved.includes(vType)) add(varMatch[1], 'variable', i18next.t("var", { type: vType }));
        }
      }
    }
  }
  return completions;
}
