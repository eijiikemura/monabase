// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {Server,utils}=require('ssh2'),{generateKeyPairSync,createHash}=require('node:crypto'),net=require('node:net');
const key=()=>generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
async function sshFixture({forward=false}={}){
 const hostKey=key(),privateKey=key(),publicKey=utils.parseKey(privateKey).getPublicSSH(),clients=new Set(),sockets=new Set(),targets=[];
 const server=new Server({hostKeys:[hostKey]},client=>{
  clients.add(client);client.on('error',()=>{});client.once('close',()=>clients.delete(client));
  client.on('authentication',ctx=>{if(ctx.username!=='fixture')return ctx.reject();if(ctx.method==='password'&&ctx.password==='fixture-only')return ctx.accept();if(ctx.method==='publickey'&&ctx.key.data.equals(publicKey)&&(!ctx.signature||utils.parseKey(privateKey).verify(ctx.blob,ctx.signature,ctx.hashAlgo)))return ctx.accept();ctx.reject();});
  client.on('ready',()=>client.on('tcpip',(accept,reject,info)=>{
   targets.push([info.destIP,info.destPort]);if(forward&&(info.destIP!=='localhost'&&info.destIP!=='127.0.0.1'||info.destPort!==13306))return reject();
   if(!forward){const stream=accept();stream.on('error',()=>{});stream.on('data',data=>stream.write(data));return;}
   const socket=net.connect(13306,'127.0.0.1');sockets.add(socket);socket.on('error',()=>{try{reject();}catch{}});socket.once('close',()=>sockets.delete(socket));socket.once('connect',()=>{const stream=accept();stream.on('error',()=>socket.destroy());stream.on('close',()=>socket.destroy());socket.on('error',()=>stream.destroy());socket.pipe(stream);stream.pipe(socket);});
  }));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const fingerprint='SHA256:'+createHash('sha256').update(utils.parseKey(hostKey).getPublicSSH()).digest('base64').replace(/=+$/,'');
 return {server,clients,targets,privateKey,fingerprint,config:{useSshTunnel:true,sshHost:'127.0.0.1',sshPort:String(server.address().port),sshUser:'fixture',sshAuthType:'password',sshPassword:'fixture-only'},verify:()=> (key,callback)=>callback('SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'')===fingerprint),close:async()=>{for(const c of clients)c.end();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={sshFixture};
