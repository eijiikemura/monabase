// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { ObjectCategory } from '@/shared/types/objectTypes';

export const synonymTargetCategories: readonly ObjectCategory[] = ['TABLE', 'VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'MATERIALIZED VIEW', 'SYNONYM', 'TYPE'];
export interface SynonymDefinition {
  owner: string;
  name: string;
  targetSchema: string;
  targetObject: string;
  dbLink: string;
  editionable: 'Y' | 'N' | null;
}
export type SynonymTargetWindow = 'table' | 'view' | 'sequence' | 'stored' | 'package' | 'mview' | 'synonym' | 'type';
export function synonymTargetWindow(type: string): SynonymTargetWindow | null {
  switch (type) {
    case 'TABLE': return 'table';
    case 'VIEW': return 'view';
    case 'SEQUENCE': return 'sequence';
    case 'PROCEDURE': case 'FUNCTION': return 'stored';
    case 'PACKAGE': return 'package';
    case 'MATERIALIZED VIEW': return 'mview';
    case 'SYNONYM': return 'synonym';
    case 'TYPE': return 'type';
    default: return null;
  }
}
export function synonymDbLink(value: string) {
  if (!value) return '';
  // Database links have their own grammar; never append arbitrary SQL after @.
  if (!/^[A-Za-z][A-Za-z0-9_$#]*(?:\.[A-Za-z0-9_$#]+)*(?:@[A-Za-z][A-Za-z0-9_$#]*)?$/.test(value)) throw new Error('synonym_invalid_link');
  return value.toUpperCase();
}
export function validateSynonym(definition: SynonymDefinition) {
  for (const [key, value] of Object.entries({ owner: definition.owner, name: definition.name, ...(definition.dbLink ? {} : { targetSchema: definition.targetSchema }), targetObject: definition.targetObject })) {
    if (!value.trim()) throw new Error(`synonym_required_${key}`);
    if (value.includes('\0') || value.includes('"')) throw new Error('synonym_invalid_identifier');
  }
  synonymDbLink(definition.dbLink);
}
export function synonymSql(definition: SynonymDefinition, replace: boolean) {
  validateSynonym(definition);
  const { owner, name, targetSchema, targetObject, editionable } = definition;
  const target = owner === 'PUBLIC' ? quoteIdentifier(name) : qualifiedObjectName({ schema: owner, objectName: name });
  const edition = editionable === null ? '' : editionable === 'Y' ? 'EDITIONABLE ' : 'NONEDITIONABLE ';
  const link = synonymDbLink(definition.dbLink);
  const referenced = targetSchema ? qualifiedObjectName({ schema: targetSchema, objectName: targetObject }) : quoteIdentifier(targetObject);
  return `CREATE ${replace ? 'OR REPLACE ' : ''}${edition}${owner === 'PUBLIC' ? 'PUBLIC ' : ''}SYNONYM ${target}\nFOR ${referenced}${link ? '@' + link : ''};`;
}
export function sameSynonym(a: SynonymDefinition, b: SynonymDefinition) {
  return a.owner === b.owner && a.name === b.name && a.targetSchema === b.targetSchema && a.targetObject === b.targetObject && a.dbLink === b.dbLink && a.editionable === b.editionable;
}
async function rows<T>(sql: string, binds: Record<string, string>) {
  const result = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!result.success || !Array.isArray(result.rows)) throw new Error(result.error || 'synonym_metadata_failed');
  return result.rows;
}
export async function readSynonym(owner: string, name: string): Promise<SynonymDefinition | null> {
  const result = await rows<{ OWNER: string; SYNONYM_NAME: string; TABLE_OWNER: string | null; TABLE_NAME: string; DB_LINK: string | null; EDITIONABLE: string | null }>(`SELECT s.OWNER, s.SYNONYM_NAME, s.TABLE_OWNER, s.TABLE_NAME, s.DB_LINK, o.EDITIONABLE
    FROM ALL_SYNONYMS s LEFT JOIN ALL_OBJECTS o ON o.OWNER = s.OWNER AND o.OBJECT_NAME = s.SYNONYM_NAME AND o.OBJECT_TYPE = 'SYNONYM'
    WHERE s.OWNER = :owner AND s.SYNONYM_NAME = :name`, { owner, name });
  if (!result.length) return null;
  if (result.length !== 1) throw new Error('synonym_metadata_failed');
  const r = result[0];
  return { owner: r.OWNER, name: r.SYNONYM_NAME, targetSchema: r.TABLE_OWNER || '', targetObject: r.TABLE_NAME, dbLink: r.DB_LINK || '', editionable: r.EDITIONABLE === 'Y' || r.EDITIONABLE === 'N' ? r.EDITIONABLE : null };
}
export async function readSynonymSource(owner: string, name: string) {
  const result = await rows<{ DDL: string }>("SELECT DBMS_METADATA.GET_DDL('SYNONYM', :name, :owner) AS DDL FROM DUAL", { owner, name });
  if (!result[0]?.DDL?.trim()) throw new Error('synonym_metadata_failed');
  return result[0].DDL.trim().replace(/;?$/, ';');
}
export interface SynonymTargetInfo { state: 'found' | 'missing' | 'unknown' | 'remote'; types: { OBJECT_TYPE: string; STATUS: string }[]; }
export async function inspectSynonymTarget(definition: SynonymDefinition, remote = false): Promise<SynonymTargetInfo> {
  if (definition.dbLink && !remote) return { state: 'remote', types: [] };
  if (!definition.targetSchema) return { state: 'unknown', types: [] };
  const link = definition.dbLink ? '@' + synonymDbLink(definition.dbLink) : '';
  const types = await rows<{ OBJECT_TYPE: string; STATUS: string }>(`SELECT DISTINCT OBJECT_TYPE, STATUS FROM ALL_OBJECTS${link} WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE <> 'PACKAGE BODY' ORDER BY OBJECT_TYPE`, { owner: definition.targetSchema, name: definition.targetObject });
  if (types.length) return { state: 'found', types };
  if (link) return { state: 'unknown', types: [] };
  const users = await rows<{ CURRENT_USER: string }>("SELECT SYS_CONTEXT('USERENV', 'CURRENT_USER') AS CURRENT_USER FROM DUAL", {});
  return { state: users[0]?.CURRENT_USER === definition.targetSchema ? 'missing' : 'unknown', types: [] };
}
export async function readSynonymDependents(owner: string, name: string) {
  return rows<{ OWNER: string; NAME: string; TYPE: string }>("SELECT DISTINCT OWNER, NAME, TYPE FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :owner AND REFERENCED_NAME = :name AND REFERENCED_TYPE = 'SYNONYM' ORDER BY OWNER, NAME, TYPE", { owner, name });
}
