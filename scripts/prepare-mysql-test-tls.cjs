// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = path.resolve(__dirname, '../local/mysql-test-tls');
fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
const files = ['ca.pem', 'ca-key.pem', 'server-cert.pem', 'server-key.pem'];
if (files.some(file => fs.existsSync(path.join(directory, file)))) {
  if (!files.every(file => fs.existsSync(path.join(directory, file)))) throw new Error('Incomplete disposable TLS fixture; inspect local/mysql-test-tls before recreating it.');
  console.log('Reusing the existing disposable MySQL TLS fixture.');
} else {
  function openssl(args) {
    const result = spawnSync('openssl', args, { cwd: directory, stdio: 'ignore' });
    if (result.status !== 0) throw new Error('Could not prepare disposable MySQL certificates. Install OpenSSL and inspect local/mysql-test-tls.');
  }
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca-key.pem', '-out', 'ca.pem', '-days', '30', '-subj', '/CN=MonaBase disposable test CA']);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server-key.pem', '-out', 'server.csr', '-subj', '/CN=localhost']);
  fs.writeFileSync(path.join(directory, 'server.ext'), 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial', '-out', 'server-cert.pem', '-days', '30', '-extfile', 'server.ext']);
  // Disposable keys only: mysqld inside Docker must be able to read these files.
  // The entire directory is ignored by Git; never use these keys for a real DB.
  for (const file of files) fs.chmodSync(path.join(directory, file), 0o644);
  console.log('Prepared a 30-day localhost certificate for the disposable MySQL service.');
}
