// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DbType, ObjectCategory, DatabaseObject, ObjectReference } from '@/shared/types/objectTypes';
import type { DatabaseRow } from "@/shared/types/databaseTypes";

import { ipcRenderer } from "@/shared/api/desktop";

export const OBJECT_PAGE_SIZE = 100;
export const OBJECT_CATEGORIES = {
  oracle: ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'MATERIALIZED VIEW LOG', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'TRIGGER', 'DATABASE LINK', 'SYNONYM', 'INDEX', 'TYPE'],
  postgresql: ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'INDEX', 'TYPE']
} as const satisfies Record<DbType, readonly ObjectCategory[]>;

export function getObjectCategoryLabel(category: string,
  t: ReturnType<typeof import('react-i18next').useTranslation>['t']) {
  switch (category) {
    case 'TABLE': return t("table_2");
    case 'VIEW': return t("view_2");
    case 'MATERIALIZED VIEW': return t("materialized_view");
    case 'MATERIALIZED VIEW LOG': return t("materialized_view_log");
    case 'SEQUENCE': return t("sequence_3");
    case 'FUNCTION': return t("function_2");
    case 'PROCEDURE': return t("procedure_2");
    case 'PACKAGE': return t("package");
    case 'TRIGGER': return t("trigger_2");
    case 'DATABASE LINK': return t("database_link");
    case 'SYNONYM': return t("synonym_2");
    case 'INDEX': return t("index_2");
    case 'TYPE': return t("type_2");
    default: return category;
  }
}
async function query(sql: string, binds: Record<string, string | number> = {}): Promise<DatabaseRow[]> {
  const result: { success: boolean; rows?: DatabaseRow[]; error?: string } =
    await ipcRenderer.invoke('execute-sql-bg', sql, binds);
  if (!result.success) throw new Error(result.error || 'オブジェクト情報の取得に失敗しました。');
  return result.rows || [];
}
const text = (value: unknown) => value == null ? '' : String(value);
const identifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
const literal = (value: unknown) => `'${text(value).replace(/'/g, "''")}'`;
const qualified = (object: DatabaseObject) => `${identifier(object.schema)}.${identifier(object.name)}`;
const required = (rows: DatabaseRow[]) => {
  if (!rows.length) throw new Error('対象オブジェクトが見つからないか、定義を取得できませんでした。');
  return rows[0];
};
export async function listObjectSchemas(dbType: DbType): Promise<string[]> {
  const rows = await query(dbType === 'oracle'
    ? `SELECT USERNAME AS "name" FROM ALL_USERS WHERE ORACLE_MAINTAINED = 'N' ORDER BY USERNAME`
    : `SELECT nspname AS name FROM pg_namespace WHERE nspname NOT LIKE 'pg!_%' ESCAPE '!' AND nspname <> 'information_schema' ORDER BY nspname`);
  return rows.map(row => text(row.name));
}
export async function listObjects(options: {
  dbType: DbType; schema: string; category: ObjectCategory;
  searchText: string; offset: number;
}): Promise<DatabaseObject[]> {
  const { dbType, schema, category, searchText, offset } = options;
  if (!schema || !category) return [];
  if (!OBJECT_CATEGORIES[dbType].some(value => value === category) ||
      !Number.isSafeInteger(offset) || offset < 0) throw new Error('カテゴリまたはページの指定が不正です。');
  let base: string;
  const binds: Record<string, string | number> = {
    schema, offset, pattern: `%${searchText.trim().replace(/[!%_]/g, '!$&')}%`
  };
  if (dbType === 'oracle') {
    switch (category) {
      case 'MATERIALIZED VIEW': base = `SELECT MVIEW_NAME AS "name" FROM ALL_MVIEWS WHERE OWNER = :schema`; break;
      case 'MATERIALIZED VIEW LOG': base = `SELECT MASTER AS "name" FROM ALL_MVIEW_LOGS WHERE LOG_OWNER = :schema`; break;
      case 'DATABASE LINK': base = `SELECT DB_LINK AS "name" FROM ALL_DB_LINKS WHERE OWNER = :schema`; break;
      case 'SYNONYM': base = `SELECT SYNONYM_NAME AS "name" FROM ALL_SYNONYMS WHERE OWNER = :schema`; break;
      default:
        binds.category = category;
        base = `SELECT OBJECT_NAME AS "name" FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE = :category AND OBJECT_NAME NOT LIKE 'BIN$%'`;
        if (category === 'TABLE') base += ` AND OBJECT_NAME NOT LIKE 'MLOG$%' AND OBJECT_NAME NOT LIKE 'RUPD$%' AND OBJECT_NAME NOT IN (SELECT MVIEW_NAME FROM ALL_MVIEWS WHERE OWNER = :schema)`;
    }
    base = `SELECT * FROM (${base}) WHERE UPPER("name") LIKE UPPER(:pattern) ESCAPE '!' ORDER BY "name" OFFSET :offset ROWS FETCH NEXT 100 ROWS ONLY`;
  } else {
    if (category === 'FUNCTION' || category === 'PROCEDURE') {
      binds.kind = category === 'FUNCTION' ? 'f' : 'p';
      base = `SELECT CAST(p.oid AS text) AS id, p.proname AS name,
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS "displayName"
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = :schema AND p.prokind = CAST(:kind AS "char")`;
    } else if (category === 'TRIGGER') {
      base = `SELECT CAST(t.oid AS text) AS id, t.tgname AS name, c.relname AS "parentName",
        t.tgname || ' (' || c.relname || ')' AS "displayName"
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = :schema AND NOT t.tgisinternal`;
    } else if (category === 'TYPE') {
      base = `SELECT CAST(t.oid AS text) AS id, t.typname AS name, t.typname AS "displayName"
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace LEFT JOIN pg_class c ON c.oid = t.typrelid
        WHERE n.nspname = :schema AND (t.typtype IN ('e', 'd', 'r', 'm') OR (t.typtype = 'c' AND c.relkind = 'c'))`;
    } else {
      const kinds = { TABLE: "'r', 'p'", VIEW: "'v'", 'MATERIALIZED VIEW': "'m'", SEQUENCE: "'S'", INDEX: "'i', 'I'" };
      const kind = kinds[category as keyof typeof kinds];
      if (!kind) throw new Error('カテゴリの指定が不正です。');
      base = `SELECT CAST(c.oid AS text) AS id, c.relname AS name, c.relname AS "displayName"
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = :schema AND c.relkind IN (${kind})`;
    }
    base = `SELECT * FROM (${base}) AS list WHERE "displayName" ILIKE :pattern ESCAPE '!'
      ORDER BY name, "displayName", id OFFSET :offset LIMIT 100`;
  }
  const rows = await query(base, binds);
  return rows.slice(0, OBJECT_PAGE_SIZE).map(row => {
    const name = text(row.name), id = text(row.id);
    return {
      key: JSON.stringify([dbType, schema, category, id || name]), dbType, schema, category, name,
      displayName: text(row.displayName) || name,
      ...(id ? { id } : {}), ...(row.parentName ? { parentName: text(row.parentName) } : {})
    };
  });
}

