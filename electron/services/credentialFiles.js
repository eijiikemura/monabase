// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readBoundedBuffer } = require('./boundedFiles');
const { t } = require('../i18n');

const CREDENTIAL_FILES = Object.freeze({
  'ssh-private-key': { limitMiB: 1, label: 'auth_file_private_key' },
  'tls-ca': { limitMiB: 4, label: 'auth_file_ca_certificate' }
});

async function readCredentialFile(file, kind) {
  const rule = CREDENTIAL_FILES[kind];
  if (!Object.hasOwn(CREDENTIAL_FILES, kind)) throw new Error('Invalid credential file kind.');
  try {
    // Follow user-selected links once, then verify and bound the opened regular file.
    // External keys/certificates are read only; their permissions are not changed.
    return await readBoundedBuffer(file, rule.limitMiB, { followSymlinks: true });
  } catch (error) {
    const code = error.code === 'file_read_too_large' ? 'auth_file_too_large' :
      error.code === 'file_read_not_regular' ? 'auth_file_not_regular' : 'auth_file_unreadable';
    throw Object.assign(new Error(t(code, { kind: t(rule.label), limit: rule.limitMiB })), { code });
  }
}

module.exports = { readCredentialFile, CREDENTIAL_FILES };
