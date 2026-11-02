// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Invoke } from '@/shared/api/desktopContract';

export async function loadOracleDdl(client: { invoke: Invoke }, type: string, name: string, owner: string): Promise<string> {
  const result = await client.invoke<{ DDL: string }>('execute-sql-bg',
    'SELECT DBMS_METADATA.GET_DDL(:ddlType, :name, :owner) AS DDL FROM DUAL',
    { ddlType: type, name, owner });
  if (!result.success) throw new Error(result.error);
  const ddl = result.rows?.[0]?.DDL;
  if (typeof ddl !== 'string' || !ddl.trim()) throw new Error('Database returned an empty DDL definition.');
  return ddl.trim();
}
