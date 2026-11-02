// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnDefinition } from "@/shared/types/databaseTypes";

import { ipcRenderer } from "@/shared/api/desktop";

export interface ErForeignKey {
  PARENT_SCHEMA?: string;
  CHILD_SCHEMA?: string;
  CONSTRAINT_NAME?: string;
  PARENT_COLUMN?: string;
  PARENT_TABLE: string;
  CHILD_TABLE: string;
  CHILD_COLUMN: string;
}

export interface ErMetadata {
  columns: (ColumnDefinition & { TABLE_NAME: string; TABLE_SCHEMA?: string })[];
  primaryKeys: { TABLE_NAME: string; COLUMN_NAME: string; TABLE_SCHEMA?: string }[];
  foreignKeys: ErForeignKey[];
  tableComments: { TABLE_NAME: string; TABLE_SCHEMA?: string; COMMENTS: string | null }[];
  columnComments: { TABLE_NAME: string; COLUMN_NAME: string; TABLE_SCHEMA?: string; COMMENTS: string | null }[];
}

// Connection usernames may be unquoted; prefer an exact catalog name and reject ambiguous fallbacks.
export function selectErSchema(schemas: string[], preferred: string | null | undefined): string {
  if (!preferred) return '';
  if (schemas.includes(preferred)) return preferred;
  const matches = schemas.filter(name => name.toLowerCase() === preferred.toLowerCase());
  return matches.length === 1 ? matches[0] : '';
}

