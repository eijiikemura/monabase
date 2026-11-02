// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createTraceDatabase } = require('../services/traceStore');
const { getStoragePaths } = require('../services/storagePaths');

module.exports = { TraceDatabase: createTraceDatabase('postgres', { getStoragePaths }) };
