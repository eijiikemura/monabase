// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { GridRowId } from '@mui/x-data-grid';

export interface SessionRow {
  id: GridRowId;
  SID: number;
  'SERIAL#'?: number;
  USERNAME: string;
  STATUS: string;
  MACHINE?: string;
  PROGRAM?: string;
  LOGON_TIME?: string;
  SQL_ID?: string;
  SQL_TEXT?: string;
}

export interface LockRow extends SessionRow {
  OSUSER?: string;
  BLOCKING_SESSION?: number;
  OBJECT_NAME?: string;
  TYPE: string;
  LMODE: string | number;
  REQUEST: string | number;
  TIME_SEC?: number;
}

export interface SessionStatistic { id: GridRowId; NAME: string; VALUE: number; }
export interface UserRow { id: GridRowId; USERNAME: string; ACCOUNT_STATUS: string; CREATED?: string; SUPERUSER?: string; }
export interface UserPrivilege { id: GridRowId; PRIV_TYPE: string; PRIVILEGE_NAME: string; }
export interface DirectoryRow { id: GridRowId; DIRECTORY_NAME: string; DIRECTORY_PATH: string; }
export interface GrantedPrivilege { GRANTEE: string; PRIVILEGE: string; }
export interface SchemaRow { id: GridRowId; SCHEMA_NAME: string; OWNER: string; }
export interface SchemaPrivilege { id: GridRowId; ROLE_NAME: string; CAN_USE: boolean; CAN_CREATE: boolean; }
export interface TablespaceRow {
  id: GridRowId;
  TABLESPACE_NAME: string;
  OWNER?: string;
  LOCATION?: string;
  BIGFILE?: string;
  TOTAL_MB?: number;
  USED_MB?: number;
  FREE_MB?: number;
  USED_PERCENT?: number;
}
export interface DatafileRow { id: GridRowId; FILE_NAME: string; SIZE_MB: number; AUTOEXTENSIBLE: string; MAX_SIZE_MB: number; }
export interface PdbRow { PDB_ID: number; PDB_NAME: string; STATUS: string; OPEN_MODE: string; RESTRICTED: string; SIZE_MB: number; }

// Privilege names vary by object type; each cell indicates whether the privilege exists.
export interface PrivilegeDisplayRow {
  [field: string]: string | boolean;
  id: string;
  grantee: string;
  isOwner: boolean;
  _hasAny: boolean;
}
