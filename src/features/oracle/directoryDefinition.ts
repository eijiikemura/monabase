// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier, escapeSqlString } from '@/shared/utils/objectIdentity';
import type { DirectoryList, DirectoryDetail, DirectoryPrincipal } from '@/shared/types/directoryTypes';
const bytes = (value: string) => [...value].reduce((size, char) => { const n = char.codePointAt(0) ?? 0; return size + (n > 65535 ? 4 : n > 2047 ? 3 : n > 127 ? 2 : 1); }, 0);
const control = (value: string) => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export function directoryCandidate(input: string, path: string, create: boolean) {
  const text = input.trim();
  const quoted = text.startsWith('"') && text.endsWith('"');
  const name = create ? quoted ? text.slice(1, -1) : text.toUpperCase() : input;
  const error = !name.trim() || name.includes('"') || control(name) || bytes(name) > 128 || create && !quoted && !/^[\p{L}][\p{L}\p{N}_$#]*$/u.test(text)
    ? 'directory_invalid_name' : !path.trim() || control(path) || bytes(path) > 4000 || path.split(/[\\/]/).includes('..') ? 'directory_invalid_path' : '';
  return { name, path, error, sql: error ? '' : `CREATE ${create ? '' : 'OR REPLACE '}DIRECTORY ${quoteIdentifier(name)} AS '${escapeSqlString(path)}';` };
}
export function directoryPrincipals(list: DirectoryList | null, detail: DirectoryDetail | null, maintained: boolean, search: string) {
  const result = new Map<string, DirectoryPrincipal>();
  for (const principal of list?.principals || []) result.set(principal.name, principal);
  for (const grant of detail?.grants || []) if (!result.has(grant.grantee)) result.set(grant.grantee, { name: grant.grantee, kind: grant.grantee === 'PUBLIC' ? 'public' : 'unknown', maintained: false });
  return [...result.values()].filter(principal => (maintained || !principal.maintained || detail?.grants.some(grant => grant.grantee === principal.name)) && principal.name.toLowerCase().includes(search.toLowerCase())).map(principal => {
    const grants = detail?.grants.filter(grant => grant.grantee === principal.name) || [];
    const column = (privilege: 'READ' | 'WRITE') => {
      const entries = grants.filter(grant => grant.privilege === privilege);
      return { checked: entries.length > 0, editable: Boolean(detail?.directory.objectId && (entries.length ? entries.every(grant => grant.canRevoke) : principal.kind !== 'unknown' && detail?.canGrant[privilege])) };
    };
    return { ...principal, id: principal.name, READ: column('READ'), WRITE: column('WRITE'), grantors: [...new Set(grants.map(grant => grant.grantor))].join(', '), assigned: grants.length > 0 };
  }).sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));
}
