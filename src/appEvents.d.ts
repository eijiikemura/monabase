// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { CompileError } from "./features/stored/storedCommon";

interface CreatedObject { tabId: number; schema: string; }
interface TableTarget { schema: string; tableName: string; }

// Define inter-window event payloads to catch mismatched receivers.
declare global {
  interface WindowEventMap {
    'table-created': CustomEvent<CreatedObject & { tableName: string }>;
    'sequence-created': CustomEvent<CreatedObject & { sequenceName: string }>;
    'trigger-created': CustomEvent<CreatedObject & { triggerName: string; tableName?: string }>;
    'dblink-created': CustomEvent<CreatedObject & { linkName: string }>;
    'synonym-created': CustomEvent<CreatedObject & { synonymName: string }>;
    'mview-created': CustomEvent<CreatedObject & { mviewName: string }>;
    'mview-log-created': CustomEvent<CreatedObject & { tableName: string }>;
    'index-created': CustomEvent<CreatedObject & { indexName: string }>;
    'constraint-created': CustomEvent<CreatedObject & { tableName: string; constraintName: string }>;
    'close-tab': CustomEvent<{ tabId: number }>;
    'object-deleted': CustomEvent<{ schema: string; objectName: string; objectType: string; reason?: 'rename'; signature?: string; tableName?: string }>;
    'open-table-tab': CustomEvent<{ tableName: string; targetTab?: string }>;
    'open-create-index-tab': CustomEvent<TableTarget>;
    'open-edit-index-tab': CustomEvent<{ schema: string; indexName: string }>;
    'open-create-trigger-tab': CustomEvent<TableTarget>;
    'open-edit-trigger-tab': CustomEvent<{ schema: string; triggerName: string; tableName?: string }>;
    'open-create-constraint-tab': CustomEvent<TableTarget>;
    'open-edit-constraint-tab': CustomEvent<TableTarget & { constraintName: string }>;
    'open-sql-tab': CustomEvent<{ initialSql: string }>;
    'open-mview-tab': CustomEvent<{ schema: string; mviewName: string }>;
    'force-change-table-tab': CustomEvent<{ fullTableName: string; targetTab: string }>;
    'refresh-sidebar': CustomEvent<{ schema?: string; objType?: string }>;
    'sidebar-compile-error': CustomEvent<{ schema: string; objectName: string; objectType: string; errors: CompileError[]; logs: string[] }>;
    'reload-source': CustomEvent<TableTarget>;
    'reload-statistics': CustomEvent<TableTarget>;
    'insert-sql-text': CustomEvent<string>;
    'insert-editor-text': CustomEvent<string>;
    'refresh-table-structure': CustomEvent<{ schema: string; tableName: string }>;
    'cancel-sql-script': Event;
    'sql-script-progress': CustomEvent<{ current: number; total: number } | null>;
    'toggle-global-loader': CustomEvent<boolean>;
  }
}

export {};
