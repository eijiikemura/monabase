// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DbLinkForm, DbLinkContext, DbLinkMetadata } from '@/shared/types/dbLinkTypes';
import { quoteIdentifier, escapeSqlString } from '@/shared/utils/objectIdentity';
const utf8Length = (value: string) => [...value].reduce((size, char) => {
  const code = char.codePointAt(0) ?? 0;
  return size + (code > 65535 ? 4 : code > 2047 ? 3 : code > 127 ? 2 : 1);
}, 0);
const unsafeHost = (value: string) => [...value].some(char => { const n = char.charCodeAt(0); return n === 127 || n < 32 && ![9, 10, 13].includes(n); });
export const emptyDbLink = (name = '', isPublic = false): DbLinkForm => ({ name, isPublic, username: '', password: '', host: '' });
export const fullLinkName = (name: string, domain: string) => name.includes('.') || !domain ? name.toUpperCase() : `${name}.${domain}`.toUpperCase();
export function dbLinkUsername(value: string, original = '') {
  const text = value.trim();
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text === original ? text : text.toUpperCase();
}
export function dbLinkForm(metadata: DbLinkMetadata): DbLinkForm {
  return { name: metadata.name, isPublic: metadata.schema === 'PUBLIC', username: metadata.username && !/^[A-Z][A-Z0-9_$#]*$/.test(metadata.username) ? `"${metadata.username}"` : metadata.username, password: '', host: metadata.host };
}
export function dbLinkPlan(form: DbLinkForm, context: DbLinkContext | null, saved: DbLinkMetadata | null) {
  const username = dbLinkUsername(form.username, saved?.username), host = form.host.trim();
  const kind = !saved ? 'create' : username !== saved.username || host !== saved.host ? 'recreate' : form.password ? 'alter' : 'unchanged';
  let error = '';
  if (!context) error = 'dblink_load_failed';
  else if (context.readonly) error = 'dblink_readonly';
  else if (saved && (!saved.editable || saved.schema !== context.user && saved.schema !== 'PUBLIC')) error = 'dblink_unsupported';
  else if (!/^[A-Za-z][A-Za-z0-9_$#]*(?:[.@][A-Za-z0-9_$#]+)*$/.test(form.name) || form.name.length > 128) error = 'dblink_invalid_name';
  else if (!username || /["\x00-\x1f\x7f]/.test(username) || utf8Length(username) > 128 || form.username !== saved?.username && !form.username.startsWith('"') && !/^[\p{L}][\p{L}\p{N}_$#]*$/u.test(form.username.trim())) error = 'dblink_invalid_user';
  else if (!host || unsafeHost(host) || utf8Length(host) > 4000) error = 'dblink_invalid_host';
  else if (/["\x00-\x1f\x7f]/.test(form.password) || utf8Length(form.password) > 128) error = 'dblink_invalid_password';
  else if (saved && (form.name !== saved.name || form.isPublic !== (saved.schema === 'PUBLIC'))) error = 'dblink_identity_fixed';
  else if (kind !== 'unchanged' && kind !== 'alter' && !(form.isPublic ? context.createPublic : context.createPrivate) || kind === 'alter' && !(form.isPublic ? context.alterPublic : context.alterPrivate) || kind === 'recreate' && form.isPublic && !context.dropPublic) error = 'dblink_privilege';
  else if ((kind === 'create' || kind === 'recreate') && !form.password) error = 'dblink_password_required';
  const target = form.name.toUpperCase(), scope = form.isPublic ? 'PUBLIC ' : '';
  let sql = '';
  // Password values are never interpolated into renderer-owned SQL, even for a preview.
  if (!error && kind !== 'unchanged') {
    const create = `CREATE ${scope}DATABASE LINK ${target}\nCONNECT TO ${quoteIdentifier(username)} IDENTIFIED BY "********"\nUSING '${escapeSqlString(host)}';`;
    sql = kind === 'alter' ? `ALTER ${scope}DATABASE LINK ${target}\nCONNECT TO ${quoteIdentifier(username)} IDENTIFIED BY "********";`
      : kind === 'recreate' ? `DROP ${scope}DATABASE LINK ${target};\n${create}` : create;
  }
  return { kind, error, sql };
}
