// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0


/** Save the selected schema name to local storage. */
export const savePgSelectSchema = (dbName: string, userName: string, schema: string): void => {
    if (!schema || !userName) return;
    const key = `pg_select_schema_${dbName || 'default'}_${userName}`;
    localStorage.setItem(key, String(schema));
  };
  
  /** Read the saved schema name from local storage. */
  export const getPgSelectSchema = (dbName: string, userName: string): string | null => {
    if (!userName) return null;
    const key = `pg_select_schema_${dbName || 'default'}_${userName}`;
    return localStorage.getItem(key);
  };