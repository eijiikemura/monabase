// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { qualifiedObjectName, quoteIdentifier, escapeSqlString } from '@/shared/utils/objectIdentity';
import type { SqlDialect } from '@/features/sql/sqlScript';
import type { MviewForm } from '@/features/materialized-view/mviewSql';
export interface MviewMetadata {
  id: string; form: MviewForm; populated: boolean; concurrent: boolean;
  scheduleKnown: boolean; nextDate: string | null; realTimeKnown: boolean;
  details: Record<string, string>; source: string;
}
export async function mviewRows<T>(sql: string, binds: Record<string, string> = {}) {
  const result = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!result.success || !Array.isArray(result.rows)) throw new Error(result.error || 'mview_metadata_failed');
  return result.rows;
}
export async function readMview(database: SqlDialect, schema: string, name: string): Promise<MviewMetadata> {
  const binds = { schema, name };
  const initial: MviewForm = { schema, mviewName: name, selectSql: '', withData: true, refreshMethod: 'FORCE', refreshTiming: 'ON DEMAND', isUpdatable: false, isRealTime: false, startWith: '', next: '' };
  if (database === 'oracle') {
    const result = await mviewRows<Record<string, unknown>>(`SELECT m.*, TO_CHAR(o.OBJECT_ID) AS OBJECT_ID_TEXT, TO_CHAR(m.LAST_REFRESH_DATE, 'YYYY-MM-DD HH24:MI:SS') AS LAST_REFRESH_TEXT
      FROM ALL_MVIEWS m JOIN ALL_OBJECTS o ON o.OWNER = m.OWNER AND o.OBJECT_NAME = m.MVIEW_NAME AND o.OBJECT_TYPE = 'MATERIALIZED VIEW'
      WHERE m.OWNER = :schema AND m.MVIEW_NAME = :name`, binds);
    if (result.length !== 1) throw new Error('mview_metadata_failed');
    const r = result[0];
    if (typeof r.QUERY !== 'string' || !r.QUERY.trim()) throw new Error('mview_metadata_failed');
    // Schedule metadata is optional: inaccessible/shared groups must not become empty editable defaults.
    const schedule = await mviewRows<{ NEXT_DATE_TEXT: string | null; INTERVAL: string | null; GROUP_SIZE: number | string }>(`SELECT TO_CHAR(r.NEXT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS NEXT_DATE_TEXT, r.INTERVAL,
      (SELECT COUNT(*) FROM ALL_REFRESH_CHILDREN a WHERE a.REFGROUP = r.REFGROUP) AS GROUP_SIZE
      FROM ALL_REFRESH r JOIN ALL_REFRESH_CHILDREN c ON c.REFGROUP = r.REFGROUP WHERE c.OWNER = :schema AND c.NAME = :name`, binds).catch(() => null);
    const known = schedule !== null && (schedule.length === 0 || schedule.length === 1 && Number(schedule[0].GROUP_SIZE) === 1);
    return { id: String(r.OBJECT_ID_TEXT), form: { ...initial, selectSql: r.QUERY, refreshMethod: String(r.REFRESH_METHOD), refreshTiming: r.REFRESH_MODE === 'NEVER' ? 'NEVER' : 'ON ' + String(r.REFRESH_MODE),
      isUpdatable: r.UPDATABLE === 'Y', isRealTime: r.ON_QUERY_COMPUTATION === 'Y', next: known ? schedule?.[0]?.INTERVAL || '' : '' },
      populated: r.LAST_REFRESH_TYPE !== 'NA', concurrent: false, scheduleKnown: known, nextDate: schedule?.[0]?.NEXT_DATE_TEXT ?? null, realTimeKnown: r.ON_QUERY_COMPUTATION === 'Y' || r.ON_QUERY_COMPUTATION === 'N', source: '',
      details: { refreshMethod: String(r.REFRESH_METHOD), refreshTiming: String(r.REFRESH_MODE), staleness: String(r.STALENESS), lastRefresh: String(r.LAST_REFRESH_TEXT ?? ''), fastRefreshable: String(r.FAST_REFRESHABLE ?? ''), buildMode: String(r.BUILD_MODE ?? '') } };
  }
  const result = await mviewRows<{ id: string; definition: string; populated: boolean; concurrent: boolean; method: string; tablespace: string | null; options: string[] | null; owner: string }>(`SELECT c.oid::text AS id, pg_get_viewdef(c.oid, true) AS definition, c.relispopulated AS populated, am.amname AS method, ts.spcname AS tablespace, c.reloptions AS options, pg_get_userbyid(c.relowner) AS owner,
    EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL) AS concurrent
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_am am ON am.oid = c.relam LEFT JOIN pg_tablespace ts ON ts.oid = c.reltablespace
    WHERE n.nspname = :schema AND c.relname = :name AND c.relkind = 'm'`, binds);
  if (result.length !== 1 || !result[0].definition?.trim()) throw new Error('mview_metadata_failed');
  const r = result[0];
  return { id: r.id, form: { ...initial, selectSql: r.definition, withData: r.populated }, populated: r.populated, concurrent: r.populated && r.concurrent, scheduleKnown: false, nextDate: null, realTimeKnown: false,
    details: { accessMethod: r.method, tablespace: r.tablespace || '', owner: r.owner, storageOptions: (r.options || []).join(', ') }, source: '' };
}
export async function readMviewSource(database: SqlDialect, schema: string, name: string, metadata?: MviewMetadata) {
  const binds = { schema, name }, target = qualifiedObjectName({ schema, objectName: name });
  if (database === 'oracle') {
    const result = await mviewRows<{ DDL: string }>("SELECT DBMS_METADATA.GET_DDL('MATERIALIZED_VIEW', :name, :schema) AS DDL FROM DUAL", binds);
    if (!result[0]?.DDL?.trim()) throw new Error('mview_metadata_failed');
    const indexes = await mviewRows<{ DDL: string }>(`SELECT DBMS_METADATA.GET_DDL('INDEX', i.INDEX_NAME, i.OWNER) AS DDL FROM ALL_INDEXES i WHERE i.TABLE_OWNER = :schema AND i.TABLE_NAME = :name AND i.GENERATED = 'N'
      AND i.INDEX_NAME NOT LIKE 'I_SNAP$%' AND NOT EXISTS (SELECT 1 FROM ALL_CONSTRAINTS c WHERE c.INDEX_OWNER = i.OWNER AND c.INDEX_NAME = i.INDEX_NAME) ORDER BY i.INDEX_NAME`, binds);
    return [result[0], ...indexes].map(r => { if (!r.DDL?.trim()) throw new Error('mview_metadata_failed'); return r.DDL.trim().replace(/;?$/, ';'); }).join('\n\n');
  }
  const m = metadata || await readMview(database, schema, name);
  const [columns, indexes, comments, options] = await Promise.all([
    mviewRows<{ name: string }>('SELECT a.attname AS name FROM pg_attribute a WHERE a.attrelid = to_regclass(:target) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum', { target }),
    mviewRows<{ ddl: string }>('SELECT pg_get_indexdef(i.indexrelid) AS ddl FROM pg_index i WHERE i.indrelid = to_regclass(:target) ORDER BY i.indexrelid', { target }),
    mviewRows<{ name: string | null; comment: string | null }>(`SELECT NULL::text AS name, obj_description(to_regclass(:target), 'pg_class') AS comment UNION ALL SELECT a.attname AS name, col_description(a.attrelid, a.attnum) AS comment FROM pg_attribute a WHERE a.attrelid = to_regclass(:target) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY name NULLS FIRST`, { target }),
    mviewRows<{ option_name: string; option_value: string }>('SELECT option_name, option_value FROM pg_class c CROSS JOIN LATERAL pg_options_to_table(c.reloptions) WHERE c.oid = to_regclass(:target) ORDER BY option_name', { target })
  ]);
  if (!columns.length) throw new Error('mview_metadata_failed');
  const literal = (v: string) => `E'${escapeSqlString(v).replaceAll('\\', '\\\\')}'`;
  const settings = options.length ? '\nWITH (' + options.map(o => o.option_name.split('.').map(quoteIdentifier).join('.') + '=' + literal(o.option_value)).join(', ') + ')' : '';
  let source = `CREATE MATERIALIZED VIEW ${target} (${columns.map(c => quoteIdentifier(c.name)).join(', ')})${m.details.accessMethod ? '\nUSING ' + quoteIdentifier(m.details.accessMethod) : ''}${settings}${m.details.tablespace ? '\nTABLESPACE ' + quoteIdentifier(m.details.tablespace) : ''}\nAS\n${m.form.selectSql.trim().replace(/;$/, '')}\nWITH ${m.populated ? '' : 'NO '}DATA;`;
  source += indexes.map(i => '\n' + i.ddl.trim().replace(/;?$/, ';')).join('');
  for (const c of comments) if (c.comment !== null) source += `\nCOMMENT ON ${c.name === null ? 'MATERIALIZED VIEW ' + target : 'COLUMN ' + target + '.' + quoteIdentifier(c.name)} IS ${literal(c.comment)};`;
  if (m.details.owner) source += `\nALTER MATERIALIZED VIEW ${target} OWNER TO ${quoteIdentifier(m.details.owner)};`;
  return source;
}
export async function readMviewRelations(database: SqlDialect, schema: string, name: string) {
  const binds = { schema, name };
  if (database === 'oracle') {
    const rows = await mviewRows<{ LABEL: string }>(`SELECT 'Uses: ' || REFERENCED_OWNER || '.' || REFERENCED_NAME || ' (' || REFERENCED_TYPE || ')' AS LABEL FROM ALL_DEPENDENCIES WHERE OWNER = :schema AND NAME = :name AND TYPE = 'MATERIALIZED VIEW'
      UNION SELECT 'Used by: ' || OWNER || '.' || NAME || ' (' || TYPE || ')' AS LABEL FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :schema AND REFERENCED_NAME = :name
      UNION SELECT 'Index: ' || OWNER || '.' || INDEX_NAME AS LABEL FROM ALL_INDEXES WHERE TABLE_OWNER = :schema AND TABLE_NAME = :name ORDER BY LABEL`, binds);
    return rows.map(r => r.LABEL);
  }
  const target = qualifiedObjectName({ schema, objectName: name });
  const rows = await mviewRows<{ label: string }>(`SELECT DISTINCT 'Uses: ' || pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) AS label FROM pg_rewrite r JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid WHERE r.ev_class = to_regclass(:target) AND d.refobjid <> r.ev_class
    UNION SELECT DISTINCT 'Used by: ' || pg_describe_object(d.classid, d.objid, d.objsubid) FROM pg_depend d WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = to_regclass(:target)
    UNION SELECT 'Index: ' || indexrelid::regclass::text FROM pg_index WHERE indrelid = to_regclass(:target) ORDER BY label`, { target });
  return rows.map(r => r.label);
}
