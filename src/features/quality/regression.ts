// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { StoredRequest, StoredData, Response, SqlResponse } from '@/shared/api/desktopContract';
import { captureResult, jsonValue, stableValue, validateSnapshot, MAX_DOCUMENT_BYTES, type JsonValue, type ResultSnapshot } from './resultSnapshot';
import { compareResults } from './compareResults';
export type QualityDb = 'oracle' | 'postgresql' | 'mysql';
export interface StoredExpectation { returnValues: JsonValue; resultSets: ResultSnapshot[]; }
export interface RegressionCheck { sql: string; binds: Record<string, JsonValue>; expected: ResultSnapshot; }
export interface RegressionCase { id: string; name: string; request: StoredRequest; expected: StoredExpectation; checks: RegressionCheck[]; }
export interface RegressionSuite { format: 'monabase-regression'; version: 1; dbType: QualityDb; cases: RegressionCase[]; }
export interface RegressionOutcome { id: string; name: string; status: 'passed' | 'failed' | 'error' | 'not-run'; details: string[]; actual?: StoredExpectation; failedChecks?: { index: number; actual: ResultSnapshot }[]; }
export interface RegressionExecutor {
  stored(request: StoredRequest): Promise<Response<StoredData>>;
  query(sql: string, binds: Record<string, JsonValue>, schema: string): Promise<SqlResponse>;
}
export function storedExpectation(data: StoredData): StoredExpectation {
  // Transaction flags and execution timings are intentionally not assertions.
  return { returnValues: jsonValue(data.returnValues || []), resultSets: (data.resultSets || []).map(result => captureResult(result.metaData.map(column => column.name), result.rows)) };
}
function record(input: unknown): input is Record<string, unknown> { return !!input && typeof input === 'object' && !Array.isArray(input); }
export function validateSuite(input: unknown): RegressionSuite {
  if (!record(input) || input.format !== 'monabase-regression' || input.version !== 1 || !['oracle','postgresql','mysql'].includes(String(input.dbType)) ||
    !Array.isArray(input.cases) || input.cases.length > 100 || new TextEncoder().encode(JSON.stringify(input)).length > MAX_DOCUMENT_BYTES) throw new Error('quality_invalid_suite');
  if (Object.keys(input).some(key => !['format','version','dbType','cases'].includes(key))) throw new Error('quality_invalid_suite');
  const seen = new Set<string>();
  for (const entry of input.cases) {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 200 || !record(entry.request) || !record(entry.expected)) throw new Error('quality_invalid_suite');
    if (Object.keys(entry).some(key => !['id','name','request','expected','checks'].includes(key)) || Object.keys(entry.expected).some(key => !['returnValues','resultSets'].includes(key))) throw new Error('quality_invalid_suite');
    seen.add(entry.id);
    const r = entry.request;
    if (['schema','objectName','objectType','inputDateFormat'].some(key => typeof r[key] !== 'string') || !r.schema || !r.objectName || !['PROCEDURE','FUNCTION','PACKAGE'].includes(String(r.objectType).toUpperCase()) ||
      !record(r.args) || !record(r.argTypes) || !record(r.argDirections)) throw new Error('quality_invalid_suite');
    if (Object.values(r.argTypes).some(v => typeof v !== 'string') || Object.values(r.argDirections).some(v => typeof v !== 'string')) throw new Error('quality_invalid_suite');
    if (r.argumentModes !== undefined && (!record(r.argumentModes) || Object.values(r.argumentModes).some(v => !['value','null','default'].includes(String(v))))) throw new Error('quality_invalid_suite');
    if (r.subProgram !== undefined && typeof r.subProgram !== 'string' || r.subProgramId !== undefined && !Number.isSafeInteger(r.subProgramId) || r.signature !== undefined && typeof r.signature !== 'string' || r.mysqlFingerprint !== undefined && typeof r.mysqlFingerprint !== 'string' || r.isSubProgramFunction !== undefined && typeof r.isSubProgramFunction !== 'boolean') throw new Error('quality_invalid_suite');
    if (Object.keys(r).some(key => !['schema','objectName','objectType','args','argTypes','argDirections','inputDateFormat','subProgram','subProgramId','argumentModes','signature','mysqlFingerprint','isSubProgramFunction'].includes(key))) throw new Error('quality_invalid_suite');
    jsonValue(r.args);
    if (!Array.isArray(entry.expected.returnValues) || !Array.isArray(entry.expected.resultSets) || !Array.isArray(entry.checks) || entry.checks.length > 20) throw new Error('quality_invalid_suite');
    jsonValue(entry.expected.returnValues);
    entry.expected.resultSets.forEach(validateSnapshot);
    if (!entry.expected.returnValues.length && !entry.expected.resultSets.length && !entry.checks.length) throw new Error('quality_no_assertions');
    for (const check of entry.checks) {
      if (!record(check) || typeof check.sql !== 'string' || !check.sql.trim() || check.sql.length > 100000 || !record(check.binds)) throw new Error('quality_invalid_suite');
      if (Object.keys(check).some(key => !['sql','binds','expected'].includes(key))) throw new Error('quality_invalid_suite');
      jsonValue(check.binds); validateSnapshot(check.expected);
    }
  }
  // Clone plain data, never persist connection settings or runtime handles.
  return JSON.parse(JSON.stringify(input)) as RegressionSuite;
}
export async function runRegressionSuite(suiteInput: RegressionSuite, dbType: QualityDb, executor: RegressionExecutor, shouldStop: () => boolean = () => false): Promise<RegressionOutcome[]> {
  const suite = validateSuite(suiteInput);
  if (!suite.cases.length) throw new Error('quality_no_cases');
  if (suite.dbType !== dbType) throw new Error('quality_database_mismatch');
  const outcomes: RegressionOutcome[] = [];
  let stopped = false;
  for (const entry of suite.cases) {
    if (stopped || shouldStop()) { stopped = true; outcomes.push({ id: entry.id, name: entry.name, status: 'not-run', details: [] }); continue; }
    const details: string[] = [];
    let actual: StoredExpectation | undefined;
    const failedChecks: { index: number; actual: ResultSnapshot }[] = [];
    try {
      const response = await executor.stored(entry.request);
      if (!response.success) throw new Error(response.error);
      if (shouldStop()) throw new Error('quality_stopped');
      actual = storedExpectation(response);
      if (stableValue(actual.returnValues) !== stableValue(entry.expected.returnValues)) details.push('quality_returns_differ');
      if (actual.resultSets.length !== entry.expected.resultSets.length) details.push('quality_resultsets_differ');
      else actual.resultSets.forEach((result, index) => {
        try { if (!compareResults(entry.expected.resultSets[index], result).equal) details.push('quality_resultsets_differ'); }
        catch (error) { if (error instanceof Error && error.message === 'quality_columns_differ') details.push('quality_resultsets_differ'); else throw error; }
      });
      for (const [index, check] of entry.checks.entries()) {
        if (shouldStop()) throw new Error('quality_stopped');
        const response = await executor.query(check.sql, check.binds, entry.request.schema);
        if (!response.success) throw new Error(response.error);
        const result = captureResult(response.metaData.map(c => c.name), response.rows);
        let equal = false;
        try { equal = compareResults(check.expected, result).equal; }
        catch (error) { if (!(error instanceof Error) || error.message !== 'quality_columns_differ') throw error; }
        if (!equal) { details.push('quality_check_differ'); failedChecks.push({ index, actual: result }); }
      }
      const status = details.length ? 'failed' : 'passed';
      outcomes.push({ id: entry.id, name: entry.name, status, details, ...(details.length ? { actual, failedChecks } : {}) });
      if (details.length) stopped = true;
    } catch (failure) {
      outcomes.push({ id: entry.id, name: entry.name, status: 'error', details: [failure instanceof Error ? failure.message : 'quality_execution_failed'], ...(actual ? { actual, failedChecks } : {}) });
      stopped = true;
    }
  }
  return outcomes;
}
