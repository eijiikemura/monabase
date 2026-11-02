// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { t } from 'i18next';
import { oracleCompileStatement, oracleCompileLineOffset, type CompileError } from '@/features/stored/storedCommon';

import { ipcRenderer } from "@/shared/api/desktop";

export interface PackageIdentity {
  schema: string;
  objectName: string;
  objectType: 'PACKAGE' | 'PACKAGE BODY';
}

export interface PackageCreationOptions {
  isNew?: boolean;
  onCreated?: (identity: PackageIdentity) => void;
}

export function createPackageTemplate(schema: string, objectType: PackageIdentity['objectType']): string {
  const owner = `"${schema.replace(/"/g, '""')}"`;
  return objectType === 'PACKAGE'
    ? `CREATE OR REPLACE PACKAGE ${owner}.new_package AS\n  PROCEDURE hello;\nEND new_package;\n/`
    : `CREATE OR REPLACE PACKAGE BODY ${owner}.new_package AS\n  PROCEDURE hello IS\n  BEGIN\n    NULL;\n  END hello;\nEND new_package;\n/`;
}

export function parsePackageIdentity(
  source: string, schema: string, expectedType: PackageIdentity['objectType']
): PackageIdentity {
  const clean = source.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
  const identifier = '(?:"(?:[^"]|"")+"|[\\p{L}_][\\p{L}\\p{N}_$#]*)';
  const pattern = new RegExp(
    `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:NON)?EDITIONABLE\\s+)?PACKAGE\\s+(BODY\\s+)?(${identifier})(?:\\s*\\.\\s*(${identifier}))?\\s*(?=AS\\b|IS\\b|AUTHID\\b|ACCESSIBLE\\b|DEFAULT\\b)`,
    'iu'
  );
  const match = pattern.exec(clean);
  const objectType = match?.[1] ? 'PACKAGE BODY' : 'PACKAGE';
  if (!match || objectType !== expectedType) {
    throw new Error(t("enter_create_package_or_create_package_body_for_the_selected_type"));
  }
  const normalize = (name: string) => name.startsWith('"')
    ? name.slice(1, -1).replace(/""/g, '"') : name.toUpperCase();
  return {
    schema: match[3] ? normalize(match[2]) : schema,
    objectName: normalize(match[3] || match[2]),
    objectType
  };
}

export async function compilePackageSource(
  schema: string, objectName: string, objectType: PackageIdentity['objectType'],
  sourceText: string, isNew: boolean
): Promise<{
  identity: PackageIdentity; success: boolean; isSyntaxError: boolean;
  errors: CompileError[]; warnings: CompileError[]; messages: string[];
}> {
  const identity = parsePackageIdentity(sourceText, schema, objectType);
  if (identity.schema !== schema || (!isNew && identity.objectName !== objectName)) {
    throw new Error(t("the_program_schema_or_name_does_not_match_the_target"));
  }
  const executed = await ipcRenderer.invoke('execute-sql', oracleCompileStatement(sourceText));
  if (!executed.success) {
    return { identity, success: false, isSyntaxError: false, errors: [], warnings: [],
      messages: [executed.error || t("compilation_failed")] };
  }
  const errorsResult = await ipcRenderer.invoke<{ LINE: number; POSITION: number; TEXT: string; ATTRIBUTE?: string }>('execute-sql-bg',
    'SELECT LINE, POSITION, TEXT, ATTRIBUTE FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = :type ORDER BY SEQUENCE',
    { owner: identity.schema, name: identity.objectName, type: identity.objectType });
  if (!errorsResult.success) throw new Error(errorsResult.error || t("failed_to_check_compilation_results"));
  const diagnostic = (row: { LINE: number; POSITION: number; TEXT: string }) => ({
    line: row.LINE + oracleCompileLineOffset(sourceText), col: row.POSITION || 1, text: row.TEXT
  });
  const errors = errorsResult.rows.filter(row => row.ATTRIBUTE !== 'WARNING').map(diagnostic);
  const warnings = errorsResult.rows.filter(row => row.ATTRIBUTE === 'WARNING').map(diagnostic);
  if (errors.length === 0) await ipcRenderer.invoke('delete-trace-db', { schema: identity.schema, objectName: identity.objectName, objectType: 'PACKAGE' });
  return { identity, success: errors.length === 0, isSyntaxError: errors.length > 0, errors, warnings,
    messages: [...errors.map(error => `[ERROR] Line ${error.line}, Col ${error.col}: ${error.text}`), ...warnings.map(error => `[WARNING] Line ${error.line}, Col ${error.col}: ${error.text}`)] };
}

export async function loadPackageSource(
  schema: string, objectName: string, objectType: PackageIdentity['objectType']
): Promise<string> {
  const binds = { ddlType: objectType === 'PACKAGE' ? 'PACKAGE_SPEC' : 'PACKAGE_BODY',
    name: objectName, owner: schema };
  // The database driver converts CLOBs to strings, so fetch the full value without splitting.
  const result = await ipcRenderer.invoke<{ DDL: string }>('execute-sql-bg',
    'SELECT DBMS_METADATA.GET_DDL(:ddlType, :name, :owner) AS DDL FROM DUAL', binds);
  const source = result.rows?.[0]?.DDL;
  if (!result.success || typeof source !== 'string' || !source.trim()) {
    throw new Error(result.error || t("failed_to_retrieve_source"));
  }
  return source.replace(/\/\s*$/, '').trim() + '\n/';
}