async function oracleReference(object: DatabaseObject): Promise<ObjectReference> {
  const binds = { schema: object.schema, name: object.name };
  if (object.category === 'DATABASE LINK') {
    // Pass references without fetching connection credentials.
    const row = required(await query(`SELECT DB_LINK, HOST FROM ALL_DB_LINKS WHERE OWNER = :schema AND DB_LINK = :name`, binds));
    return { definition: `-- Database link reference information\n-- ${qualified(object)} → ${text(row.HOST)}`, details: { host: row.HOST } };
  }
  const ddlType = object.category.replace(/ /g, '_');
  const method = object.category === 'MATERIALIZED VIEW LOG' ? 'GET_DEPENDENT_DDL' : 'GET_DDL';
  // Fetch 1,000 characters at a time to preserve long source and multibyte text.
  const parts = await query(`WITH source AS (
      SELECT DBMS_METADATA.${method}(:ddlType, :name, :schema) AS ddl FROM DUAL
    ) SELECT LEVEL AS "part", DBMS_LOB.SUBSTR(ddl, 1000, (LEVEL - 1) * 1000 + 1) AS "text"
    FROM source CONNECT BY LEVEL <= CEIL(DBMS_LOB.GETLENGTH(ddl) / 1000) ORDER BY LEVEL`, { ...binds, ddlType });
  const definition = parts.map(row => text(row.text)).join('');
  if (!definition.trim()) throw new Error('オブジェクト定義の取得に失敗しました。');
  const details: Record<string, unknown> = {};
  if (['TABLE', 'VIEW', 'MATERIALIZED VIEW'].includes(object.category)) {
    const [comments, columns] = await Promise.all([
      query(`SELECT COMMENTS AS "comment" FROM ALL_TAB_COMMENTS WHERE OWNER = :schema AND TABLE_NAME = :name`, binds),
      query(`SELECT c.COLUMN_NAME AS "name", c.DATA_TYPE AS "dataType", c.DATA_LENGTH AS "length",
        c.DATA_PRECISION AS "precision", c.DATA_SCALE AS "scale", c.NULLABLE AS "nullable", cc.COMMENTS AS "comment"
        FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS cc ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.OWNER = :schema AND c.TABLE_NAME = :name ORDER BY c.COLUMN_ID`, binds)
    ]);
    details.comment = comments[0]?.comment || null;
    details.columns = columns;
  } else if (['FUNCTION', 'PROCEDURE', 'PACKAGE'].includes(object.category)) {
    details.arguments = await query(`SELECT OBJECT_NAME, PACKAGE_NAME, ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, OVERLOAD
      FROM ALL_ARGUMENTS WHERE OWNER = :schema AND
      ((PACKAGE_NAME = :name) OR (PACKAGE_NAME IS NULL AND OBJECT_NAME = :name))
      ORDER BY OBJECT_NAME, OVERLOAD, SEQUENCE`, binds);
  }
  return { definition, details };
}

