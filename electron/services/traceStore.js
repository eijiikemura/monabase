// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readInternalText, parsePrivateJson } = require('./dataSafety');
const { t } = require('../i18n');
const fs = require('fs');
const path = require('path');
const { getStoragePaths: defaultStoragePaths } = require('./storagePaths');
const { resolveTraceFile } = require('./traceFiles');
const { atomicWriteJson } = require('./jsonFiles');
const { createHash } = require('node:crypto');

// Database adapters retain their public interface and share only JSON persistence.
function createTraceDatabase(database, { getStoragePaths = defaultStoragePaths } = {}) {
  if (!['oracle', 'postgres'].includes(database)) throw new Error('Invalid trace database.');
  const filename = identity => resolveTraceFile(getStoragePaths().traceDirectory, database, identity);
  return class TraceDatabase {
    constructor(identity) {
      this.identity = identity;
      this.dbPath = filename(identity);
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.data = { traceInfo: null, traceSteps: [] };
    }

    static exists(identity) { return fs.existsSync(filename(identity)); }

    static deleteDatabase(identity) {
      const file = filename(identity);
      if (!fs.existsSync(file)) return;
      try {
        fs.unlinkSync(file);
        console.log(t('tracedb_deleted_from_disk', { value0: file }));
      } catch (error) {
        console.error(t('tracedb_failed_to_delete_the_file'), error);
      }
    }

    async init() {
      this.dbPath = filename(this.identity);
      if (fs.existsSync(this.dbPath)) {
        const content = await readInternalText(this.dbPath);
        if (content) this.data = parsePrivateJson(content);
      } else {
        this.data = { traceInfo: null, traceSteps: [] };
        this._saveToFile();
      }
    }

    _saveToFile(data = this.data) { atomicWriteJson(filename(this.identity), data); }

    async saveTraceInfo(traceDate, argsJson, targetCompileDate = null, subProgram = null, source = null) {
      const traceInfo = {
        compile_date: traceDate, arguments: argsJson,
        target_compile_date: targetCompileDate, sub_program: subProgram
      };
      if (source && typeof source.text === 'string') {
        traceInfo.executed_source = source.text;
        traceInfo.source_sha256 = createHash('sha256').update(source.text, 'utf8').digest('hex');
        traceInfo.source_kind = source.instrumented ? 'instrumented' : 'original';
        traceInfo.line_mapping = source.lineMap ? 'generated_procedure_to_original' : source.instrumented || source.mappingUnverified ? 'unverified' : 'original_source_1_based';
        if (source.lineMap) traceInfo.procedure_to_source = source.lineMap;
      }
      this._saveToFile({ ...this.data, traceInfo });
      this.data.traceInfo = traceInfo;
    }

    async getTraceInfo() { return this.data.traceInfo; }
    async getTraceSteps() { return this.data.traceSteps; }

    async insertSteps(steps) {
      const formatted = steps.map((step, index) => ({
        step_id: index + 1, line_num: step.lineNum, loop_path: step.loopPath,
        variables_json: JSON.stringify(step.variables), log_text: step.logText
      }));
      const traceSteps = this.data.traceSteps.concat(formatted);
      this._saveToFile({ ...this.data, traceSteps });
      this.data.traceSteps = traceSteps;
    }

    close() { this.data = { traceInfo: null, traceSteps: [] }; }
  };
}

module.exports = { createTraceDatabase };
