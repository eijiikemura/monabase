// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { t } from 'i18next';
import type { RequestArgs, RequestResult, Response } from '@/shared/api/desktopContract';
import type { UserRow } from '@/shared/types/dbaTypes';
import { ipcRenderer } from '@/shared/api/desktop';

type DbaReadCommand = 'get-schemas' | 'get-objects' | 'get-sessions' | 'get-session-stats' | 'get-locks' | 'get-tablespaces' | 'get-tablespace-details' | 'get-directories' | 'get-directory-privileges';

// Preserve DBA result shapes and use the background connection for reads.
export function invokeDbaRead(isPg: boolean, command: 'get-schemas', includeMaintained?: boolean, detailed?: false): Promise<Response<{ schemas: string[] }>>;
export function invokeDbaRead(isPg: boolean, command: 'get-schemas', includeMaintained: boolean, detailed: true): Promise<Response<{ schemas: Omit<UserRow, 'id'>[] }>>;
export function invokeDbaRead<C extends Exclude<DbaReadCommand, 'get-schemas'>>(isPg: boolean, command: C, ...args: RequestArgs<C>): Promise<RequestResult<C>>;
export async function invokeDbaRead(isPg: boolean, command: DbaReadCommand, ...args: unknown[]): Promise<unknown> {
  let query = '';
  let fallback = '';
  let resultKey = '';
  const binds: Record<string, string | number | boolean> = {};
  switch (command) {
    case 'get-schemas': {
      const includeMaintained = args[0] === true;
      const detailed = args[1] === true;
      if (isPg) {
        query = `SELECT schema_name AS "USERNAME", 'OPEN' AS "ACCOUNT_STATUS", null AS "CREATED" FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name`;
      } else {
        const filter = includeMaintained ? '' : "WHERE ORACLE_MAINTAINED = 'N'";
        query = detailed
          ? `SELECT USERNAME, ACCOUNT_STATUS, CREATED FROM DBA_USERS ${filter} ORDER BY USERNAME`
          : `SELECT USERNAME FROM ALL_USERS ${filter} ORDER BY USERNAME`;
        fallback = detailed
          ? `SELECT USERNAME, 'UNKNOWN' AS ACCOUNT_STATUS, CREATED FROM ALL_USERS ${filter} ORDER BY USERNAME`
          : `SELECT USERNAME FROM ALL_USERS ${filter} ORDER BY USERNAME`;
      }
      let res = await ipcRenderer.invoke<UserRow>('execute-sql-bg', query);
      if (!res.success && fallback) res = await ipcRenderer.invoke<UserRow>('execute-sql-bg', fallback);
      return { ...res, schemas: detailed ? res.rows : (res.rows || []).map((row: { USERNAME: string }) => row.USERNAME) };
    }
    case 'get-objects': {
      const owner = String(args[0]);
      const type = String(args[1]);
      binds.owner = owner;
      binds.type = type;
      if (isPg) {
        // Preserve the existing visible objects for each object type.
        const objectQueries: Record<string, string> = {
          'TABLE': `SELECT table_name AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM information_schema.tables WHERE table_schema = :owner AND table_type = 'BASE TABLE' ORDER BY table_name`,
          'VIEW': `SELECT table_name AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM information_schema.tables WHERE table_schema = :owner AND table_type = 'VIEW' ORDER BY table_name`,
          'SEQUENCE': `SELECT s.relname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace WHERE s.relkind = 'S' AND n.nspname = :owner AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = s.oid AND d.deptype IN ('a', 'i') AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass) ORDER BY s.relname`,
          'FUNCTION': `SELECT p.proname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = :owner AND p.prokind = 'f' AND p.prorettype != 'pg_catalog.trigger'::regtype ORDER BY p.proname`,
          'PROCEDURE': `SELECT routine_name AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM information_schema.routines WHERE routine_schema = :owner AND routine_type = 'PROCEDURE' ORDER BY routine_name`,
        };
        query = objectQueries[type];
        delete binds.type;
      } else {
        query = 'SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_TYPE = :type ORDER BY OBJECT_NAME';
      }
      if (!query) return { success: true, objects: [] };
      const res = await ipcRenderer.invoke<{ OBJECT_NAME: string; STATUS?: string; TABLE_NAME?: string }>('execute-sql-bg', query, binds);
      return { ...res, objects: (res.rows || []).map((row: { OBJECT_NAME: string; STATUS?: string; TABLE_NAME?: string }) => isPg
        ? { name: row.OBJECT_NAME, status: row.STATUS, tableName: row.TABLE_NAME }
        : row.OBJECT_NAME) };
    }
    case 'get-sessions':
      if (!isPg) {
        const res = await ipcRenderer.invoke('list-oracle-sessions');
        return { ...res, sessions: (res.sessions || []).map(row => ({ ...row, 'SERIAL#': row.SERIAL })) };
      }
      {
        const res = await ipcRenderer.invoke('list-postgres-sessions');
        return { ...res, sessions: (res.sessions || []).map(row => ({ ...row, SID: row.pid, USERNAME: row.username, STATUS: row.state, MACHINE: row.address, PROGRAM: row.program, SQL_ID: row.query })) };
      }
    case 'get-session-stats':
      if (!isPg) return { success: false, error: t('session_identity_required') };
      return { success: false, error: t('pg_session_stats_unavailable') };
    case 'get-locks':
      if (!isPg) {
        const res = await ipcRenderer.invoke('list-oracle-locks');
        return { ...res, locks: (res.locks || []).map(row => ({ ...row, 'SERIAL#': row.SERIAL,
          LMODE: row.HELD_MODE, REQUEST: row.REQUEST_MODE, TIME_SEC: row.HOLD_SECONDS, BLOCKING_SESSION: row.BLOCKING_SID })) };
      }
      {
        const res = await ipcRenderer.invoke('list-postgres-locks');
        return { ...res, locks: (res.locks || []).map(row => ({ ...row, SID: row.pid, TYPE: row.kind, LMODE: row.mode, REQUEST: row.granted })) };
      }
    case 'get-tablespaces': {
      if (!isPg) {
        const result = await ipcRenderer.invoke('list-oracle-tablespaces');
        return { ...result, tablespaces: (result.tablespaces || []).map(row => ({ ...row, TABLESPACE_NAME: row.name, BIGFILE: row.bigfile ? 'YES' : 'NO', TOTAL_MB: row.allocatedMb, USED_MB: row.usedMb, FREE_MB: row.freeMb, USED_PERCENT: row.usedPercent })) };
      }
      const result = await ipcRenderer.invoke('list-postgres-tablespaces');
      return { ...result, tablespaces: (result.tablespaces || []).map(row => ({ ...row, TABLESPACE_NAME: row.name, OWNER: row.owner, LOCATION: row.location })) };
    }
    case 'get-tablespace-details':
      return { success: false, error: t('ts_identity_required') };
    case 'get-directories':
      query = `SELECT OWNER, DIRECTORY_NAME, DIRECTORY_PATH FROM DBA_DIRECTORIES ORDER BY DIRECTORY_NAME`;
      resultKey = 'directories';
      fallback = `SELECT OWNER, DIRECTORY_NAME, DIRECTORY_PATH FROM ALL_DIRECTORIES ORDER BY DIRECTORY_NAME`;
      break;
    case 'get-directory-privileges':
      query = `SELECT GRANTEE, PRIVILEGE FROM DBA_TAB_PRIVS WHERE TABLE_NAME = :directoryName AND TYPE = 'DIRECTORY' AND PRIVILEGE IN ('READ', 'WRITE')`;
      resultKey = 'privileges';
      fallback = `SELECT GRANTEE, PRIVILEGE FROM ALL_TAB_PRIVS WHERE TABLE_NAME = :directoryName AND TYPE = 'DIRECTORY' AND PRIVILEGE IN ('READ', 'WRITE')`;
      binds.directoryName = String(args[0]);
      break;
  }
  let res = await ipcRenderer.invoke('execute-sql-bg', query, binds);
  if (!res.success && fallback) res = await ipcRenderer.invoke('execute-sql-bg', fallback, binds);
  return { ...res, [resultKey]: res.rows || [] };
}
