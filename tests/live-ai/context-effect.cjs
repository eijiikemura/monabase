// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const { authorizeEffect, createPaidSession, runEffects } = require('./effect.cjs');
const { runTraceEffects } = require('./trace-effect.cjs');
const { prepare } = require('./program-effect.cjs');
const { readKey } = require('./runner.cjs');
const { safeAiError } = require('../../electron/services/aiErrors');

async function main() {
  authorizeEffect(process.argv.slice(2));
  const configs = JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8'));
  console.log('Explicit paid context checks: gpt-6-luna only; at most 14 requests, 4096 completion tokens each. No automatic retries. Program sources require review before DB application. Enter the authorized one-time key on stdin.');
  let key = await readKey();
  const directory = path.resolve('local/ai-test-reports');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `context-effects-${Date.now()}.json`);
  const report = { model: 'gpt-6-luna', startedAt: new Date().toISOString(), tuning: [], trace: [] };
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const sessions = [];
  try {
    const tuning = createPaidSession(key, globalThis.fetch, { model: 'gpt-6-luna', requestType: 'sql_tuning', maxRequests: 4 });
    sessions.push(tuning);
    report.tuning = await runEffects({ configs, ask: prompt => tuning.ask(prompt) }); save();
    const trace = createPaidSession(key, globalThis.fetch, { model: 'gpt-6-luna', requestType: 'debug_function', maxRequests: 2 });
    sessions.push(trace);
    report.trace = await runTraceEffects({ configs, ask: prompt => trace.ask(prompt), onObservation: observation => {
      report.traceObservations ??= []; report.traceObservations.push(observation); save();
    } }); save();
    report.programFile = await prepare(key, null, null, 'gpt-6-luna');
    report.completedAt = new Date().toISOString(); save();
    console.log(`Context results saved: ${path.relative(process.cwd(), file)}`);
  } catch (error) {
    report.error = safeAiError(error.message, key); save();
    throw new Error(report.error);
  } finally {
    key = ''; sessions.forEach(session => session.dispose());
  }
}
if (require.main === module) main().catch(error => { console.error(safeAiError(error.message)); process.exitCode = 1; });
