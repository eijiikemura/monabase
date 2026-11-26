// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { stableValue, validateSnapshot, type ResultSnapshot, type JsonValue } from './resultSnapshot';
export type MaskMode = 'omit' | 'keep' | 'null' | 'fixed' | 'token' | 'email';
export interface MaskRule { column: string; mode: MaskMode; group: string; value: string; }
export function defaultMaskRules(snapshot: ResultSnapshot): MaskRule[] {
  return snapshot.columns.map(column => ({ column, mode: 'omit', group: column, value: '' }));
}
export async function maskResult(input: ResultSnapshot, rules: MaskRule[], secret: string, webCrypto: Crypto = globalThis.crypto): Promise<ResultSnapshot> {
  const snapshot = validateSnapshot(input);
  if (rules.length !== snapshot.columns.length || rules.some((rule, index) => rule.column !== snapshot.columns[index] || !['omit','keep','null','fixed','token','email'].includes(rule.mode))) throw new Error('quality_invalid_rules');
  const active = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.mode !== 'omit');
  if (!active.length) throw new Error('quality_select_columns');
  if (rules.some(rule => rule.mode === 'token' || rule.mode === 'email') && secret.length < 16) throw new Error('quality_secret_length');
  const encoder = new TextEncoder();
  const key = await webCrypto.subtle.importKey('raw', encoder.encode(secret || 'unused'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const cache = new Map<string, string>();
  const rows: JsonValue[][] = [];
  for (const row of snapshot.rows) {
    const masked: JsonValue[] = [];
    for (const { rule, index } of active) {
      const original = row[index];
      if (rule.mode === 'null' || original === null) { masked.push(null); continue; }
      if (rule.mode === 'keep') { masked.push(original); continue; }
      if (rule.mode === 'fixed') { masked.push(rule.value); continue; }
      const message = JSON.stringify([rule.group, stableValue(original)]);
      let token = cache.get(message);
      if (!token) {
        const digest = await webCrypto.subtle.sign('HMAC', key, encoder.encode(message));
        token = Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
        cache.set(message, token);
      }
      masked.push(rule.mode === 'email' ? 'user-' + token + '@example.invalid' : 'anon_' + token);
    }
    rows.push(masked);
  }
  return validateSnapshot({ format: 'monabase-result', version: 1, columns: active.map(({ rule }) => rule.column), rows });
}
