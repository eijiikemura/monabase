// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0


export const highlightSql = (code: string, isDark: boolean) => {
  let inString = false;
  let inComment = false;
  let result = '';
  let token = '';
  
  // Include all keywords, types, functions, and packages defined in plsqlDialect.ts.
  const keywords = new Set([
    // 1. Basic keywords, exceptions, and control flow.
    'ACCESS','ADD','ALL','ALTER','AND','ANY','AS','ASC','AUDIT','BEGIN','BINARY_INTEGER','BODY',
    'BETWEEN','BY','CASE','CHECK','CLUSTER','COLUMN','COLUMN_VALUE','COMMENT','COMPRESS',
    'CONNECT','CREATE','CURRENT','CURSOR','DECLARE','DEFAULT','DELETE','DESC','DISTINCT',
    'DROP','EDITIONABLE','ELSE','ELSIF','END','EXCLUSIVE','EXISTS','EXIT','FETCH','FILE','FOR','FROM',
    'FUNCTION','GOTO','GRANT','GROUP','HAVING','IDENTIFIED','IF','IMMEDIATE','IN','INCREMENT',
    'INDEX','INITIAL','INSERT','INTERSECT','INTO','IS','LEVEL','LIKE','LOCK','MAXEXTENTS',
    'MINUS','MODE','MODIFY','NESTED_TABLE_ID','NOAUDIT','NOCOMPRESS','NOT','NOWAIT','NULL','OF',
    'OFFLINE','ON','ONLINE','OPTION','OR','ORDER','OUT','PACKAGE','PCTFREE','PRIOR','PROCEDURE',
    'PUBLIC','RENAME','REPLACE','RESOURCE','RETURN','REVOKE','ROW','ROWNUM','ROWS','SELECT',
    'SESSION','SET','SHARE','SIZE','START','SUCCESSFUL','SYNONYM','TABLE','THEN','TO','TRIGGER',
    'UNION','UNIQUE','UPDATE','VALIDATE','VALUES','VIEW','WHEN','WHENEVER','WHERE','WHILE',
    'WITH','LOOP','EXCEPTION','OTHERS','TYPE','ROWTYPE','ACCESS_INTO_NULL','CASE_NOT_FOUND',
    'COLLECTION_IS_NULL','CURSOR_ALREADY_OPEN','DUP_VAL_ON_INDEX','INVALID_CURSOR',
    'INVALID_NUMBER','LOGIN_DENIED','NO_DATA_FOUND','NO_DATA_NEEDED','NOT_LOGGED_ON',
    'PROGRAM_ERROR','ROWTYPE_MISMATCH','SELF_IS_NULL','STORAGE_ERROR','SUBSCRIPT_BEYOND_COUNT',
    'SUBSCRIPT_OUTSIDE_LIMIT','SYS_INVALID_ROWID','TIMEOUT_ON_RESOURCE','TOO_MANY_ROWS',
    'VALUE_ERROR','ZERO_DIVIDE','RAISE','ENDIF','ENDLOOP','COMMIT','ROLLBACK','FORALL',

    // 2. Data types.
    'CHAR','DATE','DECIMAL','FLOAT','INTEGER','LONG','MLSLABEL','NUMBER','RAW','ROWID',
    'SMALLINT','VARCHAR','VARCHAR2','BOOLEAN','PLS_INTEGER',

    // 3. Built-in functions.
    'ADD_MONTHS','ASCII','AVG','CEIL','CHR','COALESCE','CONCAT','COUNT','DECODE','DENSE_RANK',
    'FLOOR','INITCAP','INSTR','INSTRB','LAST_DAY','LENGTH','LENGTHB','LOWER','LPAD','LTRIM',
    'MAX','MIN','MOD','NVL','RANK','ROUND','ROW_NUMBER','RPAD','RTRIM','SUBSTR','SUBSTRB','SUM',
    'SYSDATE','TO_CHAR','TO_DATE','TO_NUMBER','TRANSLATE','TRIM','TRUNC','UID','UPPER','USER',
    'SYSTIMESTAMP',

    // 4. Standard Oracle packages.
    'DBMS_OUTPUT','DBMS_SQL','DBMS_LOB','DBMS_METADATA','DBMS_UTILITY','DBMS_RANDOM',
    'DBMS_CRYPTO','DBMS_SCHEDULER','DBMS_JOB','DBMS_STATS','UTL_FILE','UTL_HTTP','UTL_SMTP',
    'UTL_MAIL','UTL_URL','HTP','HTF','OWA','OWA_UTIL',

    // 5. Additional MonaBase keywords.
    'UPDATING', 'DELETING', 'INSERTING', 'RAISE_APPLICATION_ERROR', 'EXCEPTION_INIT', 
    'TRUE', 'FALSE', 'REFERENCES', 'CONSTRAINT', 'PRIMARY', 'KEY', 'PRAGMA', 'AUTONOMOUS_TRANSACTION'
  ]);
  
  const colors = {
    keyword: isDark ? '#569cd6' : '#0000ff', // VS Code-style blue.
    string: isDark ? '#ce9178' : '#a31515',  // VS Code-style orange / brown.
    comment: isDark ? '#6a9955' : '#008000', // VS Code-style green.
    number: isDark ? '#b5cea8' : '#098658'   // VS Code-style light green.
  };

  const flushToken = () => {
    if (token) {
      if (keywords.has(token.toUpperCase())) {
        result += `<span style="color: ${colors.keyword}; font-weight: bold;">${token}</span>`;
      } else if (!isNaN(Number(token)) && token.trim() !== '') {
        result += `<span style="color: ${colors.number};">${token}</span>`;
      } else {
        result += token;
      }
      token = '';
    }
  };

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    
    if (inComment) {
      if (char === '<') result += '&lt;';
      else if (char === '>') result += '&gt;';
      else if (char === '&') result += '&amp;';
      else result += char;
      continue;
    }
    
    if (inString) {
      if (char === '<') result += '&lt;';
      else if (char === '>') result += '&gt;';
      else if (char === '&') result += '&amp;';
      else result += char;
      if (char === "'") inString = false;
      continue;
    }
    
    if (char === '-' && code[i+1] === '-') {
      flushToken();
      inComment = true;
      result += `<span style="color: ${colors.comment};">--`;
      i++;
      continue;
    }
    
    if (char === "'") {
      flushToken();
      inString = true;
      result += `<span style="color: ${colors.string};">&#39;`;
      continue;
    }
    
    if (/[a-zA-Z0-9_$#.]/.test(char)) { 
      token += char;
    } else {
      flushToken();
      if (char === '<') result += '&lt;';
      else if (char === '>') result += '&gt;';
      else if (char === '&') result += '&amp;';
      else result += char;
    }
  }
  flushToken();
  
  if (inComment || inString) result += '</span>';
  
  return result;
};