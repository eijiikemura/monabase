// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Scan the default MySQL 8.4 SQL mode, retaining quoted text but separating code.
// Executable comments and client DELIMITER scripts are intentionally unsupported.
function inspectSql(sql, binds = {}, escapeValue) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > 1024 * 1024) throw new Error('SQL must be text of at most 1 MiB.');
  let output = '', code = '', quote = null, ended = false, identifier = '';
  const values = [];
  let bindBytes = 0;
  if (!binds || typeof binds !== 'object' || Array.isArray(binds) || Object.keys(binds).length > 1024) throw new Error('Bind values must be an object with at most 1,024 entries.');
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (quote) {
      output += c;
      if (quote === '`' && c !== '`') identifier += c;
      if (c === '\\' && quote !== '`') { output += next || ''; i++; }
      else if (c === quote) {
        if (next === quote) { output += next; if (quote === '`') identifier += '`'; i++; }
        else {
          if (quote === '`' && /^(LOAD_FILE|GET_LOCK|RELEASE_LOCK)$/i.test(identifier)) throw new Error('Quoted server file and advisory lock functions are not supported.');
          quote = null;
        }
      }
      continue;
    }
    if (c === '#' || (c === '-' && next === '-' && (!sql[i + 2] || /\s/.test(sql[i + 2])))) {
      while (i < sql.length && sql[i] !== '\n') i++;
      output += '\n'; code += ' '; continue;
    }
    if (c === '/' && next === '*') {
      if (sql[i + 2] === '!' || sql.slice(i + 2, i + 4).toUpperCase() === 'M!') throw new Error('Executable SQL comments are not supported.');
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unclosed SQL comment.');
      i = end + 1; output += ' '; code += ' '; continue;
    }
    if (/\s/.test(c)) { output += c; code += ' '; continue; }
    if (ended) throw new Error('Run one MySQL statement at a time. Select the statement to execute.');
    if (c === ';') { ended = true; continue; }
    if (['\'', '"', '`'].includes(c)) { quote = c; identifier = ''; output += c; code += ' ? '; continue; }
    if (c === ':' && /[A-Za-z_]/.test(next || '')) {
      const name = sql.slice(i + 1).match(/^[A-Za-z_][A-Za-z_0-9]*/)[0];
      const key = Object.keys(binds).find(key => key.toLowerCase() === name.toLowerCase());
      if (key === undefined) throw new Error(`Missing bind value: ${name}`);
      const value = binds[key];
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) && !Buffer.isBuffer(value)) throw new Error('Unsupported bind value.');
      if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Invalid or inexact numeric bind value. Use a string for exact large numbers.');
      bindBytes += Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
      if (values.length >= 1024 || bindBytes > 1024 * 1024) throw new Error('MySQL bind values exceed 1,024 references or 1 MiB.');
      values.push(value); output += escapeValue ? escapeValue(value) : '?'; code += '?'; i += name.length; continue;
    }
    output += c; code += c;
  }
  if (quote) throw new Error('Unclosed SQL quote.');
  const normalized = code.trim().replace(/\s+/g, ' ').toUpperCase();
  const command = normalized.match(/^[A-Z]+/)?.[0];
  if (!command) throw new Error('Enter a SQL statement.');
  if (!['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'START', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'ANALYZE'].includes(command)) throw new Error('This MySQL statement is not supported in the initial SQL workspace.');
  if (command === 'ANALYZE' && !/^ANALYZE TABLE /.test(normalized)) throw new Error('Only ANALYZE TABLE is supported.');
  // A native VIEW header may include DEFINER and SQL SECURITY. Keep stored-program restrictions elsewhere.
  const viewHeader = normalized.match(/^(?:CREATE(?: OR REPLACE)?|ALTER) (?:ALGORITHM\s*=\s*(?:UNDEFINED|MERGE|TEMPTABLE) )?(?:DEFINER\s*=\s*(?:\?\s*@\s*\?|CURRENT_USER(?:\s*\(\s*\))?) )?(?:SQL SECURITY (?:DEFINER|INVOKER) )?VIEW /);
  const restrictedCode = viewHeader ? normalized.slice(viewHeader[0].length) : normalized;
  if (/\b(PROCEDURE|FUNCTION|TRIGGER|EVENT|DEFINER|TEMPORARY)\b/.test(restrictedCode) && ['CREATE', 'ALTER', 'DROP'].includes(command)) throw new Error('Stored programs and temporary tables are not supported in the initial MySQL workspace.');
  if (/\b(INTO\s+(OUTFILE|DUMPFILE)|LOAD_FILE\s*\(|GET_LOCK\s*\(|RELEASE_LOCK\s*\()/.test(normalized)) throw new Error('Server file and advisory lock operations are not supported.');
  if (['START', 'BEGIN', 'COMMIT', 'ROLLBACK', 'RELEASE'].includes(command) && /\b(CHAIN|RELEASE|WRITE)\b/.test(normalized.replace(/^RELEASE SAVEPOINT /, ''))) throw new Error('Transaction chaining and read/write overrides are not supported.');
  const engine = normalized.match(/\bENGINE\s*=\s*(\S+)/);
  if (engine && engine[1] !== 'INNODB') throw new Error('Only InnoDB is supported.');
  return { sql: output.trim(), values, command, code: normalized };
}
function assertReadOnly(statement) {
  if (!['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(statement.command)
      || /\b(INSERT|UPDATE|DELETE|REPLACE|INTO|LOCK|FOR|ANALYZE|EXECUTE)\b/.test(statement.code)) throw new Error('This operation is unavailable on a read-only connection.');
}
module.exports = { inspectSql, assertReadOnly };
