// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { readPostgresType } from '@/features/postgresql/typeDefinition';
import { typeRows, oracleTypeDiagnostics, type OracleTypeDiagnostic } from '@/features/oracle/typeDefinition';

export interface TypeInformation {
  kind: string; status: string[]; attributes: { name: string; type: string }[]; labels: string[]; methods: { name: string; kind: string; parameters: number; results: number }[];
  references: string[]; dependents: string[]; body?: { source: string; diagnostics: OracleTypeDiagnostic[] };
}
export async function loadTypeInformation(database: 'oracle' | 'postgresql', schema: string, name: string): Promise<TypeInformation> {
  if (database === 'oracle') {
    const binds = { owner: schema, name };
    const [types, status, attributes, methods, collections, references, dependents] = await Promise.all([
      typeRows<{ TYPECODE: string }>('SELECT TYPECODE FROM ALL_TYPES WHERE OWNER = :owner AND TYPE_NAME = :name', binds),
      typeRows<{ OBJECT_TYPE: string; STATUS: string }>("SELECT OBJECT_TYPE, STATUS FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE IN ('TYPE', 'TYPE BODY') ORDER BY OBJECT_TYPE", binds),
      typeRows<{ ATTR_NAME: string; ATTR_TYPE_OWNER: string; ATTR_TYPE_NAME: string; LENGTH: number; PRECISION: number; SCALE: number }>('SELECT ATTR_NAME, ATTR_TYPE_OWNER, ATTR_TYPE_NAME, LENGTH, PRECISION, SCALE FROM ALL_TYPE_ATTRS WHERE OWNER = :owner AND TYPE_NAME = :name ORDER BY ATTR_NO', binds),
      typeRows<{ METHOD_NAME: string; METHOD_TYPE: string; PARAMETERS: number; RESULTS: number }>('SELECT METHOD_NAME, METHOD_TYPE, PARAMETERS, RESULTS FROM ALL_TYPE_METHODS WHERE OWNER = :owner AND TYPE_NAME = :name ORDER BY METHOD_NO', binds),
      typeRows<{ COLL_TYPE: string; UPPER_BOUND: number; ELEM_TYPE_OWNER: string; ELEM_TYPE_NAME: string }>('SELECT COLL_TYPE, UPPER_BOUND, ELEM_TYPE_OWNER, ELEM_TYPE_NAME FROM ALL_COLL_TYPES WHERE OWNER = :owner AND TYPE_NAME = :name', binds),
      typeRows<{ OWNER: string; NAME: string; TYPE: string }>("SELECT DISTINCT REFERENCED_OWNER AS OWNER, REFERENCED_NAME AS NAME, REFERENCED_TYPE AS TYPE FROM ALL_DEPENDENCIES WHERE OWNER = :owner AND NAME = :name AND TYPE IN ('TYPE', 'TYPE BODY') ORDER BY OWNER, NAME, TYPE", binds),
      typeRows<{ OWNER: string; NAME: string; TYPE: string }>("SELECT DISTINCT OWNER, NAME, TYPE FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :owner AND REFERENCED_NAME = :name AND REFERENCED_TYPE IN ('TYPE', 'TYPE BODY') ORDER BY OWNER, NAME, TYPE", binds)
    ]);
    if (types.length !== 1 || !status.some(row => row.OBJECT_TYPE === 'TYPE')) throw new Error('Type information is unavailable.');
    let body: TypeInformation['body'];
    if (status.some(row => row.OBJECT_TYPE === 'TYPE BODY')) {
      const rows = await typeRows<{ DDL: string }>("SELECT DBMS_METADATA.GET_DDL('TYPE_BODY', :name, :owner) AS DDL FROM DUAL", binds);
      if (typeof rows[0]?.DDL !== 'string' || !rows[0].DDL.trim()) throw new Error('Type body is unavailable.');
      body = { source: rows[0].DDL, diagnostics: await oracleTypeDiagnostics(schema, name, 'TYPE BODY', rows[0].DDL) };
    }
    const describe = (row: { OWNER: string; NAME: string; TYPE: string }) => `${row.OWNER}.${row.NAME} (${row.TYPE})`;
    return { kind: [types[0].TYPECODE, ...collections.map(row => `${row.COLL_TYPE} · ${row.ELEM_TYPE_OWNER ? row.ELEM_TYPE_OWNER + '.' : ''}${row.ELEM_TYPE_NAME}${row.UPPER_BOUND ? ` [${row.UPPER_BOUND}]` : ''}`)].join(' · '),
      status: status.map(row => `${row.OBJECT_TYPE}: ${row.STATUS}`),
      attributes: attributes.map(row => ({ name: row.ATTR_NAME, type: `${row.ATTR_TYPE_OWNER ? row.ATTR_TYPE_OWNER + '.' : ''}${row.ATTR_TYPE_NAME}${row.PRECISION != null ? `(${row.PRECISION}${row.SCALE != null ? ',' + row.SCALE : ''})` : /CHAR|RAW/.test(row.ATTR_TYPE_NAME) && row.LENGTH ? `(${row.LENGTH})` : ''}` })),
      labels: [], methods: methods.map(row => ({ name: row.METHOD_NAME, kind: row.METHOD_TYPE, parameters: row.PARAMETERS, results: row.RESULTS })),
      references: references.map(describe), dependents: dependents.map(describe), body };
  }
  const definition = await readPostgresType(schema, name);
  const response = await ipcRenderer.invoke<{ oid: string }>('execute-sql-bg', 'SELECT t.oid::text AS oid FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = :schema AND t.typname = :name', { schema, name });
  if (!response.success || response.rows.length !== 1) throw new Error('Type identity is unavailable.');
  const binds = { oid: response.rows[0].oid };
  const [references, dependents] = await Promise.all([
    typeRows<{ description: string }>("SELECT DISTINCT pg_catalog.pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) AS description FROM pg_catalog.pg_depend d WHERE ((d.classid = 'pg_catalog.pg_type'::regclass AND d.objid = CAST(:oid AS oid)) OR (d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = (SELECT typrelid FROM pg_catalog.pg_type WHERE oid = CAST(:oid AS oid)))) AND d.deptype IN ('n', 'a') ORDER BY description", binds),
    typeRows<{ description: string }>("SELECT DISTINCT pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) AS description FROM pg_catalog.pg_depend d WHERE d.refclassid = 'pg_catalog.pg_type'::regclass AND d.refobjid = CAST(:oid AS oid) AND d.deptype IN ('n', 'a') ORDER BY description", binds)
  ]);
  return { kind: definition.kind, status: [], attributes: definition.kind === 'composite' ? definition.attributes.map(row => ({ name: row.name, type: row.typeSql })) : [],
    labels: definition.kind === 'enum' ? definition.labels : [], methods: [], references: references.map(row => row.description), dependents: dependents.map(row => row.description) };
}
