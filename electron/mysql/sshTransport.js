// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {Client}=require('ssh2');
const {readCredentialFile}=require('../services/credentialFiles');
const {connectVerifiedSsh}=require('../services/sshHostKeys');
class MysqlSshTransport {
 constructor(createVerifier,onLost){this.createVerifier=createVerifier;this.onLost=onLost;this.streams=new Set();this.closed=false;}
 async connect(config){
  const port=Number(config.sshPort||22),host=typeof config.sshHost==='string'?config.sshHost.trim():'';
  if(!host||!config.sshUser||!Number.isInteger(port)||port<1||port>65535||!['password','key'].includes(config.sshAuthType||'password'))throw new Error('MySQL SSH host, port or authentication settings are invalid.');
  const options={host,port,username:config.sshUser,readyTimeout:30000,keepaliveInterval:5000,keepaliveCountMax:3};
  if(config.sshAuthType==='key'){options.privateKey=await readCredentialFile(config.sshKeyFile,'ssh-private-key');if(config.sshPassword)options.passphrase=config.sshPassword;}
  else{options.password=config.sshPassword||'';options.tryKeyboard=true;}
  this.client=new Client();
  this.client.on('keyboard-interactive',(_name,_instructions,_language,prompts,finish)=>finish(config.sshAuthType==='key'?[]:prompts.map(()=>config.sshPassword||'')));
  await new Promise((resolve,reject)=>{
   let ready=false;const fail=()=>{if(!ready)reject(new Error('MySQL SSH connection failed. Check authentication and the trusted server key.'));if(!this.closed)this.onLost();};
   this.client.once('ready',()=>{ready=true;resolve();});this.client.on('error',fail);this.client.on('close',fail);
   try{connectVerifiedSsh(this.client,options,this.createVerifier,key=>key);}catch{reject(new Error('MySQL SSH connection failed.'));}
  });
 }
 async open(host,port){
  if(this.closed)throw new Error('MySQL SSH connection is closed.');
  return new Promise((resolve,reject)=>{
   let settled=false;const timeout=setTimeout(()=>{settled=true;reject(new Error('MySQL SSH forwarding timed out.'));},10000);timeout.unref?.();
   this.client.forwardOut('127.0.0.1',0,host,port,(error,stream)=>{
    clearTimeout(timeout);if(settled||this.closed){stream?.destroy();if(!settled)reject(new Error('MySQL SSH connection is closed.'));return;}settled=true;
    if(error){reject(new Error('MySQL SSH forwarding failed. Check the database address from the SSH server.'));return;}
    this.streams.add(stream);stream.on('error',()=>{});stream.once('close',()=>this.streams.delete(stream));resolve(stream);
   });
  });
 }
 close(){this.closed=true;for(const stream of this.streams)stream.destroy();this.streams.clear();this.client?.destroy();}
}
module.exports={MysqlSshTransport};
