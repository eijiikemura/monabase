// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { splitSqlScript, tokenizeSql, type SqlDialect } from '@/features/sql/sqlScript';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
export interface MviewForm {
  schema: string; mviewName: string; selectSql: string; withData: boolean;
  refreshMethod: string; refreshTiming: string; isUpdatable: boolean; isRealTime: boolean; startWith: string; next: string;
}
export function mviewIdentifier(database: SqlDialect, value: string) {
  if (!value.trim() || value.includes('\0') || database === 'oracle' && value.includes('"')) throw new Error('mview_invalid_name');
}
export function mviewQuery(source: string, database: SqlDialect) {
  const statements = splitSqlScript(source, database);
  if (statements.length !== 1) throw new Error('mview_one_select');
  const tokens = tokenizeSql(statements[0].text, database);
  if (!tokens.length || !/^(SELECT|WITH)$/i.test(tokens[0].text) || tokens.some(token => token.kind === 'word' && /^(INSERT|UPDATE|DELETE|MERGE|INTO|CREATE|ALTER|DROP|TRUNCATE|CALL|EXECUTE|BEGIN|DECLARE|COPY|GRANT|REVOKE)$/i.test(token.text))) throw new Error('mview_one_select');
  // End before trailing comments so appended DDL clauses cannot be commented out.
  return statements[0].text.slice(0, tokens.at(-1)!.end);
}
export function mviewDateExpression(source: string) {
  if (!source.trim()) return '';
  const tokens = tokenizeSql(source, 'oracle');
  const words = /^(SYSDATE|SYSTIMESTAMP|CURRENT_DATE|CURRENT_TIMESTAMP|TRUNC|ROUND|ADD_MONTHS|NEXT_DAY|LAST_DAY|TO_DATE|TO_TIMESTAMP|TO_TIMESTAMP_TZ|NUMTODSINTERVAL|NUMTOYMINTERVAL|INTERVAL|DAY|HOUR|MINUTE|SECOND|MONTH|YEAR|TO|AT|TIME|ZONE|LOCAL|NLS_DATE_LANGUAGE)$/i;
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'word' && !/^\d+$/.test(token.text) && !words.test(token.text)) throw new Error('mview_invalid_schedule');
    if (token.kind === 'quoted' && token.text.startsWith('"')) throw new Error('mview_invalid_schedule');
    if (token.kind === 'symbol') {
      if (!/^[()+\-*/.,]$/.test(token.text)) throw new Error('mview_invalid_schedule');
      if (token.text === '(') depth++;
      if (token.text === ')' && --depth < 0) throw new Error('mview_invalid_schedule');
      if (token.text === ',' && !depth) throw new Error('mview_invalid_schedule');
    }
  }
  if (depth || !tokens.length) throw new Error('mview_invalid_schedule');
  return source.slice(0, tokens.at(-1)!.end).trim();
}
export function oracleRefreshClauses(form: MviewForm, baseline?: MviewForm) {
  const changed = (key: keyof MviewForm) => !baseline || form[key] !== baseline[key];
  const clauses: string[] = [];
  if (changed('refreshMethod')) { if (!['FAST', 'COMPLETE', 'FORCE'].includes(form.refreshMethod)) throw new Error('mview_invalid_options'); clauses.push(form.refreshMethod); }
  if (changed('refreshTiming')) { if (!['ON DEMAND', 'ON COMMIT', 'ON STATEMENT'].includes(form.refreshTiming)) throw new Error('mview_invalid_options'); if (baseline && form.refreshTiming === 'ON STATEMENT') throw new Error('mview_statement_create_only'); clauses.push(form.refreshTiming); }
  if (form.refreshTiming === 'ON STATEMENT' && form.refreshMethod !== 'FAST') throw new Error('mview_invalid_options');
  if (form.startWith && changed('startWith')) clauses.push('START WITH ' + mviewDateExpression(form.startWith));
  if (changed('next')) {
    if (form.next) clauses.push('NEXT ' + mviewDateExpression(form.next));
    else if (baseline?.next) throw new Error('mview_schedule_clear_unsupported');
  }
  if ((form.startWith || form.next) && clauses.some(clause => /^(START|NEXT)/.test(clause)) && form.refreshTiming !== 'ON DEMAND') throw new Error('mview_invalid_schedule');
  return clauses.length ? 'REFRESH ' + clauses.join('\n') : '';
}
export function createMviewSql(database: SqlDialect, form: MviewForm) {
  mviewIdentifier(database, form.schema); mviewIdentifier(database, form.mviewName);
  const query = mviewQuery(form.selectSql, database), target = qualifiedObjectName({ schema: form.schema, objectName: form.mviewName });
  if (database === 'postgresql') return `CREATE MATERIALIZED VIEW ${target} AS\n${query}\nWITH ${form.withData ? '' : 'NO '}DATA;`;
  return `CREATE MATERIALIZED VIEW ${target}\n${oracleRefreshClauses(form)}\n${form.isUpdatable ? 'FOR UPDATE\n' : ''}${form.isRealTime ? 'ENABLE ON QUERY COMPUTATION\n' : ''}AS\n${query}\n;`;
}
export function alterMviewSql(schema: string, name: string, form: MviewForm, baseline: MviewForm) {
  const clause = oracleRefreshClauses(form, baseline);
  return clause ? `ALTER MATERIALIZED VIEW ${qualifiedObjectName({ schema, objectName: name })}\n${clause}` : '';
}