// Fetch columns, constraints, and comments only for displayed tables.
export async function fetchErMetadata(
  isPg: boolean, schema: string, targetTableName: string | null, isCustomMode: boolean
): Promise<ErMetadata> {
  const safeSchema = schema.replace(/'/g, "''");
  let sqlCols, sqlPk, sqlFk, sqlTabComments, sqlColComments;
  if (isPg) {
    sqlCols = `SELECT table_name AS "TABLE_NAME", column_name AS "COLUMN_NAME", data_type AS "DATA_TYPE", COALESCE(character_maximum_length, numeric_precision) AS "DATA_LENGTH", numeric_scale AS "DATA_SCALE" FROM information_schema.columns WHERE table_schema = '${safeSchema}' ORDER BY table_name, ordinal_position`;
    sqlPk = `SELECT kcu.table_name AS "TABLE_NAME", kcu.column_name AS "COLUMN_NAME" FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = '${safeSchema}'`;
    sqlFk = `SELECT child_ns.nspname AS "CHILD_SCHEMA", child.relname AS "CHILD_TABLE", child_col.attname AS "CHILD_COLUMN", parent_ns.nspname AS "PARENT_SCHEMA", parent.relname AS "PARENT_TABLE", parent_col.attname AS "PARENT_COLUMN", fk.conname AS "CONSTRAINT_NAME" FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) AS key_position(ordinal) JOIN pg_catalog.pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = fk.conkey[key_position.ordinal] JOIN pg_catalog.pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = fk.confkey[key_position.ordinal] WHERE fk.contype = 'f' AND child_ns.nspname = '${safeSchema}'`;
    sqlTabComments = `SELECT c.relname AS "TABLE_NAME", obj_description(c.oid) AS "COMMENTS" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${safeSchema}' AND c.relkind IN ('r', 'v', 'p')`;
    sqlColComments = `SELECT c.relname AS "TABLE_NAME", a.attname AS "COLUMN_NAME", col_description(c.oid, a.attnum) AS "COMMENTS" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid WHERE n.nspname = '${safeSchema}' AND c.relkind IN ('r', 'v', 'p') AND a.attnum > 0 AND NOT a.attisdropped`;
  } else {
    sqlCols = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE FROM ALL_TAB_COLUMNS WHERE OWNER = '${safeSchema}' AND TABLE_NAME NOT LIKE 'MLOG$_%' AND TABLE_NAME NOT LIKE 'RUPD$_%' ORDER BY TABLE_NAME, COLUMN_ID`;
    sqlPk = `SELECT acc.TABLE_NAME, acc.COLUMN_NAME FROM ALL_CONS_COLUMNS acc JOIN ALL_CONSTRAINTS ac ON acc.OWNER = ac.OWNER AND acc.CONSTRAINT_NAME = ac.CONSTRAINT_NAME WHERE ac.OWNER = '${safeSchema}' AND ac.CONSTRAINT_TYPE = 'P'`;
    sqlFk = `SELECT a.owner AS CHILD_SCHEMA, a.table_name AS CHILD_TABLE, a.column_name AS CHILD_COLUMN, c_pk.owner AS PARENT_SCHEMA, c_pk.table_name AS PARENT_TABLE, parent_col.column_name AS PARENT_COLUMN, c.constraint_name AS CONSTRAINT_NAME FROM all_cons_columns a JOIN all_constraints c ON a.owner = c.owner AND a.constraint_name = c.constraint_name JOIN all_constraints c_pk ON c.r_owner = c_pk.owner AND c.r_constraint_name = c_pk.constraint_name JOIN all_cons_columns parent_col ON parent_col.owner = c_pk.owner AND parent_col.constraint_name = c_pk.constraint_name AND parent_col.position = a.position WHERE c.constraint_type = 'R' AND a.owner = '${safeSchema}'`;
    sqlTabComments = `SELECT TABLE_NAME, COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER = '${safeSchema}'`;
    sqlColComments = `SELECT TABLE_NAME, COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS WHERE OWNER = '${safeSchema}'`;
  }

  const binds: Record<string, string> = {};
  if (targetTableName) {
    const main = targetTableName;
    const tables = new Set([main]);
    if (!isCustomMode) {
      // Inspect direct parents and children without recursively expanding related tables.
      const child = isPg ? 'child.relname' : 'c.table_name';
      const parent = isPg ? 'parent.relname' : 'c_pk.table_name';
      const parentSchema = isPg ? 'parent_ns.nspname' : 'c_pk.owner';
      const discovery = await ipcRenderer.invoke<(ErForeignKey)>('execute-sql-bg',
        `${sqlFk} AND (${child} = :erMain OR (${parent} = :erMain AND ${parentSchema} = '${safeSchema}'))`, { erMain: main });
      if (!discovery.success) throw new Error(discovery.error);
      (discovery.rows || []).forEach((row: ErForeignKey) => {
        if (!row.PARENT_SCHEMA || row.PARENT_SCHEMA === schema) tables.add(row.PARENT_TABLE);
        tables.add(row.CHILD_TABLE);
      });
    }
    const names = Array.from(tables);
    names.forEach((name, index) => { binds[`erTable${index}`] = name; });
    const filter = (expression: string) => {
      const groups: string[] = [];
      // Split conditions that exceed Oracle's IN expression limit.
      for (let offset = 0; offset < names.length; offset += 1000) {
        const placeholders = names.slice(offset, offset + 1000).map((_, index) => `:erTable${offset + index}`);
        groups.push(`${expression} IN (${placeholders.join(', ')})`);
      }
      return ` AND (${groups.join(' OR ')})`;
    };
    const restrict = (sql: string, expression: string) => {
      const orderPosition = sql.search(/\bORDER BY\b/i);
      return orderPosition < 0 ? sql + filter(expression)
        : sql.slice(0, orderPosition) + filter(expression) + ' ' + sql.slice(orderPosition);
    };
    sqlCols = restrict(sqlCols, 'table_name');
    sqlPk = restrict(sqlPk, isPg ? 'kcu.table_name' : 'acc.table_name');
    sqlFk = restrict(sqlFk, isPg ? 'child.relname' : 'c.table_name');
    sqlTabComments = restrict(sqlTabComments, isPg ? 'c.relname' : 'table_name');
    sqlColComments = restrict(sqlColComments, isPg ? 'c.relname' : 'table_name');
  }

  const [cols, pk, fk, tableComments, columnComments] = await Promise.all([
    ipcRenderer.invoke<ErMetadata['columns'][number]>('execute-sql-bg', sqlCols, binds),
    ipcRenderer.invoke<ErMetadata['primaryKeys'][number]>('execute-sql-bg', sqlPk, binds),
    ipcRenderer.invoke<ErForeignKey>('execute-sql-bg', sqlFk, binds),
    ipcRenderer.invoke<ErMetadata['tableComments'][number]>('execute-sql-bg', sqlTabComments, binds),
    ipcRenderer.invoke<ErMetadata['columnComments'][number]>('execute-sql-bg', sqlColComments, binds)
  ]);
  // Publish a complete snapshot only after every metadata query succeeds.
  for (const result of [cols, pk, fk, tableComments, columnComments]) {
    if (!result.success) throw new Error(result.error);
  }
  const result: ErMetadata = {
    columns: (cols.rows || []).map(row => ({ ...row, TABLE_SCHEMA: schema })),
    primaryKeys: (pk.rows || []).map(row => ({ ...row, TABLE_SCHEMA: schema })),
    foreignKeys: fk.rows || [],
    tableComments: (tableComments.rows || []).map(row => ({ ...row, TABLE_SCHEMA: schema })),
    columnComments: (columnComments.rows || []).map(row => ({ ...row, TABLE_SCHEMA: schema }))
  };
  if (!isCustomMode) {
    const external = new Map<string, { schema: string; table: string }>();
    for (const relation of result.foreignKeys) {
      if (relation.PARENT_SCHEMA && relation.PARENT_SCHEMA !== schema) {
        external.set(JSON.stringify([relation.PARENT_SCHEMA, relation.PARENT_TABLE]), {
          schema: relation.PARENT_SCHEMA, table: relation.PARENT_TABLE
        });
      }
    }
    // Expand direct external parents once, without recursively loading their relations.
    const parents = await Promise.all(Array.from(external.values(), target =>
      fetchErMetadata(isPg, target.schema, target.table, true)));
    for (const parent of parents) {
      if (!parent.columns.length) throw new Error('Referenced table metadata is not accessible.');
      result.columns.push(...parent.columns);
      result.primaryKeys.push(...parent.primaryKeys);
      result.tableComments.push(...parent.tableComments);
      result.columnComments.push(...parent.columnComments);
    }
  }
  return result;
}