async function postgresReference(object: DatabaseObject): Promise<ObjectReference> {
  if (!object.id || !/^\d+$/.test(object.id)) throw new Error('オブジェクトの識別情報が不正です。');
  const binds = { id: object.id, schema: object.schema, name: object.name };
  const scope = `c.oid = CAST(:id AS oid) AND n.nspname = :schema AND c.relname = :name`;
  if (object.category === 'FUNCTION' || object.category === 'PROCEDURE') {
    const row = required(await query(`SELECT pg_get_functiondef(p.oid) AS definition,
      pg_get_function_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result,
      obj_description(p.oid, 'pg_proc') AS comment
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = CAST(:id AS oid) AND n.nspname = :schema AND p.proname = :name`, binds));
    return { definition: text(row.definition), details: { arguments: row.arguments, result: row.result, comment: row.comment } };
  }
  if (object.category === 'TRIGGER') {
    const row = required(await query(`SELECT pg_get_triggerdef(t.oid) AS definition,
      obj_description(t.oid, 'pg_trigger') AS comment, c.relname AS "tableName",
      pg_get_functiondef(t.tgfoid) AS "functionDefinition"
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.oid = CAST(:id AS oid) AND n.nspname = :schema AND t.tgname = :name AND NOT t.tgisinternal`, binds));
    return { definition: text(row.definition), details: { tableName: row.tableName, comment: row.comment, functionDefinition: row.functionDefinition } };
  }
  if (object.category === 'TYPE') return postgresType(object, binds);
  const row = required(await query(`SELECT c.relkind AS kind, obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${scope}`, binds));
  const details: Record<string, unknown> = { comment: row.comment };
  let definition: string;
  if (object.category === 'INDEX') {
    definition = text(required(await query(`SELECT pg_get_indexdef(CAST(:id AS oid)) AS definition`, { id: object.id })).definition);
  } else if (object.category === 'SEQUENCE') {
    const seq = required(await query(`SELECT format_type(seqtypid, NULL) AS type, seqstart, seqincrement, seqmin, seqmax, seqcache, seqcycle FROM pg_sequence WHERE seqrelid = CAST(:id AS oid)`, { id: object.id }));
    definition = `CREATE SEQUENCE ${qualified(object)} AS ${text(seq.type)} START WITH ${text(seq.seqstart)} INCREMENT BY ${text(seq.seqincrement)} MINVALUE ${text(seq.seqmin)} MAXVALUE ${text(seq.seqmax)} CACHE ${text(seq.seqcache)} ${seq.seqcycle ? 'CYCLE' : 'NO CYCLE'};`;
  } else {
    const [columns, constraints, indexes] = await Promise.all([
      query(`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS "dataType",
        a.attnotnull AS "notNull", a.attidentity AS identity, to_jsonb(a)->>'attgenerated' AS generated,
        pg_get_expr(d.adbin, d.adrelid) AS "defaultValue", col_description(a.attrelid, a.attnum) AS comment
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = CAST(:id AS oid) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, { id: object.id }),
      query(`SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = CAST(:id AS oid) ORDER BY conname`, { id: object.id }),
      query(`SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid = CAST(:id AS oid) ORDER BY indexrelid`, { id: object.id })
    ]);
    details.columns = columns; details.constraints = constraints; details.indexes = indexes;
    if (object.category === 'VIEW' || object.category === 'MATERIALIZED VIEW') {
      const view = required(await query(`SELECT pg_get_viewdef(CAST(:id AS oid), true) AS definition`, { id: object.id }));
      definition = `CREATE ${object.category === 'VIEW' ? 'OR REPLACE VIEW' : 'MATERIALIZED VIEW'} ${qualified(object)} AS\n${text(view.definition).trim().replace(/;$/, '')};`;
    } else {
      const definitions = columns.map(column => {
        let def = `${identifier(text(column.name))} ${text(column.dataType)}`;
        if (column.identity) def += column.identity === 'a' ? ' GENERATED ALWAYS AS IDENTITY' : ' GENERATED BY DEFAULT AS IDENTITY';
        else if (column.generated) def += ` GENERATED ALWAYS AS (${text(column.defaultValue)}) STORED`;
        else if (column.defaultValue != null) def += ` DEFAULT ${text(column.defaultValue)}`;
        if (column.notNull) def += ' NOT NULL';
        return def;
      });
      definitions.push(...constraints.map(constraint => `CONSTRAINT ${identifier(text(constraint.name))} ${text(constraint.definition)}`));
      const partition = required(await query(`SELECT pg_get_partkeydef(c.oid) AS key,
        pg_get_expr(c.relpartbound, c.oid) AS bound,
        (SELECT quote_ident(pn.nspname) || '.' || quote_ident(p.relname) FROM pg_inherits i
         JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace pn ON pn.oid = p.relnamespace
         WHERE i.inhrelid = c.oid LIMIT 1) AS parent
        FROM pg_class c WHERE c.oid = CAST(:id AS oid)`, { id: object.id }));
      details.partition = partition;
      definition = partition.bound && partition.parent
        ? `CREATE TABLE ${qualified(object)} PARTITION OF ${text(partition.parent)} ${text(partition.bound)};`
        : `CREATE TABLE ${qualified(object)} (\n  ${definitions.join(',\n  ')}\n)${partition.key ? ` PARTITION BY ${text(partition.key)}` : ''};`;
    }
  }
  return { definition, details };
}

async function postgresType(object: DatabaseObject, binds: Record<string, string>): Promise<ObjectReference> {
  const row = required(await query(`SELECT t.typtype AS kind, format_type(t.typbasetype, t.typtypmod) AS base,
    t.typnotnull AS "notNull", t.typdefault AS "defaultValue", t.typrelid AS relation,
    obj_description(t.oid, 'pg_type') AS comment FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.oid = CAST(:id AS oid) AND n.nspname = :schema AND t.typname = :name`, binds));
  const details: Record<string, unknown> = { comment: row.comment };
  let definition: string;
  if (row.kind === 'e') {
    const labels = await query(`SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = CAST(:id AS oid) ORDER BY enumsortorder`, { id: object.id! });
    definition = `CREATE TYPE ${qualified(object)} AS ENUM (${labels.map(label => literal(label.label)).join(', ')});`;
  } else if (row.kind === 'c') {
    const columns = await query(`SELECT attname AS name, format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = CAST(:relation AS oid) AND attnum > 0 AND NOT attisdropped ORDER BY attnum`, { relation: text(row.relation) });
    details.columns = columns;
    definition = `CREATE TYPE ${qualified(object)} AS (${columns.map(column => `${identifier(text(column.name))} ${text(column.type)}`).join(', ')});`;
  } else if (row.kind === 'd') {
    const constraints = await query(`SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contypid = CAST(:id AS oid) ORDER BY conname`, { id: object.id! });
    details.constraints = constraints;
    definition = `CREATE DOMAIN ${qualified(object)} AS ${text(row.base)}${row.defaultValue != null ? ` DEFAULT ${text(row.defaultValue)}` : ''}${row.notNull ? ' NOT NULL' : ''}${constraints.map(constraint => ` CONSTRAINT ${identifier(text(constraint.name))} ${text(constraint.definition)}`).join('')};`;
  } else if (row.kind === 'r' || row.kind === 'm') {
    const range = required(await query(`SELECT format_type(r.rngtypid, NULL) AS name, format_type(r.rngsubtype, NULL) AS subtype,
      to_jsonb(r) AS properties FROM pg_range r
      WHERE r.rngtypid = CAST(:id AS oid) OR CAST(to_jsonb(r)->>'rngmultitypid' AS oid) = CAST(:id AS oid)`, { id: object.id! }));
    details.range = range;
    definition = row.kind === 'r'
      ? `CREATE TYPE ${qualified(object)} AS RANGE (SUBTYPE = ${text(range.subtype)});`
      : `-- Multirange type ${qualified(object)}\n-- Base range type: ${text(range.name)}\n-- Element type: ${text(range.subtype)}`;
  } else throw new Error('このタイプの定義取得には対応していません。');
  return { definition, details };
}

export async function loadObjectReference(object: DatabaseObject): Promise<ObjectReference> {
  if (!OBJECT_CATEGORIES[object.dbType].some(category => category === object.category)) throw new Error('カテゴリの指定が不正です。');
  const reference = await (object.dbType === 'oracle' ? oracleReference(object) : postgresReference(object));
  if (!reference.definition.trim()) throw new Error('定義情報を取得できませんでした。');
  return reference;
}

// Support quoted identifiers and saved names without a schema.
export function parseObjectName(fullName: string, defaultSchema = ''): { schema: string; name: string } {
  const parts: string[] = [];
  let part = '', quoted = false;
  for (let i = 0; i < fullName.length; i++) {
    const char = fullName[i];
    if (char === '"') {
      if (quoted && fullName[i + 1] === '"') { part += '"'; i++; }
      else quoted = !quoted;
    } else if (char === '.' && !quoted) { parts.push(part); part = ''; }
    else part += char;
  }
  parts.push(part);
  if (quoted || parts.length > 2 || parts.some(value => !value)) throw new Error('オブジェクト名の形式が不正です。');
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: defaultSchema, name: parts[0] };
}

export function objectFullName(object: Pick<DatabaseObject, 'schema' | 'name'>): string {
  const encode = (value: string) => /^[A-Za-z0-9_$#]+$/.test(value) ? value : identifier(value);
  return `${encode(object.schema)}.${encode(object.name)}`;
}

export function formatObjectName(fullName: string): string {
  const { schema, name } = parseObjectName(fullName);
  return schema ? `${identifier(schema)}.${identifier(name)}` : identifier(name);
}

// Limit concurrent requests to two and await all started requests even on failure.
export async function mapObjects<T>(objects: readonly DatabaseObject[], load: (object: DatabaseObject) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let offset = 0; offset < objects.length; offset += 2) {
    const batch = await Promise.allSettled(objects.slice(offset, offset + 2).map(load));
    const failed = batch.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    for (const result of batch) if (result.status === 'fulfilled') results.push(result.value);
  }
  return results;
}
