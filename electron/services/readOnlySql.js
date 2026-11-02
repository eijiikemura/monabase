// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { scanSql } = require('./sqlTokens');

// Read-only mode is an accident-prevention feature; DB privileges remain the security boundary.
const writeWords = new Set('INSERT UPDATE DELETE MERGE CREATE ALTER DROP TRUNCATE GRANT REVOKE CALL DO BEGIN DECLARE COPY EXECUTE VACUUM ANALYZE INTO LOCK NEXTVAL SETVAL'.split(' '));
const oracleFunctions = new Set(`ABS ACOS ADD_MONTHS ASCII ASIN ATAN ATAN2 AVG BITAND CAST CEIL CHR COALESCE CONCAT COS COUNT CUME_DIST CURRENT_DATE CURRENT_TIMESTAMP DECODE DENSE_RANK DUMP EXP EXTRACT FIRST_VALUE FLOOR GREATEST GROUPING GROUPING_ID HEXTORAW INITCAP INSTR JSON_ARRAY JSON_OBJECT JSON_QUERY JSON_VALUE LAG LAST_DAY LAST_VALUE LEAD LEAST LENGTH LENGTHB LISTAGG LN LOG LOWER LPAD LTRIM MAX MEDIAN MIN MOD MONTHS_BETWEEN NANVL NTH_VALUE NTILE NULLIF NVL NVL2 PERCENT_RANK POWER RANK RAWTOHEX REGEXP_COUNT REGEXP_INSTR REGEXP_REPLACE REGEXP_SUBSTR REPLACE ROUND ROW_NUMBER RPAD RTRIM SIGN SIN SQRT STDDEV SUBSTR SUM SYS_CONTEXT TAN TO_CHAR TO_CLOB TO_DATE TO_NCHAR TO_NUMBER TO_TIMESTAMP TO_TIMESTAMP_TZ TRANSLATE TRIM TRUNC UPPER VARIANCE XMLAGG XMLELEMENT XMLSERIALIZE`.split(/\s+/));
const syntaxParentheses = new Set('AS IN EXISTS OVER PARTITION BY GROUP ORDER WITHIN KEEP WHEN THEN ELSE AND OR NOT ON USING SELECT FROM WHERE HAVING UNION ALL DISTINCT CASE VALUES NUMBER VARCHAR2 VARCHAR CHAR NVARCHAR2 NCHAR TIMESTAMP INTERVAL'.split(' '));

function isReadOnlySql(sql, dialect) {
  const tokens = scanSql(sql, dialect);
  if (tokens.at(-1)?.text === ';') tokens.pop();
  if (!tokens.length || !['SELECT', 'WITH', ...(dialect === 'postgresql' ? ['VALUES'] : [])].includes(tokens[0].text.toUpperCase())) return false;
  if (tokens.some(token => token.kind === 'symbol' && token.text === ';')) return false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const name = token.text.toUpperCase();
    if (token.kind === 'word' && writeWords.has(name)) return false;
    if (token.text.replace(/^"|"$/g, '').toUpperCase() === 'NEXTVAL' && tokens[index - 1]?.text === '.') return false;
    if (name === 'FOR' && ['UPDATE', 'SHARE', 'NO', 'KEY'].includes(tokens[index + 1]?.text.toUpperCase())) return false;
    const identifier = token.kind === 'word' || token.text.startsWith('"');
    if (!identifier || tokens[index + 1]?.text !== '(') continue;
    const normalized = name.replace(/^"|"$/g, '').replaceAll('""', '"');
    if (dialect === 'postgresql') {
      if (/^PG_(?:TERMINATE_BACKEND|CANCEL_BACKEND|ADVISORY_|LOGICAL_EMIT_MESSAGE)/.test(normalized) || normalized === 'SET_CONFIG' || normalized.startsWith('DBLINK')) return false;
      continue;
    }
    if (tokens[index - 1]?.text === '.') {
      // Only the metadata reader is allowed; arbitrary package functions can commit autonomously.
      if (name !== 'GET_DDL' || tokens[index - 2]?.text.toUpperCase() !== 'DBMS_METADATA' || tokens[index - 3]?.text === '.') return false;
    } else if (token.kind !== 'word' || (!oracleFunctions.has(name) && !syntaxParentheses.has(name))) {
      // A CTE column list is a declaration rather than a function invocation.
      let depth = 1, end = index + 2;
      for (; end < tokens.length && depth; end++) {
        if (tokens[end].text === '(') depth++;
        if (tokens[end].text === ')') depth--;
      }
      if (tokens[0].text.toUpperCase() !== 'WITH' || tokens[end]?.text.toUpperCase() !== 'AS' || !['WITH', ','].includes(tokens[index - 1]?.text.toUpperCase())) return false;
    }
  }
  return true;
}

module.exports = { isReadOnlySql };
