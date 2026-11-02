// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { parseCodingResponse, type CodingResponse } from './codingResponse';

export interface TriggerAiSettings {
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  events: Array<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>;
  forEachRow: boolean;
}

export type TriggerCodingResponse = Exclude<CodingResponse, { status: 'success' }> |
  { status: 'success'; source: string; message: string; settings: TriggerAiSettings };

export function parseTriggerCodingResponse(
  answer: string,
  dbType: 'oracle' | 'postgresql',
  targetType: 'TABLE' | 'VIEW'
): TriggerCodingResponse {
  const invalid = () => new Error('AIのトリガー設定を確認できませんでした。起動タイミング・処理対象・行ごとの実行設定を確認して再依頼してください。');
  const text = answer.trim();
  const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  let value: unknown;
  try { value = JSON.parse(fence ? fence[1] : text); } catch { throw invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const record = value as Record<string, unknown>;
  if (record.status !== 'success') {
    const response = parseCodingResponse(answer);
    if (response.status === 'success') throw invalid();
    return response;
  }
  if (Object.keys(record).length !== 4 || !record.settings || typeof record.settings !== 'object' || Array.isArray(record.settings)) throw invalid();
  const { settings, ...program } = record;
  const response = parseCodingResponse(JSON.stringify(program));
  const config = settings as Record<string, unknown>;
  const allowedEvents = dbType === 'postgresql' && targetType === 'TABLE'
    ? ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] : ['INSERT', 'UPDATE', 'DELETE'];
  if (response.status !== 'success' || Object.keys(config).length !== 3 ||
      typeof config.timing !== 'string' ||
      !['BEFORE', 'AFTER', 'INSTEAD OF'].includes(String(config.timing)) ||
      !Array.isArray(config.events) || !config.events.length ||
      config.events.some(event => typeof event !== 'string' || !allowedEvents.includes(event)) ||
      new Set(config.events).size !== config.events.length || typeof config.forEachRow !== 'boolean') throw invalid();
  if (targetType === 'VIEW' && (config.timing !== 'INSTEAD OF' || config.forEachRow !== true)) throw invalid();
  if (targetType === 'TABLE' && config.timing === 'INSTEAD OF') throw invalid();
  if (config.events.includes('TRUNCATE') && config.forEachRow) throw invalid();
  return { ...response, settings: {
    timing: config.timing as TriggerAiSettings['timing'],
    events: [...config.events] as TriggerAiSettings['events'],
    forEachRow: config.forEachRow
  } };
}

export function validateTriggerBody(source: string): string {
  const body = source.replace(/\n\s*\/\s*$/, '').trim();
  const clean = body.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
  if (!/^(BEGIN|DECLARE)\b/i.test(clean) || !/\bEND\s*;\s*$/i.test(clean)) {
    throw new Error('トリガー本体のDECLARE／BEGIN～END;だけを返してください。CREATE文は含めないでください。');
  }
  return body;
}
