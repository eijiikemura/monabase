// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('./jsonFiles');

function createSshHostKeyVerifier({ file, confirm, notify, t }) {
  let pending = Promise.resolve();
  const load = () => fs.existsSync(file) ? readJsonFile(file, value => Array.isArray(value) && value.every(entry =>
    isJsonObject(entry) && typeof entry.host === 'string' && Number.isInteger(entry.port) &&
    entry.port > 0 && entry.port <= 65535 && /^SHA256:[A-Za-z0-9+/]{43}$/.test(entry.fingerprint))) : [];

  return ({ host, port }) => {
    const normalizedHost = host.trim().toLowerCase();
    if (!normalizedHost || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH host or port.');
    return (key, callback) => {
      const verify = async () => {
        try {
          const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          const entries = load();
          const previous = entries.find(entry => entry.host === normalizedHost && entry.port === port);
          if (previous) {
            if (previous.fingerprint === fingerprint) return true;
            await notify(t('ssh_host_key_changed', { host: normalizedHost, port, expected: previous.fingerprint, actual: fingerprint }));
            return false;
          }
          if (!await confirm({ host: normalizedHost, port, fingerprint })) return false;
          atomicWriteJson(file, [...entries, { host: normalizedHost, port, fingerprint }]);
          return true;
        } catch {
          try { await notify(t('ssh_host_keys_unavailable')); } catch {}
          return false;
        }
      };
      // Serialize trust decisions so simultaneous handshakes cannot lose saved keys.
      const result = pending.then(verify);
      pending = result.then(() => undefined, () => undefined);
      void result.then(accepted => callback(accepted), () => callback(false));
    };
  };
}

// Keep the network deadline, but exclude time spent in the user's trust dialog.
function connectVerifiedSsh(client, config, createVerifier, t) {
  const verify = createVerifier({ host: config.host, port: config.port });
  let timer;
  let ready = false;
  let closed = false;
  const stop = () => clearTimeout(timer);
  const resume = () => {
    stop();
    if (ready || closed) return;
    timer = setTimeout(() => {
      closed = true;
      client.emit('error', new Error(t('ssh_connection_timed_out')));
      client.destroy();
    }, config.readyTimeout);
    timer.unref?.();
  };
  client.once('ready', () => { ready = true; stop(); });
  client.once('error', () => { closed = true; stop(); });
  client.once('close', () => { closed = true; stop(); });
  const hostVerifier = (key, callback) => {
    stop();
    let settled = false;
    const finish = accepted => {
      if (settled) return;
      settled = true;
      resume();
      callback(!closed && accepted === true);
    };
    try {
      const synchronous = verify(key, finish);
      if (typeof synchronous === 'boolean') finish(synchronous);
    } catch { finish(false); }
  };
  resume();
  try { return client.connect({ ...config, readyTimeout: 0, hostVerifier }); }
  catch (error) { stop(); throw error; }
}

module.exports = { createSshHostKeyVerifier, connectVerifiedSsh };
