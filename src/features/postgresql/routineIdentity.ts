// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Invoke } from '@/shared/api/desktopContract';
import type { StoredIdentity } from '@/features/stored/storedCreation';

export const quotePgIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function routineTabKey(identity: StoredIdentity): string { return '@pg-routine:' + JSON.stringify(identity); }
export function parseRoutineTab(value?: string): StoredIdentity | undefined {
  if (!value?.startsWith('@pg-routine:')) return undefined;
  const identity: unknown = JSON.parse(value.slice('@pg-routine:'.length));
  if (!identity || typeof identity !== 'object' || !('schema' in identity) || !('objectName' in identity) || !('objectType' in identity) ||
      typeof identity.schema !== 'string' || typeof identity.objectName !== 'string' || !['FUNCTION', 'PROCEDURE'].includes(String(identity.objectType)) ||
      !('signature' in identity) || typeof identity.signature !== 'string') throw new Error('Invalid routine tab identity.');
  return { schema: identity.schema, objectName: identity.objectName, objectType: identity.objectType as StoredIdentity['objectType'], signature: identity.signature };
}
export interface PgRoutineMetadata { oid: string; signature: string; ddl: string; }
export async function resolvePgRoutine(client: { invoke: Invoke }, identity: StoredIdentity): Promise<PgRoutineMetadata> {
  const binds: Record<string, string> = { schema: identity.schema, name: identity.objectName, kind: identity.objectType === 'PROCEDURE' ? 'p' : 'f' };
  if (identity.signature !== undefined) binds.routine = `${quotePgIdentifier(identity.schema)}.${quotePgIdentifier(identity.objectName)}(${identity.signature})`;
  const result = await client.invoke<PgRoutineMetadata>('execute-sql-bg', `SELECT p.oid::text AS oid,
    oidvectortypes(p.proargtypes) AS signature, pg_get_functiondef(p.oid) AS ddl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = :schema AND p.proname = :name AND p.prokind = :kind
    ${identity.signature !== undefined ? 'AND p.oid = to_regprocedure(:routine)' : ''}`, binds);
  if (!result.success) throw new Error(result.error);
  if (result.rows.length !== 1) throw new Error(result.rows.length ? 'Routine is ambiguous. Select its argument signature in the sidebar.' : 'The selected routine no longer exists. Refresh the sidebar.');
  return result.rows[0];
}
