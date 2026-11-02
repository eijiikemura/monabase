// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {loadTypeScript}=require('./loadTypeScript.cjs');
const {createHookHarness}=require('./renderHook.cjs');
const {postgresLockFixture}=require('./postgresLockData.cjs');
async function createPostgresSessionHarness(invoke,options={}){
 const hook=createHookHarness({doubleUpdates:true}),confirmations=[],timers=new Map();let timerId=0;
 const {useSessionTab}=loadTypeScript('src/features/postgresql/windows/dba/useSessionTab.ts',{react:hook.react,'react-i18next':{useTranslation:()=>({t:(key,values)=>key+JSON.stringify(values||{})})},'@/shared/api/desktop':{ipcRenderer:{invoke}}},{window:{confirm:message=>{confirmations.push(message);return options.confirm?.(message)??true;}},setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id)});
 let active=true,state;const render=()=>state=hook.render(()=>useSessionTab(active));
 async function flush(){for(let i=0;i<4;i++){render();hook.commit();await hook.settle();}return render();}
 async function waitFor(predicate){const deadline=Date.now()+10000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);throw Error('PostgreSQL session state timed out: '+state.error+' '+state.errorCode);}
 await flush();return{get state(){return state;},flush,waitFor,confirmations,timers,updateActive:value=>{active=value;},unmount:()=>hook.unmount()};
}
function postgresSessionFixture(overrides={}){return postgresLockFixture({state_change:'2026-10-27 01:00:00+00',query_seconds:'9007199254740993.000001',transaction_seconds:'3600.000001',state_seconds:'2.000001',client_port:32000,...overrides});}
module.exports={createPostgresSessionHarness,postgresSessionFixture};
