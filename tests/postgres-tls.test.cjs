// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { Client } = require('pg');
const { postgresTlsOptions } = require('../electron/postgres/tlsOptions');

test('PostgreSQL negotiates real TLS and rejects an unknown CA or a different certificate host', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monabase-tls-'));
  const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem'),config=path.join(dir,'openssl.cnf');
  fs.writeFileSync(config,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=db.test\n[ext]\nsubjectAltName=DNS:db.test\nbasicConstraints=critical,CA:TRUE\n');
  const windowsOpenSSL=path.join(process.env.ProgramFiles || 'C:/Program Files','Git/usr/bin/openssl.exe');
  const openssl=process.platform==='win32'&&fs.existsSync(windowsOpenSSL)?windowsOpenSSL:'openssl';
  execFileSync(openssl,['req','-new','-newkey','rsa:2048','-nodes','-x509','-days','1','-config',config,'-keyout',key,'-out',cert],{stdio:'ignore'});
  const sockets=new Set();
  const context=tls.createSecureContext({key:fs.readFileSync(key),cert:fs.readFileSync(cert)});
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.once('data',request=>{
      assert.equal(request.readInt32BE(4),80877103);
      socket.write('S');
      const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:context});
      secure.on('error',()=>{});
      secure.once('data',()=>{
        // Trust authentication and ReadyForQuery are sufficient to exercise Client.connect().
        secure.write(Buffer.from([82,0,0,0,8,0,0,0,0,90,0,0,0,5,73]));
      });
    });
  });
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const connect=async(options)=>{
    const client=new Client({host:'127.0.0.1',port:server.address().port,user:'test',database:'test',connectionTimeoutMillis:3000,ssl:await postgresTlsOptions(options)});
    try{await client.connect();assert.equal(client.connection.stream.encrypted,true);assert.equal(client.connection.stream.authorized,true);}
    finally{await client.end();}
  };
  await connect({pgSslMode:'verify-full',host:'db.test',pgSslCaFile:cert});
  await assert.rejects(connect({pgSslMode:'verify-full',host:'other.test',pgSslCaFile:cert}),/Hostname\/IP|certificate|altname/i);
  await assert.rejects(connect({pgSslMode:'verify-full',host:'db.test'}),/self.signed|certificate/i);
  assert.equal(await postgresTlsOptions({pgSslMode:'disable'}),false);
  await assert.rejects(postgresTlsOptions({pgSslMode:'invalid'}),/invalid_mode/);
});

test('Main, metadata, background and cancellation connections retain TLS verification through an SSH tunnel', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const options = [];
  class FakeClient {
    constructor(config) { options.push(config); this.connection={stream:{encrypted:true,authorized:true}}; }
    on() {}
    async connect() {}
    async end() {}
    async query(sql) { return {rows:sql.includes('pg_backend_pid')?[{pid:123}]:sql.includes('version()')?[{version:'test server'}]:[]}; }
  }
  const PostgresClient=loadModule('electron/postgres/postgresClient.js',{
    electron:{app:{isPackaged:true}},pg:{Client:FakeClient,types:{setTypeParser(){}}},'../i18n':{t:key=>key}
  },{}, {strict:false});
  const client=new PostgresClient();
  client.setupSshTunnel=async()=>{client.localSshPort=17777;};
  try {
    await client.connect({host:'db.test',port:5432,database:'test',user:'test',password:'test',useSshTunnel:true,pgSslMode:'verify-full'});
    assert.equal((await client.breakExecution()).success,true);
    assert.equal(options.length,8);
    for(const config of options) {
      assert.equal(config.host,'127.0.0.1');assert.equal(config.ssl.rejectUnauthorized,true);
      assert.equal(config.ssl.servername,'db.test');
      assert.equal(config.ssl.checkServerIdentity('127.0.0.1',{subjectaltname:'DNS:db.test'}),undefined);
      assert.ok(config.ssl.checkServerIdentity('127.0.0.1',{subjectaltname:'DNS:other.test'}) instanceof Error);
    }
    assert.ok((await client.getDbVersion()).includes('security_tls_verified'));
  } finally {await client.disconnect();}
});
