// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { tokenizeSql } from '@/features/sql/sqlScript';
import { oracleCompileStatement, oracleCompileLineOffset, type CompileError } from '@/features/stored/storedCommon';

export interface OracleTypeDiagnostic extends CompileError { kind: 'TYPE' | 'TYPE BODY'; severity: 'error' | 'warning'; }
export interface OracleTypeStatus { OBJECT_TYPE: string; STATUS: string; }
export async function typeRows<T>(query: string, binds: Record<string, string>) {
  const result = await ipcRenderer.invoke<T>('execute-sql-bg', query, binds);
  if (!result.success || !Array.isArray(result.rows)) throw new Error(result.error || 'Type metadata is unavailable.');
  return result.rows;
}
export function oracleTypeStatement(source: string, schema: string, name: string) {
  const statement = oracleCompileStatement(source);
  const tokens = tokenizeSql(statement, 'oracle');
  let index = 0;
  const word = (text: string) => tokens[index]?.kind === 'word' && tokens[index].text.toUpperCase() === text;
  const identifier = () => {
    const token = tokens[index++];
    if (token?.kind === 'word' && /^[\p{L}_][\p{L}\p{N}_$#]*$/u.test(token.text)) return token.text.toUpperCase();
    if (token?.text.startsWith('"') && token.text.endsWith('"')) return token.text.slice(1, -1).replaceAll('""', '"');
    throw new Error('type_definition_invalid');
  };
  if (!word('CREATE')) throw new Error('type_definition_invalid'); index++;
  if (word('OR')) { index++; if (!word('REPLACE')) throw new Error('type_definition_invalid'); index++; }
  if (word('EDITIONABLE') || word('NONEDITIONABLE')) index++;
  if (!word('TYPE')) throw new Error('type_definition_invalid'); index++;
  if (word('BODY')) throw new Error('type_definition_invalid');
  let owner = schema, objectName = identifier();
  if (tokens[index]?.text === '.') { owner = objectName; index++; objectName = identifier(); }
  if (owner !== schema || objectName !== name) throw new Error('type_identity_mismatch');
  return statement;
}
export async function oracleTypeDiagnostics(schema: string, name: string, kind: 'TYPE' | 'TYPE BODY', source: string): Promise<OracleTypeDiagnostic[]> {
  const rows = await typeRows<{ LINE: number; POSITION: number; TEXT: string; ATTRIBUTE: string }>(
    'SELECT LINE, POSITION, TEXT, ATTRIBUTE FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = :kind ORDER BY SEQUENCE', { owner: schema, name, kind });
  return rows.map(row => ({ line: row.LINE + oracleCompileLineOffset(source), col: row.POSITION || 1, text: row.TEXT, kind, severity: row.ATTRIBUTE === 'WARNING' ? 'warning' : 'error' }));
}
export async function readOracleType(schema: string, name: string) {
  const binds = { owner: schema, name };
  const [ddl, status] = await Promise.all([
    typeRows<{ DDL: string }>("SELECT DBMS_METADATA.GET_DDL('TYPE', :name, :owner) AS DDL FROM DUAL", binds),
    typeRows<OracleTypeStatus>("SELECT OBJECT_TYPE, STATUS FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE IN ('TYPE', 'TYPE BODY') ORDER BY OBJECT_TYPE", binds)
  ]);
  if (typeof ddl[0]?.DDL !== 'string' || !ddl[0].DDL.trim() || !status.some(row => row.OBJECT_TYPE === 'TYPE')) throw new Error('Type definition is unavailable.');
  const source = ddl[0].DDL.replace(/\/\s*$/, '').trim() + '\n/';
  const diagnostics = await oracleTypeDiagnostics(schema, name, 'TYPE', source);
  return { source, status, diagnostics };
}
