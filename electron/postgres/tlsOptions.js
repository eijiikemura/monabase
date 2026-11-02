// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readCredentialFile } = require('../services/credentialFiles');
const net = require('node:net');
const tls = require('node:tls');

async function postgresTlsOptions(config) {
  if (config.pgSslMode === undefined || config.pgSslMode === 'disable') return false;
  if (config.pgSslMode !== 'verify-full') throw new Error('security_tls_invalid_mode');
  const expectedName = (config.pgSslServerName || config.host || '').trim().replace(/^\[|\]$/g, '');
  if (!expectedName || /[\s/\\]/.test(expectedName) || [...expectedName].some(character => character.charCodeAt(0) < 32)) throw new Error('security_tls_invalid_name');
  const options = { rejectUnauthorized: true, minVersion: 'TLSv1.2',
    // Verify the DB name, not the loopback address of an SSH tunnel.
    checkServerIdentity: (_name, certificate) => tls.checkServerIdentity(expectedName, certificate) };
  if (!net.isIP(expectedName)) options.servername = expectedName;
  if (config.pgSslCaFile) options.ca = (await readCredentialFile(config.pgSslCaFile, 'tls-ca')).toString('utf8');
  return options;
}
module.exports = { postgresTlsOptions };
