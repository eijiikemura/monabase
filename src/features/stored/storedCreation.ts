// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { t } from 'i18next';
import type { AiContext } from '@/shared/types/aiTypes';

export interface StoredIdentity {
  signature?: string;
  schema: string;
  objectName: string;
  objectType: 'FUNCTION' | 'PROCEDURE';
}
export interface StoredCreationOptions {
  signature?: string;
  isNew?: boolean;
  onCreated?: (identity: StoredIdentity) => void;
}
export interface StoredAiProps {
  isAiEnabled?: boolean;
  onOpenAiSidebar?: (context: AiContext | null) => boolean | void;
}
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function createStoredTemplate(dbType: 'oracle' | 'postgresql', schema: string, kind: string): string {
  if (dbType === 'oracle') {
    return kind === 'PROCEDURE'
      ? `-- ${t("edit_the_procedure_name_and_body")}\nCREATE OR REPLACE PROCEDURE ${quote(schema)}.new_procedure(p_param IN VARCHAR2)\nIS\nBEGIN\n  DBMS_OUTPUT.PUT_LINE(p_param);\nEND;\n/`
      : `-- ${t("edit_the_function_name_and_body")}\nCREATE OR REPLACE FUNCTION ${quote(schema)}.new_function(p_param IN VARCHAR2) RETURN VARCHAR2\nIS\nBEGIN\n  RETURN p_param;\nEND;\n/`;
  }
  return kind === 'PROCEDURE'
    ? `-- ${t("edit_the_procedure_name_and_body")}\nCREATE OR REPLACE PROCEDURE ${quote(schema)}.new_procedure(p_param text)\nLANGUAGE plpgsql AS $$\nBEGIN\n  RAISE NOTICE '%', p_param;\nEND;\n$$;`
    : `-- ${t("edit_the_function_name_and_body")}\nCREATE OR REPLACE FUNCTION ${quote(schema)}.new_function(p_param text)\nRETURNS text AS $$\nBEGIN\n  RETURN p_param;\nEND;\n$$ LANGUAGE plpgsql;`;
}

export function parseStoredIdentity(source: string, dbType: 'oracle' | 'postgresql', schema: string, expectedKind: string): StoredIdentity {
  // Skip leading comments and read only the identifier in the CREATE declaration.
  const clean = source.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
  const identifier = '(?:"(?:[^"]|"")+"|[\\p{L}_][\\p{L}\\p{N}_$#]*)';
  const pattern = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:NON)?EDITIONABLE\\s+)?(FUNCTION|PROCEDURE)\\s+(${identifier})(?:\\s*\\.\\s*(${identifier}))?\\s*(?=\\(|RETURN\\b|RETURNS\\b|AS\\b|IS\\b|LANGUAGE\\b)`, 'iu');
  const match = pattern.exec(clean);
  if (!match || match[1].toUpperCase() !== expectedKind) {
    throw new Error(t("enter_create_function_or_create_procedure_for_the_selected_type"));
  }
  const normalize = (name: string) => name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"')
    : dbType === 'oracle' ? name.toUpperCase() : name.toLowerCase();
  return { schema: match[3] ? normalize(match[2]) : schema,
    objectName: normalize(match[3] || match[2]), objectType: match[1].toUpperCase() as StoredIdentity['objectType'] };
}
