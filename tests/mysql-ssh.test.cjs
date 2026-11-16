// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once,EventEmitter}=require('node:events');
const {sshFixture}=require('./helpers/mysqlSsh.cjs'),{MysqlSshTransport}=require('../electron/mysql/sshTransport'),{loadModule}=require('./helpers/loadModule.cjs');
for(const mode of ['password','key'])test(`MySQL SSH ${mode} authentication uses verified host keys, separate streams and bounded credential files`,async()=>{
 const server=await sshFixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-ssh-')),transport=new MysqlSshTransport(server.verify,()=>{});try{
 const keyFile=path.join(dir,'key');fs.writeFileSync(keyFile,server.privateKey,{mode:0o600});await transport.connect({...server.config,...(mode==='key'?{sshAuthType:'key',sshKeyFile:keyFile,sshPassword:''}:{})});
 const a=await transport.open('localhost',13306),b=await transport.open('localhost',13306);assert.notEqual(a,b);const received=once(a,'data');a.write('synthetic payload');assert.equal(String((await received)[0]),'synthetic payload');assert.equal(server.targets.length,2);transport.close();assert.equal(transport.streams.size,0);
 }finally{transport.close();await server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('MySQL SSH rejects untrusted server keys and bad authentication without exposing provider details',async()=>{
 const s=await sshFixture();try{for(const [verifier,password] of [[()=>()=>false,'fixture-only'],[s.verify,'wrong']]){const t=new MysqlSshTransport(verifier,()=>{});try{await assert.rejects(t.connect({...s.config,sshPassword:password}),/MySQL SSH connection failed/);}finally{t.close();}}}finally{await s.close();}
});
function clientFixture({failAt=0}={}){
 const options=[],streams=[],closed=[],callbacks=[];let invalidated=0;
 class Transport{constructor(verifier,lost){callbacks.push({verifier,lost});}async connect(){}async open(){const stream={destroy(){closed.push('stream');}};streams.push(stream);return stream;}close(){closed.push('ssh');}}
 const Client=loadModule('electron/mysql/mysqlClient.js',{'./sshTransport':{MysqlSshTransport:Transport},'./transactionState':{observeTransactionState:()=>({invalidate(){invalidated++;},verifyCapabilities(){},get:()=>({transactionStatus:'idle'})})},mysql2:{createConnection:option=>{options.push(option);const number=options.length,connection=new EventEmitter();connection.destroy=()=>closed.push(number);connection.promise=()=>({connect:async()=>{if(number===failAt)throw Object.assign(new Error('sentinel-secret'),{code:'ER_ACCESS_DENIED_ERROR'});},end:async()=>closed.push(number),query:async sql=>sql.includes('default_storage_engine')?[[['8.4.13','','InnoDB']]]:sql.includes('lower_case_table_names')?[[['8.4.13','+00:00','','utf8mb4','utf8mb4_0900_ai_ci','0']]]:[]});return connection;}}},{},{strict:false});
 return {Client,options,streams,closed,callbacks,get invalidated(){return invalidated;}};
}
test('MySQL SSH preserves the remote TLS hostname, verifier and three distinct connection channels',async()=>{
 const f=clientFixture(),verifier=()=>()=>false,c=new f.Client({createSshHostVerifier:verifier});await c.connect({host:'database.example.test',database:'demo',user:'test',useSshTunnel:true,mysqlSslMode:'verify-full'});assert.equal(f.options.length,3);assert.equal(new Set(f.options.map(o=>o.stream)).size,3);assert.ok(f.options.every(o=>o.host==='database.example.test'&&o.ssl.verifyIdentity&&o.ssl.rejectUnauthorized&&o.multipleStatements===false));assert.equal(f.callbacks[0].verifier,verifier);f.callbacks[0].lost();assert.equal(f.invalidated,1);await c.disconnect();assert.ok(f.closed.includes('ssh'));
});
test('MySQL SSH failed database handshake closes all created connections and the transport without leaking credentials',async()=>{
 const f=clientFixture({failAt:2}),c=new f.Client();await assert.rejects(c.connect({host:'localhost',database:'demo',user:'test',useSshTunnel:true}),error=>!error.message.includes('sentinel-secret')&&error.message.includes('ER_ACCESS_DENIED_ERROR'));assert.equal(c.connections.length,0);assert.ok(f.closed.includes(1)&&f.closed.includes(2)&&f.closed.includes('ssh'));
});
