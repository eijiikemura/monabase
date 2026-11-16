// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto'),fs=require('node:fs');
const Client=require('../../electron/mysql/mysqlClient');
async function startDatabaseSandbox(){
 if(process.env.MONABASE_MYSQL_DATABASE_DISPOSABLE!=='1')throw new Error('Explicit isolated database-management environment opt-in is required.');
 const name='monabase-database-'+randomBytes(6).toString('hex'),image=fs.readFileSync(require('node:path').resolve(__dirname,'../fixtures/mysql/compose.yml'),'utf8').match(/image:\s+(mysql:[^\s]+)/)?.[1];if(!image)throw new Error('Pinned MySQL image unavailable.');
 const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:120000,env:{...process.env,MYSQL_ROOT_PASSWORD:'disposable_database_test_only'}});if(r.status!==0)throw new Error('Dedicated MySQL container command failed.');return r.stdout.trim();};
 let owned=false,client;const remove=()=>{if(owned){docker(['rm','-f',name]);owned=false;}};process.once('exit',remove);const close=async()=>{try{await client?.disconnect();}finally{remove();process.removeListener('exit',remove);}};
 try{docker(['run','--rm','-d','--name',name,'-p','127.0.0.1::3306','--env','MYSQL_ROOT_PASSWORD','--tmpfs','/var/lib/mysql',image,'--skip-log-bin']);owned=true;
 const address=docker(['port',name,'3306/tcp']);if(!/^127\.0\.0\.1:\d+$/.test(address))throw new Error('The dedicated MySQL service must bind only to loopback.');const port=address.split(':')[1];
 for(let attempt=0;attempt<90;attempt++){client=new Client();try{await client.connect({host:'127.0.0.1',port,database:'mysql',user:'root',password:'disposable_database_test_only'});return {client,close,connection:{host:'127.0.0.1',port,database:'mysql',user:'root',password:'disposable_database_test_only'}};}catch{await client.disconnect().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,500));}}
 throw new Error('The dedicated MySQL service did not become ready.');
 }catch(error){await close();throw error;}
}
module.exports={startDatabaseSandbox};
