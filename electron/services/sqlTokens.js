// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Keep literals, identifiers, and comments opaque during SQL inspection.
function scanSql(source, dialect = 'postgresql') {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    if (/\s/.test(source[index])) { index++; continue; }
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth) {
        if (dialect === 'postgresql' && source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      continue;
    }
    if (dialect === 'oracle' && /[qQ]/.test(source[index]) && source[index + 1] === "'") {
      const open = source[index + 2];
      const close = ({ '[': ']', '{': '}', '(': ')', '<': '>' })[open] || open;
      const end = source.indexOf(close + "'", index + 3);
      index = end < 0 ? source.length : end + 2;
      tokens.push({ kind: 'quoted', start, end: index, text: source.slice(start, index) });
      continue;
    }
    const dollar = dialect === 'postgresql' ? source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0] : null;
    if (dollar) {
      const end = source.indexOf(dollar, index + dollar.length);
      index = end < 0 ? source.length : end + dollar.length;
      tokens.push({ kind: 'quoted', start, end: index, text: source.slice(start, index) });
      continue;
    }
    if (source[index] === "'" || source[index] === '"') {
      const quote = source[index++];
      const escaped = dialect === 'postgresql' && quote === "'" && /[eE]/.test(source[start - 1] || '') && (start < 2 || !/[\p{L}\p{N}_$]/u.test(source[start - 2]));
      while (index < source.length) {
        if (escaped && source[index] === '\\') { index += 2; continue; }
        if (source[index] === quote) {
          if (source[index + 1] === quote) { index += 2; continue; }
          index++; break;
        }
        index++;
      }
      tokens.push({ kind: 'quoted', start, end: index, text: source.slice(start, index) });
      continue;
    }
    if (/[\p{L}\p{N}_$]/u.test(source[index])) {
      index++;
      while (index < source.length && /[\p{L}\p{N}_$]/u.test(source[index])) index++;
      tokens.push({ kind: 'word', start, end: index, text: source.slice(start, index) });
    } else {
      index++;
      tokens.push({ kind: 'symbol', start, end: index, text: source[start] });
    }
  }
  return tokens;
}

module.exports = { scanSql };
