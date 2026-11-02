// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier, qualifiedObjectName } from '@/shared/utils/objectIdentity';

interface ColumnDdl {
  column_name: string;
  formatted_type: string;
  not_null: boolean;
  expression: string | null;
  identity: string;
  generated: string;
}

/** Build table source from catalog definitions without discarding type modifiers or constraints. */
export const getFullTableDDL = async (
  ipcRenderer: { invoke: import('@/shared/api/desktopContract').Invoke },
  schema: string, tableName: string, t: ReturnType<typeof import('react-i18next').useTranslation>['t'], includeTriggers = true
): Promise<string> => {
  const target = qualifiedObjectName({ schema, objectName: tableName });
  const binds = { target };
  const colSql = `
    SELECT a.attname AS column_name,
      CASE WHEN typ.typtype IN ('e', 'd', 'c') THEN format('%I.%I', ns.nspname, typ.typname)
           WHEN elem.typtype IN ('e', 'd', 'c') THEN format('%I.%I[]', ens.nspname, elem.typname)
           ELSE format_type(a.atttypid, a.atttypmod) END AS formatted_type,
      a.attnotnull AS not_null, a.attidentity AS identity, a.attgenerated AS generated,
      pg_get_expr(def.adbin, def.adrelid) AS expression
    FROM pg_attribute a
    JOIN pg_type typ ON typ.oid = a.atttypid
    JOIN pg_namespace ns ON ns.oid = typ.typnamespace
    LEFT JOIN pg_type elem ON elem.oid = typ.typelem
    LEFT JOIN pg_namespace ens ON ens.oid = elem.typnamespace
    LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum
    WHERE a.attrelid = to_regclass(:target) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`;
  const constraintSql = `
    SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS ddl
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass(:target) AND c.contype IN ('p', 'u', 'c', 'f', 'x')
    ORDER BY c.conname, c.oid`;
  const commentSql = `
    SELECT 'TABLE' AS type, NULL AS col_name, obj_description(to_regclass(:target), 'pg_class') AS comment
    UNION ALL
    SELECT 'COLUMN' AS type, a.attname AS col_name, col_description(a.attrelid, a.attnum) AS comment
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(:target) AND a.attnum > 0 AND NOT a.attisdropped
      AND col_description(a.attrelid, a.attnum) IS NOT NULL`;
  const idxSql = `
    SELECT pg_get_indexdef(i.indexrelid) AS ddl
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE i.indrelid = to_regclass(:target)
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
    ORDER BY idx.relname, idx.oid`;
  const trgSql = `
    SELECT pg_get_triggerdef(oid) AS ddl FROM pg_trigger
    WHERE tgrelid = to_regclass(:target) AND NOT tgisinternal ORDER BY tgname, oid`;
  const [columns, constraints, comments, indexes, triggers] = await Promise.all([
    ipcRenderer.invoke<ColumnDdl>('execute-sql-bg', colSql, binds),
    ipcRenderer.invoke<{ name: string; ddl: string }>('execute-sql-bg', constraintSql, binds),
    ipcRenderer.invoke<{ type: string; col_name: string | null; comment: string | null }>('execute-sql-bg', commentSql, binds),
    ipcRenderer.invoke<{ ddl: string }>('execute-sql-bg', idxSql, binds),
    includeTriggers ? ipcRenderer.invoke<{ ddl: string }>('execute-sql-bg', trgSql, binds) : Promise.resolve(null)
  ]);
  for (const result of [columns, constraints, comments, indexes, triggers]) {
    if (result && !result.success) throw new Error(result.error || 'Failed to retrieve complete PostgreSQL table source.');
  }
  if (!columns.success || !columns.rows?.length) throw new Error('PostgreSQL table source has no visible columns.');
  const definitions = columns.rows.map(column => {
    let ddl = `  ${quoteIdentifier(column.column_name)} ${column.formatted_type}`;
    if (column.identity) ddl += ` GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
    else if (column.generated) ddl += ` GENERATED ALWAYS AS (${column.expression}) ${column.generated === 'v' ? 'VIRTUAL' : 'STORED'}`;
    else if (column.expression !== null) ddl += ` DEFAULT ${column.expression}`;
    if (column.not_null) ddl += ' NOT NULL';
    return ddl;
  });
  if (constraints.success) for (const constraint of constraints.rows || []) {
    definitions.push(`  CONSTRAINT ${quoteIdentifier(constraint.name)} ${constraint.ddl}`);
  }
  let source = `CREATE TABLE ${target} (\n${definitions.join(',\n')}\n);\n`;
  if (comments.success) for (const comment of comments.rows || []) {
    if (comment.comment === null) continue;
    const subject = comment.type === 'TABLE' ? `TABLE ${target}` : `COLUMN ${target}.${quoteIdentifier(comment.col_name!)}`;
    source += `COMMENT ON ${subject} IS '${comment.comment.replaceAll("'", "''")}';\n`;
  }
  if (indexes.success && indexes.rows?.length) {
    source += `\n${t('index_information')}\n${indexes.rows.map(row => `${row.ddl};`).join('\n')}\n`;
  }
  if (triggers?.success && triggers.rows?.length) {
    source += `\n${t('trigger_information')}\n${triggers.rows.map(row => `${row.ddl};`).join('\n')}\n`;
  }
  return source;
};
