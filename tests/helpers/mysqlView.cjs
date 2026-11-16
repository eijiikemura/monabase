// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
function viewModules(invoke) {
  const dependencies = { '@/shared/api/desktop': { ipcRenderer: { invoke } } };
  const model = loadTypeScript('src/features/mysql/view/viewModel.ts',dependencies,{Error});
  const repository = loadTypeScript('src/features/mysql/view/viewRepository.ts',dependencies,{Error});
  return { dependencies, model, repository };
}
async function mysqlView(invoke, overrides={}, load) {
  const h=createHookHarness({doubleUpdates:true}),calls=[],changes=[],states=[],alerts=[],events=new EventTarget(); events.confirm=()=>false; events.alert=message=>alerts.push(message);
  const {dependencies,model,repository}=viewModules(async(...args)=>{calls.push(args);return invoke(...args);});
  const globals={Error,Event,CustomEvent,window:events};
  const transfer=loadTypeScript('src/features/mysql/sidebarDataTransfer.ts',{...dependencies,'@/features/data-grid/dataGridHelper':{},'@/features/table/importData':{},'./table/tableRepository':{},'./table/tableModel':{}},globals);
  const controller=loadTypeScript('src/features/mysql/view/useMysqlView.ts',{...dependencies,react:h.react,'react-i18next':{useTranslation:()=>({t:key=>key})},'./viewRepository':load?{loadMysqlView:load}:repository,'./viewModel':model,'../sidebarDataTransfer':transfer,'../table/tableModel':loadTypeScript('src/features/mysql/table/tableModel.ts')},globals);
  const object={dbType:'mysql',schema:'mb_test',category:'VIEW',name:'demo',displayName:'demo',key:'demo'};
  const props={object,tabId:1,active:true,busy:false,readonly:false,disabled:false,settings:{outputDateFormat:'YYYY/MM/DD HH:mm:ss',inputDateFormat:'YYYY-MM-DD',theme:'simple'},setBusy(){},onState:value=>states.push(value),onDropped:()=>changes.push('drop'),...overrides};let state;
  const render=()=>state=h.render(()=>controller.useMysqlView(props));
  const flush=async()=>{for(let i=0;i<5;i++){render();h.commit();await h.settle();}return render();};
  const waitFor=async predicate=>{const end=Date.now()+12000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,5));}while(Date.now()<end);throw new Error('MySQL view state did not settle: '+state.error);};
  await flush();return {get state(){return state;},props,calls,changes,states,alerts,events,flush,waitFor,unmount:h.unmount,model,repository};
}
module.exports={viewModules,mysqlView};
