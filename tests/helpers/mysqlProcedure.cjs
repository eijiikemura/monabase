// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {loadTypeScript}=require('./loadTypeScript.cjs');const {createHookHarness}=require('./renderHook.cjs');
async function mysqlProcedure(invoke,overrides={}){
  const h=createHookHarness({doubleUpdates:true}),calls=[],states=[],changes=[],alerts=[],window=new EventTarget();window.confirm=()=>false;window.alert=v=>alerts.push(v);
  const deps={'../table/tableModel':loadTypeScript('src/features/mysql/table/tableModel.ts'),react:h.react,'react-i18next':{useTranslation:()=>({t:k=>k})},'@/shared/api/desktop':{ipcRenderer:{invoke:async(...args)=>{calls.push(args);return invoke(...args);}}}};
  const mod=loadTypeScript('src/features/mysql/procedure/useMysqlProcedure.ts',deps,{window,Event,CustomEvent,Error});
  const props={schema:'mb_test',tabId:1,active:true,setDdlBusy(){},busy:false,readonly:false,disabled:false,setBusy(){},onState:v=>states.push(v),onChanged:v=>changes.push(v),onDropped:()=>changes.push('drop'),...overrides};let state;
  const render=()=>state=h.render(()=>mod.useMysqlProcedure(props));const flush=async()=>{for(let i=0;i<5;i++){render();h.commit();await h.settle();}return render();};
  const waitFor=async p=>{const end=Date.now()+10000;do{await flush();if(p(state))return state;await new Promise(r=>setTimeout(r,5));}while(Date.now()<end);throw new Error('MySQL procedure state did not settle: '+state.error);};
  await flush();return {get state(){return state;},props,calls,states,changes,alerts,flush,waitFor,unmount:h.unmount};
}
module.exports={mysqlProcedure};
