// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ObjectIdentity } from '@/shared/types/objectTypes';

interface TabDescription {
  type: string;
  title: string;
  fullObjectName?: string;
  objectIdentity?: ObjectIdentity;
  storedIdentity?: ObjectIdentity & { objectType: string; signature?: string };
  packageIdentity?: ObjectIdentity & { objectType: string };
  triggerIdentity?: ObjectIdentity & { tableName: string };
}
const categoryKeys: Record<string, string> = {
  table: 'table', view: 'view', sequence: 'sequence', trigger: 'trigger',
  index: 'index', type: 'type', synonym: 'synonym', dblink: 'db_link_2',
  mview: 'materialized_view', 'mview-log': 'materialized_view_log', constraint: 'ux_constraint',
};
const displayName = (name: string) => /^[a-zA-Z_][a-zA-Z0-9_$#]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
const qualifiedName = (identity: ObjectIdentity) => [identity.schema, identity.objectName].filter(Boolean).map(displayName).join('.');

export function workspaceTabDescription(tab: TabDescription, t: (key: string) => string): string {
  const identity = tab.storedIdentity ?? tab.packageIdentity ?? tab.triggerIdentity ?? tab.objectIdentity;
  if (!identity) return tab.fullObjectName || tab.title;
  const objectType = tab.storedIdentity?.objectType ?? tab.packageIdentity?.objectType;
  const key = objectType === 'PROCEDURE' ? 'procedure' : objectType === 'FUNCTION' ? 'function'
    : objectType === 'PACKAGE BODY' ? 'package_body' : objectType === 'PACKAGE' ? 'package_spec' : categoryKeys[tab.type];
  const name = qualifiedName(identity) + (tab.storedIdentity?.signature !== undefined ? `(${tab.storedIdentity.signature})` : '');
  const target = tab.triggerIdentity ? `${t('table_2')}: ${qualifiedName({ schema: identity.schema, objectName: tab.triggerIdentity.tableName })}` : '';
  return [key ? t(key) : tab.title, name, target].filter(Boolean).join(' · ');
}
