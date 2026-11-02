// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { splitSqlScript, tokenizeSql } from '@/features/sql/sqlScript';
import { escapeSqlString, qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { ObjectIdentity } from '@/shared/types/objectTypes';

export type PostgresTypeDefinition = ObjectIdentity & (
  | { kind: 'enum'; labels: string[] }
  | { kind: 'composite'; attributes: { name: string; typeSql: string }[] }
);
type TypeErrorCode = 'definition_invalid' | 'unsupported_change' | 'identity_change' | 'metadata_unavailable' | 'unsupported_kind';
export class PostgresTypeError extends Error {
  readonly code: TypeErrorCode;
  constructor(code: TypeErrorCode) { super(code); this.code = code; }
}
type Token = ReturnType<typeof tokenizeSql>[number];
const invalid = (): never => { throw new PostgresTypeError('definition_invalid'); };
const isWord = (token: Token | undefined, word: string) => token?.kind === 'word' && token.text.toUpperCase() === word;
function identifier(token: Token | undefined): string {
  if (!token) return invalid();
  if (token.text.startsWith('"') && token.text.endsWith('"') && token.text.length > 2) return token.text.slice(1, -1).replaceAll('""', '"');
  if (token.kind === 'word' && /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(token.text)) return token.text.toLowerCase();
  return invalid();
}
export function postgresTypeString(value: string): string {
  const text = escapeSqlString(value);
  return value.includes('\\') ? `E'${text.replaceAll('\\', '\\\\')}'` : `'${text}'`;
}
function stringValue(tokens: Token[]): string {
  if (tokens.length === 1 && tokens[0].text.startsWith('$')) {
    const text = tokens[0].text, tag = text.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (tag && text.length >= tag.length * 2 && text.endsWith(tag)) return text.slice(tag.length, -tag.length);
  }
  const escaped = tokens.length === 2 && isWord(tokens[0], 'E') && tokens[0].end === tokens[1].start;
  if (tokens.length !== (escaped ? 2 : 1)) return invalid();
  const text = tokens.at(-1)!.text;
  if (!text.startsWith("'") || !text.endsWith("'") || text.length < 2) return invalid();
  let value = '';
  for (let index = 1; index < text.length - 1; index++) {
    const char = text[index];
    if (char === "'") {
      if (index + 1 >= text.length - 1 || text[index + 1] !== "'") return invalid();
      value += "'"; index++;
    } else if (escaped && char === '\\') {
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"' };
      if (index + 1 >= text.length - 1) return invalid();
      const next = text[++index];
      if (!Object.hasOwn(escapes, next)) return invalid();
      value += escapes[next];
    } else value += char;
  }
  return value;
}
function groups(tokens: Token[]): Token[][] {
  if (!tokens.length) return [];
  let depth = 0;
  const result: Token[][] = [[]];
  for (const token of tokens) {
    if (token.text === '(') depth++;
    if (token.text === ')' && --depth < 0) return invalid();
    if (token.text === ',' && depth === 0) result.push([]);
    else result.at(-1)!.push(token);
  }
  if (depth !== 0 || result.some(group => !group.length)) return invalid();
  return result;
}
function typeExpression(tokens: Token[]): string {
  if (!tokens.length) return invalid();
  for (const token of tokens) {
    if (token.kind === 'word') {
      if (/^(CASCADE|RESTRICT|DROP|ALTER|ADD|RENAME|SET|OWNER|COLLATE)$/i.test(token.text)) return invalid();
    } else if (token.text.startsWith('"')) identifier(token);
    else if (!['.', '(', ')', '[', ']', ',', '+', '-'].includes(token.text)) return invalid();
  }
  return tokens.map(token => token.text).join(' ');
}
const normalizedType = (source: string) => tokenizeSql(source, 'postgresql').map(token => token.kind === 'word' ? token.text.toLowerCase() : token.text).join(' ');

export function parsePostgresType(source: string, defaultSchema: string): PostgresTypeDefinition {
  const statements = splitSqlScript(source, 'postgresql');
  if (statements.length !== 1) return invalid();
  const tokens = tokenizeSql(statements[0].text, 'postgresql');
  if (!isWord(tokens[0], 'CREATE') || !isWord(tokens[1], 'TYPE')) return invalid();
  let index = 2, schema = defaultSchema, objectName = identifier(tokens[index++]);
  if (tokens[index]?.text === '.') { schema = objectName; index++; objectName = identifier(tokens[index++]); }
  if (!isWord(tokens[index++], 'AS')) return invalid();
  const enumeration = isWord(tokens[index], 'ENUM');
  if (enumeration) index++;
  if (tokens[index++]?.text !== '(' || tokens.at(-1)?.text !== ')') return invalid();
  const parts = groups(tokens.slice(index, -1));
  if (enumeration) {
    const labels = parts.map(stringValue);
    if (new Set(labels).size !== labels.length) return invalid();
    return { schema, objectName, kind: 'enum', labels };
  }
  const attributes = parts.map(part => ({ name: identifier(part[0]), typeSql: typeExpression(part.slice(1)) }));
  if (new Set(attributes.map(attribute => attribute.name)).size !== attributes.length) return invalid();
  return { schema, objectName, kind: 'composite', attributes };
}

export function postgresTypeSource(definition: PostgresTypeDefinition): string {
  const target = qualifiedObjectName(definition);
  if (definition.kind === 'enum') return `CREATE TYPE ${target} AS ENUM (\n  ${definition.labels.map(postgresTypeString).join(', ')}\n);`;
  return `CREATE TYPE ${target} AS (\n${definition.attributes.map(attribute => `  ${quoteIdentifier(attribute.name)} ${attribute.typeSql}`).join(',\n')}\n);`;
}

// Only additions are inferred from CREATE definitions; existing values and attributes cannot be removed or rewritten.
export function planPostgresTypeChanges(current: PostgresTypeDefinition, desired: PostgresTypeDefinition): string[] {
  if (current.schema !== desired.schema || current.objectName !== desired.objectName) throw new PostgresTypeError('identity_change');
  if (current.kind !== desired.kind) throw new PostgresTypeError('unsupported_change');
  const target = qualifiedObjectName(current);
  if (current.kind === 'enum' && desired.kind === 'enum') {
    const retained = desired.labels.filter(label => current.labels.includes(label));
    if (JSON.stringify(retained) !== JSON.stringify(current.labels)) throw new PostgresTypeError('unsupported_change');
    const statements: string[] = [], working = [...current.labels];
    for (let index = 0; index < desired.labels.length; index++) {
      const label = desired.labels[index];
      if (working.includes(label)) continue;
      const next = desired.labels.slice(index + 1).find(value => working.includes(value));
      statements.push(`ALTER TYPE ${target} ADD VALUE ${postgresTypeString(label)}${next === undefined ? '' : ` BEFORE ${postgresTypeString(next)}`}`);
      working.splice(next === undefined ? working.length : working.indexOf(next), 0, label);
    }
    return statements;
  }
  if (current.kind === 'composite' && desired.kind === 'composite') {
    if (current.attributes.some((attribute, index) => attribute.name !== desired.attributes[index]?.name || normalizedType(attribute.typeSql) !== normalizedType(desired.attributes[index].typeSql))) throw new PostgresTypeError('unsupported_change');
    const added = desired.attributes.slice(current.attributes.length);
    return added.length ? [`ALTER TYPE ${target} ${added.map(attribute => `ADD ATTRIBUTE ${quoteIdentifier(attribute.name)} ${attribute.typeSql} RESTRICT`).join(', ')}`] : [];
  }
  return [];
}

export async function readPostgresType(schema: string, objectName: string): Promise<PostgresTypeDefinition> {
  const binds = { schema, objectName };
  const result = await ipcRenderer.invoke<{ typtype: string; relkind: string }>('execute-sql-bg', `SELECT t.typtype, c.relkind
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_class c ON c.oid = t.typrelid WHERE n.nspname = :schema AND t.typname = :objectName`, binds);
  if (!result.success) throw new Error(result.error);
  if (result.rows.length !== 1) throw new PostgresTypeError('metadata_unavailable');
  if (result.rows[0].typtype === 'e') {
    const labels = await ipcRenderer.invoke<{ enumlabel: string }>('execute-sql-bg', `SELECT e.enumlabel FROM pg_catalog.pg_enum e
      JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = :schema AND t.typname = :objectName ORDER BY e.enumsortorder`, binds);
    if (!labels.success) throw new Error(labels.error);
    return { schema, objectName, kind: 'enum', labels: labels.rows.map(row => row.enumlabel) };
  }
  if (result.rows[0].typtype !== 'c' || result.rows[0].relkind !== 'c') throw new PostgresTypeError('unsupported_kind');
  const attributes = await ipcRenderer.invoke<{ attname: string; format_type: string }>('execute-sql-bg', `SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS format_type
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.typrelid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = :schema AND t.typname = :objectName AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, binds);
  if (!attributes.success) throw new Error(attributes.error);
  return { schema, objectName, kind: 'composite', attributes: attributes.rows.map(row => ({ name: row.attname, typeSql: row.format_type })) };
}
