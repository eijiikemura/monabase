// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function mysqlEr(invoke, { mode = 'custom', ...overrides } = {}) {
  const hook=createHookHarness({doubleUpdates:true}),calls=[],alerts=[],store=new Map();const t=key=>key;
  const globals={alert:value=>alerts.push(value),localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},
    window:{addEventListener(){},removeEventListener(){},confirm:()=>true,innerHeight:1000},document:{body:{style:{},appendChild(){}},getElementById:()=>({remove(){},innerHTML:''}),createElement:()=>({click(){},style:{}})}};
  const dependencies={react:hook.react,'react-i18next':{useTranslation:()=>({t})},reactflow:{applyNodeChanges:(changes,nodes)=>nodes.flatMap(node=>{const change=changes.find(change=>change.id===node.id);return change?.type==='remove'?[]:[{...node,...(change?.position?{position:change.position,dragging:change.dragging}:{}),...(change?.type==='select'?{selected:change.selected}:{})}];}),applyEdgeChanges:(changes,edges)=>edges.filter(edge=>!changes.some(change=>change.type==='remove'&&change.id===edge.id)),getNodesBounds:()=>({x:0,y:0,width:500,height:500})},
    'html-to-image':{toPng:async()=> 'data:image/png;base64,test'},'../postgresql/windows/common/schemaStorage':{getPgSelectSchema:()=>'',savePgSelectSchema(){}},
    '@/shared/api/desktop':{ipcRenderer:{invoke:async(...args)=>{calls.push(args);return invoke(...args);}}}};
  dependencies['./erDocument']=loadTypeScript('src/features/er/erDocument.ts');
  dependencies['./formatDataType']=loadTypeScript('src/features/er/formatDataType.ts');
  dependencies['./erMetadata']=loadTypeScript('src/features/er/erMetadata.ts',dependencies,globals);
  dependencies['./useErDiagramWindow']=loadTypeScript('src/features/er/useErDiagramWindow.ts',dependencies,globals);
  const controller=mode==='custom'?loadTypeScript('src/features/er/useCustomErDiagram.ts',dependencies,globals).useCustomErDiagram:dependencies['./useErDiagramWindow'].useErDiagramWindow;
  const props={dbType:'mysql',isActive:true,schemas:['mb_test'],initialSchema:'mb_test',tabId:1,...overrides};let state;
  const render=()=>state=hook.render(()=>controller(props));
  const flush=async()=>{for(let i=0;i<6;i++){render();hook.commit();await hook.settle();}return render();};
  const waitFor=async predicate=>{const end=Date.now()+10000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<end);throw new Error('MySQL ER state did not settle: '+alerts.join('\n'));};
  await flush();return {get state(){return state;},props,calls,alerts,flush,waitFor,unmount:hook.unmount,diagram:dependencies['./useErDiagramWindow'].fetchErDiagramData};
}
module.exports={mysqlEr};
