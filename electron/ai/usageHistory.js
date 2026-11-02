// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readInternalText, assertDataSize, dataError } = require('../services/dataSafety');
const fs = require('fs').promises;
const { constants } = require('fs');
const path = require('path');

const HEADER = ['依頼日時', '依頼内容', 'モデル名', '入力トークン', '出力トークン'];
let writeQueue = Promise.resolve();

function normalizeTokens(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function createUsageRecord(requestType, modelName, date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return {
    requestedAt: `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    requestType: typeof requestType === 'string' && requestType.trim()
      ? requestType : "unspecified",
    modelName,
    inputTokens: 0,
    outputTokens: 0
  };
}

function getYearFile(directory, year) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error('履歴の年が不正です。');
  }
  return path.join(directory, `ai-usage-${String(year).padStart(4, '0')}.csv`);
}

// Quoting alone does not prevent spreadsheet formula interpretation.
function spreadsheetSafe(value) {
  const text = String(value);
  return /^[\t\r\n]|^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) ? "'" + text : text;
}

function encodeRow(values) {
  return values.map(value =>
    '"' + spreadsheetSafe(value).replace(/"/g, '""') + '"'
  ).join(',') + '\r\n';
}

async function prepareYearFile(directory, year, legacyDirectory) {
  const file = getYearFile(directory, year);
  if (!legacyDirectory || path.resolve(directory) === path.resolve(legacyDirectory)) return file;
  try { await fs.stat(file); return file; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const legacyFile = getYearFile(legacyDirectory, year);
  try {
    await fs.stat(legacyFile);
    await fs.mkdir(directory, { recursive: true });
    // Preserve both files when the destination already contains history.
    await fs.copyFile(legacyFile, file, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error;
  }
  return file;
}

// Serialize header creation and row appends even when responses arrive together.
function appendUsage(directory, record, legacyDirectory) {
  const task = writeQueue.then(async () => {
    const file = await prepareYearFile(directory, Number(record.requestedAt.slice(0, 4)), legacyDirectory);
    await fs.mkdir(directory, { recursive: true });
    let before;
    try {
      before = await fs.lstat(file);
      if (!before.isFile() || before.isSymbolicLink()) throw dataError('internal_data_not_regular');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let handle;
    try {
      handle = await fs.open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT |
        (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0), 0o600);
      const status = await handle.stat();
      if (!status.isFile() || before && (status.dev !== before.dev || status.ino !== before.ino)) throw dataError('internal_data_not_regular');
      const header = status.size === 0 ? '\uFEFF' + encodeRow(HEADER) : '';
      const row = header + encodeRow([
        record.requestedAt, record.requestType, record.modelName,
        normalizeTokens(record.inputTokens), normalizeTokens(record.outputTokens)
      ]);
      assertDataSize(status.size + Buffer.byteLength(row));
      await handle.writeFile(row, 'utf8');
    } finally { await handle?.close(); }
  });
  writeQueue = task.catch(() => {});
  return task;
}

// Handle quoted commas, newlines, and escaped double quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const pushRow = () => {
    row.push(field);
    if (row.some(value => value !== '')) rows.push(row);
    row = [];
    field = '';
  };
  text = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      if (field !== '') throw new Error('履歴CSVの引用符が不正です。');
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      pushRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('履歴CSVの引用符が閉じられていません。');
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

function readUsage(directory, year, legacyDirectory) {
  // Queue reads with writes to prevent appending during legacy history migration.
  const task = writeQueue.then(async () => {
    const file = await prepareYearFile(directory, year, legacyDirectory);
    let text;
    try {
      text = await readInternalText(file);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const rows = parseCsv(text);
    if (rows.length === 0) return [];
    const header = rows.shift();
    if (header.length !== HEADER.length ||
        header.some((value, index) => value !== HEADER[index])) {
      throw new Error('履歴CSVのヘッダーが不正です。');
    }
    return rows.map((row, index) => {
      const inputTokens = Number(row[3]), outputTokens = Number(row[4]);
      if (row.length !== 5 ||
          !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row[0]) ||
          Number(row[0].slice(0, 4)) !== year ||
          row[3].trim() === '' || row[4].trim() === '' ||
          !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
          !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
        throw new Error(`履歴CSVの${index + 2}行目が不正です。`);
      }
      return {
        requestedAt: row[0], requestType: row[1], modelName: row[2],
        inputTokens, outputTokens
      };
    });
  });
  writeQueue = task.catch(() => {});
  return task;
}

module.exports = { createUsageRecord, appendUsage, readUsage };
