// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { sequenceInteger } from './sequenceValues';
import { sequenceStatement, type SequenceDatabase, type SequenceMetadata } from './sequenceModel';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
async function rows<T>(sql: string, binds: Record<string, string>) {
  const response = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!response.success || !Array.isArray(response.rows)) throw new Error(response.error || 'sequence_metadata_unavailable');
  return response.rows;
}
export async function readSequenceMetadata(database: SequenceDatabase, schema: string, name: string): Promise<SequenceMetadata> {
  const binds = { schema, name };
  if (database === 'oracle') {
    const result = await rows<Record<string, unknown>>(`SELECT s.*, TO_CHAR(MAX_VALUE, 'TM9') AS MAX_VAL_STR, TO_CHAR(MIN_VALUE, 'TM9') AS MIN_VAL_STR,
      TO_CHAR(INCREMENT_BY, 'TM9') AS INC_VAL_STR, TO_CHAR(CACHE_SIZE, 'TM9') AS CACHE_VAL_STR, TO_CHAR(LAST_NUMBER, 'TM9') AS LAST_VAL_STR
      FROM ALL_SEQUENCES s WHERE SEQUENCE_OWNER = :schema AND SEQUENCE_NAME = :name`, binds);
    if (result.length !== 1) throw new Error('sequence_metadata_unavailable');
    const r = result[0];
    const settings = { increment: sequenceInteger(r.INC_VAL_STR ?? r.INCREMENT_BY), min: sequenceInteger(r.MIN_VAL_STR ?? r.MIN_VALUE), max: sequenceInteger(r.MAX_VAL_STR ?? r.MAX_VALUE), cache: sequenceInteger(r.CACHE_VAL_STR ?? r.CACHE_SIZE),
      cycle: r.CYCLE_FLAG === 'Y', order: r.ORDER_FLAG === 'Y', keep: r.KEEP_VALUE === 'Y', session: r.SESSION_FLAG === 'Y', dataType: 'NUMBER' };
    return { settings, observed: r.LAST_VAL_STR == null && r.LAST_NUMBER == null ? null : sequenceInteger(r.LAST_VAL_STR ?? r.LAST_NUMBER), start: settings.increment.startsWith('-') ? settings.max : settings.min };
  }
  const result = await rows<Record<string, unknown>>(`SELECT sequencename, data_type::text AS data_type, start_value::text AS start_value, min_value::text AS min_value,
    max_value::text AS max_value, increment_by::text AS increment_by, cycle, cache_size::text AS cache_size, last_value::text AS last_value
    FROM pg_sequences WHERE schemaname = :schema AND sequencename = :name`, binds);
  if (result.length !== 1 || !['smallint', 'integer', 'bigint'].includes(String(result[0].data_type))) throw new Error('sequence_metadata_unavailable');
  const r = result[0];
  return { settings: { increment: sequenceInteger(r.increment_by), min: sequenceInteger(r.min_value), max: sequenceInteger(r.max_value), cache: sequenceInteger(r.cache_size),
    cycle: r.cycle === true || r.cycle === 'YES' || r.cycle === 't', order: false, keep: false, session: false, dataType: String(r.data_type) },
    start: sequenceInteger(r.start_value), observed: r.last_value == null ? null : sequenceInteger(r.last_value) };
}
export interface SequenceUsage { owner: { schema: string; table: string; column: string; identity: boolean } | null; dependents: string[]; }
export async function readSequenceUsage(database: SequenceDatabase, schema: string, name: string): Promise<SequenceUsage> {
  if (database === 'oracle') {
    const result = await rows<{ OWNER: string; NAME: string; TYPE: string }>("SELECT DISTINCT OWNER, NAME, TYPE FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :schema AND REFERENCED_NAME = :name AND REFERENCED_TYPE = 'SEQUENCE' ORDER BY OWNER, NAME, TYPE", { schema, name });
    return { owner: null, dependents: result.map(row => `${row.OWNER}.${row.NAME} (${row.TYPE})`) };
  }
  const binds = { schema, name };
  const owners = await rows<{ schema: string; table: string; column: string; kind: string }>(`SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column", d.deptype AS kind
    FROM pg_class s JOIN pg_namespace sn ON sn.oid = s.relnamespace JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
    JOIN pg_class c ON c.oid = d.refobjid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
    WHERE sn.nspname = :schema AND s.relname = :name AND s.relkind = 'S' ORDER BY schema, "table", "column"`, binds);
  const dependencies = await rows<{ description: string }>(`SELECT DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid) AS description FROM pg_depend d
    JOIN pg_class s ON s.oid = d.refobjid JOIN pg_namespace n ON n.oid = s.relnamespace WHERE d.refclassid = 'pg_class'::regclass AND n.nspname = :schema AND s.relname = :name AND s.relkind = 'S' ORDER BY description`, binds);
  const owner = owners[0];
  return { owner: owner ? { ...owner, identity: owner.kind === 'i' } : null, dependents: dependencies.map(row => row.description) };
}
export async function readSequenceSource(database: SequenceDatabase, schema: string, name: string) {
  if (database === 'oracle') {
    const result = await rows<{ DDL: string }>("SELECT DBMS_METADATA.GET_DDL('SEQUENCE', :name, :schema) AS DDL FROM DUAL", { schema, name });
    if (typeof result[0]?.DDL !== 'string' || !result[0].DDL.trim()) throw new Error('sequence_metadata_unavailable');
    return result[0].DDL.trim().replace(/;?$/, ';');
  }
  const [metadata, usage] = await Promise.all([readSequenceMetadata(database, schema, name), readSequenceUsage(database, schema, name)]);
  const create = sequenceStatement(database, schema, name, metadata.settings, undefined, metadata.start) + ';';
  const owner = usage.owner;
  if (!owner) return create;
  const owned = `${quoteIdentifier(owner.schema)}.${quoteIdentifier(owner.table)}.${quoteIdentifier(owner.column)}`;
  return create + (owner.identity ? '\n-- Identity-owned sequence: recreate its identity association through the table definition.' : `\nALTER SEQUENCE ${qualifiedObjectName({ schema, objectName: name })} OWNED BY ${owned};`);
}
