// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { t } from 'i18next';

export type CodingResponse =
  | { status: 'success'; source: string; message: string }
  | { status: 'question'; source: ''; message: string }
  | { status: 'error'; source: ''; message: string };

export function parseCodingResponse(answer: string): CodingResponse {
  const invalid = () => new Error(t("the_ai_response_format_could_not_be_recognized_try_again"));
  if (typeof answer !== 'string') throw invalid();
  const text = answer.trim();
  const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  let value: unknown;
  try { value = JSON.parse(fence ? fence[1] : text); } catch { throw invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const response = value as Record<string, unknown>;
  if (Object.keys(response).length !== 3 || typeof response.source !== 'string' ||
      typeof response.message !== 'string') throw invalid();
  if (response.status === 'success') {
    if (!response.source.trim() || response.message.trim()) throw invalid();
    return { status: 'success', source: response.source, message: '' };
  }
  if ((response.status === 'question' || response.status === 'error') &&
      !response.source.trim() && response.message.trim()) {
    return { status: response.status, source: '', message: response.message.trim() };
  }
  throw invalid();
}

export function formatCodingMessage(response: CodingResponse, target: 'program' | 'sql' = 'program'): string {
  if (response.status === 'success') return target === 'sql'
    ? t("applied_the_generated_sql_to_the_sql_window")
    : t("applied_the_generated_program_to_the_source_editor");
  return response.status === 'question'
    ? t("additional_clarification_is_required_questions", { message: response.message })
    : target === 'sql'
      ? t("could_not_generate_sql_reason", { message: response.message })
      : t("could_not_generate_the_program_reason", { message: response.message });
}

// Decode partial JSON strings, including newline, quote, and Unicode escapes.
function readString(text: string, offset: number): { value: string; end: number; complete: boolean } | null {
  if (text[offset] !== '"') return null;
  let value = '';
  const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  for (let i = offset + 1; i < text.length; i++) {
    const char = text[i];
    if (char === '"') return { value, end: i + 1, complete: true };
    if (char.charCodeAt(0) < 32) return null;
    if (char !== '\\') { value += char; continue; }
    const escaped = text[++i];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const digits = text.slice(i + 1, i + 5);
      if (digits.length < 4) break;
      if (!/^[0-9a-f]{4}$/i.test(digits)) return null;
      value += String.fromCharCode(parseInt(digits, 16)); i += 4;
    } else if (escaped in escapes) value += escapes[escaped];
    else return null;
  }
  // Wait for the next update when the trailing surrogate has not arrived yet.
  const last = value.charCodeAt(value.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) value = value.slice(0, -1);
  return { value, end: text.length, complete: false };
}

export function getCodingPreview(answer: string): string | null {
  const text = answer.replace(/^\s*```(?:json)?\s*\r?\n/i, '').trimStart();
  let offset = 0, status = '', source: string | null = null;
  const skipSpace = () => { while (/\s/.test(text[offset] || '') && offset < text.length) offset++; };
  skipSpace();
  if (text[offset++] !== '{') return null;
  while (offset < text.length) {
    skipSpace();
    const key = readString(text, offset);
    if (!key?.complete) return null;
    offset = key.end; skipSpace();
    if (text[offset++] !== ':') return null;
    skipSpace();
    const value = readString(text, offset);
    if (!value) return null;
    if (key.value === 'status' && value.complete) status = value.value;
    if (key.value === 'source') source = value.value;
    if (status === 'success' && source !== null) return source;
    if (!value.complete) return null;
    offset = value.end; skipSpace();
    if (text[offset++] !== ',') return null;
  }
  return null;
}
