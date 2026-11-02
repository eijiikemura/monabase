// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { ArgInfo } from './storedCommon';

export interface PackageProgram { PROCEDURE_NAME: string; SUBPROGRAM_ID: number; OVERLOAD: string | null; SIGNATURE: string | null; key: string; label: string; }
export interface PackageStatus { OBJECT_TYPE: string; STATUS: string; AUTHID?: string; }
export interface PackageArgument extends ArgInfo { SUBPROGRAM_ID: number; TYPE_OWNER?: string | null; TYPE_NAME?: string | null; DATA_LEVEL?: number; }
export const packageScalarType = (type: string) => /^(NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|PLS_INTEGER|BINARY_INTEGER|VARCHAR2|NVARCHAR2|CHAR|NCHAR|DATE|TIMESTAMP(?: WITH (?:LOCAL )?TIME ZONE)?)$/i.test(type);
export async function packageRows<T>(sql: string, binds: Record<string, string | number>) {
  const response = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!response.success || !Array.isArray(response.rows)) throw new Error(response.error || 'Package metadata is unavailable.');
  return response.rows;
}
export async function loadPackagePrograms(schema: string, name: string): Promise<PackageProgram[]> {
  const rows = await packageRows<Omit<PackageProgram, 'key' | 'label'>>(`SELECT p.PROCEDURE_NAME, p.SUBPROGRAM_ID, p.OVERLOAD,
    (SELECT LISTAGG(a.DATA_TYPE, ', ') WITHIN GROUP (ORDER BY a.POSITION) FROM ALL_ARGUMENTS a
      WHERE a.OWNER = p.OWNER AND a.PACKAGE_NAME = p.OBJECT_NAME AND a.SUBPROGRAM_ID = p.SUBPROGRAM_ID AND a.POSITION > 0 AND a.DATA_LEVEL = 0) AS SIGNATURE
    FROM ALL_PROCEDURES p WHERE p.OWNER = :owner AND p.OBJECT_NAME = :name AND p.PROCEDURE_NAME IS NOT NULL ORDER BY p.SUBPROGRAM_ID`, { owner: schema, name });
  if (rows.some(row => !row.PROCEDURE_NAME || !Number.isInteger(row.SUBPROGRAM_ID))) throw new Error('Invalid package program metadata.');
  return rows.map(row => ({ ...row, key: rows.filter(other => other.PROCEDURE_NAME === row.PROCEDURE_NAME).length > 1 ? `${row.PROCEDURE_NAME}#${row.SUBPROGRAM_ID}` : row.PROCEDURE_NAME,
    label: `${row.PROCEDURE_NAME}(${row.SIGNATURE || ''})` }));
}
export function loadPackageArguments(schema: string, name: string, subProgram: string, id: number) {
  return packageRows<PackageArgument>(`SELECT ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, DEFAULT_LENGTH, DEFAULTED, SUBPROGRAM_ID, TYPE_OWNER, TYPE_NAME, DATA_LEVEL FROM ALL_ARGUMENTS
    WHERE OWNER = :owner AND PACKAGE_NAME = :name AND OBJECT_NAME = :subProgram AND SUBPROGRAM_ID = :id AND DATA_LEVEL = 0 ORDER BY SEQUENCE`, { owner: schema, name, subProgram, id });
}
export function loadPackageStatus(schema: string, name: string) {
  return packageRows<PackageStatus>(`SELECT o.OBJECT_TYPE, o.STATUS, p.AUTHID FROM ALL_OBJECTS o LEFT JOIN ALL_PROCEDURES p ON p.OWNER = o.OWNER AND p.OBJECT_NAME = o.OBJECT_NAME AND p.PROCEDURE_NAME IS NULL
    WHERE o.OWNER = :owner AND o.OBJECT_NAME = :name AND o.OBJECT_TYPE IN ('PACKAGE', 'PACKAGE BODY') ORDER BY o.OBJECT_TYPE`, { owner: schema, name });
}

export async function loadPackageInformation(schema: string, name: string) {
  const binds = { owner: schema, name };
  const [status, programs, args, references, dependents] = await Promise.all([
    loadPackageStatus(schema, name), loadPackagePrograms(schema, name),
    packageRows<PackageArgument & { PROCEDURE_NAME: string }>(`SELECT OBJECT_NAME AS PROCEDURE_NAME, ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, DEFAULTED, SUBPROGRAM_ID, TYPE_OWNER, TYPE_NAME FROM ALL_ARGUMENTS WHERE OWNER = :owner AND PACKAGE_NAME = :name AND DATA_LEVEL = 0 ORDER BY SUBPROGRAM_ID, SEQUENCE`, binds),
    packageRows<{ OWNER: string; NAME: string; TYPE: string }>(`SELECT DISTINCT REFERENCED_OWNER AS OWNER, REFERENCED_NAME AS NAME, REFERENCED_TYPE AS TYPE FROM ALL_DEPENDENCIES WHERE OWNER = :owner AND NAME = :name AND TYPE IN ('PACKAGE', 'PACKAGE BODY') ORDER BY OWNER, NAME, TYPE`, binds),
    packageRows<{ OWNER: string; NAME: string; TYPE: string }>(`SELECT DISTINCT OWNER, NAME, TYPE FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :owner AND REFERENCED_NAME = :name AND REFERENCED_TYPE IN ('PACKAGE', 'PACKAGE BODY') ORDER BY OWNER, NAME, TYPE`, binds)
  ]);
  if (!status.length) throw new Error('Package metadata is unavailable.');
  return { status, programs, args, references, dependents };
}
