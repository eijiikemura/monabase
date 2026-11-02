// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { app, BrowserWindow, ipcMain } = require('electron');
const { inspectSqlPrivacy } = require('../../electron/services/sqlPrivacy');
ipcMain.handle('inspect-sql-privacy', (_event, statements, dialect) => statements.map(sql => inspectSqlPrivacy(sql, dialect)));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// Exercise actual React/Electron rendering with deterministic IPC responses, without a real DB or AI service.
const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ui-'));
app.setPath('userData', path.join(temporary, 'userdata'));
const preload = path.join(temporary, 'preload.cjs');
fs.writeFileSync(preload, `
const { contextBridge, ipcRenderer } = require('electron');
const dbType = process.argv.find(arg => arg.startsWith('--test-db=')).split('=')[1];
const queries = [];
const triggerSaves = [];
let triggerPickerActive = false, failTriggerSource = false;
const oracleTriggerHeader = 'TRIGGER "DEMO"."UI_TRG_0" BEFORE UPDATE OF "AMOUNT" ON "DEMO"."UI_ITEM_0" FOR EACH ROW WHEN (NEW."AMOUNT" > 0) ';
const oracleTrigger = { TRIGGER_TYPE: 'BEFORE EACH ROW', TRIGGERING_EVENT: 'UPDATE', TABLE_OWNER: 'DEMO', TABLE_NAME: 'UI_ITEM_0',
  BASE_OBJECT_TYPE: 'TABLE', REFERENCING_NAMES: 'REFERENCING NEW AS NEW OLD AS OLD', WHEN_CLAUSE: 'NEW."AMOUNT" > 0',
  STATUS: 'DISABLED', ACTION_TYPE: 'PL/SQL', CROSSEDITION: 'NO', header: oracleTriggerHeader, headerLines: 0,
  body: 'BEGIN NULL; END;', source: oracleTriggerHeader + 'BEGIN NULL; END;', editable: true, updateColumns: ['AMOUNT'], errors: [] };
let sqlActive = false, sqlFile = '', sqlCalls = [], sqlSaved, sqlSaveAttempts = 0, finishSql;
let qbAiRequests = 0;
const qbAiPayloads = [];
let clipboardMode = 'success';
const copiedCellTexts = [];
let qbActive = false, qbExecutions = 0, qbSaveAttempts = 0, qbSaved, finishQb;
const qbTable = (id, name) => ({ id, name: '"DEMO"."' + name + '"', columns: ['ID', 'K', 'AMOUNT'], x: id === 'qa' ? 20 : 300, y: 20 });
const qbA = qbTable('qa', 'QB_A'), qbB = qbTable('qb', 'QB_B');
const qbDocument = { version: 1, dbType, selectedSchema: 'DEMO', queryTables: [qbB, qbA],
  queryFields: [{ id: 'f', tableId: 'qa', tableName: qbA.name, columnName: 'AMOUNT', sort: '', criteria: '', orCriteria: '', show: true, groupBy: '' }],
  queryJoins: ['ID', 'K'].map((column, index) => ({ id: 'j' + index, fromTableId: 'qa', fromCol: column, toTableId: 'qb', toCol: column, joinType: 'LEFT' })) };
let erActive = false, erPickerActive = false, generatorPickerActive = false;
let erSaved;
let indexActive = false, failIndex = false;
let synonymTarget = 'UI_ITEM_0', failSynonymRead = false, failSynonymSource = false, synonymPicker = false;
let mviewPopulated = false, mviewMethod = 'COMPLETE', failMviewRead = false;
let failLogRead = false, logInclude = true, logPickerActive = false;
let failDbLinkRead = false, dbLinkExists = true, dbLinkRevision = 1, failDbLinkRecreate = false;
let dbLinkHost = 'server/service', dbLinkTests = 0;
const dbLinkWrites = [];
let oraUserFailList=true,oraUserFailDetail=true,oraUserFailWrite=true;
const oraUserWrites=[],oraUserReviews=[];
const oraPrincipal=(name,identity,kind='USER',self=false)=>({identity,id:identity,name,kind,created:'2026-01-01',status:kind==='USER'?'EXPIRED':null,locked:kind==='USER'?false:null,authentication:kind==='USER'?'PASSWORD':'NONE',common:false,maintained:false,self,protected:self,profile:'DEFAULT',defaultTablespace:'USERS',temporaryTablespace:'TEMP',expiry:'2026-10-01',canPassword:kind==='USER',canLock:kind==='USER'&&!self,canDrop:!self,canQuota:kind==='USER'&&!self,fingerprint:'oracle-user-'+identity});
const oraUserSnapshot=()=>({principals:[oraPrincipal('TEST','OR_SELF','USER',true),oraPrincipal('AppUser','OR_USER'),oraPrincipal('Readers','OR_ROLE','ROLE')],grants:[],context:{database:'FREE',containerId:'3',container:'FREEPDB1',user:'TEST',readonly:false,scope:'all',modern:true,maxNameBytes:128,privileges:['ALTER USER'],canCreateUser:true,canCreateRole:true},fetchedAt:'2026-10-27T00:00:00Z'});
const oraUserDetail=input=>({target:oraUserSnapshot().principals.find(row=>row.identity===input.identity),grants:[{grantee:input.name,name:'CREATE SESSION',kind:'SYSTEM',admin:false,defaultRole:null,common:false,inherited:false,canRevoke:true}],effective:[{grantee:'PUBLIC',source:'PUBLIC',name:'CREATE TABLE',kind:'SYSTEM',admin:false,common:false,inherited:false,direct:false}],candidates:Array.from({length:102},(_,i)=>({kind:'ROLE',name:'CANDIDATE_'+String(i).padStart(3,'0')})),related:[],dependencies:[{owner:input.name,name:'ORDERS',kind:'TABLE',relation:'OWNED'}],dependencyCount:1,dependenciesTruncated:false,dependenciesError:'',quotas:[{tablespace:'USERS',usedBytes:'9007199254740993123',maxBytes:'1048577'}],quotaError:'',unlimited:false,fingerprint:'ora-detail-'+input.identity,fetchedAt:'2026-10-27T00:00:00Z'});
let pgRoleFailRead=true,pgRoleFailDetail=true,pgRoleFailWrite=true;
const pgRoleWrites=[],pgRoleReviews=[];
const pgRoleRow=(oid,name,extra={})=>({oid,identity:'role-'+oid,name,login:true,superuser:false,createDatabase:false,createRole:false,inherit:true,replication:false,bypassRls:false,connectionLimit:-1,validUntil:null,settings:[],system:name.startsWith('pg_'),self:oid==='100',protected:oid==='100'||name.startsWith('pg_'),canPassword:!name.startsWith('pg_'),canLogin:oid!=='100'&&!name.startsWith('pg_'),canSuperuser:oid!=='100'&&!name.startsWith('pg_'),canDrop:oid!=='100'&&!name.startsWith('pg_'),actorAdmin:true,actorUsable:true,fingerprint:'role-fingerprint-'+oid,...extra});
const pgRoleSnapshot=()=>({roles:[pgRoleRow('200','AppUser'),pgRoleRow('100','DEMO',{superuser:true}),pgRoleRow('600','pgx'),pgRoleRow('500','pg_monitor'),pgRoleRow('10','bootstrap',{superuser:true}),...Array.from({length:102},(_,i)=>pgRoleRow(String(300+i),'GROUP_'+String(i).padStart(3,'0'),{login:false}))],memberships:[{roleId:'300',memberId:'200',grantorId:'10',admin:false,inherit:true,set:true}],context:{database:'demo',databaseId:'5',user:'DEMO',userId:'100',sessionUserId:'100',readonly:false,version:160000,maxIdentifierLength:63,canCreate:true,scope:'cluster'},fetchedAt:'2026-10-27T00:00:00Z'});
const pgRoleDetail=input=>({role:pgRoleSnapshot().roles.find(row=>row.oid===input.oid),memberships:input.oid==='200'?[{roleId:'300',memberId:'200',grantorId:'10',admin:false,inherit:true,set:true,canRevoke:true}]:[],members:[],effectiveRoles:input.oid==='200'?[{oid:'300',name:'GROUP_000',member:true,usable:true,settable:true,direct:true},{oid:'301',name:'GROUP_001',member:true,usable:false,settable:true,direct:false}]:[],candidates:Array.from({length:102},(_,i)=>({oid:String(300+i),name:'GROUP_'+String(i).padStart(3,'0'),grantorIds:['10']})),dependencies:[],dependencyCount:0,dependenciesTruncated:false,fingerprint:'role-detail-'+input.oid,fetchedAt:'2026-10-27T00:00:00Z'});
let pgTsFailRead=true,pgTsFailDetail=true,pgTsName='UI_SPACE',pgTsFailWrite=true;
const pgTsWrites=[];
const pgTsRow=(name=pgTsName,oid='60')=>({oid,identity:'ts-'+oid,name,ownerId:'10',owner:'DEMO',location:oid==='60'?'/srv/ui':null,locationKind:oid==='60'?'custom':'default',options:[],protected:oid!=='60',canRename:oid==='60',canDrop:oid==='60',canChangeOwner:oid==='60',fingerprint:'ts-'+name});
const pgTsSnapshot=()=>({tablespaces:[pgTsRow(),pgTsRow('pg_default','1663')],principals:[{id:'10',name:'DEMO',login:true,superuser:true,usable:true,settable:true,kind:'user'}],context:{database:'demo',databaseId:'5',user:'DEMO',userId:'10',readonly:false,version:160000,maxIdentifierLength:63,defaultId:'1663',canCreate:true,scope:'cluster'},fetchedAt:'2026-10-27T00:00:00Z'});
const pgTsDetail=input=>({tablespace:pgTsRow(input.name,input.oid),bytes:'900719925474099312345',sizeError:'',databases:[],databasesError:'',objects:[],objectCount:0,objectsTruncated:false,ownerCandidates:['10'],fingerprint:'detail-'+pgTsName,fetchedAt:'2026-10-27T00:00:00Z'});
let pgSessionFailRead=true,pgSessionStatus='active',pgSessionPresent=true,pgSessionFailSignal=true,pgSessionReadonly=false;
const pgSessionCommands=[];
const pgSessionRow=(pid,state='idle',protectedTarget=false,databaseId='5',visibility='visible')=>({id:'PG_SESSION_'+pid,fingerprint:'pg-session-'+pid+'-'+state,pid,backendStart:'2026-10-27 01:00:00.000001+00',queryStart:'2026-10-27 02:00:00.000001+00',transactionStart:state?.includes('transaction')?'2026-10-27 01:10:00+00':null,stateChangedAt:'2026-10-27 02:00:01+00',userId:'100',databaseId,database:databaseId==='5'?'demo':'other_database',username:'DEMO',program:'session fixture',address:'127.0.0.1',port:32000,backendType:'client backend',state,waitType:state==='active'?'Lock':null,waitEvent:state==='active'?'transactionid':null,blockers:[],query:visibility==='visible'?'UPDATE DEMO.SESSION_DEMO SET VALUE=1':null,queryVisibility:visibility,querySeconds:state==='active'?'9007199254740993.000001':null,transactionSeconds:state?.includes('transaction')?'3600.000001':null,stateSeconds:'2.000001',protected:protectedTarget,canTerminate:!protectedTarget&&!pgSessionReadonly,canCancel:state==='active'&&!protectedTarget&&visibility==='visible'&&!pgSessionReadonly});
const pgSessionSnapshot=()=>({sessions:[pgSessionRow(900,'idle',true),pgSessionRow(901,'idle in transaction'),...(pgSessionPresent?[pgSessionRow(902,pgSessionStatus)]:[]),pgSessionRow(903,'active',false,'6'),pgSessionRow(904,null,true,'5','restricted')],context:{database:'demo',databaseId:'5',readonly:pgSessionReadonly,protectionReady:true,scope:'cluster'},fetchedAt:'2026-10-27T02:00:00Z'});
let schemaActive=false,schemaFailRead=true,schemaFailDetail=false,schemaFailMutation=true,schemaName='DEMO',schemaRevision=1;
const schemaWrites=[],schemaAclWrites=[];
const schemaPrincipals=()=>pgPrivRoles.map(role=>({...role,databaseCreate:role.id==='10'}));
const schemaAclGrants=[{grantee_id:'10',grantor_id:'10',privilege:'USAGE',grantable:false,source:'default',canRevoke:true},{grantee_id:'10',grantor_id:'10',privilege:'CREATE',grantable:false,source:'default',canRevoke:true},{grantee_id:'0',grantor_id:'10',privilege:'USAGE',grantable:false,source:'default',canRevoke:true}];
const schemaRow=(name=schemaName,oid='50')=>({oid,identity:'schema-'+oid,name,ownerId:'10',owner:'DEMO',system:name==='pg_catalog',protected:['public','pg_catalog'].includes(name),extensionOwned:false,issuerId:'10',canDrop:!['public','pg_catalog'].includes(name),canRename:!['public','pg_catalog'].includes(name),canChangeOwner:!['public','pg_catalog'].includes(name),fingerprint:'schema-'+schemaRevision});
const schemaSnapshot=()=>({schemas:[schemaRow(),schemaRow('pgx','51'),schemaRow('toast','52'),schemaRow('public','53'),schemaRow('pg_catalog','54')],principals:schemaPrincipals(),context:{...pgPrivContext,canCreate:true,maxIdentifierLength:63},fetchedAt:'2026-10-27T00:00:00Z'});
const schemaObject=(schema=schemaName,type='table',identity='DEMO.ORDERS')=>({class_id:'1259',object_id:type==='view'?'61':'60',sub_id:0,type,schema,name:identity,identity,total:'3'});
const schemaAcl=()=>({object:{...pgPrivObject(schemaName,'SCHEMA','','50'),schema:schemaName,label:schemaName},ownerId:'10',owner:'DEMO',context:pgPrivContext,principals:pgPrivRoles,grants:schemaAclGrants,columnGrants:[],privileges:['CREATE','USAGE'],effective:pgPrivRoles.filter(role=>role.id!=='0').flatMap(role=>['CREATE','USAGE'].map(privilege=>({principal_id:role.id,privilege,effective:schemaAclGrants.some(grant=>grant.privilege===privilege&&[role.id,'0'].includes(grant.grantee_id)),column_effective:false,schema_usage:true,sources:schemaAclGrants.filter(grant=>grant.privilege===privilege&&[role.id,'0'].includes(grant.grantee_id)).map(grant=>grant.grantee_id)}))),grantors:{USAGE:['10'],CREATE:['10']},fingerprint:'schema-acl-'+schemaRevision,fetchedAt:'2026-10-27T00:00:00Z'});
const schemaDetail=target=>({schema:schemaSnapshot().schemas.find(row=>row.oid===target.oid),privileges:schemaAcl(),ownerCandidates:['10'],objects:[schemaObject()],objectCount:1,dependencies:[schemaObject(),schemaObject('other','view','other.LINKED')],dependencyCount:2,dependenciesTruncated:false,fingerprint:'schema-detail-'+schemaRevision,fetchedAt:'2026-10-27T00:00:00Z'});
let pgPrivFailPeople=true, pgPrivFailDetail=false, pgPrivFailMutation=true, pgPrivRevision=1;
const pgPrivWrites=[];
const pgPrivRoles=[{id:'0',name:'PUBLIC',kind:'public',login:false,superuser:false,usable:false,settable:false},{id:'10',name:'DEMO',kind:'user',login:true,superuser:false,usable:true,settable:true},{id:'20',name:'reader',kind:'role',login:false,superuser:false,usable:false,settable:false},{id:'30',name:'inherited_user',kind:'user',login:true,superuser:false,usable:false,settable:false}];
const pgPrivContext={database:'demo',databaseId:'5',user:'DEMO',userId:'10',readonly:false,version:160000};
const pgPrivObject=(name='UI_PRIV_TARGET',type='TABLE',args='',oid='50')=>({type,oid,schema:'DEMO',name,databaseId:'5',identity:type+oid+args,args,label:'DEMO.'+name+(type==='FUNCTION'?'('+args+')':'')});
const pgPrivGrants=[{grantee_id:'10',grantor_id:'10',privilege:'SELECT',grantable:false,source:'default',canRevoke:true},{grantee_id:'0',grantor_id:'10',privilege:'SELECT',grantable:false,source:'default',canRevoke:true}];
const pgPrivDetail=object=>{const privileges=object.type==='FUNCTION'?['EXECUTE']:['SELECT','UPDATE'];const grants=object.type==='FUNCTION'?[{grantee_id:'0',grantor_id:'10',privilege:'EXECUTE',grantable:false,source:'default',canRevoke:true}]:pgPrivGrants;return {object,ownerId:'10',owner:'DEMO',context:pgPrivContext,principals:pgPrivRoles,grants,columnGrants:object.type==='TABLE'?[{column:'LABEL',grantee_id:'20',grantor_id:'10',privilege:'UPDATE',grantable:false}]:[],privileges,effective:pgPrivRoles.filter(role=>role.id!=='0').flatMap(role=>privileges.map(privilege=>({principal_id:role.id,privilege,effective:grants.some(grant=>grant.privilege===privilege&&[role.id,'0'].includes(grant.grantee_id)),column_effective:role.id==='20'&&privilege==='UPDATE',schema_usage:true,sources:grants.filter(grant=>grant.privilege===privilege&&[role.id,'0'].includes(grant.grantee_id)).map(grant=>grant.grantee_id)}))),grantors:Object.fromEntries(privileges.map(privilege=>[privilege,['10']])),fingerprint:'pg-priv-'+object.identity+'-'+pgPrivRevision,fetchedAt:'2026-10-27T00:00:00Z'}};
let pgLockFailRead=true, pgLockHolder=true;
const pgLockCommands=[];
const pgLockRow=(pid,granted,protectedTarget=false)=>({id:'PG_LOCK_'+pid,fingerprint:'pg-lock-fp-'+pid,pid,backendStart:'2026-10-26 01:00:00+00',queryStart:'2026-10-26 02:00:00+00',userId:'100',databaseId:'5',database:'demo',username:'test',program:'ui lock fixture',address:'127.0.0.1',backendType:'client backend',state:granted?'idle in transaction':'active',kind:'transactionid',mode:granted?'ExclusiveLock':'ShareLock',granted,schema:null,object:null,relationId:null,transactionId:'9007199254740993',query:'UPDATE DEMO.ORDERS SET TOTAL=1',querySeconds:'9007199254740993.000001',waitType:'Lock',waitEvent:'transactionid',transactionStart:'2026-10-26 01:55:00+00',blockers:granted||!pgLockHolder?[]:[802],waiters:pid===802?1:0,protected:protectedTarget,canTerminate:!protectedTarget,canCancel:!protectedTarget&&!granted});
const pgLockSnapshot=()=>({locks:[pgLockRow(800,true,true),pgLockRow(801,false),...(pgLockHolder?[pgLockRow(802,true)]:[])],context:{database:'demo',databaseId:'5',readonly:false,protectionReady:true,scope:'cluster'},fetchedAt:'2026-10-26T02:00:00Z'});
let tsFailRead=true, tsSize='512', tsAuto=true, tsReviewCounter=0;
const tsWrites=[];
const tsRow=(name='UI_BIG')=>({id:name,fingerprint:name+tsSize+tsAuto,name,kind:name==='TEMP'?'TEMPORARY':'PERMANENT',status:'ONLINE',bigfile:name==='UI_BIG',blockSize:8192,protected:name!=='UI_BIG',dropProtected:name!=='UI_BIG',allocatedMb:tsSize,usedMb:'100',freeMb:'412',maxMb:'2048',usedPercent:19.53});
const tsSnapshot=()=>({tablespaces:[tsRow(),tsRow('TEMP'),tsRow('SYSTEM')],files:[tsFile()],context:{database:'UI',container:'3',containerName:'PDB',instance:'1',readonly:false,scope:'all',canCreate:true,canAlter:true,canDrop:true,omf:true,blockSize:8192,protectionReady:true},fetchedAt:'2026-10-26T02:00:00Z'});
const tsFile=()=>({id:'ui-file',fileId:'10',creationId:'99',tablespace:'UI_BIG',path:'/demo/ui_big.dbf',kind:'DATAFILE',bytes:String(BigInt(tsSize)*1048576n),sizeMb:tsSize,autoExtend:tsAuto,maxBytes:tsAuto?'2147483648':null,maxMb:tsAuto?'2048':null,nextBytes:'16777216',nextMb:'16',online:true});
const tsDetail=()=>({target:tsRow(),files:[tsFile()],users:[],quotas:[],segments:[],segmentCount:0,fetchedAt:'2026-10-26T02:00:00Z'});
let sessionFailRead=true, sessionFailDetail=false;
const sessionCommands=[];
let uiSessionStatus='ACTIVE';
const sessionRow=(own=false)=>({id:own?'OWN_SESSION':'UI_SESSION',fingerprint:own?'own-fp':'ui-fp',execution:'sql-exec-1',protected:own,SID:own?601:602,SERIAL:own?701:702,INSTANCE_ID:1,CON_ID:3,USERNAME:own?'DEMO':'APP_USER',PROGRAM:'ui-test',MACHINE:'fixture',OSUSER:'fixture',LOGON_TIME:'2026-10-26 00:00:00',STATUS:own?'INACTIVE':uiSessionStatus,SQL_ID:'0123456789abc',SQL_EXEC_START:'2026-10-26 01:00:00',SQL_EXEC_ID:'9',PREV_SQL_ID:'abcdef0123456',EVENT:'enq: TX - row lock contention',STATE:'WAITING',WAIT_CLASS:'Application',WAIT_SECONDS:1.5,BLOCKING_SID:601,BLOCKING_INSTANCE:1});
const sessionSnapshot=()=>({sessions:[sessionRow(true),sessionRow()],context:{instance:1,container:3,readonly:false,protectionReady:true,canManage:true,cancelSupported:true},fetchedAt:'2026-10-26T01:00:01Z'});
let pdbFailRead=true, pdbFailMutation=false;
const pdbWrites=[], pdbReviews=[];
let pdbRows=[{id:'APP_GUID',conId:3,name:'APP_PDB',dbid:'333',status:'NORMAL',openMode:'READ WRITE',restricted:'NO',sizeMb:30,protected:true,fingerprint:'app1'},
{id:'UI_PDB_GUID',conId:4,name:'UI_PDB',dbid:'444',status:'NORMAL',openMode:'MOUNTED',restricted:'NO',sizeMb:20,protected:false,fingerprint:'pdb1'}];
const pdbSnapshot=()=>({context:{user:'SYS',container:'CDB$ROOT',containerId:'1',database:'UI_CDB',instance:'UI_INSTANCE',common:true,sysdba:true,readonly:false,writable:true,canCreate:true,canAlter:true,canDrop:true,canPassword:true,omf:true,hotClone:true},pdbs:pdbRows,seedFiles:['/server/seed/system.dbf','/server/other/temp.dbf']});
let privilegeActive=false, privilegeFailList=true, privilegeFailDetail=false;
const privilegeWrites=[];
let privilegeGrants=[{grantee:'READER',grantor:'DEMO',privilege:'SELECT',grantable:false,hierarchy:false,common:false,inherited:false,canRevoke:true}];
const privilegeDetail=object=>({object,context:{user:'DEMO',readonly:false,grantAny:false},grants:privilegeGrants,columnGrants:[{grantee:'READER',grantor:'DEMO',column:'LABEL',privilege:'UPDATE',grantable:false}],privileges:['SELECT','UPDATE'],canGrant:{SELECT:true,UPDATE:true},scope:'all',fingerprint:'priv-'+privilegeWrites.length});
let directoryFailList = true, directoryFailDetail = false, directoryRevision = 1;
let directoryPath = '/demo/initial';
const directoryWrites = [];
const directoryContext = {user:'DEMO',readonly:false,canCreate:true,canDrop:true,grantAny:false,roles:['READER']};
const directoryDefinition = () => ({name:'UI_DIRECTORY',path:directoryPath,owner:'SYS',objectId:'701',ddlTime:'2026-10-26 12:00:00'});
let directoryGrants = [{grantee:'DEMO',grantor:'SYS',privilege:'READ',grantable:true,canRevoke:false},{grantee:'DEMO',grantor:'SYS',privilege:'WRITE',grantable:true,canRevoke:false},{grantee:'READER',grantor:'SYS',privilege:'READ',grantable:false,canRevoke:false},{grantee:'PUBLIC',grantor:'SYS',privilege:'READ',grantable:false,canRevoke:false}];
const directoryDetail = () => ({directory:directoryDefinition(),context:directoryContext,grants:directoryGrants,scope:'all',fingerprint:String(directoryRevision),canGrant:{READ:true,WRITE:true},sessionGrants:directoryGrants});
const dbLinkContext = {user:'DEMO',domain:'',readonly:false,createPrivate:true,createPublic:false,alterPrivate:true,alterPublic:false,dropPublic:false};
const dbLinkMetadata = () => ({schema:'DEMO',name:'UI_LINK_0',username:'DEMO',host:dbLinkHost,created:'2026-10-26 10:00:00',fingerprint:String(dbLinkRevision),auth:'fixed',editable:true,source:'CREATE DATABASE LINK UI_LINK_0 CONNECT TO "DEMO" IDENTIFIED BY "********" USING '+String.fromCharCode(39)+dbLinkHost.replaceAll("'","''")+String.fromCharCode(39)+';'});
let sequenceCache = '20', failSequenceRead = false;
let failTypeSource = false, typeWrites = [], failEnumSecond = true;
let typeSource = 'CREATE OR REPLACE TYPE "DEMO"."UI_TYPE_0" AS OBJECT ("ID" NUMBER, MEMBER FUNCTION F RETURN NUMBER);';
let enumLabels = ["can't", 'semi;colon'];
let failTableStats = false, statsValue = 7, failTableSource = false;
let holdSidebar = false, finishSidebar;
const sidebarCalls = [];
let holdGenerator = false, generatorBatches = 0, finishGenerator;
const erNode = id => ({ id, type: 'tableNode', position: { x: id === 'ER_A' ? 0 : 400, y: 0 },
  data: { tableName: id, tableComment: '', columns: [{ name: 'ID', type: 'INTEGER', comment: '', isPk: true, isFk: false }] } });
const erDocument = { version: 2, schema: 'DEMO', nodes: [erNode('ER_A'), erNode('ER_B')], edges: [
  { id: 'first', source: 'ER_A', target: 'ER_B', type: 'smoothstep' },
  { id: 'second', source: 'ER_A', target: 'ER_B', type: 'smoothstep' }
] };

const tuningExports = [];
let gitSetups = 0;
let failStoredSource = false;
const storedCompiles = [], routineExecutions = [];
let packageBFailed = false;
const packageExecutions = [];
let holdAiSettings = false;
let pendingAiSettings;
const aiSettingsWrites = [];
let failViewCount = false, failViewSource = false, viewAdded = false;
const viewWrites = [];
let failTableCount = false;
let failTableMetadata = true;
let tableMetadataCalls = 0;
let sourceRevision = 0;
let zeroNextUpdate = false;
let holdConnections = true;
const pendingConnections = [];
let savedConnections = ['Test DB', 'Other DB'].map(name => ({ name, dbType, user: 'DEMO', host: 'localhost', port: dbType === 'oracle' ? '1521' : '5432', database: 'demo', password: '' }));
let pendingOrder;
let orderWrites = 0;
let pendingDelete;
let deleteWrites = 0;
let connectCalls = 0;
let disconnectCalls = 0;
let failInitialSchemas = true;
let failNextDisconnect = false;
let pendingConnect;
let failClientSave = false;
let failCredentialSave = false, credentialFailures = 0, failAiCredentialSave = false, aiCredentialFailures = 0;
const credentialFailure = 'Could not securely save the credentials. Your previous settings were preserved. Unlock the OS credential store and try again.';
let clientSaveCalls = 0;
let generalSettings = { language: 'en', theme: 'mona', queryTimeout: 0, maxTabs: 20, sqlHistoryLimit: 100,
  outputDateFormat: 'YYYY-MM-DD HH:mm:ss', inputDateFormat: 'YYYY-MM-DD', numberFormat: 'comma', timezone: '+09:00', erNotation: 'barker', oracleClientPath: '' };
let holdSettingsSave = false;
let pendingSettingsSave;
const generalSettingsWrites = [];
let holdExportBrowse = false;
let pendingExportBrowse;
let pendingExportWrite;
let holdExportRead = false, pendingExportRead;
let exportBrowseCalls = 0;
let exportWriteCalls = 0;
let exportSnapshots = 0;
let exportCloses = 0;
let holdImport = false;
let pendingImport;
let holdRecordSubmit = false;
let pendingRecordSubmit;
contextBridge.exposeInMainWorld('recordTest', {
  hold: () => { holdRecordSubmit = true; },
  finish: rowsAffected => pendingRecordSubmit({ success: true, rowsAffected })
});
contextBridge.exposeInMainWorld('importTest', {
  hold: () => { holdImport = true; },
  finish: result => pendingImport({ success: true, ...(result === 'unknown' ? {} : { rowsAffected: result ?? 2 }) })
});
contextBridge.exposeInMainWorld('exportTest', {
  holdRead: () => { holdExportRead = true; },
  finishRead: () => pendingExportRead({ success: true, rows: [{ LABEL: 'discard me' }], done: true }),
  holdBrowse: () => { holdExportBrowse = true; },
  finishBrowse: outcome => pendingExportBrowse(outcome),
  finishWrite: () => pendingExportWrite({ success: true }),
  counts: () => ({ browse: exportBrowseCalls, writes: exportWriteCalls, opens: exportSnapshots, closes: exportCloses })
});
contextBridge.exposeInMainWorld('settingsTest', {
  hold: () => { holdSettingsSave = true; },
  finish: success => pendingSettingsSave(success),
  writes: () => generalSettingsWrites.slice(),
  saved: () => ({ ...generalSettings })
});
contextBridge.exposeInMainWorld('loginTest', {
  waiting: () => pendingConnections.length > 0,
  release: () => { holdConnections = false; pendingConnections.splice(0).forEach(resolve => resolve(savedConnections)); },
  writes: () => orderWrites,
  finishOrder: success => pendingOrder(success),
  deletions: () => deleteWrites,
  finishDelete: success => pendingDelete(success),
  connections: () => connectCalls,
  disconnections: () => disconnectCalls,
  failDisconnect: () => { failNextDisconnect = true; },
  finishConnect: () => pendingConnect({ success: true, aiHistoryScope: 'a'.repeat(64) }),
  failClientSave: () => { failClientSave = true; },
  failCredentialSave: () => { failCredentialSave = true; }, credentialFailures: () => credentialFailures,
  clientSaves: () => clientSaveCalls
});
contextBridge.exposeInMainWorld('uiTest', { failAiCredentialSave: () => { failAiCredentialSave = true; }, aiCredentialFailures: () => aiCredentialFailures, failMviewRead: () => { failMviewRead = true; }, failSynonymRead: () => { failSynonymRead = true; }, failSynonymSource: () => { failSynonymSource = true; }, externalSynonym: name => { synonymTarget = name; }, startSynonymPicker: () => { synonymPicker = true; }, stopSynonymPicker: () => { synonymPicker = false; }, failSequenceRead: () => { failSequenceRead = true; }, externalSequenceCache: value => { sequenceCache = value; }, failTypeSource: () => { failTypeSource = true; }, typeWrites: () => typeWrites.slice(), routineExecutions: () => routineExecutions.slice(), failViewSource: () => { failViewSource = true; }, viewWrites: () => viewWrites.slice(), startTriggerPicker: () => { triggerPickerActive = true; }, stopTriggerPicker: () => { triggerPickerActive = false; }, failTriggerSource: () => { failTriggerSource = true; }, startSql: value => { sqlActive = true; sqlFile = value; }, sqlCalls: () => sqlCalls, sqlSaved: () => sqlSaved, stopSql: () => { sqlActive = false; }, holdGenerator: () => { holdGenerator = true; generatorBatches = 0; }, generatorBatches: () => generatorBatches, finishGenerator: () => finishGenerator(), holdSidebar: () => { holdSidebar = true; }, failSidebar: () => finishSidebar({success:false,error:'Simulated sidebar failure'}), sidebarCalls: () => sidebarCalls, failTableStatistics: () => { failTableStats = true; statsValue = 9; }, failTableSource: () => { failTableSource = true; }, startIndex: () => { indexActive = true; }, stopIndex: () => { indexActive = false; }, failIndex: () => { failIndex = true; }, startGeneratorPicker: () => { generatorPickerActive = true; }, startQb: () => { generatorPickerActive = false; sqlActive = false; qbActive = true; }, qbDocument: () => qbDocument, qbSaved: () => qbSaved, qbAiRequests: () => qbAiRequests, qbAiPayloads: () => qbAiPayloads, qbExecutions: () => qbExecutions, finishQb: () => finishQb(), startErPicker: () => { erPickerActive = true; }, startEr: () => { erActive = true; qbActive = false; }, erSaved: () => erSaved, storedCompiles: () => storedCompiles.slice(), packageExecutions: () => packageExecutions.slice(), failStoredSource: () => { failStoredSource = true; }, holdAiSettings: () => { holdAiSettings = true; }, failAiSettings: () => { pendingAiSettings({ success: false, error: 'Simulated AI settings load failure' }); }, aiSettingsWrites: () => aiSettingsWrites.slice(), tuningExports: () => tuningExports.slice(), failTableCount: () => { failTableCount = true; }, metadataCalls: () => tableMetadataCalls, zeroNextUpdate: () => { zeroNextUpdate = true; }, bumpSource: () => { sourceRevision++; }, queries: () => queries.slice(), triggerSaves: () => triggerSaves.slice(), clear: () => { queries.length = 0; }, failViewCount: () => { failViewCount = true; } });
let definitionActive = false;
contextBridge.exposeInMainWorld('definitionTest', { start: () => { definitionActive = true; }, stop: () => { definitionActive = false; } });
let finishInitialTableMetadata, initialTableLoaderVisible = false;
contextBridge.exposeInMainWorld('tableOpeningTest', {
  waiting: () => !!finishInitialTableMetadata,
  loaderVisibleAtMetadata: () => initialTableLoaderVisible,
  release: () => { finishInitialTableMetadata(); finishInitialTableMetadata = undefined; }
});
let lockFailRead = true, lockWrites = [], lockHolderPresent = true;
function lockSnapshot() {
  const common = { INSTANCE_ID:1,CON_ID:3,USERNAME:'DEMO',OSUSER:'demo',PROGRAM:'lock fixture',MACHINE:'demo',STATUS:'INACTIVE',TYPE:'TX',ID1:1,ID2:2,HOLD_SECONDS:9,EVENT:'enq: TX - row lock contention',OBJECT_OWNER:null,OBJECT_NAME:null,OBJECT_TYPE:null,SQL_ID:null,SQL_TEXT:null,PREV_SQL_ID:'prev_sql',PREV_SQL_TEXT:'UPDATE DEMO.ORDERS SET TOTAL = 1',LOGON_TIME:'2026-10-26 01:02:03',protected:false };
  const locks = [
    ...(lockHolderPresent ? [{...common,id:'LOCK_HOLDER',fingerprint:'holder_fingerprint',SID:501,SERIAL:11,HELD_MODE:6,REQUEST_MODE:0,BLOCK:1,WAITERS:1,WAIT_SECONDS:null,BLOCKING_SID:null,BLOCKING_INSTANCE:null}] : []),
    {...common,id:'LOCK_WAITER',fingerprint:'waiter_fingerprint',SID:502,SERIAL:12,HELD_MODE:0,REQUEST_MODE:lockHolderPresent?6:0,BLOCK:0,WAITERS:0,WAIT_SECONDS:4,BLOCKING_SID:lockHolderPresent?501:null,BLOCKING_INSTANCE:lockHolderPresent?1:null,SQL_ID:'current_sql',SQL_TEXT:'UPDATE DEMO.ORDERS SET TOTAL = 2'}
  ];
  return {success:true,locks,context:{instance:1,container:3,readonly:false,canKill:true,protectionReady:true},fetchedAt:'2026-10-26T01:02:03Z'};
}
contextBridge.exposeInMainWorld('lockTest',{ failRead:()=>{lockFailRead=true}, writes:()=>lockWrites.slice() });
contextBridge.exposeInMainWorld('logTest', { fail: () => { failLogRead = true; }, picker: active => { logPickerActive = active; } });
contextBridge.exposeInMainWorld('dbLinkTest', { fail: () => { failDbLinkRead = true; }, recreateFailure: () => { failDbLinkRecreate = true; }, writes: () => dbLinkWrites.slice(), tests: () => dbLinkTests });
contextBridge.exposeInMainWorld('oraUserTest',{failRead:()=>{oraUserFailList=true;},writes:()=>oraUserWrites.slice(),reviews:()=>oraUserReviews.slice()});
contextBridge.exposeInMainWorld('pgRoleTest',{failRead:()=>{pgRoleFailRead=true;},writes:()=>pgRoleWrites.slice(),reviews:()=>pgRoleReviews.slice()});
contextBridge.exposeInMainWorld('pgTsTest',{failRead:()=>{pgTsFailRead=true;},writes:()=>pgTsWrites.slice()});
contextBridge.exposeInMainWorld('pgSessionTest',{failRead:()=>{pgSessionFailRead=true;},readonly:value=>{pgSessionReadonly=value;},commands:()=>pgSessionCommands.slice()});
contextBridge.exposeInMainWorld('schemaTest',{start:()=>{schemaActive=true;},failDetail:()=>{schemaFailDetail=true;},writes:()=>schemaWrites.slice(),aclWrites:()=>schemaAclWrites.slice()});
contextBridge.exposeInMainWorld('pgPrivTest',{failDetail:()=>{pgPrivFailDetail=true;},writes:()=>pgPrivWrites.slice()});
contextBridge.exposeInMainWorld('pgLockTest',{ failRead:()=>{pgLockFailRead=true;}, commands:()=>pgLockCommands.slice() });
contextBridge.exposeInMainWorld('sessionTest', { failDetail:()=>{sessionFailDetail=true;}, commands:()=>sessionCommands.slice() });
contextBridge.exposeInMainWorld('pdbTest', { failList:()=>{pdbFailRead=true;}, failMutation:()=>{pdbFailMutation=true;}, writes:()=>pdbWrites.map(request=>({action:request.action,target:request.target,name:request.name})), reviewsContainSecret:()=>JSON.stringify(pdbReviews).includes('PDB_SECRET_SENTINEL') });
contextBridge.exposeInMainWorld('privilegeTest', { failDetails:()=>{privilegeFailDetail=true;}, writes:()=>privilegeWrites.slice(), stop:()=>{privilegeActive=false;} });
contextBridge.exposeInMainWorld('directoryTest', { failDetails: () => {directoryFailDetail=true;}, writes: () => directoryWrites.slice() });
let holdUsageRead = false, pendingUsageRead;
const usageYears = [];
const usageResponse = year => ({ success: true, records: [{ requestedAt: year+'-09-01T12:00:00', requestType: 'sql_generation', modelName: 'UI_USAGE_MODEL', inputTokens: 12, outputTokens: 3 }] });
contextBridge.exposeInMainWorld('usageTest', {
  holdNext: () => { holdUsageRead = true; },
  finish: success => pendingUsageRead(success),
  years: () => usageYears.slice()
});
contextBridge.exposeInMainWorld('clipboardTest', { set: mode => { clipboardMode = mode; }, values: () => copiedCellTexts.slice() });
contextBridge.exposeInMainWorld('monaBase', {
  async invoke(channel, ...args) {
    if (channel === 'get-ai-database-context') return { success: true, environment: { dbType, session: 'main', readOnlyMode: false, version: 'UI_CONTEXT_VERSION', schema: 'DEMO', timezone: '+09:00' } };
    if (channel === 'get-ai-usage-history') {
      const year = args[0]; usageYears.push(year);
      if (holdUsageRead) { holdUsageRead = false; return new Promise(resolve => { pendingUsageRead = success => resolve(success ? usageResponse(year) : {success:false,error:'Simulated usage load failure'}); }); }
      return usageResponse(year);
    }
    if (channel === 'copy-to-clipboard') { if (clipboardMode === 'throw') throw new Error('Clipboard unavailable'); if (clipboardMode === 'success') copiedCellTexts.push(args[0]); return clipboardMode === 'success'; }
    if(channel==='list-oracle-user-roles'){if(oraUserFailList){oraUserFailList=false;return {success:false,error:'ora_user_load_failed'}}return {success:true,...oraUserSnapshot()}}
    if(channel==='get-oracle-user-role-detail'){if(oraUserFailDetail){oraUserFailDetail=false;return {success:false,error:'ora_user_load_failed'}}return {success:true,detail:oraUserDetail(args[0])}}
    if(channel==='review-oracle-user-role-operation'){oraUserReviews.push(args[0]);if(args[0].action==='drop'&&!args[0].cascade)return {success:false,error:'ora_user_has_objects'};return {success:true,request:args[0],sql:args[0].action==='create'?'CREATE ROLE "'+args[0].newName+'" NOT IDENTIFIED':args[0].action==='drop'?'DROP USER "'+args[0].target.name+'" CASCADE':args[0].action==='quota'?'ALTER USER "'+args[0].target.name+'" QUOTA '+args[0].amount+' ON "USERS"':'ALTER USER "'+args[0].target.name+'" IDENTIFIED BY "<redacted>"',detail:args[0].target?oraUserDetail(args[0].target):null,token:'ora-user-review'}}
    if(channel==='execute-oracle-user-role-operation'){const {password:_password,...safe}=args[0];oraUserWrites.push(safe);if(oraUserFailWrite){oraUserFailWrite=false;return {success:false,error:'ora_user_verification_failed',applied:true}}return {success:true,snapshot:oraUserSnapshot(),selectedIdentity:'OR_USER',applied:true}}
    if(channel==='list-postgres-roles'){if(pgRoleFailRead){pgRoleFailRead=false;return {success:false,error:'pg_role_load_failed'}}return {success:true,...pgRoleSnapshot()}}
    if(channel==='get-postgres-role-detail'){if(pgRoleFailDetail){pgRoleFailDetail=false;return {success:false,error:'pg_role_load_failed'}}return {success:true,detail:pgRoleDetail(args[0])}}
    if(channel==='review-postgres-role-operation'){pgRoleReviews.push(args[0]);return {success:true,request:args[0],sql:args[0].action==='create'?'CREATE ROLE "'+args[0].newName+'" NOLOGIN PASSWORD NULL':args[0].action==='drop'?'DROP ROLE "'+args[0].target.name+'"':'ALTER ROLE "'+args[0].target.name+'" PASSWORD '+"'<redacted>'",detail:args[0].target?pgRoleDetail(args[0].target):null,token:'role-review'}}
    if(channel==='execute-postgres-role-operation'){const {password:_password,...safe}=args[0];pgRoleWrites.push(safe);if(pgRoleFailWrite){pgRoleFailWrite=false;return {success:false,error:'pg_role_operation_failed',errorCode:'42501'}}return {success:true,snapshot:pgRoleSnapshot(),selectedOid:'200',applied:true,passwordChanged:true}}
    if(channel==='list-postgres-tablespaces'){if(pgTsFailRead){pgTsFailRead=false;return {success:false,error:'pg_ts_load_failed'}}return {success:true,...pgTsSnapshot()}}
    if(channel==='get-postgres-tablespace-detail'){if(pgTsFailDetail){pgTsFailDetail=false;return {success:false,error:'pg_ts_load_failed'}}return {success:true,detail:pgTsDetail(args[0])}}
    if(channel==='review-postgres-tablespace-operation')return {success:true,request:args[0],sql:'ALTER TABLESPACE "'+pgTsName+'" RENAME TO "'+args[0].newName+'"',detail:pgTsDetail(args[0].target),token:'ts-review'};
    if(channel==='execute-postgres-tablespace-operation'){pgTsWrites.push(args[0]);if(pgTsFailWrite){pgTsFailWrite=false;return {success:false,error:'pg_ts_outcome_unknown'}}pgTsName=args[0].newName;return {success:true,snapshot:pgTsSnapshot(),selectedOid:'60',applied:true}}
    if(channel==='list-postgres-sessions'){if(pgSessionFailRead){pgSessionFailRead=false;return {success:false,error:'pg_session_read_failed'}}return {success:true,...pgSessionSnapshot()}}
    if(channel==='manage-postgres-session'){pgSessionCommands.push(args[0]);if(args[0].action==='cancel'){pgSessionStatus='idle';return {success:true,status:'query-ended',observationFailed:false}}if(pgSessionFailSignal){pgSessionFailSignal=false;return {success:false,error:'pg_session_outcome_unknown'}}pgSessionPresent=false;return {success:true,status:'ended',observationFailed:false}}
    if(channel==='list-postgres-schemas'){if(schemaFailRead){schemaFailRead=false;return {success:false,error:'pg_schema_load_failed'}}return {success:true,...schemaSnapshot()}}
    if(channel==='get-postgres-schema-detail'){if(schemaFailDetail){schemaFailDetail=false;return {success:false,error:'pg_schema_load_failed'}}return {success:true,detail:schemaDetail(args[0])}}
    if(channel==='review-postgres-schema-operation'){const request=args[0];if(request.action==='drop'&&!request.cascade)return {success:false,error:'pg_schema_not_empty'};return {success:true,request,sql:request.action==='drop'?'DROP SCHEMA "'+schemaName+'" CASCADE':'ALTER SCHEMA "'+schemaName+'" RENAME TO "'+request.newName+'"',issuer:pgPrivRoles[1],detail:schemaDetail(request.target),token:'schema-review-'+schemaRevision}}
    if(channel==='execute-postgres-schema-operation'){const request=args[0];schemaWrites.push(request);if(schemaFailMutation){schemaFailMutation=false;return {success:false,error:'pg_schema_not_applied'}}const oldName=schemaName;if(request.action==='rename')schemaName=request.newName;schemaRevision++;return {success:true,snapshot:schemaSnapshot(),selectedOid:'50',applied:true,change:{action:request.action,oid:'50',oldName,newName:schemaName}}}
    if(channel==='review-postgres-object-privilege'&&args[0].object.type==='SCHEMA'){return {success:true,request:args[0],sql:'GRANT CREATE ON SCHEMA "'+schemaName+'" TO "reader"',grantor:pgPrivRoles[1],issuer:pgPrivRoles[1],principal:pgPrivRoles[2],detail:schemaAcl(),affectedColumns:[],token:'schema-acl-review-'+schemaRevision}}
    if(channel==='mutate-postgres-object-privilege'&&args[0].object.type==='SCHEMA'){schemaAclWrites.push(args[0]);schemaAclGrants.push({grantee_id:'20',grantor_id:'10',privilege:'CREATE',grantable:false,source:'acl',canRevoke:true});schemaRevision++;return {success:true,detail:schemaAcl(),applied:true}}
    if(channel==='list-postgres-privilege-principals'){if(pgPrivFailPeople){pgPrivFailPeople=false;return {success:false,error:'pg_priv_load_failed'}}return {success:true,context:pgPrivContext,principals:pgPrivRoles}}
    if(channel==='list-postgres-privilege-objects'){const r=args[0];if(r.type==='FUNCTION')return {success:true,context:pgPrivContext,objects:[pgPrivObject('same_name','FUNCTION','value integer','60'),pgPrivObject('same_name','FUNCTION','value text','61')],hasMore:false};const names=Array.from({length:102},(_,i)=>i===100?'UI_PRIV_TARGET':'UI_PRIV_'+i).filter(name=>name.includes(r.search));return {success:true,context:pgPrivContext,objects:names.slice(r.offset,r.offset+100).map(name=>pgPrivObject(name)),hasMore:names.length>r.offset+100}}
    if(channel==='get-postgres-object-privileges'){if(pgPrivFailDetail){pgPrivFailDetail=false;return {success:false,error:'pg_priv_load_failed'}}return {success:true,detail:pgPrivDetail(args[0])}}
    if(channel==='review-postgres-object-privilege'){const request=args[0];return {success:true,request,sql:'GRANT '+request.privilege+' ON TABLE "DEMO"."UI_PRIV_TARGET" TO "reader"',grantor:pgPrivRoles[1],issuer:pgPrivRoles[1],principal:pgPrivRoles.find(role=>role.id===request.principalId),detail:pgPrivDetail(request.object),affectedColumns:[],token:'pg-review-'+pgPrivRevision}}
    if(channel==='mutate-postgres-object-privilege'){pgPrivWrites.push(args[0]);if(pgPrivFailMutation){pgPrivFailMutation=false;return {success:false,error:'pg_priv_not_applied',applied:false}}pgPrivGrants.push({grantee_id:args[0].principalId,grantor_id:'10',privilege:args[0].privilege,grantable:false,source:'acl',canRevoke:true});pgPrivRevision++;return {success:true,detail:pgPrivDetail(args[0].object),applied:true}}
    if(channel==='list-postgres-locks'){if(pgLockFailRead){pgLockFailRead=false;return {success:false,error:'pg_lock_read_failed'}}return {success:true,...pgLockSnapshot()}}
    if(channel==='manage-postgres-lock'){pgLockCommands.push(args[0]);if(args[0].action==='terminate')pgLockHolder=false;return {success:true,status:args[0].action==='terminate'?'ended':'query-ended',observationFailed:false}}
    if(channel==='list-oracle-tablespaces'){if(tsFailRead){tsFailRead=false;return {success:false,error:'ts_load_failed'}}return {success:true,...tsSnapshot()}}
    if(channel==='get-oracle-tablespace-detail')return {success:true,...tsDetail()};
    if(channel==='review-oracle-tablespace-operation')return {success:true,token:'ts-review-'+(++tsReviewCounter),request:args[0],detail:tsDetail(),steps:[...(args[0].sizeMb!==tsSize?[{kind:'resize',sql:'ALTER TABLESPACE "UI_BIG" RESIZE '+args[0].sizeMb+'M'}]:[]),{kind:'autoextend',sql:'ALTER TABLESPACE "UI_BIG" AUTOEXTEND OFF'}],canExecute:true,shrinking:false};
    if(channel==='execute-oracle-tablespace-operation'){tsWrites.push(args[0]);if(tsWrites.length===1){tsSize=args[0].sizeMb;return {success:false,error:'ts_operation_failed',errorCode:'ORA-01031',completed:['resize'],attempted:'autoextend',applied:true}}tsAuto=false;return {success:true,completed:['autoextend'],attempted:null,applied:true,snapshot:tsSnapshot()}}
    if(channel==='list-oracle-sessions'){
      if(sessionFailRead){sessionFailRead=false;return {success:false,error:'session_read_failed'};}
      return {success:true,...sessionSnapshot()};
    }
    if(channel==='get-oracle-session-detail'){
      if(sessionFailDetail){sessionFailDetail=false;return {success:false,error:'session_detail_failed'};}
      return {success:true,sessionId:args[0].id,fingerprint:args[0].fingerprint,execution:'sql-exec-1',statistics:[{id:'1',NAME:'session logical reads',VALUE:'900719925474099300001'}],sqlText:'SELECT * FROM DEMO.ORDERS',previousSqlText:'UPDATE DEMO.ORDERS SET TOTAL=2',fetchedAt:'2026-10-26T01:00:02Z'};
    }
    if(channel==='manage-oracle-session'){
      sessionCommands.push(args[0]);
      if(args[0].action==='kill')uiSessionStatus='KILLED';
      return {success:true,status:args[0].action==='kill'?'marked':'requested'};
    }
    if(channel==='list-oracle-pdbs'){
      if(pdbFailRead){pdbFailRead=false;return {success:false,error:'pdb_operation_failed',errorCode:'ORA-01031'};}
      return {success:true,...pdbSnapshot()};
    }
    if(channel==='get-oracle-pdb-detail')return {success:true,target:pdbRows.find(row=>row.name===args[0]),files:['/server/a/system.dbf','/server/b/temp.dbf'],users:['LOCAL_APP']};
    if(channel==='review-oracle-pdb-operation'){
      pdbReviews.push(args[0]);
      return {success:true,token:'ui-pdb-review',request:args[0],target:pdbRows.find(row=>row.name===args[0].target)||null,stages:[args[0].action],datafiles:[],compatibility:null,canExecute:true};
    }
    if(channel==='execute-oracle-pdb-operation'){
      pdbWrites.push(args[0]);
      if(pdbFailMutation){pdbFailMutation=false;return {success:false,error:'pdb_operation_failed',errorCode:'ORA-65000',stage:'outcome_unknown',applied:false};}
      if(args[0].action==='drop')pdbRows=pdbRows.filter(row=>row.name!==args[0].target);
      return {success:true,snapshot:pdbSnapshot(),stage:'applied',applied:true};
    }
    if(channel==='list-oracle-privilege-principals'){
      privilegeActive=true;
      if(privilegeFailList){privilegeFailList=false;return {success:false,error:'object_priv_load_failed'};}
      return {success:true,rolesComplete:true,principals:[{name:'DEMO',kind:'user',maintained:false},{name:'READER',kind:'role',maintained:false},{name:'PUBLIC',kind:'public',maintained:false}]};
    }
    if(channel==='get-oracle-object-privileges'){
      if(privilegeFailDetail){privilegeFailDetail=false;return {success:false,error:'object_priv_load_failed'};}
      return {success:true,detail:privilegeDetail(args[0])};
    }
    if(channel==='mutate-oracle-object-privileges'){
      privilegeWrites.push(args[0]);
      privilegeGrants=privilegeGrants.filter(row=>!(row.grantee===args[0].grantee&&row.privilege===args[0].privilege));
      return {success:true,detail:privilegeDetail(args[0].object),applied:true,hasUncommittedTx:false};
    }
    if(privilegeActive&&channel==='execute-sql-bg'){
      if(/ALL_USERS/.test(args[0]))return {success:true,rows:[{name:'DEMO'}]};
      if(/OFFSET :offset/.test(args[0]))return {success:true,rows:(args[1].offset?['UI_PRIV_TARGET']:Array.from({length:100},(_,i)=>'UI_PRIV_'+i)).map(name=>({name}))};
    }
    if (channel === 'list-oracle-directories') {
      if (directoryFailList) {directoryFailList=false;return {success:false,error:'directory_load_failed'};}
      return {success:true,context:directoryContext,directories:[directoryDefinition()],scope:'all',rolesComplete:true,principals:[{name:'DEMO',kind:'user',maintained:false},{name:'APP_USER',kind:'user',maintained:false},{name:'READER',kind:'role',maintained:false},{name:'PUBLIC',kind:'public',maintained:false}]};
    }
    if (channel === 'get-oracle-directory') {
      if(directoryFailDetail){directoryFailDetail=false;return {success:false,error:'directory_privileges_failed'};}
      return {success:true,detail:directoryDetail()};
    }
    if (channel === 'mutate-oracle-directory') {
      const request=args[0];directoryWrites.push(request);directoryRevision++;
      if(request.action==='replace')directoryPath=request.path;
      if(request.action==='create')return {success:false,error:'directory_exists',applied:false};
      if(request.action==='grant')directoryGrants=[...directoryGrants,{grantee:request.grantee,grantor:'DEMO',privilege:request.privilege,grantable:false,canRevoke:true}];
      return {success:true,detail:directoryDetail(),applied:true,hasUncommittedTx:false};
    }
    if (channel === 'get-oracle-dblink') {
      if (failDbLinkRead) { failDbLinkRead=false; return {success:false,error:'dblink_load_failed'}; }
      return {success:true,context:dbLinkContext,link:args[0].name && dbLinkExists ? dbLinkMetadata() : null};
    }
    if (channel === 'save-oracle-dblink') {
      const request=args[0];
      dbLinkWrites.push({action:request.action,recreate:request.confirmRecreate,passwordSupplied:Boolean(request.form?.password)});
      if (request.action==='drop') { dbLinkExists=false; return {success:true,phase:'dropped',context:dbLinkContext,link:null,hasUncommittedTx:false}; }
      if (request.confirmRecreate && failDbLinkRecreate) { failDbLinkRecreate=false;dbLinkExists=false;return {success:false,error:'dblink_operation_failed',errorCode:'ORA-01031',phase:'dropped-only',hasUncommittedTx:false}; }
      dbLinkHost=request.form.host.trim();dbLinkRevision++;dbLinkExists=true;
      return {success:true,context:dbLinkContext,link:dbLinkMetadata(),phase:request.action==='create'?'created':request.confirmRecreate?'recreated':'altered',hasUncommittedTx:false};
    }
    if (channel === 'test-oracle-dblink') { dbLinkTests++;return {success:true,elapsedMs:12}; }
    if (channel === 'execute-sql-bg' && args[1]?.tableName?.startsWith('UI_LOG_')) {
      if (args[0].includes('FROM ALL_TABLES t JOIN')) return {success:true,rows:[{ID:'51',HAS_PK:1,IS_OBJECT:0}]};
      if (args[0].includes('FROM ALL_TAB_COLUMNS')) return {success:true,rows:['ID','a,b','Order Total'].map(COLUMN_NAME=>({COLUMN_NAME,DATA_TYPE:'NUMBER',DATA_TYPE_OWNER:null}))};
      if (args[0].includes('FROM ALL_MVIEW_LOGS l JOIN')) {
        if (failLogRead) { failLogRead=false; return {success:false,error:'Simulated log metadata failure'}; }
        return {success:true,rows:args[1].tableName === 'UI_LOG_MASTER' ? [{LOG_ID:'52',LOG_OWNER:'DEMO',MASTER:'UI_LOG_MASTER',LOG_TABLE:'MLOG$_UI_LOG_MASTER',PRIMARY_KEY:'YES',ROWIDS:'NO',OBJECT_ID:'NO',SEQUENCE:'NO',COMMIT_SCN_BASED:'NO',INCLUDE_NEW_VALUES:logInclude?'YES':'NO',LAST_PURGE_STATUS:0,NUM_ROWS_PURGED:12}] : []};
      }
    }
    if (channel === 'execute-sql-bg' && args[0].includes("GET_DDL('MATERIALIZED_VIEW_LOG'")) return {success:true,rows:[{DDL:'CREATE MATERIALIZED VIEW LOG ON "DEMO"."UI_LOG_MASTER" TABLESPACE "USERS" WITH PRIMARY KEY ("a,b") '+(logInclude?'INCLUDING':'EXCLUDING')+' NEW VALUES'}]};
    if (channel === 'execute-sql' && args[0].startsWith('ALTER MATERIALIZED VIEW LOG ON')) { queries.push(args[0]); logInclude=!args[0].includes('EXCLUDING'); return {success:true}; }
    if (channel === 'execute-sql-bg' && args[0].startsWith('SELECT MASTER FROM ALL_MVIEW_LOGS')) return {success:true,rows:[{MASTER:'UI_LOG_MASTER'}]};
    if (logPickerActive && channel === 'execute-sql-bg' && args[0].includes('OFFSET :offset')) {
      const names=args[1].offset ? ['UI_LOG_PICK_100'] : ['UI_LOG_MASTER',...Array.from({length:99},(_,i)=>'UI_LOG_PICK_'+i)];
      return {success:true,rows:names.map(name=>({name}))};
    }
    if (channel === 'execute-stored' && args[0]?.objectType !== 'PACKAGE') { routineExecutions.push(args[0]); return {success:true,returnValues:[],dbmsOutput:[]}; }
    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_PROC_0') {
      if (/SELECT STATUS/.test(args[0])) return {success:true,rows:[{STATUS:'VALID'}]};
      if (/ALL_ARGUMENTS/.test(args[0])) return {success:true,rows:[{ARGUMENT_NAME:'P',DATA_TYPE:'VARCHAR2',IN_OUT:'IN',POSITION:1,DEFAULTED:'Y',DEFAULT_LENGTH:0}]};
      if (/ALL_PROCEDURES/.test(args[0])) return {success:true,rows:[{STATUS:'VALID',AUTHID:'DEFINER',RESULT:null}]};
      if (/ALL_DEPENDENCIES/.test(args[0])) return {success:true,rows:[{schema:'DEMO',name:'ROUTINE_LINKED',type:'TABLE'}]};
    }
    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_FN') return {success:true,rows:[{oid:'84',signature:'text',ddl:"CREATE OR REPLACE FUNCTION public.UI_FN(p text DEFAULT 'fallback') RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN p; END; $$;"}]};
    if (channel === 'execute-sql-bg' && args[1]?.oid === '84') {
      if (/WITH ORDINALITY/.test(args[0])) return {success:true,rows:[{proargnames:['p'],proargmodes:['i'],data_type:'text',pronargs:1,pronargdefaults:1,defaults:"'fallback'::text"}]};
      if (/pg_get_function_result/.test(args[0])) return {success:true,rows:[{result:'text',language:'plpgsql',security:false}]};
      return {success:true,rows:[{schema:'public',name:'ROUTINE_LINKED',type:'VIEW'}]};
    }

    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_VIEW_0') {
      if (/GET_DDL|SELECT definition/.test(args[0])) {
        if (failViewSource) { failViewSource = false; return {success:false,error:'Simulated view source failure'}; }
        const schema = dbType === 'oracle' ? 'DEMO' : 'public';
        return {success:true,rows:[{DDL:'CREATE OR REPLACE VIEW "' + schema + '"."UI_VIEW_0" AS SELECT 1 AS "LABEL"' + (dbType === 'oracle' ? ' FROM DUAL' : ''),definition:'SELECT 1 AS "LABEL"'}]};
      }
      if (/ALL_ERRORS/.test(args[0])) return {success:true,rows:[]};
      if (/SELECT STATUS|SELECT 'VALID'/.test(args[0])) return {success:true,rows:[{STATUS:'VALID',status:'VALID'}]};
      if (/ALL_TAB_COLUMNS|FROM pg_attribute/.test(args[0])) return {success:true,rows:[{name:'LABEL',type:'text',nullable:'Y'},{name:'Added',type:'integer',nullable:'Y'}]};
      return {success:true,rows:[{schema:dbType === 'oracle' ? 'DEMO' : 'public',name:'VIEW_LINKED',type:'VIEW'}]};
    }
    if (channel === 'execute-sql' && /^CREATE.*VIEW/.test(args[0]) && /UI_VIEW_0/.test(args[0])) { viewWrites.push(args[0]); viewAdded = true; return {success:true,hasUncommittedTx:false}; }

    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_MV_0') {
      if (/ALL_MVIEWS m JOIN|c.relkind = 'm'/.test(args[0])) {
        if (failMviewRead) { failMviewRead = false; return {success:false,error:'Simulated materialized view failure'}; }
        return {success:true,rows:[dbType === 'oracle' ? {QUERY:'SELECT 1 AS ID FROM DUAL',OBJECT_ID_TEXT:'91',REFRESH_METHOD:mviewMethod,REFRESH_MODE:'DEMAND',UPDATABLE:'N',ON_QUERY_COMPUTATION:'Y',LAST_REFRESH_TYPE:'COMPLETE',STALENESS:'FRESH',BUILD_MODE:'IMMEDIATE'}
          : {id:'91',definition:'SELECT 1 AS "ID";',populated:mviewPopulated,concurrent:true,method:'heap',tablespace:null,options:[],owner:'DEMO'}]};
      }
      if (/ALL_REFRESH r/.test(args[0])) return {success:true,rows:[]};
      if (/GET_DDL/.test(args[0]) && args[0].includes("'MATERIALIZED_VIEW'")) return {success:true,rows:[{DDL:'CREATE MATERIALIZED VIEW "DEMO"."UI_MV_0" BUILD IMMEDIATE REFRESH '+mviewMethod+' ON DEMAND AS SELECT 1 AS ID FROM DUAL'}]};
      if (/GET_DDL/.test(args[0]) && args[0].includes("'INDEX'")) return {success:true,rows:[]};
      if (/ALL_DEPENDENCIES/.test(args[0])) return {success:true,rows:[{LABEL:'Uses: DEMO.MV_BASE_ROWS'}]};
    }
    if (channel === 'execute-sql-bg' && args[1]?.target?.includes('UI_MV_0')) {
      if (/pg_describe_object/.test(args[0])) return {success:true,rows:[{label:'Uses: table DEMO.MV_BASE_ROWS'}]};
      if (/pg_get_indexdef/.test(args[0])) return {success:true,rows:[{ddl:'CREATE UNIQUE INDEX "MV_INDEX" ON "DEMO"."UI_MV_0" ("ID")'}]};
      if (/pg_options_to_table|obj_description/.test(args[0])) return {success:true,rows:[]};
      if (/pg_attribute/.test(args[0])) return {success:true,rows:[{name:'ID'}]};
    }
    if (channel === 'execute-sql-bg' && (/UI_MV_0/.test(args[0]) || args[1]?.tableName==='UI_MV_0') && /ALL_TAB_COLUMNS|pg_attribute|information_schema.columns/.test(args[0])) return {success:true,rows:[{COLUMN_NAME:'ID',DATA_TYPE:dbType==='oracle'?'NUMBER':'integer'}]};
    if (channel === 'execute-sql' && (/UI_MV_0/.test(args[0]) || args[1]?.target?.includes('UI_MV_0'))) {
      queries.push(args[0]);
      if (/^REFRESH|DBMS_MVIEW.REFRESH/.test(args[0])) mviewPopulated=true;
      if (/^ALTER MATERIALIZED VIEW/.test(args[0]) && /FORCE/.test(args[0])) mviewMethod='FORCE';
      return {success:true,rows:/COUNT/.test(args[0])?[{CNT:1}]:[{ID:1}],metaData:[{name:'ID'}]};
    }
    if (synonymPicker && channel === 'execute-sql-bg' && /OFFSET :offset/.test(args[0])) {
      const names = args[1].category === 'TYPE' ? ['UI_TYPE_0'] : args[1].offset ? ['UI_SYN_PICK_100'] : Array.from({length:100}, (_,i)=>'UI_SYN_PICK_'+i);
      return { success: true, rows: names.map(name => ({ name })) };
    }
    if (synonymPicker && channel === 'execute-sql-bg' && /ALL_USERS/.test(args[0])) return { success: true, rows: [{ name: 'DEMO' }] };
    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_SYN_0') {
      if (/GET_DDL/.test(args[0])) {
        if (failSynonymSource) { failSynonymSource = false; return { success:false, error:'Simulated synonym source failure' }; }
        return { success:true, rows:[{DDL:'CREATE OR REPLACE EDITIONABLE SYNONYM "DEMO"."UI_SYN_0" FOR "DEMO"."'+synonymTarget+'"'}] };
      }
      if (/ALL_SYNONYMS s/.test(args[0])) {
        if (failSynonymRead) { failSynonymRead = false; return {success:false,error:'Simulated synonym metadata failure'}; }
        return {success:true,rows:[{OWNER:'DEMO',SYNONYM_NAME:'UI_SYN_0',TABLE_OWNER:'DEMO',TABLE_NAME:synonymTarget,DB_LINK:null,EDITIONABLE:'Y'}]};
      }
      if (/ALL_DEPENDENCIES/.test(args[0])) return {success:true,rows:[{OWNER:'DEMO',NAME:'SYNONYM_DEPENDENT',TYPE:'VIEW'}]};
    }
    if (channel === 'execute-sql-bg' && /SELECT DISTINCT OBJECT_TYPE, STATUS FROM ALL_OBJECTS/.test(args[0])) return {success:true,rows:[{OBJECT_TYPE:'TABLE',STATUS:'VALID'}]};
    if (triggerPickerActive && channel === 'execute-sql-bg' && /OFFSET :offset/.test(args[0])) {
      const type = args[0].includes("'VIEW'") || args[1].type === 'VIEW' ? 'VIEW' : 'TABLE';
      return {success:true,rows:(args[1].offset ? ['UI_TRIGGER_NEXT_' + type] : Array.from({length:100},(_,i)=>'UI_TRIGGER_' + type + '_' + i)).map(name=>({name,displayName:name}))};
    }
    if (channel === 'get-oracle-trigger') {
      if (failTriggerSource) { failTriggerSource = false; return {success:false,error:'Simulated trigger source failure'}; }
      return {success:true,trigger:oracleTrigger};
    }
    if (channel === 'save-oracle-trigger') { triggerSaves.push(args[0]); return {success:true,trigger:oracleTrigger,hasUncommittedTx:false}; }

    if (indexActive) {
      if (channel === 'get-objects') throw new Error('Index creation must not fetch an unpaged table list');
      if (channel === 'get-columns') return {success:true,columns:['A','B','C']};
      if (channel === 'execute-sql-bg' && /OFFSET :offset/.test(args[0])) return {success:true,rows:(args[1].offset ? ['UI_INDEX_TABLE'] : Array.from({length:100},(_,i)=>'UI_INDEX_'+i)).map(name=>({name,displayName:name}))};
      if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_INDEX') {
        if (failIndex) { failIndex = false; return {success:false,error:'Simulated index metadata failure'}; }
        let rows=[];
        if (/pg_get_indexdef.* AS ddl/.test(args[0])) rows=[{table_schema:'public',table_name:'UI_INDEX_TABLE',ddl:'CREATE INDEX UI_INDEX ON UI_INDEX_TABLE (A DESC) INCLUDE (B) WHERE C > 0',expression:null,indisunique:false}];
        else if (/generate_series/.test(args[0])) rows=[{column_name:'A',key_expression:'A DESC'}];
        else if (/SELECT TABLE_OWNER/.test(args[0])) rows=[{TABLE_OWNER:'DEMO',TABLE_NAME:'UI_INDEX_TABLE',INDEX_TYPE:'NORMAL',UNIQUENESS:'NONUNIQUE',VISIBILITY:'VISIBLE'}];
        else if (/GET_DDL/.test(args[0])) rows=[{DDL:'CREATE INDEX UI_INDEX ON UI_INDEX_TABLE (A DESC) TABLESPACE USERS'}];
        else if (/ALL_IND_COLUMNS/.test(args[0])) rows=[{COLUMN_NAME:'A'}];
        else if (/pg_stat_user_indexes/.test(args[0])) rows=[{idx_scan:3,index_size:'16 kB'}];
        else if (/SELECT BLEVEL/.test(args[0])) rows=[{BLEVEL:1,NUM_ROWS:42}];
        return {success:true,rows};
      }
    }
    if (generatorPickerActive && channel === 'execute-sql-bg' && args[0].includes('OFFSET :offset')) {
      const names = args[1].offset ? ['UI_GEN'] : Array.from({length:100},(_,i)=>'UI_GENERATOR_'+i);
      return {success:true,rows:names.map(name=>({name,displayName:name}))};
    }
    if (definitionActive && channel === 'execute-sql-bg') {
      if (/AS "PK_COUNT"|FROM ALL_TAB_COLUMNS/.test(args[0])) return {success:true,rows:['before','after','meo'].map((COLUMN_NAME,i)=>({COLUMN_NAME,DATA_TYPE:dbType==='oracle'?'NUMBER':'integer',PK_POSITION:i===0?2:i===1?1:null,PK_COUNT:2}))};
      if (/FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS/.test(args[0])) return {success:true,rows:[{COLUMN_NAME:'after',POSITION:1},{COLUMN_NAME:'before',POSITION:2}]};
      if (/AS "COLUMN_POSITION"/.test(args[0])) return {success:true,rows:[
        {INDEX_NAME:'META_PK',COLUMN_NAME:'after',COLUMN_DEFINITION:'after',COLUMN_POSITION:1,IS_PRIMARY:true,UNIQUENESS:true},
        {INDEX_NAME:'META_PK',COLUMN_NAME:'before',COLUMN_DEFINITION:'before',COLUMN_POSITION:2,IS_PRIMARY:true,UNIQUENESS:true},
        {INDEX_NAME:'META_PK',COLUMN_NAME:'meo',COLUMN_DEFINITION:'meo',COLUMN_POSITION:3,IS_PRIMARY:true,UNIQUENESS:true,IS_INCLUDED:true},
        {INDEX_NAME:'META_EXPR',COLUMN_NAME:null,COLUMN_DEFINITION:'(before + 1)',COLUMN_POSITION:1},
        {INDEX_NAME:'META_EXPR',COLUMN_NAME:'after',COLUMN_DEFINITION:'after',COLUMN_POSITION:2}
      ]};
      if (/i.INDEX_TYPE/.test(args[0])) return {success:true,rows:['Owner A','Owner B'].map(OWNER=>({OWNER,INDEX_NAME:'SHARED_INDEX',COLUMN_NAME:'before',COLUMN_POSITION:1,INDEX_TYPE:'NORMAL',VISIBILITY:'VISIBLE'}))};
      if (/FROM ALL_TRIGGERS/.test(args[0])) return {success:true,rows:['Owner A','Owner B'].map(OWNER=>({OWNER,TRIGGER_NAME:'SHARED_TRIGGER',TRIGGER_TYPE:'BEFORE',TRIGGERING_EVENT:'INSERT',STATUS:'ENABLED'}))};
      return {success:true,rows:[]};
    }
    if (channel === 'list-oracle-locks') {
      if (lockFailRead) {lockFailRead=false;return {success:false,error:'lock_read_failed'}}
      return lockSnapshot();
    }
    if (channel === 'terminate-oracle-lock-session') {lockWrites.push(args[0]);lockHolderPresent=false;return {success:true,status:'requested'}}
    if (channel === 'execute-sql-bg' && /NUM_ROWS, BLOCKS|NUM_DISTINCT, NUM_NULLS|FROM pg_stat_all_tables|FROM pg_stats/.test(args[0])) {
      if (failTableStats) { failTableStats = false; return { success: false, error: 'Simulated statistics failure' }; }
      return { success: true, rows: [{ VALUE: statsValue }] };
    }
    if (channel === 'execute-sql-bg' && ((/DBMS_METADATA.GET_DDL/.test(args[0]) && args[1]?.name === 'UI_ITEM_0') || args[1]?.target?.includes('UI_ITEM_0'))) {
      if (failTableSource) { failTableSource = false; return { success: false, error: 'Simulated table source failure' }; }
      if (/DBMS_METADATA.GET_DDL/.test(args[0])) return { success: true, rows: [{ DDL: 'CREATE TABLE "DEMO"."UI_ITEM_0" ("LABEL" VARCHAR2(25))' }] };
    }
    if (channel.includes('sql-draft')) throw new Error('SQL drafts must not be accessed');
    if (channel === 'inspect-sql-privacy') return ipcRenderer.invoke(channel, ...args);
    if (channel === 'begin-sql-batch' || channel === 'end-sql-batch') return { success: true };
    if (channel === 'add-sql-history') return [{id:'ui-history-entry',executeTime:'2026-10-28 12:00:00',sql:'SELECT HISTORY_COPY',duration:3,rowCount:1}];
    if (channel === 'clear-sql-history') return [];
    if (sqlActive) {
      if (channel === 'open-sql-file') return { success: true, canceled: false, filePath: '/mock/query.sql', sql: sqlFile };
      if (channel === 'show-save-dialog') return { canceled: false, filePath: '/mock/query-copy.sql' };
      if (channel === 'save-file') { if (++sqlSaveAttempts === 1) return { success: false, error: 'Simulated save failure' }; sqlSaved = { path: args[0], sql: args[1] }; return { success: true }; }
      if (channel === 'cancel-execution') { if (finishSql) { finishSql({ success: false, cancelled: true, error: 'Stopped' }); finishSql = null; } return { success: true }; }
      if (channel === 'execute-sql') {
        sqlCalls.push(args);
        if (args[0].includes('SQL_BAD')) return { success: false, error: 'SQL_BAD failed at line 1' };
        if (args[0].includes('SQL_SLOW')) return new Promise(resolve => { finishSql = resolve; });
        return { success: true, rows: [{ VALUE: 'SQL_FIRST_RESULT' }], metaData: [{ name: 'VALUE' }], executionTime: 1 };
      }
    }
    if (qbActive) {
      if (channel === 'get-ai-settings') return { success: true, isAiEnabled: true, modelName: 'mock-model', endpointUrl: '/mock/ai', apiKey: '' };
      if (channel === 'ask-ai') {
        qbAiRequests++; qbAiPayloads.push(args);
        if (args[2] !== 'query_builder') throw new Error('Unexpected AI request type');
        return { success: true, answer: JSON.stringify({ ...qbDocument, queryFields: qbDocument.queryFields.map(field => ({ ...field, groupBy: 'SUM', sort: 'DESC', criteria: '> 10' })) }) };
      }
      if (channel === 'show-save-dialog' && args[0].defaultPath === 'query-builder.json') return { canceled: false, filePath: '/mock/query-builder.json' };
      if (channel === 'save-file' && args[0] === '/mock/query-builder.json') {
        if (++qbSaveAttempts === 1) return { success: false, error: 'Simulated write failure' };
        qbSaved = JSON.parse(args[1]); return { success: true };
      }
      if (channel === 'execute-sql') {
        qbExecutions++;
        if (!args[0].includes('LEFT JOIN') || !args[0].includes(' AND ') || args[0].includes('(+)')) throw new Error('Incorrect builder SQL');
        return new Promise(resolve => { finishQb = () => resolve({ success: true, rows: [{ STAMP: '2026-10-25 12:34:56.123456789 +05:45', ID: '9007199254740993' }],
          metaData: [{ name: 'STAMP', dbTypeName: 'TIMESTAMP WITH TIME ZONE' }, { name: 'ID' }], executionTime: 1 }); });
      }
      if (channel === 'execute-sql-bg' && /"dataType"/.test(args[0])) return { success: true, rows: ['ID', 'K', 'AMOUNT'].map(name => ({ name, dataType: 'INTEGER', comment: null, objectType: 'TABLE', tableComment: null })) };
      if (channel === 'execute-sql-bg' && /DBMS_METADATA.GET_DDL/.test(args[0])) return { success: true, rows: [{ DDL: 'CREATE TABLE "DEMO"."' + args[1].name + '" (ID INTEGER, K INTEGER, AMOUNT INTEGER)' }] };
      if (channel === 'execute-sql-bg' && args[1]?.target?.includes('QB_') && /AS formatted_type/.test(args[0])) return { success: true, rows: ['ID', 'K', 'AMOUNT'].map(column_name => ({ column_name, formatted_type: 'integer', not_null: false, expression: null, identity: '', generated: '' })) };
      if (channel === 'execute-sql-bg') return { success: true, rows: [] };
    }
    if (erActive) {
      if (channel === 'get-er-diagrams') return { success: true, files: ['er-review.json'] };
      if (channel === 'load-er-diagram') return { success: true, data: JSON.stringify(erDocument) };
      if (channel === 'git-get-history-er') {
        const page = args[0].page || 0;
        return { success: true, page, hasMore: page === 0, history: [{ id: 'er-page-' + page,
          fullId: (page ? 'b' : 'a').repeat(40), date: '2026-10-28 12:00:00 +0900', message: 'ER history page ' + page,
          isPushed: true, hasRemote: true, isMerge: false }] };
      }
      if (channel === 'git-commit-er') { erSaved = JSON.parse(args[0].sourceText); return { success: true }; }
      if (channel === 'execute-sql-bg') {
        const sql = args[0];
        if (erPickerActive && /OFFSET :offset/.test(sql)) {
          const view = args[1].category === 'VIEW' || sql.includes("'v'");
          const names = view ? ['ER_PICK_VIEW'] : args[1].offset ? ['ER_PICK_100'] : ['ER_A', ...Array.from({length:99},(_,i)=>'ER_PICK_'+i)];
          return { success: true, rows: names.map(name=>({name,displayName:name})) };
        }
        if (/USERNAME/.test(sql)) return { success: true, rows: [{ USERNAME: 'DEMO' }] };
        if (/ORDER BY table_name, ordinal_position|ORDER BY TABLE_NAME, COLUMN_ID/.test(sql)) return { success: true, rows: [
          { TABLE_NAME: 'ER_A', COLUMN_NAME: 'ID', DATA_TYPE: 'INTEGER' },
          { TABLE_NAME: 'ER_A', COLUMN_NAME: 'ADDED_COLUMN', DATA_TYPE: 'INTEGER' },
          { TABLE_NAME: 'ER_B', COLUMN_NAME: 'ID', DATA_TYPE: 'INTEGER' },
          ...(erPickerActive ? ['ER_PICK_100','ER_PICK_VIEW'].map(TABLE_NAME=>({TABLE_NAME,COLUMN_NAME:'ID',DATA_TYPE:'INTEGER'})) : [])
        ] };
        return { success: true, rows: [] };
      }
    }

    if (channel === 'git-get-history' && args[0]?.objectName === 'UI_VIEW_0') return {success:true,hasMore:false,history:['b','a'].map((key,index)=>({fullId:key.repeat(40),id:key.repeat(7),date:'2026-10-28',message:index?'Older UI revision':'Newer UI revision',hasRemote:false,isPushed:false}))};
    if (channel === 'git-get-file-content' && args[0]?.objectName === 'UI_VIEW_0') return {success:true,content:args[0].commitId.startsWith('b')?"SELECT 'UI_NEW_SEARCH'":"SELECT 'UI_OLD_SEARCH'"};
    if (channel === 'git-status-check') return { success: true, isRepo: true, remoteUrl: '/mock/repository.git', repoPath: '/mock/workspace', branch: 'feature/demo', tracking: null, ahead: null };
    if (channel === 'git-set-remote') {
      if (args[0]?.branch !== 'feature/demo') throw new Error('Unexpected Git branch');
      return ++gitSetups === 1 ? { success: false, needsPull: false, error: 'Simulated Git authentication failure' } : { success: true };
    }
    if (channel === 'git-push') return { success: true };
    if (channel === 'execute-stored' && args[0]?.objectType === 'PACKAGE') { packageExecutions.push(args[0]); return { success: true, returnValues: [], dbmsOutput: [] }; }
    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_PKG_0') {
      if (/GET_DDL/.test(args[0])) return { success: true, rows: [{ DDL: 'CREATE PACKAGE BODY DEMO.UI_PKG_0 AS PROCEDURE A IS BEGIN NULL; END; PROCEDURE B IS BEGIN NULL; END; END;' }] };
      if (/ALL_PROCEDURES p/.test(args[0]) && !/ALL_OBJECTS/.test(args[0])) return { success: true, rows: [{ PROCEDURE_NAME: 'A', SUBPROGRAM_ID: 1, SIGNATURE: 'VARCHAR2' }, { PROCEDURE_NAME: 'B', SUBPROGRAM_ID: 2, SIGNATURE: 'VARCHAR2' }] };
      if (/ALL_OBJECTS/.test(args[0])) return { success: true, rows: [{ OBJECT_TYPE: 'PACKAGE', STATUS: 'VALID', AUTHID: 'DEFINER' }, { OBJECT_TYPE: 'PACKAGE BODY', STATUS: 'VALID', AUTHID: 'DEFINER' }] };
      if (/ALL_DEPENDENCIES/.test(args[0])) return { success: true, rows: [{ OWNER: 'DEMO', NAME: 'PACKAGE_LINKED_VIEW', TYPE: 'VIEW' }] };
      if (/ALL_ARGUMENTS/.test(args[0])) {
        if (!args[1].subProgram) return { success: true, rows: ['A', 'B'].map((name, index) => ({ PROCEDURE_NAME: name, SUBPROGRAM_ID: index + 1, ARGUMENT_NAME: name + '_VALUE', DATA_TYPE: 'VARCHAR2', POSITION: 1, IN_OUT: 'IN', DEFAULTED: 'Y' })) };
        if (args[1].subProgram === 'B' && !packageBFailed) { packageBFailed = true; return { success: false, error: 'Simulated package argument failure' }; }
        return { success: true, rows: [{ ARGUMENT_NAME: args[1].subProgram + '_VALUE', DATA_TYPE: 'VARCHAR2', IN_OUT: 'IN', POSITION: 1, DEFAULTED: args[1].subProgram === 'B' ? 'N' : 'Y', DEFAULT_LENGTH: 0 }] };
      }
    }
    if (channel === 'execute-sql-bg' && /FROM ALL_OBJECTS/.test(args[0]) && /OBJECT_TYPE = 'PACKAGE BODY'/.test(args[0])) return { success: true, rows: [{ OBJECT_NAME: 'UI_PKG_0' }] };
    if (channel === 'execute-sql' && /^CREATE (?:OR REPLACE )?PROCEDURE/.test(args[0])) { storedCompiles.push(args[0]); return { success: true, rows: [] }; }
    if (channel === 'execute-sql') queries.push(args[0]);
    if (channel === 'execute-sql' && /^CREATE OR REPLACE EDITIONABLE SYNONYM/.test(args[0])) {
      const marker = 'FOR "DEMO"."'; synonymTarget = args[0].split(marker)[1].split('"')[0];
    }
    if (channel === 'execute-sql' && holdRecordSubmit && /^INSERT/.test(args[0])) {
      holdRecordSubmit = false;
      return new Promise(resolve => { pendingRecordSubmit = resolve; });
    }
    if (channel === 'execute-sql' && holdImport && /^INSERT/.test(args[0])) {
      holdImport = false;
      return new Promise(resolve => { pendingImport = resolve; });
    }
    if (holdGenerator && channel === 'execute-sql' && /^INSERT/.test(args[0]) && /UI_GEN/.test(args[0])) {
      generatorBatches++;
      return new Promise(resolve => { finishGenerator = () => resolve({ success: true, rowsAffected: 500 }); });
    }
    if (channel === 'execute-sql' && /^INSERT/.test(args[0])) return { success: true, rowsAffected: /UI_GEN/.test(args[0]) ? 2 : 1 };
    if (channel === 'execute-sql-bg' && /ALL_USERS|information_schema.schemata/.test(args[0])) return { success: true, rows: (dbType === 'oracle' ? ['DEMO'] : ['DEMO', 'public']).map(USERNAME => ({ USERNAME })) };
    if (channel === 'execute-sql-bg' && /SELECT USER FROM DUAL/.test(args[0])) return { success: true, rows: [{ USER: 'DEMO' }] };
    if (channel === 'execute-sql-bg' && args[1]?.tableName === 'UI_GEN') {
      return { success: true, rows: /ALL_TAB_COLUMNS|information_schema.columns|PG_TYPE_SCHEMA/.test(args[0])
        ? [{ COLUMN_NAME: 'ID', DATA_TYPE: dbType === 'oracle' ? 'NUMBER' : 'bigint', NULLABLE: 'N' },
          ...(dbType === 'postgresql' ? [{ COLUMN_NAME: 'CLOCK', DATA_TYPE: 'time(6) without time zone', NULLABLE: 'Y' },
            { COLUMN_NAME: 'LOCATION', DATA_TYPE: 'point', NULLABLE: 'Y' }] : [])]
        : [{ COLUMN_NAME: 'ID' }] };
    }
    if (channel === 'execute-sql-bg' && !/WITH list/.test(args[0]) &&
        (/SELECT OBJECT_NAME FROM ALL_OBJECTS/.test(args[0]) || /SELECT table_name AS "OBJECT_NAME" FROM information_schema.tables/.test(args[0]))) {
      return { success: true, rows: [{ OBJECT_NAME: 'UI_GEN' }] };
    }
    if (channel === 'execute-sql-bg' && /ALL_TAB_COLUMNS|PG_TYPE_SCHEMA/.test(args[0]) && (args[1]?.tableName === 'UI_ITEM_0' || /UI_ITEM_0/.test(args[0]))) {
      tableMetadataCalls++;
      if (failTableMetadata) {
        failTableMetadata = false;
        const loader = document.querySelector('[data-testid="global-loader"]');
        initialTableLoaderVisible = !!loader && getComputedStyle(loader).visibility !== 'hidden' && Number(getComputedStyle(loader).opacity) > 0;
        return new Promise(resolve => { finishInitialTableMetadata = () => resolve({success:false,error:'Simulated table metadata failure'}); });
      }
    }
    if (channel === 'execute-sql' && failTableCount && /UI_ITEM_0/.test(args[0]) && /COUNT/.test(args[0])) {
      failTableCount = false; return { success: false, error: 'Simulated table count failure' };
    }
    if (channel === 'load-settings') return { ...generalSettings };
    if (channel === 'get-connections') return holdConnections ? new Promise(resolve => pendingConnections.push(resolve)) : savedConnections;
    if (channel === 'save-connection' && failCredentialSave) { failCredentialSave=false;credentialFailures++;return {success:false,error:credentialFailure}; }
    if (channel === 'save-connection' && !args[1] && savedConnections.some(connection => connection.name === args[0].name)) return { success: false, error: 'A saved connection already uses this name.' };
    if (channel === 'connect-db') { connectCalls++; return new Promise(resolve => { pendingConnect = resolve; }); }
    if (channel === 'show-open-folder-dialog') return { canceled: false, filePaths: ['/mock/oracle-client'] };
    if (channel === 'save-settings') {
      if (args[0]?.oracleClientPath === '/mock/oracle-client' && connectCalls === 0) {
        clientSaveCalls++;
        if (failClientSave) { failClientSave = false; return { success: false, error: 'Simulated client setting failure' }; }
      }
      generalSettingsWrites.push(args[0]);
      if (holdSettingsSave) {
        holdSettingsSave = false;
        return new Promise(resolve => { pendingSettingsSave = success => {
          if (success) generalSettings = { ...args[0] };
          resolve(success ? { success: true } : { success: false, error: 'Simulated general settings failure' });
        }; });
      }
      generalSettings = { ...args[0] };
      return { success: true };
    }
    if (channel === 'delete-connection') {
      deleteWrites++;
      return new Promise(resolve => { pendingDelete = success => {
        if (success) savedConnections = savedConnections.filter(connection => connection.name !== args[0]);
        resolve(success ? { success: true } : { success: false, error: 'Simulated connection deletion failure' });
      }; });
    }
    if (channel === 'save-connections-order') {
      orderWrites++;
      return new Promise(resolve => { pendingOrder = success => {
        if (success) savedConnections = args[0];
        resolve(success ? { success: true } : { success: false, error: 'Simulated connection order failure' });
      }; });
    }
    if (channel === 'disconnect-db') {
      disconnectCalls++;
      if (failNextDisconnect) { failNextDisconnect = false; throw new Error('Simulated disconnect cleanup failure'); }
      return true;
    }
    if (channel === 'get-schemas') {
      if (failInitialSchemas) { failInitialSchemas = false; return { success: false, error: 'Simulated initial schema failure' }; }
      return { success: true, schemas: schemaActive&&dbType==='postgresql'?[schemaName,'pgx','toast','public']:['DEMO', 'public'] };
    }
    if (channel === 'get-db-info') return { success: true, info: dbType === 'oracle' ? 'Oracle Database 23ai Free Release 23.0.0.0.0' : 'PostgreSQL 16.15' };
    if (channel === 'show-save-dialog') {
      if (holdExportBrowse) {
        holdExportBrowse = false; exportBrowseCalls++;
        return new Promise((resolve, reject) => { pendingExportBrowse = outcome => {
          if (outcome === 'failure') reject(new Error('Simulated export dialog failure'));
          else resolve({ canceled: outcome === 'cancel', filePath: '/mock/output.csv' });
        }; });
      }
      return { canceled: false, filePath: '/mock/tuning_info.txt' };
    }
    if (channel === 'open-data-export') { exportSnapshots++; return { success: true, exportId: 'ui-export', totalCount: 1 }; }
    if (channel === 'read-data-export' && holdExportRead) { holdExportRead = false; return new Promise(resolve => { pendingExportRead = resolve; }); }
    if (channel === 'read-data-export') return { success: true, rows: [{ LABEL: 'UI export row', STATE: 'open', CLOCK: '12:34:56.123456', ZCLOCK: '12:34:56.123456+05:45' }], done: true };
    if (channel === 'close-data-export') { exportCloses++; return { success: true }; }
    if (channel === 'save-file') {
      if (args[0] === '/mock/output.csv') { exportWriteCalls++; return new Promise(resolve => { pendingExportWrite = resolve; }); }
      tuningExports.push(args[1]); return { success: true };
    }
    if (channel === 'execute-sql-bg' && args[1]?.target === '"Archive.Mixed"."Order.Items"') {
      return { success: true, rows: /AS formatted_type/.test(args[0]) ? [{ column_name: 'id', formatted_type: 'integer', not_null: false, expression: null, identity: '', generated: '' }] : [] };
    }
    if (channel === 'execute-sql-bg' && /DBMS_METADATA.GET_DDL/.test(args[0]) && args[1]?.name === 'UI_PROC_0') {
      if (failStoredSource) { failStoredSource = false; return { success: false, error: 'Simulated stored source refresh failure' }; }
      return { success: true, rows: [{ DDL: 'CREATE PROCEDURE DEMO.UI_PROC_0 AS BEGIN NULL; END;' }] };
    }
    if (channel === 'execute-sql-bg' && /DBMS_METADATA.GET_DDL/.test(args[0]) && args[1]?.tableName === 'Order.Items') return { success: true, rows: [{ DDL: 'CREATE TABLE "Archive.Mixed"."Order.Items" (id NUMBER)' }] };
    if (channel === 'get-app-version') return '1.0.0';
    if (channel === 'explain-sql') return { success: true, executionSchema: dbType === 'oracle' ? 'DEMO' : undefined, metaData: [{ name: 'PLAN_TABLE_OUTPUT' }], rows: dbType === 'oracle' ? [
      { PLAN_TABLE_OUTPUT: '| 1 | TABLE ACCESS FULL | Order.Items | 1 | 1 | 1 | 1 |', PLAN_OBJECT_OWNER: 'Archive.Mixed', PLAN_OBJECT_NAME: 'Order.Items', PLAN_OBJECT_TYPE: 'TABLE' },
      { PLAN_TABLE_OUTPUT: '| 2 | INDEX RANGE SCAN | UI_ONLY_IDX | 1 | 1 | 1 | 1 |', PLAN_OBJECT_OWNER: 'Archive.Mixed', PLAN_OBJECT_NAME: 'UI_ONLY_IDX', PLAN_OBJECT_TYPE: 'INDEX' }
    ] : [{ PLAN_TABLE_OUTPUT: JSON.stringify([{ Plan: { 'Node Type': 'Append', Plans: [
      { 'Node Type': 'Seq Scan', Schema: 'Archive.Mixed', 'Relation Name': 'Order.Items', Alias: 'table_alias' },
      { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'UI_ONLY_IDX' },
      { 'Node Type': 'CTE Scan', Alias: 'UI_ONLY_ALIAS' }
    ] } }]) }] };

    if (channel === 'get-ai-settings') {
      if (holdAiSettings) { holdAiSettings = false; return new Promise(resolve => { pendingAiSettings = resolve; }); }
      return { success: true, isAiEnabled: false, modelName: 'ui-model', endpointUrl: '/mock/endpoint', apiKey: '' };
    }
    if (channel === 'save-ai-settings') {
      if(failAiCredentialSave){failAiCredentialSave=false;aiCredentialFailures++;return {success:false,error:credentialFailure};}
      aiSettingsWrites.push({ modelName: args[0].modelName, isAiEnabled: args[0].isAiEnabled });
      return { success: true, credentialsPersisted: true };
    }
    if (channel === 'ask-ai') throw new Error('AI calls are forbidden in UI tests.');
    if (channel === 'save-postgres-trigger') { triggerSaves.push(args[0]); return { success: true, hasUncommittedTx: false }; }
    if (channel === 'get-postgres-trigger') return { success: true, trigger: {
      trigger_oid: args[0].tableName === 'UI_ITEM_1' ? '43' : '42', trigger_name: 'UI_TRG_0', table_name: args[0].tableName, schema_name: 'public',
      tgtype: 19, enabled: 'D', relkind: 'r', language: 'plpgsql', function_users: '1', complex: true, when_condition: '(new.amount > 0)', update_columns: ['amount'],
      function_name: 'ActualHandler', function_schema: 'public', function_body: args[0].tableName === 'UI_ITEM_1' ? 'BEGIN RETURN OLD; END;' : 'BEGIN RETURN NEW; END;',
      trigger_ddl: 'CREATE TRIGGER UI_TRG_0 BEFORE UPDATE OF amount ON public.UI_ITEM_0 FOR EACH ROW WHEN (NEW.amount > 0) EXECUTE FUNCTION public.ActualHandler()',
      function_ddl: 'CREATE OR REPLACE FUNCTION public.ActualHandler() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END;$$'
    } };
    if (channel === 'delete-ai-object-history') return { success: true };
    if (channel === 'git-commit') return { success: true };
    if (channel === 'get-sql-history') return [{id:'ui-history-entry',executeTime:'2026-10-28 12:00:00',sql:'SELECT HISTORY_COPY',duration:3,rowCount:1}];
    if (channel === 'get-focus-diagnostics') return [];
    if (channel === 'execute-sql' && failViewCount && /UI_VIEW_0/.test(args[0]) && /COUNT/.test(args[0])) {
      failViewCount = false; return { success: false, error: 'Simulated view count failure' };
    }
    if (channel === 'execute-sql' && /^UPDATE/.test(args[0])) {
      const rowsAffected = zeroNextUpdate ? 0 : 1; zeroNextUpdate = false;
      return { success: true, rowsAffected, hasUncommittedTx: rowsAffected > 0 };
    }
    if (channel === 'execute-sql' && /COUNT\\(\\*\\)/.test(args[0])) return { success: true, rows: [{ CNT: 140 }], metaData: [] };
    if (channel === 'execute-sql' && /^ALTER SEQUENCE/.test(args[0])) { const match = /CACHE (\\d+)/.exec(args[0]); if (match) sequenceCache = match[1]; }
    if (channel === 'execute-sql-bg' && (/UI_SEQ_0/.test(args[0]) || args[1]?.name === 'UI_SEQ_0')) {
      if (failSequenceRead) { failSequenceRead = false; return { success: false, error: 'Simulated sequence metadata failure' }; }
      if (/ALL_DEPENDENCIES/.test(args[0])) return { success: true, rows: [{ OWNER: 'DEMO', NAME: 'SEQUENCE_ROWS', TYPE: 'TABLE' }] };
      if (/pg_describe_object/.test(args[0])) return { success: true, rows: [{ description: 'default for column id of table public.SEQUENCE_ROWS' }] };
      if (/AS kind/.test(args[0])) return { success: true, rows: [{ schema: 'public', table: 'SEQUENCE_ROWS', column: 'id', kind: 'a' }] };
      if (/pg_depend/.test(args[0])) return { success: true, rows: [] };
      if (/GET_DDL/.test(args[0])) return { success: true, rows: [{ DDL: 'CREATE SEQUENCE "DEMO"."UI_SEQ_0" START WITH 9007199254740993' }] };
      return { success: true, rows: [{ INCREMENT_BY: '1', LAST_NUMBER: '9007199254740993', MAX_VAL_STR: '9000000000000000000000000000', MIN_VAL_STR: '1', CACHE_SIZE: sequenceCache, CYCLE_FLAG: 'N', ORDER_FLAG: 'N', KEEP_VALUE: 'N', SESSION_FLAG: 'N', increment_by: '1', last_value: '9007199254740993', start_value: '1', max_value: '8000000000000000000', min_value: '1', cache_size: sequenceCache, cycle: false, data_type: 'bigint' }] };
    }
    if (channel === 'execute-sql' && /^(?:--[^\\n]*\\n\\s*)*CREATE OR REPLACE TYPE/.test(args[0])) { typeSource = args[0]; typeWrites.push(args[0]); queries.push(args[0]); return { success: true, rows: [] }; }
    if (channel === 'execute-sql' && /^ALTER TYPE/.test(args[0])) {
      typeWrites.push(args[0]); queries.push(args[0]);
      if (args[0].includes("'extra2'") && failEnumSecond) { failEnumSecond = false; return { success: false, error: 'Simulated second TYPE DDL failure' }; }
      enumLabels.push(args[0].includes("'extra1'") ? 'extra1' : 'extra2'); return { success: true, rows: [] };
    }
    if (channel === 'execute-sql-bg' && args[1]?.name === 'UI_TYPE_0' && dbType === 'oracle') {
      if (/GET_DDL/.test(args[0])) {
        if (failTypeSource) { failTypeSource = false; return { success: false, error: 'Simulated TYPE metadata failure' }; }
        return { success: true, rows: [{ DDL: /TYPE_BODY/.test(args[0]) ? 'CREATE TYPE BODY DEMO.UI_TYPE_0 AS MEMBER FUNCTION F RETURN NUMBER IS BEGIN RETURN BODY_TEST_ERROR; END; END;' : typeSource }] };
      }
      if (/ALL_OBJECTS/.test(args[0])) return { success: true, rows: [{ OBJECT_TYPE: 'TYPE', STATUS: 'VALID' }, { OBJECT_TYPE: 'TYPE BODY', STATUS: 'INVALID' }] };
      if (/ALL_ERRORS/.test(args[0])) return { success: true, rows: args[1].kind === 'TYPE BODY' ? [{ LINE: 1, POSITION: 1, TEXT: 'BODY_TEST_ERROR', ATTRIBUTE: 'ERROR' }] : [] };
      if (/ALL_TYPES/.test(args[0])) return { success: true, rows: [{ TYPECODE: 'OBJECT' }] };
      if (/ALL_TYPE_ATTRS/.test(args[0])) return { success: true, rows: [{ ATTR_NAME: 'ID', ATTR_TYPE_NAME: 'NUMBER' }] };
      if (/ALL_TYPE_METHODS/.test(args[0])) return { success: true, rows: [{ METHOD_NAME: 'F', METHOD_TYPE: 'MEMBER', PARAMETERS: 1, RESULTS: 1 }] };
      if (/ALL_DEPENDENCIES/.test(args[0])) return { success: true, rows: [{ OWNER: 'DEMO', NAME: 'TYPE_DEPENDENT', TYPE: 'TABLE' }] };
      return { success: true, rows: [] };
    }
    if (channel === 'execute-sql-bg' && args[1]?.name?.startsWith('UI_') && /t.oid::text AS oid/.test(args[0])) return { success: true, rows: [{ oid: '941' }] };
    if (channel === 'execute-sql-bg' && args[1]?.oid === '941' && /pg_depend/.test(args[0])) return { success: true, rows: [{ description: 'TYPE_DEPENDENT' }] };
    if (channel === 'execute-sql-bg' && args[1]?.objectName === 'UI_ENUM_0') {
      if (/pg_enum/.test(args[0])) return { success: true, rows: enumLabels.map(enumlabel => ({ enumlabel })) };
      return { success: true, rows: [{ typtype: 'e' }] };
    }
    if (channel === 'execute-sql-bg' && args[1]?.objectName === 'UI_TYPE_0') {
      if (/pg_attribute/.test(args[0])) return { success: true, rows: [{ attname: 'Note;Text', format_type: 'text' }] };
      return { success: true, rows: [{ typtype: 'c', relkind: 'c' }] };
    }
    if (channel === 'execute-sql-bg' && args[1]?.target?.includes('UI_ITEM_0')) {
      if (/AS formatted_type/.test(args[0])) return { success: true, rows: [{ column_name: 'AMOUNT', formatted_type: 'numeric(10,2)', expression: null, identity: '', generated: '', not_null: false }, { column_name: 'TAGS', formatted_type: 'text[]', expression: null, identity: '', generated: '', not_null: false }] };
      if (/SELECT c.conname/.test(args[0])) return { success: true, rows: [{ name: 'UI_POSITIVE', ddl: 'CHECK (("AMOUNT" > ' + (sourceRevision ? '10' : '0') + '))' }] };
      return { success: true, rows: [] };
    }
    if (channel === 'get-columns' && args[1] === 'UI_VIEW_0') return { success: true, columns: ['id', 'STAMP', 'LABEL', ...(viewAdded ? ['Added'] : [])] };
    if (channel === 'execute-sql' && /UI_VIEW_0/.test(args[0])) {
      const offset = Number(/OFFSET (\\d+)/.exec(args[0])?.[1] || 0);
      return { success: true, rows: Array.from({length: 50}, (_, i) => ({ id: '9007199254740993', STAMP: '2026-10-22T12:34:56.000Z', LABEL: 'VIEW_ROW_' + (offset + i), ...(viewAdded ? {Added:7} : {}) })), metaData: ['id', 'STAMP', 'LABEL', ...(viewAdded ? ['Added'] : [])].map(name => ({ name, dbTypeName: 'VARCHAR2' })) };
    }
    if (channel === 'execute-sql' && /UI_ITEM_0/.test(args[0])) {
      const offset = Number(/OFFSET (\\d+)/.exec(args[0])?.[1] || 0);
      const rowIdAlias = /t\\.ROWID AS "([^"]+)"/.exec(args[0])?.[1];
      return { success: true, rows: Array.from({length: 50}, (_, i) => ({ LABEL: dbType === 'oracle' && i === 1 ? null : dbType === 'oracle' && i === 2 ? '' : 'DATA_ROW_' + (offset + i), STATE: i === 1 ? null : i === 2 ? '' : 'open', CLOCK: '12:34:56.123456', ZCLOCK: '12:34:56.123456+05:45', id: 0, __row_id: 'duplicate', ORACLE_ROWID: 'business-rowid', [rowIdAlias || 'POSTGRES_CTID']: String(offset + i) })), metaData: (dbType === 'postgresql' ? ['LABEL', 'STATE', 'CLOCK', 'ZCLOCK'] : ['LABEL']).map(name => ({ name, dbTypeName: 'VARCHAR2', fetchType: 2001 })) };
    }
    if (channel === 'execute-sql-bg' && /PG_TYPE_SCHEMA/.test(args[0]) && args[1]?.tableName === 'UI_ITEM_0') return { success: true, rows: [
      { COLUMN_NAME: 'LABEL', DATA_TYPE: 'character varying(25)', PG_TYPE_SCHEMA: 'pg_catalog', PG_TYPE_NAME: 'varchar', PG_TYPE_KIND: 'b', PG_TYPE_CATEGORY: 'S', PK_POSITION: 1 },
      { COLUMN_NAME: 'STATE', DATA_TYPE: 'public."PrintStatus"', PG_TYPE_SCHEMA: 'public', PG_TYPE_NAME: 'PrintStatus', PG_TYPE_KIND: 'e', PG_TYPE_CATEGORY: 'E', PK_POSITION: '' },
      { COLUMN_NAME: 'CLOCK', DATA_TYPE: 'time(6) without time zone', PG_TYPE_SCHEMA: 'pg_catalog', PG_TYPE_NAME: 'time', PG_TYPE_KIND: 'b', PG_TYPE_CATEGORY: 'D', PK_POSITION: '' },
      { COLUMN_NAME: 'ZCLOCK', DATA_TYPE: 'time(6) with time zone', PG_TYPE_SCHEMA: 'pg_catalog', PG_TYPE_NAME: 'timetz', PG_TYPE_KIND: 'b', PG_TYPE_CATEGORY: 'D', PK_POSITION: '' }
    ] };
    if (channel === 'execute-sql-bg' && /ALL_TAB_COLUMNS|information_schema.columns|pg_catalog.pg_attribute/.test(args[0])) return { success: true, rows: (/UI_VIEW_0/.test(args[0]) ? ['id', 'STAMP', 'LABEL', ...(viewAdded ? ['Added'] : [])] : ['LABEL']).map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: dbType === 'oracle' ? 'VARCHAR2' : 'text' })) };
    if (channel === 'execute-sql-bg' && /WITH list/.test(args[0])) {
      sidebarCalls.push({sql:args[0],binds:args[1]});
      if (holdSidebar) { holdSidebar = false; return new Promise(resolve => { finishSidebar = resolve; }); }
      if (/OBJECT_TYPE = 'PACKAGE'/.test(args[0])) return { success: true, rows: [{ OBJECT_NAME: 'UI_PKG_0' }] };
      if (args[0].includes('SELECT MASTER AS OBJECT_NAME FROM ALL_MVIEW_LOGS')) return {success:true,rows:[{OBJECT_NAME:'UI_LOG_MASTER'}]};
      if (args[0].includes('SELECT DB_LINK AS OBJECT_NAME FROM ALL_DB_LINKS')) return {success:true,rows:[{OBJECT_NAME:'UI_LINK_0'}]};
      if (/SELECT MVIEW_NAME AS OBJECT_NAME FROM ALL_MVIEWS|FROM pg_matviews|relkind = 'm'/.test(args[0])) return {success:true,rows:[dbType==='oracle'?{OBJECT_NAME:'UI_MV_0'}:{name:'UI_MV_0',status:'VALID'}]};
      if (/FROM ALL_SYNONYMS/.test(args[0])) return {success:true,rows:[{OBJECT_NAME:'UI_SYN_0'}]};
      if (/FROM ALL_TRIGGERS/.test(args[0])) return {success:true,rows:[{OBJECT_NAME:'UI_TRG_0'}]};
      if (/OBJECT_TYPE = 'PROCEDURE'/.test(args[0])) return { success: true, rows: [{ OBJECT_NAME: 'UI_PROC_0' }] };
      if (/p.prokind = 'f'/.test(args[0])) return { success: true, rows: [{name:'UI_FN',signature:'integer',status:'VALID'},{name:'UI_FN',signature:'text',status:'VALID'}] };
      if (/FROM pg_trigger trg/.test(args[0])) return { success: true, rows: [{ name: 'UI_TRG_0', status: 'VALID', tableName: 'UI_ITEM_0' }, { name: 'UI_TRG_0', status: 'VALID', tableName: 'UI_ITEM_1' }] };
      if (/t.typtype = 'e'/.test(args[0])) return { success: true, rows: [{ name: 'UI_TYPE_0', status: 'VALID' }, { name: 'UI_ENUM_0', status: 'VALID' }] };
      if (/FROM ALL_TYPES/.test(args[0])) return { success: true, rows: [{ OBJECT_NAME: 'UI_TYPE_0' }] };
      if (/FROM ALL_SEQUENCES|relkind = 'S'/.test(args[0])) return { success: true, rows: [dbType === 'oracle' ? { OBJECT_NAME: 'UI_SEQ_0' } : { name: 'UI_SEQ_0', status: 'VALID' }] };
      if (/OBJECT_TYPE = 'VIEW'|relkind = 'v'/.test(args[0])) return { success: true, rows: [dbType === 'oracle' ? { OBJECT_NAME: 'UI_VIEW_0' } : { name: 'UI_VIEW_0', status: 'VALID' }] };
      const rows = Array.from({ length: /OFFSET 100/.test(args[0]) ? 1 : 100 }, (_, index) => {
        const name = /OFFSET 100/.test(args[0]) ? 'UI_MORE_ITEM' : 'UI_ITEM_' + index;
        return dbType === 'oracle' ? { OBJECT_NAME: name } : { name, status: 'VALID' };
      });
      return { success: true, rows };
    }
    return { success: true, rows: [], columns: [], objects: [], hasUncommittedTx: false };
  },
  on() { return () => {}; }
});
`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  console.error('UI state at timeout', await win.webContents.executeJavaScript(`JSON.stringify({credentialFailures:window.loginTest?.credentialFailures(),connections:window.loginTest?.connections(),loginCheckboxes:Array.from(document.querySelectorAll('label')).filter(el=>el.querySelector('input[type=checkbox]')).map(el=>({text:el.textContent,checked:el.querySelector('input').checked})),settings:window.settingsTest?.saved(),sqlErrors:Array.from(document.querySelectorAll('[data-testid="sql-log-error-line"]')).map(el=>({text:el.textContent,width:el.getBoundingClientRect().width})),generator:document.querySelector('[data-testid="data-generator"]')?.innerText,lock:document.querySelector('[data-testid="lock-tab"]')?.innerText,lockHeight:document.querySelector('[data-testid="lock-tab"]')?.getBoundingClientRect().height,dialogs:Array.from(document.querySelectorAll('[role=dialog]')).map(el=>el.textContent),selectButtons:Array.from(document.querySelectorAll('[aria-label="Select Table"]')).map(el=>({tag:el.tagName,text:el.textContent,disabled:el.matches(':disabled')}))})`));
  throw new Error(`UI condition timed out: ${expression}`);
}
app.on('window-all-closed', () => {});
let timeout = setTimeout(() => { console.error('UI startup timed out.'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    for (const dbType of ['oracle', 'postgresql']) {
      clearTimeout(timeout);
      timeout = setTimeout(() => { console.error(`${dbType}: UI tests timed out.`); app.exit(1); }, 90000);
      const errors = [], requests = [];
      const win = new BrowserWindow({ width: 1600, height: 1000, show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, partition: `test-${dbType}`,
          additionalArguments: [`--test-db=${dbType}`] } });
      const executeScript = win.webContents.executeJavaScript.bind(win.webContents);
      win.webContents.executeJavaScript = (script, ...args) => executeScript(script, ...args).catch(error => { console.error('Failed UI action:', script.slice(0, 500)); throw error; });
      try {
        win.webContents.on('console-message', event => {
          if (event.level !== 'error') return;
          errors.push(event.message);
          console.error(`${dbType}: renderer error: ${event.message}`);
          if (event.message.includes('useResizeContainer')) {
            void win.webContents.executeJavaScript(`JSON.stringify(Array.from(document.querySelectorAll('.MuiDataGrid-root')).map(grid => ({
              columns: Array.from(grid.querySelectorAll('[role=columnheader]')).map(header => header.textContent),
              containers: Array.from((function* () { for (let node = grid; node; node = node.parentElement) yield node; })()).map(node => ({
                tag: node.tagName, height: node.getBoundingClientRect().height, display: getComputedStyle(node).display
              }))
            })))`).then(layout => console.error(`${dbType}: grid layout: ${layout}`), () => {});
          }
        });
        win.webContents.on('preload-error', (_event, _file, error) => { errors.push(error.message); console.error(`${dbType}: preload error: ${error.message}`); });
        win.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
          requests.push(details.url);
          callback({ cancel: /^https?:/.test(details.url) });
        });
        const connect = `Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === 'Connect')`;
        const assertInformationRefresh = async () => {
          const buttons = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button'))
            .filter(button=>button.getBoundingClientRect().width>0 && ['Refresh','Reload'].includes(button.textContent.trim()))
            .map(button=>({ label:button.textContent.trim(), icon:!!button.querySelector('.MuiButton-startIcon svg'),
              outlined:button.classList.contains('MuiButton-outlined'), border:parseFloat(getComputedStyle(button).borderTopWidth) }))`);
          assert.ok(buttons.length, 'Information must expose a visible refresh action');
          assert.ok(buttons.every(button=>button.icon && button.outlined && button.border>0), 'Information refresh actions need an icon and a visible button border: '+JSON.stringify(buttons));
        };
        await win.loadFile(path.join(root, 'dist/index.html'));
        await win.webContents.executeJavaScript(`(() => {
          window.__gridWarnings = [];
          window.__noticeBridge = event => window.alert(event.detail.message);
          window.addEventListener('monabase-notification', window.__noticeBridge);
          const NativeResizeObserver = window.ResizeObserver;
          window.__gridResizeObservers = new Map();
          window.ResizeObserver = class {
            constructor(callback) {
              this.callback = callback; this.targets = new Set();
              this.native = new NativeResizeObserver(entries => callback(entries, this));
            }
            observe(target, options) {
              this.targets.add(target);
              window.__gridResizeObservers.set(target, { notify: () => this.callback([], this) });
              this.native.observe(target, options);
            }
            unobserve(target) { this.targets.delete(target); window.__gridResizeObservers.delete(target); this.native.unobserve(target); }
            disconnect() {
              for (const target of this.targets) window.__gridResizeObservers.delete(target);
              this.targets.clear(); this.native.disconnect();
            }
          };
          const originalError = console.error;
          console.error = (...args) => {
            if (args.some(value => typeof value === 'string' && value.includes('useResizeContainer'))) {
              window.__gridWarnings.push({ phase: window.__gridPhase || 'other', tabs:Array.from(document.querySelectorAll('[role=tab][aria-selected=true]')).map(el=>el.textContent), stack: new Error().stack,
                grids: Array.from(document.querySelectorAll('.MuiDataGrid-root')).map(grid => ({
                  parents:Array.from((function*(){for(let node=grid;node;node=node.parentElement)yield node;})()).map(el=>({tag:el.tagName,display:getComputedStyle(el).display,height:el.getBoundingClientRect().height})), connected: grid.isConnected, columns: Array.from(grid.querySelectorAll('[role=columnheader]')).map(el => el.textContent),
                  height: grid.getBoundingClientRect().height, parentHeight: grid.parentElement?.getBoundingClientRect().height,
                  mainHeight: grid.querySelector('.MuiDataGrid-main')?.getBoundingClientRect().height
                })) });
            }
            originalError.apply(console, args);
          };
        })()`);
        await waitFor(win, `!!(${connect}) && window.loginTest.waiting()`);
        const connectionName = `Array.from(document.querySelectorAll('input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent==='Connection Name (Save As)'))`;
        await waitFor(win, `!!(${connectionName})`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${connectionName}),'Unsaved UI draft');(${connectionName}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${connectionName}).value==='Unsaved UI draft'`);
        const originalContentSize = win.getContentSize();
        for (const [width,height] of [[720,520],[420,640]]) {
          win.setContentSize(width,height);
          const toggle = `document.querySelector('button[aria-controls="saved-connection-list"]')`;
          await waitFor(win, `(${toggle}).getBoundingClientRect().width>0 && getComputedStyle(document.getElementById('saved-connection-list')).display==='none'`);
          assert.equal(await win.webContents.executeJavaScript(`(()=>{const button=(${connect}),r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`), true);
          await win.webContents.executeJavaScript(`(${toggle}).click();true`);
          await waitFor(win, `(${toggle}).getAttribute('aria-expanded')==='true' && getComputedStyle(document.getElementById('saved-connection-list')).display!=='none'`);
          await win.webContents.executeJavaScript(`(${toggle}).click();true`);
          await waitFor(win, `(${toggle}).getAttribute('aria-expanded')==='false'`);
        }
        if (process.env.MONABASE_UI_CAPTURE_DIR) {
          fs.mkdirSync(process.env.MONABASE_UI_CAPTURE_DIR,{recursive:true});
          fs.writeFileSync(path.join(process.env.MONABASE_UI_CAPTURE_DIR,dbType+'-login.png'),(await win.webContents.capturePage()).toPNG());
        }
        win.setContentSize(...originalContentSize);
        await waitFor(win, `getComputedStyle(document.getElementById('saved-connection-list')).display!=='none'`);
        await win.webContents.executeJavaScript(`window.__loginAlerts=[];window.alert=message=>window.__loginAlerts.push(message);window.loginTest.release();true`);
        const connectionRows = `Array.from(document.querySelectorAll('.MuiListItemText-primary')).map(el=>el.textContent)`;
        await waitFor(win, `(${connectionRows}).length===2`);
        assert.equal(await win.webContents.executeJavaScript(`(${connectionName}).value`), 'Unsaved UI draft');
        const connectionSearch = `Array.from(document.querySelectorAll('input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent==='Search saved connections'))`;
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${connectionSearch}),'Other');(${connectionSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${connectionRows}).length===1 && (${connectionRows})[0]==='Other DB'`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="ArrowUpwardIcon"]').closest('button').disabled`), true);
        assert.equal(await win.webContents.executeJavaScript(`(${connectionName}).value`), 'Unsaved UI draft');
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${connectionSearch}),'');(${connectionSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${connectionRows}).length===2`);
        const down = `document.querySelector('[data-testid="ArrowDownwardIcon"]').closest('button')`;
        await win.webContents.executeJavaScript(`(${down}).click();(${down}).click();true`);
        await waitFor(win, `(${connect}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.loginTest.writes()`), 1);
        assert.deepEqual(await win.webContents.executeJavaScript(connectionRows), ['Test DB', 'Other DB']);
        await win.webContents.executeJavaScript(`window.loginTest.finishOrder(false);true`);
        await waitFor(win, `window.__loginAlerts.includes('Simulated connection order failure') && !(${connect}).disabled`);
        assert.deepEqual(await win.webContents.executeJavaScript(connectionRows), ['Test DB', 'Other DB']);
        await win.webContents.executeJavaScript(`(${down}).click();true`);
        await waitFor(win, `window.loginTest.writes()===2`);
        await win.webContents.executeJavaScript(`window.loginTest.finishOrder(true);true`);
        await waitFor(win, `(${connectionRows})[0]==='Other DB' && !(${connect}).disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.includes('Test DB')).click();true`);
        await waitFor(win, `(${connectionName}).value==='Test DB'`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='New').click();true`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${connectionName}),'Other DB');(${connectionName}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${connectionName}).value==='Other DB'`);
        await win.webContents.executeJavaScript(`(${connect}).click();true`);
        await waitFor(win, `window.__loginAlerts.includes('A saved connection already uses this name.')`);
        assert.equal(await win.webContents.executeJavaScript(`window.loginTest.connections()`), 0);
        assert.equal(await win.webContents.executeJavaScript(`(${connectionName}).value`), 'Other DB');
        const otherConnection = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.includes('Other DB'))`;
        const removeOther = `(${otherConnection}).closest('li').querySelector('[data-testid="DeleteIcon"]').closest('button')`;
        await win.webContents.executeJavaScript(`window.confirm=()=>true;(${otherConnection}).click();true`);
        await waitFor(win, `(${connectionName}).value==='Other DB'`);
        await win.webContents.executeJavaScript(`(${removeOther}).click();(${removeOther}).click();true`);
        await waitFor(win, `(${connect}).disabled && window.loginTest.deletions()===1`);
        await win.webContents.executeJavaScript(`window.loginTest.finishDelete(false);true`);
        await waitFor(win, `window.__loginAlerts.includes('Simulated connection deletion failure') && !(${connect}).disabled`);
        assert.deepEqual(await win.webContents.executeJavaScript(connectionRows), ['Other DB', 'Test DB']);
        assert.equal(await win.webContents.executeJavaScript(`(${connectionName}).value`), 'Other DB');
        await win.webContents.executeJavaScript(`(${removeOther}).click();true`);
        await waitFor(win, `window.loginTest.deletions()===2`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.includes('Test DB')).click();true`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${connectionName}),'Retained UI draft');(${connectionName}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${connectionName}).value==='Retained UI draft'`);
        await win.webContents.executeJavaScript(`window.loginTest.finishDelete(true);true`);
        await waitFor(win, `(${connectionRows}).length===1 && !(${connect}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`(${connectionName}).value`), 'Retained UI draft');
        await win.webContents.executeJavaScript(`document.querySelector('.MuiListItemButton-root').click();true`);
        await waitFor(win, `(${connectionName}).value==='Test DB'`);
        const environmentInput = `Array.from(document.querySelectorAll('input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent==='Environment label (optional)'))`;
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${environmentInput}),'Development');(${environmentInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        const environmentSelect = `Array.from(document.querySelectorAll('.MuiFormControl-root')).find(el=>el.textContent.includes('Identification color')).querySelector('[role=combobox]')`;
        await win.webContents.executeJavaScript(`(${environmentSelect}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        const identificationColor = dbType === 'oracle' ? 'blue' : 'purple';
        await waitFor(win, `!!document.querySelector('[role=option][data-value="${identificationColor}"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="${identificationColor}"]').click();true`);
        await waitFor(win, `(${environmentSelect}).closest('.MuiInputBase-root').querySelector('input').value==='${identificationColor}'`);
        assert.equal(requests.some(url => /App(?:Oracle|Postgresql)-.*\.js/.test(url)), false, 'Workspaces must load lazily');
        if (dbType === 'oracle') {
          const osAuth = `Array.from(document.querySelectorAll('label')).find(el=>el.textContent.includes('OS Authentication (External)')).querySelector('input')`;
          await win.webContents.executeJavaScript(`window.loginTest.failClientSave();(${osAuth}).click();true`);
          await win.webContents.executeJavaScript(`(${connect}).click();true`);
          await waitFor(win, `window.__loginAlerts.some(message=>message.includes('Could not save the Oracle Client folder setting')) && !(${connect}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`window.loginTest.connections()`), 0);
          assert.equal(await win.webContents.executeJavaScript(`window.loginTest.clientSaves()`), 1);
          assert.equal(await win.webContents.executeJavaScript(`window.__loginAlerts.some(message=>message.includes('OS authentication was canceled'))`), false);
        }
        const overwriteConnection = `Array.from(document.querySelectorAll('label')).find(el=>el.textContent.trim()==='Overwrite Connection').querySelector('input')`;
        await win.webContents.executeJavaScript(`if(!(${overwriteConnection}).checked)(${overwriteConnection}).click();true`);
        await waitFor(win, `(${overwriteConnection}).checked`);
        await win.webContents.executeJavaScript(`window.loginTest.failCredentialSave();(${connect}).click();true`);
        await waitFor(win, `window.loginTest.credentialFailures()===1 && !(${connect}).disabled`);
        assert.equal(await win.webContents.executeJavaScript('window.loginTest.connections()'), 0);
        assert.equal(await win.webContents.executeJavaScript(`(${connectionName}).value`), 'Test DB');
        assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('Your previous settings were preserved.')`), true);
        await win.webContents.executeJavaScript(`(${overwriteConnection}).click();true`);
        await waitFor(win, `!(${overwriteConnection}).checked`);
        await win.webContents.executeJavaScript(`window.confirm=()=>true;window.alert=message=>window.__loginAlerts.push(message);(${connect}).click();(${connect}).click();true`);
        await waitFor(win, `window.loginTest.connections()===1 && (${connect}).disabled`);
        if (dbType === 'oracle') assert.equal(await win.webContents.executeJavaScript(`window.loginTest.clientSaves()`), 2);
        await win.webContents.executeJavaScript(`window.loginTest.finishConnect();true`);
        await waitFor(win, `window.__loginAlerts.some(message=>message.includes('Simulated initial schema failure')) && !(${connect}).disabled && window.loginTest.disconnections()===1`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="persistent-notification"]').textContent.includes('Simulated initial schema failure')`), true);
        const copyNotice = `document.querySelector('[data-testid="persistent-notification"] button[aria-label="Copy details"]')`;
        await win.webContents.executeJavaScript(`window.clipboardTest.set('fail');(${copyNotice}).click();true`);
        await waitFor(win, `document.querySelector('[data-testid="persistent-notification"]').textContent.includes('Could not copy. Please try again.') && !(${copyNotice}).disabled`);
        await win.webContents.executeJavaScript(`window.clipboardTest.set('throw');(${copyNotice}).click();true`);
        await waitFor(win, `document.querySelector('[data-testid="persistent-notification"]').textContent.includes('Could not copy. Please try again.') && !(${copyNotice}).disabled`);
        await win.webContents.executeJavaScript(`window.clipboardTest.set('success');(${copyNotice}).click();true`);
        await waitFor(win, `document.querySelector('[data-testid="persistent-notification"]').textContent.includes('Copied') && !document.querySelector('[data-testid="persistent-notification"]').textContent.includes('Could not copy.')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelector('[data-testid="persistent-notification"]').querySelectorAll('button')).find(el=>el.textContent.startsWith('Notifications')).click();true`);
        await waitFor(win, `!!document.getElementById('notification-list-title') && document.querySelector('[role=dialog]').textContent.includes('Simulated connection order failure')`);
        const noticeCount = await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] li').length`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] li button[aria-label="Remove from notification history"]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] li').length===${noticeCount-1}`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Clear history').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog]').textContent.includes('No notifications')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="Commit"]')`), false);
        await win.webContents.executeJavaScript(`window.alert=message=>{throw new Error(message)};(${connect}).click();true`);
        await waitFor(win, `window.loginTest.connections()===2 && (${connect}).disabled`);
        await win.webContents.executeJavaScript(`window.loginTest.finishConnect();true`);
        await waitFor(win, `!!document.querySelector('button[aria-label="Commit"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('header button[aria-label="Notifications"]').click();true`);
        await waitFor(win, `!!document.getElementById('notification-list-title') && document.querySelector('[role=dialog]').textContent.includes('No notifications')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        // Workspace navigation operates on the existing tabs and respects busy/modal guards.
        await waitFor(win, `!!document.querySelector('button[aria-label="Find a command"]')`);
        const shortcut = async key => win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',ctrlKey:true,shiftKey:true,bubbles:true}));true`);
        await shortcut('p');
        await waitFor(win, `!!document.querySelector('[role=dialog] input[role=combobox]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true}));true`);
        await waitFor(win, `document.querySelectorAll('[role=tab][draggable=true]').length===3`);
        const initialTabCount = await win.webContents.executeJavaScript(`document.querySelectorAll('[role=tab][draggable=true]').length`);
        const searchInput = `document.querySelector('[role=dialog] input[role=combobox]')`;
        const selectedOption = `document.querySelector('[role=dialog] [role=option][aria-selected=true]')`;
        const navigationKey = keyCode => {
          win.webContents.sendInputEvent({type:'keyDown',keyCode});
          win.webContents.sendInputEvent({type:'keyUp',keyCode});
        };
        await shortcut('o');
        await waitFor(win, `!!(${searchInput}) && document.activeElement===(${searchInput}) && document.querySelectorAll('[role=dialog] [role=option]').length===3`);
        await win.webContents.insertText('SQL');
        await waitFor(win, `(${searchInput}).value==='SQL'`);
        await win.webContents.executeJavaScript(`(${searchInput}).setSelectionRange(2,2);true`);
        navigationKey('Home');
        await waitFor(win, `(${searchInput}).selectionStart===0 && (${selectedOption}).textContent.includes('SQL 1')`);
        navigationKey('End');
        await waitFor(win, `(${searchInput}).selectionStart===3 && (${selectedOption}).textContent.includes('SQL 1')`);
        navigationKey('Down');
        await waitFor(win, `(${selectedOption})?.textContent.includes('SQL 2')`);
        navigationKey('Up');
        await waitFor(win, `(${selectedOption})?.textContent.includes('SQL 1')`);
        await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] [role=option]')[2].focus();true`);
        navigationKey('Down');
        await waitFor(win, `document.activeElement===(${searchInput}) && (${selectedOption})?.textContent.includes('SQL 2')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] [role=option]').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,movementX:0,movementY:0}));true`);
        assert.equal(await win.webContents.executeJavaScript(`(${selectedOption}).textContent.includes('SQL 2')`), true);
        navigationKey('Return');
        await waitFor(win, `!document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('[role=tab][draggable=true][aria-selected=true]')).some(el=>el.textContent==='SQL 2')`);
        await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Find an open tab"]').click();true`);
        await waitFor(win, `!!(${searchInput}) && document.activeElement===(${searchInput})`);
        navigationKey('Up');
        await waitFor(win, `(${selectedOption})?.textContent.includes('SQL 3')`);
        navigationKey('Return');
        await waitFor(win, `!document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('[role=tab][draggable=true][aria-selected=true]')).some(el=>el.textContent==='SQL 3')`);
        await shortcut('o');
        await waitFor(win, `!!(${searchInput}) && document.activeElement===(${searchInput})`);
        await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] [role=option]')[1].focus();true`);
        navigationKey('Return');
        await waitFor(win, `!document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('[role=tab][draggable=true][aria-selected=true]')).some(el=>el.textContent==='SQL 2')`);
        await shortcut('o');
        await waitFor(win, `!!document.querySelector('[role=dialog] input[role=combobox]')`);
        await win.webContents.executeJavaScript(`const input=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'SQL 1');input.dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] [role=option]').length===1`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[role=tab][draggable=true]').length`), initialTabCount);
        await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close SQL 2"]').click();document.querySelector('button[aria-label="Close SQL 3"]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=tab][draggable=true]').length===1`);
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('toggle-global-loader',{detail:true}));true`);
        await waitFor(win, `document.querySelector('button[aria-label="Find a command"]').disabled`);
        await shortcut('p');
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]')`), false);
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('toggle-global-loader',{detail:false}));true`);
        await waitFor(win, `!document.querySelector('button[aria-label="Find a command"]').disabled`);
        // A real hosted success must not invoke the native blocking alert fallback.
        await win.webContents.executeJavaScript(`window.removeEventListener('monabase-notification',window.__noticeBridge);document.querySelector('button[aria-label="Commit"]').click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=status]')).some(el=>el.textContent.includes('Transaction committed (saved).'))`);
        await win.webContents.executeJavaScript(`window.addEventListener('monabase-notification',window.__noticeBridge);true`);
        const separator = `document.querySelector('[role=separator][aria-label="Resize the object sidebar"]')`;
        const initialWidth = await win.webContents.executeJavaScript(`Number((${separator}).getAttribute('aria-valuenow'))`);
        await win.webContents.executeJavaScript(`(${separator}).focus();(${separator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));true`);
        await waitFor(win, `Number((${separator}).getAttribute('aria-valuenow'))===${initialWidth + 16}`);
        await win.webContents.executeJavaScript(`(${separator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));true`);
        await waitFor(win, `Number((${separator}).getAttribute('aria-valuenow'))===${initialWidth}`);
        await waitFor(win, `localStorage.getItem('monabase.panel-width.${dbType}.sidebar')===String(${initialWidth})`);
        // A committed success remains available after its transient popup is closed.
        const successPopup = `document.querySelector('.MuiSnackbar-root')`;
        await waitFor(win, `!!(${successPopup})`);
        await win.webContents.executeJavaScript(`(${successPopup}).querySelector('button').click();document.querySelector('header button[aria-label="Notifications"]').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog]').textContent.includes('Transaction committed (saved).') && !!document.querySelector('[role=dialog] time[datetime]')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        const openGeneralSettings = async () => {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('header button')).find(button=>button.textContent.trim()==='Settings').click();true`);
          await waitFor(win, `!!document.querySelector('[role=menuitem] [data-testid=SettingsIcon]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=menuitem] [data-testid=SettingsIcon]').closest('[role=menuitem]').click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] input[type=number]')`);
        };
        await openGeneralSettings();
        await shortcut('p');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog]').length`), 1);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog] input[role=combobox]')`), false);
        const timeoutInput = `document.querySelector('[role=dialog] input[type=number]')`;
        const settingsSave = `document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child')`;
        const maxTabsInput = `Array.from(document.querySelectorAll('[role=dialog] input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent.includes('Max visible tabs')))`;
        const writesBeforeInvalid = await win.webContents.executeJavaScript(`window.settingsTest.writes().length`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${maxTabsInput}),'');(${maxTabsInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${maxTabsInput}).value==='' && (${maxTabsInput}).getAttribute('aria-invalid')==='true'`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] [role=tab]')).find(el=>el.textContent==='Files').click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] [role=tab][aria-selected=true]')).some(el=>el.textContent==='Files')`);
        await win.webContents.executeJavaScript(`(${settingsSave}).click();true`);
        await waitFor(win, `document.activeElement===(${maxTabsInput}) && document.querySelector('[role=dialog]').textContent.includes('Enter a value.')`);
        assert.equal(await win.webContents.executeJavaScript(`window.settingsTest.writes().length`), writesBeforeInvalid);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${maxTabsInput}),'20');(${maxTabsInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await win.webContents.executeJavaScript(`window.__settingsAlerts=[];window.alert=message=>window.__settingsAlerts.push(message);window.settingsTest.hold();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${timeoutInput}),'17');(${timeoutInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${timeoutInput}).value==='17'`);
        const historySwitch = `Array.from(document.querySelectorAll('[role=dialog] label')).find(el=>el.textContent.includes('Save SQL execution history')).querySelector('input')`;
        assert.equal(await win.webContents.executeJavaScript(`(${historySwitch}).checked`), true);
        await win.webContents.executeJavaScript(`(${historySwitch}).click();true`);
        await waitFor(win, `!(${historySwitch}).checked`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] [role=tab]')).find(el=>el.textContent==='AI').click();true`);
        const aiSendKeySelect = `Array.from(document.querySelectorAll('[role=dialog] .MuiFormControl-root')).find(el=>el.textContent.includes('AI request send key')).querySelector('[role=combobox]')`;
        await win.webContents.executeJavaScript(`(${aiSendKeySelect}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=option][data-value="modifier-enter"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="modifier-enter"]').click();true`);
        await waitFor(win, `(${aiSendKeySelect}).closest('.MuiInputBase-root').querySelector('input').value==='modifier-enter'`);
        const aiSizeInput = `document.querySelector('[data-testid=ai-response-settings] input[type=number]')`;
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${aiSizeInput}),'24');(${aiSizeInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${aiSizeInput}).value==='24'`);
        await win.webContents.executeJavaScript(`const inputs=document.querySelectorAll('[data-testid=ai-response-settings] input[type=number]');[180,900].forEach((value,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[index+1],String(value));inputs[index+1].dispatchEvent(new Event('input',{bubbles:true}));});true`);

        await win.webContents.executeJavaScript(`(()=>{Array.from(document.querySelectorAll('[role=dialog] [role=tab]')).find(el=>el.textContent==='Files').click();const inputs=document.querySelectorAll('[data-testid=file-read-settings] input');[8,24].forEach((value,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[index],String(value));inputs[index].dispatchEvent(new Event('input',{bubbles:true}));});return true;})()`);
        await waitFor(win, `document.querySelector('[data-testid=file-read-settings] input').value==='8'`);
        const beforeSettingsWrites = await win.webContents.executeJavaScript(`window.settingsTest.writes().length`);
        await win.webContents.executeJavaScript(`(${settingsSave}).click();(${settingsSave}).click();true`);
        await waitFor(win, `(${settingsSave}).disabled && (${timeoutInput}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.settingsTest.writes().length`), beforeSettingsWrites + 1);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.settingsTest.finish(false);true`);
        await waitFor(win, `window.__settingsAlerts.includes('Failed to save settings.') && !(${settingsSave}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`(${timeoutInput}).value`), '17');
        assert.equal(await win.webContents.executeJavaScript(`window.settingsTest.saved().queryTimeout`), 0);
        await win.webContents.executeJavaScript(`(${settingsSave}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        const confirmedSettings = await win.webContents.executeJavaScript(`window.settingsTest.saved()`);
        assert.equal(confirmedSettings.queryTimeout, 17);
        assert.equal(confirmedSettings.sqlHistoryEnabled, false);
        assert.equal(confirmedSettings.aiSendKey, 'modifier-enter');
        assert.equal(confirmedSettings.aiResponseMaxMb, 24);
        assert.equal(confirmedSettings.sqlFileMaxMb, 8);
        assert.equal(confirmedSettings.erFileMaxMb, 24);
        assert.equal(confirmedSettings.aiIdleTimeoutSeconds, 180);
        assert.equal(confirmedSettings.aiRequestTimeoutSeconds, 900);
        assert.equal(confirmedSettings.erNotation, 'barker');
        assert.equal(confirmedSettings.oracleClientPath, dbType === 'oracle' ? '/mock/oracle-client' : '');
        await openGeneralSettings();
        assert.equal(await win.webContents.executeJavaScript(`(${timeoutInput}).value`), '17');
        assert.equal(await win.webContents.executeJavaScript(`(${historySwitch}).checked`), false);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] [role=tab]')).find(el=>el.textContent==='Files').click();true`);
        assert.deepEqual(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid=file-read-settings] input')).map(el=>el.value)`), ['8','24']);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] [role=tab]')).find(el=>el.textContent==='AI').click();true`);
        assert.equal(await win.webContents.executeJavaScript(`(${aiSizeInput}).value`), '24');
        assert.equal(await win.webContents.executeJavaScript(`(${aiSendKeySelect}).closest('.MuiInputBase-root').querySelector('input').value`), 'modifier-enter');
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] [role=tab]')).find(el=>el.textContent==='Oracle').click();true`);
        if (dbType === 'oracle') assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog] input[value="/mock/oracle-client"]')`), true);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Cancel').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        const beforeUsageQueries = await win.webContents.executeJavaScript(`window.uiTest.queries().length`);
        await win.webContents.executeJavaScript(`window.usageTest.holdNext();Array.from(document.querySelectorAll('header button')).find(el=>el.textContent.trim()==='AI').click();true`);
        const usageMenu = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='AI usage history')`;
        await waitFor(win, `!!(${usageMenu})`);
        await win.webContents.executeJavaScript(`(${usageMenu}).click();true`);
        const usageTotals = `document.querySelector('[data-testid="ai-usage-totals"]')`;
        const usageMonthInput = `document.querySelector('[role=dialog] input[type=month]')`;
        const usageButton = text => `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
        await waitFor(win, `!!(${usageTotals}) && window.usageTest.years().length===1 && (${usageTotals}).textContent.includes('—')`);
        await win.webContents.executeJavaScript(`window.usageTest.finish(false);true`);
        await waitFor(win, `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('Simulated usage load failure')`);
        assert.ok(await win.webContents.executeJavaScript(`(${usageTotals}).textContent.includes('—')`));
        await win.webContents.executeJavaScript(`window.usageTest.holdNext();(${usageButton('Retry')}).click();true`);
        await waitFor(win, `window.usageTest.years().length===2 && !document.querySelector('[role=dialog] [role=alert]') && (${usageTotals}).textContent.includes('—')`);
        await win.webContents.executeJavaScript(`window.usageTest.finish(true);true`);
        await waitFor(win, `!(${usageTotals}).textContent.includes('—')`);
        const setUsageMonth = value => win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${usageMonthInput}),${JSON.stringify(value)});(${usageMonthInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await setUsageMonth('2025-09');
        await waitFor(win, `document.querySelector('[role=dialog]').textContent.includes('UI_USAGE_MODEL') && !(${usageTotals}).textContent.includes('—')`);
        assert.deepEqual(await win.webContents.executeJavaScript(`Array.from((${usageTotals}).children).map(el=>el.textContent.split(':').at(-1).trim())`), ['12','3']);
        const beforeSameYearMonth = await win.webContents.executeJavaScript(`window.usageTest.years().length`);
        await win.webContents.executeJavaScript(`(${usageButton('Next month')}).click();true`);
        await waitFor(win, `(${usageMonthInput}).value==='2025-10' && document.querySelector('[role=dialog]').textContent.includes('No AI usage history for this month.')`);
        assert.deepEqual(await win.webContents.executeJavaScript(`Array.from((${usageTotals}).children).map(el=>el.textContent.split(':').at(-1).trim())`), ['0','0']);
        assert.equal(await win.webContents.executeJavaScript(`window.usageTest.years().length`), beforeSameYearMonth);
        await setUsageMonth('');
        await waitFor(win, `(${usageMonthInput}).getAttribute('aria-invalid')==='true'`);
        await win.webContents.executeJavaScript(`(${usageButton('This month')}).click();true`);
        await waitFor(win, `(${usageMonthInput}).value===new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0') && (${usageMonthInput}).getAttribute('aria-invalid')==='false' && !(${usageTotals}).textContent.includes('—')`);
        await win.webContents.executeJavaScript(`(${usageButton('Close')}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), beforeUsageQueries);
        await win.webContents.executeJavaScript(`window.__gitAlerts=[];window.__gitConfirmations=[];window.alert=message=>window.__gitAlerts.push(message);window.confirm=message=>{window.__gitConfirmations.push(message);return true};true`);
        const gitMenu = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='GIT')`;
        await win.webContents.executeJavaScript(`(${gitMenu}).click();true`);
        const gitSettings = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Git Settings...')`;
        await waitFor(win, `!!(${gitSettings})`);
        await win.webContents.executeJavaScript(`(${gitSettings}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog] input[value="feature/demo"]')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[value="feature/demo"]').readOnly`), true);
        const setup = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Save and perform initial push')`;
        await waitFor(win, `!!(${setup}) && !(${setup}).disabled`);
        await win.webContents.executeJavaScript(`(${setup}).click();true`);
        await waitFor(win, `window.__gitAlerts.some(message=>message.includes('Simulated Git authentication failure'))`);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]')`), true, 'Failed setup preserves the dialog for retry');
        await waitFor(win, `!(${setup}).disabled`);
        await win.webContents.executeJavaScript(`(${setup}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`(${gitMenu}).click();true`);
        const push = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Git Push (Send local changes)')`;
        await waitFor(win, `!!(${push})`);
        await win.webContents.executeJavaScript(`(${push}).click();true`);
        await waitFor(win, `window.__gitAlerts.includes('Git Push completed!')`);
        assert.equal(await win.webContents.executeJavaScript(`window.__gitConfirmations.some(message=>message.includes('number of unpushed commits is unknown'))`), true);
        await win.webContents.executeJavaScript(`window.uiTest.holdAiSettings();Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='AI').click();true`);
        const aiSettings = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='AI settings...')`;
        await waitFor(win, `!!(${aiSettings})`);
        await win.webContents.executeJavaScript(`(${aiSettings}).click();true`);
        const aiModel = `Array.from(document.querySelectorAll('[role=dialog] input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent==='Model name'))`;
        const aiSave = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Save')`;
        await waitFor(win, `!!(${aiModel}) && document.body.innerText.includes('Loading AI settings')`);
        assert.equal(await win.webContents.executeJavaScript(`(${aiModel}).disabled && (${aiSave}).disabled`), true);
        await win.webContents.executeJavaScript(`window.uiTest.failAiSettings();true`);
        await waitFor(win, `document.body.innerText.includes('Simulated AI settings load failure')`);
        assert.equal(await win.webContents.executeJavaScript(`(${aiSave}).disabled`), true);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.aiSettingsWrites().length`), 0);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Retry').click();true`);
        await waitFor(win, `!!(${aiSave}) && !(${aiSave}).disabled`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);
        await waitFor(win, `!(${aiModel}).disabled`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${aiModel}),'edited-ui-model');(${aiModel}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${aiModel}).value==='edited-ui-model'`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);
        await win.webContents.executeJavaScript(`window.uiTest.failAiCredentialSave();(${aiSave}).click();true`);
        await waitFor(win, `window.uiTest.aiCredentialFailures()===1 && !!document.querySelector('[role=dialog]') && !(${aiSave}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`(${aiModel}).value`), 'edited-ui-model');
        assert.deepEqual(await win.webContents.executeJavaScript('window.uiTest.aiSettingsWrites()'), []);
        await win.webContents.executeJavaScript(`(${aiSave}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.deepEqual(await win.webContents.executeJavaScript(`window.uiTest.aiSettingsWrites()`), [{ modelName: 'edited-ui-model', isAiEnabled: false }]);
        await win.webContents.executeJavaScript(`window.alert=message=>{throw new Error(message)};true`);
        const schema = dbType === 'oracle' ? 'DEMO' : 'public';
        await win.webContents.executeJavaScript(`(()=>{const row=document.getElementById('schema-${schema}');if(row?.querySelector('[data-testid="ExpandMoreIcon"]'))row.click();})()`);
        const category = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el => /^Tables?$/.test(el.textContent.trim()))`;
        await waitFor(win, `!!(${category})`);
        await win.webContents.executeJavaScript(`(${category}).click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_ITEM_0')`);
        const loadMore = `Array.from(document.querySelectorAll('[role=button],button')).find(el=>/show.*more/i.test(el.textContent))`;
        await waitFor(win, `!!(${loadMore})`);
        await win.webContents.executeJavaScript(`(${loadMore}).click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_MORE_ITEM')`);
        await win.webContents.executeJavaScript(`(${category}).click();true`);
        await waitFor(win, `!document.body.innerText.includes('UI_ITEM_0')`);
        await win.webContents.executeJavaScript(`(${category}).click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_MORE_ITEM')`);
        const firstObject = `document.querySelector('[data-sidebar-list] [data-sidebar-object]')`;
        const sidebar = `document.querySelector('[data-sidebar-list]')`;
        await win.webContents.executeJavaScript(`(${firstObject}).click();(${firstObject}).focus();true`);
        assert.equal(await win.webContents.executeJavaScript(`(${sidebar}).querySelectorAll('[aria-current=true]').length`), 1);
        await win.webContents.executeJavaScript(`(${firstObject}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);
        assert.equal(await win.webContents.executeJavaScript(`document.activeElement.textContent`), 'UI_ITEM_1');
        await win.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));true`);
        assert.equal(await win.webContents.executeJavaScript(`document.activeElement===(${category})`), true);
        await win.webContents.executeJavaScript(`(${category}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));true`);
        await waitFor(win, `(${category}).getAttribute('aria-expanded')==='false'`);
        await win.webContents.executeJavaScript(`(${category}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));true`);
        await waitFor(win, `(${category}).getAttribute('aria-expanded')==='true' && document.body.innerText.includes('UI_MORE_ITEM')`);
        await win.webContents.executeJavaScript(`(${firstObject}).focus();(${firstObject}).dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=menu]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
        await waitFor(win, `!document.querySelector('[role=menu]')`);
        const categoryBody = `(${category}).nextElementSibling`;
        await win.webContents.executeJavaScript(`window.uiTest.holdSidebar();(${categoryBody}).querySelector('[data-testid=RefreshIcon]').closest('button').click();true`);
        await waitFor(win, `!!(${categoryBody}).querySelector('[role=status]')`);
        assert.equal(await win.webContents.executeJavaScript(`(${sidebar}).textContent.includes('UI_MORE_ITEM')`), true);
        await win.webContents.executeJavaScript(`window.uiTest.failSidebar();true`);
        await waitFor(win, `!!(${categoryBody}).querySelector('[role=alert]')`);
        assert.equal(await win.webContents.executeJavaScript(`(${sidebar}).textContent.includes('UI_MORE_ITEM')`), true);
        await win.webContents.executeJavaScript(`(${categoryBody}).querySelector('[role=alert] button').click();true`);
        await waitFor(win, `!(${categoryBody}).querySelector('[role=alert]') && !(${categoryBody}).querySelector('[role=status]')`);
        assert.equal(await win.webContents.executeJavaScript(`(${categoryBody}).textContent.includes('Showing 100 items')`), true);
        const sidebarSearch = `(${categoryBody}).querySelector('input')`;
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${sidebarSearch}),'a_%!');(${sidebarSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `window.uiTest.sidebarCalls().at(-1).binds.filter==='%a!_!%!!%' && !(${categoryBody}).querySelector('[role=status]')`);
        await win.webContents.executeJavaScript(`(${categoryBody}).querySelector('button[aria-label="Clear search"]').click();true`);
        await waitFor(win, `(${sidebarSearch}).value==='' && !(${categoryBody}).querySelector('[role=status]')`);
        if (dbType === 'postgresql') {
          const functions = `Array.from((${sidebar}).querySelectorAll('[data-sidebar-row]')).find(el=>/^Functions?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${functions}).click();true`);
          await waitFor(win, `(${sidebar}).textContent.includes('UI_FN(text)')`);
          const routine = `Array.from((${sidebar}).querySelectorAll('[data-sidebar-object]')).find(el=>el.textContent==='UI_FN(text)')`;
          await win.webContents.executeJavaScript(`(${routine}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:150}));true`);
          await waitFor(win, `!!document.querySelector('[role=menu]')`);
          assert.equal(await win.webContents.executeJavaScript(`(${sidebar}).querySelectorAll('[aria-current=true]').length===1 && (${routine}).getAttribute('aria-current')==='true'`), true);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent==='Open') && !Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent==='Drop')`), true);
          await win.webContents.executeJavaScript(`document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
          await waitFor(win, `!document.querySelector('[role=menu]')`);
          await win.webContents.executeJavaScript(`(${functions}).click();true`);
        }
        const other = dbType === 'oracle' ? 'AppPostgresql' : 'AppOracle';
        assert.equal(requests.some(url => url.includes(`/${other}-`)), false, 'Unselected workspace must remain unloaded');
        await win.webContents.executeJavaScript(`window.__tableAlerts=[];window.alert=message=>window.__tableAlerts.push(message);window.uiTest.clear();true`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_ITEM_0').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`);
        await waitFor(win, `window.tableOpeningTest.waiting()`);
        assert.equal(await win.webContents.executeJavaScript('window.tableOpeningTest.loaderVisibleAtMetadata()'), true, 'The full-screen loader must be painted before the first metadata request');
        assert.equal(await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-testid="global-loader"]');const r=el.getBoundingClientRect();return getComputedStyle(el).visibility!=='hidden' && r.width>=innerWidth && r.height>=innerHeight})()`), true);
        await win.webContents.executeJavaScript('window.tableOpeningTest.release();true');
        await waitFor(win, `window.__tableAlerts.some(message=>message.includes('Simulated table metadata failure'))`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.metadataCalls()'), 1);
        assert.equal(await win.webContents.executeJavaScript("window.uiTest.queries().filter(sql=>/UI_ITEM_0/.test(sql)).length"), 0, 'No main query before valid column metadata');
        const tableExecute = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute' && el.getBoundingClientRect().width>0)`;
        await win.webContents.executeJavaScript(`(${tableExecute}).click();true`);
        await waitFor(win, `document.body.innerText.includes('DATA_ROW_0')`);
        const inspectFetchedCell = async (selector, expected) => {
          const before = await win.webContents.executeJavaScript(`window.uiTest.queries().length`);
          const menuItem = label => `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent===${JSON.stringify(label)})`;
          await win.webContents.executeJavaScript(`(${selector}).focus();(${selector}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:400}));true`);
          await waitFor(win, `!!(${menuItem('View value')}) && !!(${menuItem('Copy value')})`);
          await win.webContents.executeJavaScript(`(${menuItem('View value')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] textarea[readonly]')`);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] textarea[readonly]').value`), expected);
          await win.webContents.executeJavaScript(`window.clipboardTest.set('success');Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Copy value').click();true`);
          await waitFor(win, `window.clipboardTest.values().at(-1)===${JSON.stringify(expected)}`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && document.activeElement===(${selector})`);
          for (const key of ['F10','ContextMenu']) {
            await win.webContents.executeJavaScript(`(${selector}).focus();(${selector}).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},shiftKey:${key === 'F10'},bubbles:true,cancelable:true}));true`);
            await waitFor(win, `!!(${menuItem('View value')})`);
            assert.equal(await win.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('[role=menu]').getBoundingClientRect();return rect.left>10 && rect.top>10;})()`), true);
            if (key==='F10') {
              await win.webContents.executeJavaScript(`(${menuItem('View value')}).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));true`);
              await waitFor(win, `!document.querySelector('[role=menu]') && document.activeElement===(${selector})`);
            } else {
              await win.webContents.executeJavaScript(`(${menuItem('View value')}).click();true`);
              await waitFor(win, `!!document.querySelector('[role=dialog] textarea[readonly]')`);
              await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
              await waitFor(win, `!document.querySelector('[role=dialog]') && document.activeElement===(${selector})`);
            }
          }
          const copiedCount = await win.webContents.executeJavaScript(`window.clipboardTest.values().length`);
          await win.webContents.executeJavaScript(`(${selector}).dispatchEvent(new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true,cancelable:true}));true`);
          await waitFor(win, `!!(${menuItem('Copy value')})`);
          await win.webContents.executeJavaScript(`(${menuItem('Copy value')}).click();true`);
          await waitFor(win, `window.clipboardTest.values().length===${copiedCount+1} && !document.querySelector('[role=menu]') && document.activeElement===(${selector})`);
          assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), before);
        };
        await inspectFetchedCell(`Array.from(document.querySelectorAll('[data-testid="table-data"] [data-field="LABEL"]')).find(el=>el.textContent==='DATA_ROW_0')`, 'DATA_ROW_0');

        assert.equal(await win.webContents.executeJavaScript('window.uiTest.metadataCalls()'), 2, 'Execute retries metadata initialization');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[data-testid="table-data"] [data-db-null]').length>0`), true);
        const draftFilter = `document.querySelector('[data-testid="table-data"] input[placeholder="Enter value"]')`;
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${draftFilter}),'draft only');(${draftFilter}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `document.body.innerText.includes('Search conditions have changed. Execute to apply them.')`);
        const conditionSearch = `Array.from(document.querySelectorAll('[data-testid="table-data"] input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent.includes('Find a column')))`;
        const beforeConditionQueries = await win.webContents.executeJavaScript(`window.uiTest.queries().length`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${conditionSearch}),'not-a-column');(${conditionSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `document.querySelector('[data-testid="table-data"]').textContent.includes('No matching columns.') && document.querySelector('[data-testid="table-data"]').textContent.includes('hidden column')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid="table-data"] button')).find(el=>el.textContent==='Clear all conditions').click();true`);
        await waitFor(win, `!document.body.innerText.includes('Search conditions have changed. Execute to apply them.')`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), beforeConditionQueries);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${conditionSearch}),'');(${conditionSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${draftFilter}),'');(${draftFilter}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `!document.body.innerText.includes('Search conditions have changed. Execute to apply them.')`);
        await win.webContents.executeJavaScript(`window.__recordSubmitAlerts=[];window.alert=message=>window.__recordSubmitAlerts.push(message);document.querySelector('[aria-label="Add New Record (Ctrl+I)"] button').click();true`);
        const newRecordInput = `Array.from(document.querySelectorAll('[role=dialog] input')).find(input=>Array.from(input.labels||[]).some(label=>label.textContent.startsWith('LABEL ')))`;
        const submitRecord = `document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child')`;
        await waitFor(win, `!!(${newRecordInput})`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${newRecordInput}),'Retained record');(${newRecordInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${newRecordInput}).value==='Retained record'`);
        for (const affected of ['0', 'undefined', '1']) {
          await win.webContents.executeJavaScript(`window.uiTest.clear();window.recordTest.hold();(${submitRecord}).click();(${submitRecord}).click();true`);
          await waitFor(win, `window.uiTest.queries().filter(sql=>/^INSERT/.test(sql)).length===1 && (${submitRecord}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${newRecordInput}).disabled`), true);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiDialogActions-root button:first-child').disabled`), true);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.recordTest.finish(${affected});true`);
          if (affected !== '1') {
            await waitFor(win, `!(${submitRecord}).disabled`);
            assert.equal(await win.webContents.executeJavaScript(`(${newRecordInput}).value`), 'Retained record');
            assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 1);
          } else await waitFor(win, `!document.querySelector('[role=dialog]')`);
        }
        assert.equal(await win.webContents.executeJavaScript(`window.__recordSubmitAlerts.some(message=>message.includes('No record was inserted')) && window.__recordSubmitAlerts.some(message=>message.includes('A single inserted record could not be confirmed'))`), true);
        await win.webContents.executeJavaScript(`window.alert=message=>window.__tableAlerts.push(message);true`);
        await waitFor(win, `!!document.querySelector('.MuiTablePagination-actions button:last-child:not([disabled])')`);
        await win.webContents.executeJavaScript(`window.uiTest.clear();window.uiTest.failTableCount();document.querySelector('.MuiTablePagination-actions button:last-child').click();true`);
        await waitFor(win, `window.__tableAlerts.some(message=>message.includes('Simulated table count failure'))`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 1, 'Failed count must not issue a data query');
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Result' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `document.body.innerText.includes('DATA_ROW_0')`);
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('.MuiTablePagination-actions button:first-child').disabled"), true, 'Failed pagination retains the first page');
        await win.webContents.executeJavaScript(`window.uiTest.clear();document.querySelector('.MuiTablePagination-actions button:last-child').click();true`);
        await waitFor(win, `document.body.innerText.includes('DATA_ROW_50')`);
        const queries = await win.webContents.executeJavaScript('window.uiTest.queries()');
        assert.equal(queries.filter(sql=>/COUNT\(\*\)/.test(sql)).length, 1, 'One count query per page change');
        assert.equal(queries.length, 2, 'One count query and one data query per page change');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.MuiTablePagination-selectLabel').textContent`), 'Rows per page:', 'Table pagination follows the English language setting');
        const changeLanguage = async language => {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('header button')).find(button=>/^(Settings|設定)$/.test(button.textContent.trim())).click();true`);
          await waitFor(win, `!!document.querySelector('[role=menuitem] [data-testid=SettingsIcon]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=menuitem] [data-testid=SettingsIcon]').closest('[role=menuitem]').click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] [role=combobox]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] [role=combobox]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `!!document.querySelector('[role=option][data-value="${language}"]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="${language}"]').click();true`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await waitFor(win, `document.querySelector('.MuiTablePagination-selectLabel')?.textContent===${JSON.stringify(language === 'ja' ? 'ページあたりの行数:' : 'Rows per page:')}`);
        };
        await changeLanguage('ja'); await changeLanguage('en');
        await win.webContents.executeJavaScript(`document.querySelector('.MuiDataGrid-row').click();window.uiTest.clear();true`);
        const selectedRow = await win.webContents.executeJavaScript(`document.querySelector('.MuiDataGrid-row.custom-selected')?.getAttribute('data-id')`);
        assert.ok(selectedRow, 'Select a row before hiding the grid');
        await win.webContents.executeJavaScript(`window.__gridPhase='queued-resize-before-zero-viewport';true`);
        await win.webContents.executeJavaScript(`(() => {
          const grid = document.querySelector('.MuiDataGrid-root'), viewport = grid.parentElement;
          const main = grid.querySelector('.MuiDataGrid-main');
          const parentObserver = window.__gridResizeObservers.get(viewport);
          const gridObserver = window.__gridResizeObservers.get(main);
          if (!parentObserver || !gridObserver) throw new Error('Expected viewport and MUI resize observers');
          window.__queuedGridViewport = viewport;
          window.__queuedGridStyle = viewport.getAttribute('style');
          return new Promise(resolve => {
            requestAnimationFrame(() => {
              viewport.style.flex = '0 0 0px'; viewport.style.maxHeight = '0px';
              parentObserver.notify();
            });
            gridObserver.notify();
            requestAnimationFrame(() => setTimeout(resolve, 0));
          });
        })()`);
        await waitFor(win, `!document.querySelector('.MuiDataGrid-root')`);
        const queuedWarnings = await win.webContents.executeJavaScript(`window.__gridWarnings.filter(item=>item.phase==='queued-resize-before-zero-viewport')`);
        if (queuedWarnings.length) console.error(`${dbType}: queued resize diagnostics: ${JSON.stringify(queuedWarnings)}`);
        assert.equal(queuedWarnings.length, 0, 'A queued MUI resize must not measure the collapsed grid');
        await win.webContents.executeJavaScript(`if(window.__queuedGridStyle===null)window.__queuedGridViewport.removeAttribute('style');else window.__queuedGridViewport.setAttribute('style',window.__queuedGridStyle);true`);
        await waitFor(win, `!!document.querySelector('.MuiDataGrid-root')`);
        await win.webContents.executeJavaScript(`window.__gridPhase='zero-size-viewport';true`);
        await win.webContents.executeJavaScript(`window.__gridViewport=document.querySelector('.MuiDataGrid-root').parentElement;window.__gridStyle=window.__gridViewport.getAttribute('style');window.__gridViewport.style.flex='0 0 0px';window.__gridViewport.style.maxHeight='0px';true`);
        await waitFor(win, `!document.querySelector('.MuiDataGrid-root')`);
        await win.webContents.executeJavaScript(`if(window.__gridStyle===null)window.__gridViewport.removeAttribute('style');else window.__gridViewport.setAttribute('style',window.__gridStyle);true`);
        await waitFor(win, `document.body.innerText.includes('DATA_ROW_50')`);
        await win.webContents.executeJavaScript(`window.__gridPhase='result-tab-switch';true`);
        for (let toggle = 0; toggle < 3; toggle++) {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Execution Log' && el.getBoundingClientRect().width>0).click();true`);
          await waitFor(win, `!document.querySelector('.MuiDataGrid-root')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Result' && el.getBoundingClientRect().width>0).click();true`);
          await waitFor(win, `document.body.innerText.includes('DATA_ROW_50')`);
        }
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.MuiDataGrid-row.custom-selected')?.getAttribute('data-id')`), selectedRow, 'Selection survives zero-sized containers and hidden results');
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'Restoring the grid retains its page without fetching again');
        if (dbType === 'postgresql') {
          await win.webContents.executeJavaScript(`document.querySelector('.MuiDataGrid-row').click();true`);
          const editRecord = `Array.from(document.querySelectorAll('button')).find(el=>el.getBoundingClientRect().width>0 && el.querySelector('[data-testid=EditIcon]'))`;
          await waitFor(win, `!!(${editRecord}) && !(${editRecord}).disabled`);
          await win.webContents.executeJavaScript(`(${editRecord}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog]')`);
          const enumInput = `Array.from(document.querySelectorAll('[role=dialog] .MuiFormControl-root')).find(el=>el.querySelector('label')?.textContent.startsWith('STATE '))?.querySelector('input')`;
          assert.equal(await win.webContents.executeJavaScript(`(${enumInput})?.value`), 'open');
          assert.equal(await win.webContents.executeJavaScript(`(${enumInput})?.type`), 'text');
          const clockInput = `Array.from(document.querySelectorAll('[role=dialog] .MuiFormControl-root')).find(el=>el.querySelector('label')?.textContent.startsWith('CLOCK '))?.querySelector('input')`;
          const zoneInput = `Array.from(document.querySelectorAll('[role=dialog] .MuiFormControl-root')).find(el=>el.querySelector('label')?.textContent.startsWith('ZCLOCK '))?.querySelector('input')`;
          assert.equal(await win.webContents.executeJavaScript(`(${clockInput})?.value`), '12:34:56.123456');
          assert.equal(await win.webContents.executeJavaScript(`(${zoneInput})?.value`), '12:34:56.123456+05:45');
          assert.equal(await win.webContents.executeJavaScript(`(${clockInput}).closest('.MuiFormControl-root').parentElement.querySelector('[data-testid=CalendarTodayIcon]')===null`), true, 'TIME fields have no calendar picker');
          await win.webContents.executeJavaScript(`window.__importAlerts=[];window.alert=message=>window.__importAlerts.push(message);window.uiTest.clear();window.uiTest.zeroNextUpdate();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${enumInput}),'closed');(${enumInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
          await waitFor(win, `(${enumInput})?.value==='closed'`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child').click();true`);
          await waitFor(win, `window.__importAlerts.some(message=>message.includes('No record was updated.'))`);
          assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]') && (${enumInput})?.value==='closed'`), true, 'A zero-row save retains the dialog and the typed value');
          assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 1, 'A failed save must not refresh the rows');

          await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${clockInput}),'23:45:56.654321');(${clockInput}).dispatchEvent(new Event('input',{bubbles:true}));true`);
          await waitFor(win, `(${clockInput})?.value==='23:45:56.654321'`);
          await win.webContents.executeJavaScript(`(${enumInput}).closest('.MuiFormControl-root').parentElement.querySelector('button').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] button')).some(el=>el.textContent.trim()==='NULL selected')`);
          await win.webContents.executeJavaScript(`window.uiTest.clear();document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          assert.match((await win.webContents.executeJavaScript('window.uiTest.queries()')).find(sql=>/^UPDATE/.test(sql)), /"STATE" = NULL/);
          assert.match((await win.webContents.executeJavaScript('window.uiTest.queries()')).find(sql=>/^UPDATE/.test(sql)), /"CLOCK" = CAST\('23:45:56.654321' AS time without time zone\)/);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Result').click();true`);
          await waitFor(win, `document.body.innerText.includes('DATA_ROW_50')`);
        }
        await waitFor(win, `!!document.querySelector('[aria-label="Export Data (Clipboard/CSV/Excel)"] button:not([disabled])')`);
        await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Export Data (Clipboard/CSV/Excel)"] button').click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('reload-source',{detail:{schema:'${schema}',tableName:'UI_ITEM_0'}}));true`);
        await delay(200);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]')`), true, 'Footer dialog survives parent updates');
        await win.webContents.executeJavaScript(`window.__exportDialog=document.querySelector('[role=dialog]');window.__exportViewport=document.querySelector('.MuiDataGrid-root').parentElement;window.__exportViewport.style.maxWidth='800px';true`);
        await waitFor(win, `document.querySelector('.MuiDataGrid-root')?.getBoundingClientRect().width<=800`);
        await delay(100);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]')===window.__exportDialog`), true, 'Footer dialog retains its instance during a positive-size resize');
        await win.webContents.executeJavaScript(`window.__exportViewport.style.removeProperty('max-width');true`);
        await win.webContents.executeJavaScript(`window.__exportAlerts=[];window.__exportNotices=[];window.__captureExportNotice=e=>window.__exportNotices.push(e.detail);window.removeEventListener('monabase-notification',window.__noticeBridge);window.addEventListener('monabase-notification',window.__captureExportNotice);window.alert=message=>window.__exportAlerts.push(message);document.querySelector('[role=dialog] input[value="csv"]').click();true`);
        const safetyInput = `Array.from(document.querySelectorAll('[role=dialog] label')).find(el=>el.textContent.includes('Spreadsheet safety mode')).querySelector('input')`;
        assert.equal(await win.webContents.executeJavaScript(`(${safetyInput}).checked`), true);
        await win.webContents.executeJavaScript(`(${safetyInput}).click();true`);
        await waitFor(win, `!(${safetyInput}).checked`);
        const browseExport = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Browse')`;
        const doExport = `document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child')`;
        for (const outcome of ['failure', 'cancel', 'success']) {
          await win.webContents.executeJavaScript(`window.exportTest.holdBrowse();(${browseExport}).click();(${browseExport}).click();true`);
          await waitFor(win, `(${browseExport}).disabled && (${doExport}).disabled`);
          await win.webContents.executeJavaScript(`window.exportTest.finishBrowse('${outcome}');true`);
          await waitFor(win, `!(${browseExport}).disabled`);
          if (outcome === 'failure') await waitFor(win, `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('Could not open the output destination dialog')`);
        }
        assert.equal(await win.webContents.executeJavaScript(`window.__exportAlerts.length`), 0);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog] input[value="/mock/output.csv"]')`), true);
        await win.webContents.executeJavaScript(`window.exportTest.holdRead();(${doExport}).click();true`);
        const stopExport = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Stop fetching')`;
        await waitFor(win, `!!(${stopExport}) && window.exportTest.counts().opens===1`);
        await win.webContents.executeJavaScript(`(${stopExport}).click();true`);
        await waitFor(win, `(${stopExport}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.exportTest.counts().writes`), 0);
        await win.webContents.executeJavaScript(`window.exportTest.finishRead();true`);
        await waitFor(win, `document.querySelector('[role=dialog]').textContent.includes('Export stopped.') && !(${doExport}).disabled`);
        assert.deepEqual(await win.webContents.executeJavaScript(`window.exportTest.counts()`), { browse: 3, writes: 0, opens: 1, closes: 1 });
        await win.webContents.executeJavaScript(`(${doExport}).click();(${doExport}).click();true`);
        await waitFor(win, `window.exportTest.counts().writes===1 && (${doExport}).disabled`);
        assert.deepEqual(await win.webContents.executeJavaScript(`window.exportTest.counts()`), { browse: 3, writes: 1, opens: 2, closes: 2 });
        await win.webContents.executeJavaScript(`window.exportTest.finishWrite();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.equal(await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('exportSettings')).spreadsheetSafe`), false);
        assert.equal(await win.webContents.executeJavaScript(`window.__exportAlerts.length`), 0);
        assert.deepEqual(await win.webContents.executeJavaScript(`window.__exportNotices.map(value=>({message:value.message,severity:value.severity}))`), [{ message: 'CSV file exported.', severity: 'success' }]);
        await win.webContents.executeJavaScript(`window.removeEventListener('monabase-notification',window.__captureExportNotice);window.addEventListener('monabase-notification',window.__noticeBridge);true`);

        await win.webContents.executeJavaScript(`window.__importAlerts=[];window.alert=message=>window.__importAlerts.push(message);window.__importText='LABEL\\n""\\n"   "\\n';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>window.__importText}});true`);
        const importButton = `document.querySelector('[aria-label="Import Data (Clipboard/CSV)"] button:not([disabled])')`;
        await waitFor(win, `!!(${importButton})`);
        await win.webContents.executeJavaScript(`window.uiTest.clear();(${importButton}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]')`);
        const previewImport = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Preview')`;
        const executeImport = `document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child')`;
        assert.equal(await win.webContents.executeJavaScript(`(${executeImport}).disabled`), true);
        await win.webContents.executeJavaScript(`window.__importReads=0;window.__holdImportRead=true;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.__importReads++;if(window.__holdImportRead)return new Promise(resolve=>{window.__releaseImportRead=()=>{window.__holdImportRead=false;resolve(window.__importText);};});return window.__importText;}}});window.importTest.hold();(${previewImport}).click();(${previewImport}).click();true`);
        await waitFor(win, `(${previewImport}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.__importReads`), 1);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().some(sql=>/^INSERT/.test(sql))`), false);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]')`), true);
        await win.webContents.executeJavaScript(`window.__releaseImportRead();true`);
        await waitFor(win, `!!document.querySelector('[data-testid="import-preview"]') && !(${executeImport}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 0);
        assert.ok(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="import-preview"]').textContent.includes('LABEL → LABEL')`));
        await win.webContents.executeJavaScript(`(${executeImport}).click();(${executeImport}).click();true`);
        await waitFor(win, `window.uiTest.queries().filter(sql=>/^INSERT/.test(sql)).length===1`);
        await win.webContents.executeJavaScript(`window.importTest.finish(0);true`);
        await waitFor(win, `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('Confirmed inserted rows: 0') && (${executeImport}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 1);
        for (const affected of ['1', "'unknown'", '2']) {
          await win.webContents.executeJavaScript(`window.uiTest.clear();window.importTest.hold();(${previewImport}).click();true`);
          await waitFor(win, `!(${executeImport}).disabled`);
          await win.webContents.executeJavaScript(`(${executeImport}).click();true`);
          await waitFor(win, `window.uiTest.queries().filter(sql=>/^INSERT/.test(sql)).length===1`);
          await win.webContents.executeJavaScript(`window.importTest.finish(${affected});true`);
          if (affected !== '2') {
            await waitFor(win, `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('No automatic commit or rollback') && (${executeImport}).disabled`);
            assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 1);
          }
        }
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        const inserts = await win.webContents.executeJavaScript(`window.uiTest.queries().filter(sql=>/^INSERT/.test(sql))`);
        assert.equal(inserts.length, 1);
        assert.ok(inserts[0].includes('DEFAULT')); assert.ok(inserts[0].includes("'   '"));
        await waitFor(win, `!!(${importButton})`);
        await win.webContents.executeJavaScript(`window.uiTest.clear();window.__importText='   ';(${importButton}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);
        await win.webContents.executeJavaScript(`(${previewImport}).click();true`);
        await waitFor(win, `!(${executeImport}).disabled`);
        await win.webContents.executeJavaScript(`(${executeImport}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().filter(sql=>/^INSERT/.test(sql)).length`), 1);
        await win.webContents.executeJavaScript(`window.uiTest.clear();window.__importAlerts=[];window.__importText='LABEL\\n"unclosed';(${importButton}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`(${previewImport}).click();true`);
        await waitFor(win, `document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('Invalid delimited text')`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().some(sql=>/^INSERT/.test(sql))`), false);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]')`), true);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Cancel').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        if (dbType === 'postgresql') {
          assert.deepEqual(errors, [], 'No renderer errors before opening table source');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Source').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('numeric(10,2)') && el.textContent.includes('UI_POSITIVE'))`);
          assert.ok(await win.webContents.executeJavaScript(`document.body.innerText.includes('text[]')`));
          const sourceRefresh = `document.querySelector('[aria-label="Fetch latest source"] button')`;
          await waitFor(win, `!!(${sourceRefresh}) && !(${sourceRefresh}).disabled`);
          await win.webContents.executeJavaScript(`window.uiTest.bumpSource();(${sourceRefresh}).click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('"AMOUNT" > 10'))`);
          assert.ok(await win.webContents.executeJavaScript(`document.body.innerText.includes('UI_POSITIVE') && document.body.innerText.includes('numeric(10,2)')`));
          assert.deepEqual(errors, [], 'No renderer errors after refreshing table source');
          await win.webContents.executeJavaScript(`window.uiTest.clear();Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Data').click();true`);
          await waitFor(win, `document.body.innerText.includes('DATA_ROW_')`);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'Returning from source keeps cached data and does not rerun SQL');

        }
        await win.webContents.executeJavaScript(`window.definitionTest.start();Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Structure').click();true`);
        console.log(dbType + ': checking table-definition display and routing');
        const structureRoot = `document.querySelector('[data-testid="table-structure"]')`;
        await waitFor(win, `!!(${structureRoot}) && (${structureRoot}).innerText.includes('before')`);
        await win.webContents.executeJavaScript(`Array.from((${structureRoot}).querySelectorAll('.MuiAccordionSummary-root')).forEach(el=>{if(el.getAttribute('aria-expanded')!=='true')el.click()});true`);
        if (dbType === 'oracle') {
          await waitFor(win, `(${structureRoot}).innerText.includes('Owner B')`);
          await win.webContents.executeJavaScript(`window.__definitionTargets=[];window.__definitionDispatch=window.dispatchEvent.bind(window);window.dispatchEvent=e=>{if(e.type==='open-edit-index-tab'||e.type==='open-edit-trigger-tab'){window.__definitionTargets.push(e.detail);return true}return window.__definitionDispatch(e)};true`);
          for (const name of ['SHARED_INDEX', 'SHARED_TRIGGER']) {
            const row = `Array.from((${structureRoot}).querySelectorAll('.MuiDataGrid-row')).find(el=>el.textContent.includes('${name}') && el.textContent.includes('Owner B'))`;
            await waitFor(win, `!!(${row})`);
            await win.webContents.executeJavaScript(`(${row}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
            await waitFor(win, `window.__definitionTargets.length>=${name === 'SHARED_INDEX' ? 1 : 2}`);
            assert.equal(await win.webContents.executeJavaScript(`window.__definitionTargets.at(-1).schema`), 'Owner B');
          }
          await win.webContents.executeJavaScript(`window.dispatchEvent=window.__definitionDispatch;true`);
        } else {
          await waitFor(win, `(${structureRoot}).innerText.includes('(before + 1)(1), after(2)')`);
          assert.ok(await win.webContents.executeJavaScript(`(${structureRoot}).innerText.includes('meo(3) INCLUDE')`));
        }
        await win.webContents.executeJavaScript(`window.definitionTest.stop();true`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Statistics').click();true`);
        await waitFor(win, `document.querySelector('[data-testid="table-statistics"] .MuiDataGrid-root')?.textContent.includes('VALUE')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="table-statistics"]').textContent.includes('7')`), true);
        await win.webContents.executeJavaScript(`window.uiTest.failTableStatistics();window.dispatchEvent(new CustomEvent('reload-statistics',{detail:{schema:'${schema}',tableName:'UI_ITEM_0'}}));true`);
        await waitFor(win, `!!document.querySelector('[data-testid="table-statistics"] [role=alert]')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="table-statistics"] .MuiDataGrid-root').textContent.includes('7')`), true);
        await win.webContents.executeJavaScript(`document.querySelector('[data-testid="table-statistics"] [role=alert] button').click();true`);
        await waitFor(win, `!document.querySelector('[data-testid="table-statistics"] [role=alert]') && document.querySelector('[data-testid="table-statistics"] .MuiDataGrid-root')?.textContent.includes('9')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Source').click();true`);
        const sourceEditor = `Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0)`;
        await waitFor(win, `(${sourceEditor})?.textContent.includes('CREATE TABLE')`);
        const retainedSource = await win.webContents.executeJavaScript(`(${sourceEditor}).textContent`);
        await win.webContents.executeJavaScript(`window.uiTest.failTableSource();document.querySelector('[aria-label="Fetch latest source"] button').click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=alert]')).some(el=>el.textContent.includes('Table source could not be refreshed'))`);
        assert.equal(await win.webContents.executeJavaScript(`(${sourceEditor}).textContent`), retainedSource);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=alert]')).find(el=>el.textContent.includes('Table source could not be refreshed')).querySelector('button').click();true`);
        await waitFor(win, `!Array.from(document.querySelectorAll('[role=alert]')).some(el=>el.textContent.includes('Table source could not be refreshed')) && !document.querySelector('[aria-label="Fetch latest source"] button').disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_ITEM_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        await waitFor(win, `!Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.textContent.includes('UI_ITEM_0'))`);
        const viewCategory = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el => /^Views?$/.test(el.textContent.trim()))`;
        await win.webContents.executeJavaScript(`(${viewCategory}).click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_VIEW_0')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_VIEW_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
        await waitFor(win, `document.body.innerText.includes('VIEW_ROW_0')`);
        assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('9007199254740993') && document.body.innerText.includes('2026-10-22T12:34:56.000Z')`), true, 'View preserves business IDs and text timestamps');
        await win.webContents.executeJavaScript(`window.uiTest.clear();Array.from(document.querySelectorAll('.MuiTablePagination-actions button:last-child')).filter(el=>el.getBoundingClientRect().width>0).at(-1).click();true`);
        await waitFor(win, `document.body.innerText.includes('VIEW_ROW_50')`);
        const viewQueries = await win.webContents.executeJavaScript('window.uiTest.queries()');
        assert.equal(viewQueries.length, 2, 'View pagination issues one count/data pair');
        assert.match(viewQueries[1], /OFFSET 50/);
        await win.webContents.executeJavaScript(`window.uiTest.clear();Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Execution Log' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `!document.querySelector('.MuiDataGrid-root')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Result' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `document.body.innerText.includes('VIEW_ROW_50')`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'Restoring hidden view results retains the page without fetching');
        const viewExecute = `Array.from(document.querySelectorAll('button')).filter(el=>el.textContent.trim()==='Execute' && el.getBoundingClientRect().width>0).at(-1)`;
        await win.webContents.executeJavaScript(`window.__importAlerts=[];window.uiTest.clear();window.uiTest.failViewCount();(${viewExecute}).click();true`);
        await waitFor(win, `window.__importAlerts.some(message=>message.includes('Simulated view count failure'))`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 1, 'Failed view count stops before the data query');
        assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('Simulated view count failure')`), true, 'View count error is visible in its log');
        const viewResultTab = `Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Result' && el.getBoundingClientRect().width>0)`;
        await win.webContents.executeJavaScript(`(${viewResultTab}).click();true`);
        assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('VIEW_ROW_50')`), true, 'Failed Execute retains the displayed view rows');
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiTablePagination-actions button:first-child')).filter(el=>el.getBoundingClientRect().width>0).at(-1).disabled`), false, 'Failed Execute retains the second view page');
        await win.webContents.executeJavaScript(`window.__importAlerts=[];window.uiTest.clear();window.uiTest.failViewCount();Array.from(document.querySelectorAll('.MuiTablePagination-actions button:last-child')).filter(el=>el.getBoundingClientRect().width>0).at(-1).click();true`);
        await waitFor(win, `window.__importAlerts.some(message=>message.includes('Simulated view count failure'))`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 1);
        await win.webContents.executeJavaScript(`(${viewResultTab}).click();true`);
        assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('VIEW_ROW_50')`), true, 'Failed pagination retains the second view page');
        await win.webContents.executeJavaScript(`window.uiTest.clear();Array.from(document.querySelectorAll('.MuiTablePagination-actions button:last-child')).filter(el=>el.getBoundingClientRect().width>0).at(-1).click();true`);
        await waitFor(win, `document.body.innerText.includes('VIEW_ROW_100')`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 2, 'Retrying the same view page executes one count/data pair');
        await win.webContents.executeJavaScript(`window.uiTest.clear();(${viewExecute}).click();true`);
        await waitFor(win, `document.body.innerText.includes('VIEW_ROW_0')`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 2, 'Execute retries one count/data pair after failure');
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Edit').click();true`);
        const viewSave = `Array.from(document.querySelectorAll('button')).find(el=>['Compile (Save)','Save (Compile)'].includes(el.textContent.trim()) && el.getBoundingClientRect().width>0)`;
        await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('CREATE OR REPLACE VIEW'))`);
        await win.webContents.executeJavaScript(`window.__viewEditor=Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('CREATE OR REPLACE VIEW'));true`);
        const replaceView = async text => {
          await win.webContents.executeJavaScript(`window.__viewEditor.focus();window.__viewEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
          await win.webContents.insertText(text);
          await waitFor(win, `window.__viewEditor.textContent.includes(${JSON.stringify(text.split('\n')[0])})`);
        };
        await waitFor(win, `!!(${viewSave}) && !(${viewSave}).disabled`);
        await replaceView('CREATE OR REPLACE VIEW "' + schema + '"."OTHER_VIEW" AS SELECT 1 AS "LABEL"');
        await win.webContents.executeJavaScript(`window.__importAlerts=[];(${viewSave}).click();true`);
        await waitFor(win, `window.__importAlerts.some(text=>text.includes('Only one CREATE'))`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.viewWrites().length'), 0);
        const viewDraft = 'CREATE OR REPLACE VIEW "' + schema + '"."UI_VIEW_0" AS SELECT 1 AS "LABEL", 7 AS "Added"' + (dbType === 'oracle' ? ' FROM DUAL' : '') + '\n-- retained view draft';
        await replaceView(viewDraft);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Version Control').click();true`);
        await waitFor(win, `!!document.querySelector('[aria-label="Fetch latest source"] button') && !document.querySelector('[aria-label="Fetch latest source"] button').disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Version History' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=row]')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('Newer UI revision'))`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=row]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('Newer UI revision')).click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_NEW_SEARCH')`);
        await win.webContents.executeJavaScript(`window.__gitRoot=Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Version History' && el.getBoundingClientRect().width>0).closest('.MuiPaper-root');Array.from(window.__gitRoot.querySelectorAll('button')).find(el=>el.textContent==='Unified').click();true`);
        await waitFor(win, `Array.from(window.__gitRoot.querySelectorAll('button')).some(el=>el.textContent==='Unified' && el.getAttribute('aria-pressed')==='true')`);
        await win.webContents.executeJavaScript(`window.__gitRoot.querySelector('[data-testid="SearchIcon"]').closest('button').click();true`);
        const leftDiffSearch = `window.__gitRoot.querySelector('input[placeholder^="Search Left"]')`;
        await waitFor(win, `!!(${leftDiffSearch})`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${leftDiffSearch}),'UI_NEW_SEARCH');(${leftDiffSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `!!window.__gitRoot.querySelector('mark.search-mark-active') && (${leftDiffSearch}).parentElement.textContent.includes('1/1')`);
        assert.equal(await win.webContents.executeJavaScript(`window.__gitRoot.querySelector('mark.search-mark-active').closest('tr').cells.length`),4);
        await win.webContents.executeJavaScript(`Array.from(window.__gitRoot.querySelectorAll('button')).find(el=>el.querySelector('[data-testid="SearchIcon"]') && !el.closest('.MuiInputBase-root')).click();true`);
        const rightDiffSearch = `window.__gitRoot.querySelector('input[placeholder^="Search Right"]')`;
        await waitFor(win, `!!(${rightDiffSearch})`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${rightDiffSearch}),'UI_VIEW_0');(${rightDiffSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `(${rightDiffSearch}).parentElement.textContent.includes('1/1')`);

        await win.webContents.executeJavaScript(`Array.from(window.__gitRoot.querySelectorAll('button')).find(el=>el.textContent==='Compare two revisions').click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('UI_OLD_SEARCH')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Swap comparison revisions').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog] [role=combobox]').textContent.includes('bbbbbbb')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`Array.from(window.__gitRoot.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Current Source').click();true`);
        await win.webContents.executeJavaScript(`window.uiTest.failViewSource();document.querySelector('[aria-label="Fetch latest source"] button').click();true`);
        await waitFor(win, `!document.querySelector('[aria-label="Fetch latest source"] button').disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim().includes('Edit')).click();true`);
        await waitFor(win, `document.body.innerText.includes('Simulated view source failure')`);
        assert.ok(await win.webContents.executeJavaScript(`window.__viewEditor.textContent.includes('retained view draft')`));
        assert.equal(await win.webContents.executeJavaScript(`(${viewSave}).disabled`), true);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=alert] button')).find(el=>el.textContent.trim()==='Retry').click();true`);
        await waitFor(win, `!document.body.innerText.includes('Simulated view source failure') && !(${viewSave}).disabled`);
        await replaceView(viewDraft);
        await win.webContents.executeJavaScript(`window.__importAlerts=[];(${viewSave}).click();true`);
        await waitFor(win, `window.uiTest.viewWrites().length===1 && !(${viewSave}).disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Data').click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=columnheader]')).some(el=>el.textContent.includes('Added')) && document.body.innerText.includes('VIEW_ROW_0')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Information' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `document.body.innerText.includes('VIEW_LINKED') && document.body.innerText.includes('Referenced objects') && document.body.innerText.includes('Dependent views and objects')`);
        await assertInformationRefresh();
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_VIEW_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        await waitFor(win, `!Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.textContent.includes('UI_VIEW_0'))`);
        const sequenceCategory = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el => /^Sequences?$/.test(el.textContent.trim()))`;
        await win.webContents.executeJavaScript(`(${sequenceCategory}).click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_SEQ_0')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_SEQ_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
        const addOne = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Add increment' && el.getBoundingClientRect().width>0)`;
        await waitFor(win, `!!(${addOne}) && !(${addOne}).disabled && !(${addOne}).closest('fieldset')?.disabled`);
        await win.webContents.executeJavaScript(`(${addOne}).click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('input')).some(el=>el.value==='9007199254740994')`);
        const sequenceSave = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Save' && el.getBoundingClientRect().width>0)`;
        await win.webContents.executeJavaScript(`window.uiTest.clear();(${sequenceSave}).click();true`);
        await waitFor(win, `!(${sequenceSave}).disabled`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'An unchanged save must not issue DDL');
        const cacheInput = `document.querySelector('[data-testid=sequence-settings] input[aria-label="Cache (CACHE)"]')`;
        await win.webContents.executeJavaScript(`(${cacheInput}).focus();(${cacheInput}).select();true`); await win.webContents.insertText('30');
        await waitFor(win, `(${cacheInput}).value==='30'`);
        await win.webContents.executeJavaScript(`window.uiTest.externalSequenceCache('40');(${sequenceSave}).click();true`);
        await waitFor(win, `document.body.innerText.includes('The same settings changed in another session')`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Keep my changes for next save').click();true`);
        await waitFor(win, `!document.body.innerText.includes('The same settings changed in another session')`);
        await win.webContents.executeJavaScript(`(${sequenceSave}).click();true`);

        await waitFor(win, `window.uiTest.queries().some(sql=>/^ALTER SEQUENCE/.test(sql))`);
        const sequenceQueries = await win.webContents.executeJavaScript('window.uiTest.queries()');
        assert.equal(sequenceQueries.length, 1); assert.ok(!/DROP|CREATE|RESTART|START WITH/.test(sequenceQueries[0]));
        await waitFor(win, `!(${addOne}).disabled && !(${addOne}).closest('fieldset')?.disabled`);
        await win.webContents.executeJavaScript(`(${addOne}).click();true`);
        const restart = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Restart sequence' && el.getBoundingClientRect().width>0)`;
        await waitFor(win, `!!(${restart}) && !(${restart}).disabled`);
        await win.webContents.executeJavaScript(`window.uiTest.clear();(${restart}).click();true`);
        await waitFor(win, `window.uiTest.queries().some(sql=>/^ALTER SEQUENCE .* RESTART /.test(sql))`);
        assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 1);
        await waitFor(win, `!(${addOne}).disabled && !(${addOne}).closest('fieldset')?.disabled`);
        await win.webContents.executeJavaScript(`(${cacheInput}).focus();(${cacheInput}).select();true`); await win.webContents.insertText('55');
        await waitFor(win, `(${cacheInput}).value==='55'`);
        await win.webContents.executeJavaScript(`window.uiTest.failSequenceRead();Array.from(document.querySelectorAll('[data-testid=sequence-settings] button')).find(el=>el.textContent==='Refresh').click();true`);
        await waitFor(win, `document.body.innerText.includes('Simulated sequence metadata failure')`);
        await waitFor(win, `!Array.from(document.querySelectorAll('[data-testid=sequence-settings] [role=alert] button')).find(el=>el.textContent==='Retry').disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid=sequence-settings] [role=alert] button')).find(el=>el.textContent==='Retry').click();true`);
        await waitFor(win, `!document.body.innerText.includes('Simulated sequence metadata failure') && !(${sequenceSave}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`(${cacheInput}).value`), '55');
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Source' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `!!document.querySelector('[data-testid=sequence-source] .cm-content') && document.querySelector('[data-testid=sequence-source]').getBoundingClientRect().width>0`);
        const sequenceDdl = await win.webContents.executeJavaScript(`document.querySelector('[data-testid=sequence-source] .cm-content').textContent`);
        if (dbType === 'postgresql') { assert.ok(sequenceDdl.includes('AS bigint')); assert.ok(sequenceDdl.includes('OWNED BY')); }
        await win.webContents.executeJavaScript(`window.uiTest.failSequenceRead();Array.from(document.querySelectorAll('[data-testid=sequence-source] button')).find(el=>el.textContent==='Refresh').click();true`);
        await waitFor(win, `document.body.innerText.includes('Simulated sequence metadata failure')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[data-testid=sequence-source] .cm-content').textContent`), sequenceDdl);
        await waitFor(win, `!Array.from(document.querySelectorAll('[data-testid=sequence-source] [role=alert] button')).find(el=>el.textContent==='Retry').disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-testid=sequence-source] [role=alert] button')).find(el=>el.textContent==='Retry').click();true`);
        await waitFor(win, `!document.body.innerText.includes('Simulated sequence metadata failure')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Information' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `document.body.innerText.includes('SEQUENCE_ROWS') && document.body.innerText.includes('Owned by column')`);
        await assertInformationRefresh();
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Settings' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `!!(${addOne}) && !(${addOne}).disabled && !(${addOne}).closest('fieldset')?.disabled`);
        assert.equal(await win.webContents.executeJavaScript(`(${cacheInput}).value`), '55');

        if (dbType === 'oracle') {
          await waitFor(win, `!(${addOne}).closest('fieldset')?.disabled`);
          const types = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>/^Types?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${types}).click();true`); await waitFor(win, `document.body.innerText.includes('UI_TYPE_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_TYPE_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const compileType = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Compile' && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${compileType}) && !(${compileType}).disabled`);
          await win.webContents.executeJavaScript(`window.__typeEditor=Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('CREATE OR REPLACE TYPE'));window.__typeEditor.focus();true`);
          await win.webContents.executeJavaScript(`window.__typeEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
          await win.webContents.insertText('CREATE TYPE "DEMO"."OTHER_TYPE" AS OBJECT (ID NUMBER);');
          await waitFor(win, `window.__typeEditor.textContent.includes('OTHER_TYPE')`);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];(${compileType}).click();true`);
          await waitFor(win, `window.__importAlerts.some(text=>text.includes('does not match'))`); assert.equal(await win.webContents.executeJavaScript('window.uiTest.typeWrites().length'), 0);
          await win.webContents.executeJavaScript(`window.__typeEditor.focus();window.__typeEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
          await win.webContents.insertText('CREATE OR REPLACE TYPE "DEMO"."UI_TYPE_0" AS OBJECT (ID NUMBER);\n-- retained TYPE draft');
          await waitFor(win, `window.__typeEditor.textContent.includes('retained TYPE draft')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Version Control').click();true`);
          await waitFor(win, `!!document.querySelector('[aria-label="Fetch latest source"] button') && !document.querySelector('[aria-label="Fetch latest source"] button').disabled`);
          await win.webContents.executeJavaScript(`window.uiTest.failTypeSource();document.querySelector('[aria-label="Fetch latest source"] button').click();true`);
          await waitFor(win, `document.body.innerText.includes('Simulated TYPE metadata failure')`);
          const typeSourceTab = `Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim().startsWith('Source') && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${typeSourceTab}) && !(${typeSourceTab}).disabled`);
          await win.webContents.executeJavaScript(`(${typeSourceTab}).click();true`);
          await waitFor(win, `!!(${compileType})`);
          assert.equal(await win.webContents.executeJavaScript(`(${compileType}).disabled`), true); assert.ok(await win.webContents.executeJavaScript(`window.__typeEditor.textContent.includes('retained TYPE draft')`));
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=alert] button')).find(el=>el.textContent==='Retry').click();true`);
          await waitFor(win, `!(${compileType}).disabled && !Array.from(document.querySelectorAll('[role=alert]')).some(el=>el.textContent.includes('Simulated TYPE metadata failure'))`);
          await win.webContents.executeJavaScript(`(${compileType}).click();true`); await waitFor(win, `window.uiTest.typeWrites().length===1 && !(${compileType}).disabled`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Information' && el.getBoundingClientRect().width>0).click();true`);
          await waitFor(win, `document.body.innerText.includes('TYPE_DEPENDENT') && document.body.innerText.includes('TYPE BODY (read-only)') && document.body.innerText.includes('BODY_TEST_ERROR')`);
          await assertInformationRefresh();
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_TYPE_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          await waitFor(win, `!(${addOne}).closest('fieldset')?.disabled`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_SEQ_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
          const typeCategory = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el => /^Types?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${typeCategory}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_TYPE_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_TYPE_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('Note;Text'))`);
          const typeSave = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Save (Execute)' && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${typeSave}) && !(${typeSave}).closest('fieldset')?.disabled`);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];window.uiTest.clear();(${typeSave}).click();true`);
          await waitFor(win, `window.__importAlerts.includes('Save (Compile) successful.')`);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'Unchanged type save must not issue DROP, CREATE or ALTER');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_TYPE_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
          await waitFor(win, `document.body.innerText.includes('UI_ENUM_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_ENUM_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('semi;colon'))`);
          await waitFor(win, `!!(${typeSave}) && !(${typeSave}).closest('fieldset')?.disabled`);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];window.uiTest.clear();(${typeSave}).click();true`);
          await waitFor(win, `window.__importAlerts.includes('Save (Compile) successful.')`);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'Enum listing opens the type editor and unchanged save issues no DDL');
          await win.webContents.executeJavaScript(`window.__typeEditor=Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('semi;colon'));window.__typeEditor.focus();window.__typeEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
          await win.webContents.insertText(`CREATE TYPE "public"."UI_ENUM_0" AS ENUM ('can''t', 'semi;colon', 'extra1', 'extra2');`);
          await waitFor(win, `window.__typeEditor.textContent.includes('extra2')`);
          await win.webContents.executeJavaScript(`(${typeSave}).click();true`); await waitFor(win, `!!document.querySelector('[role=dialog]') && document.body.innerText.includes('Review type changes')`);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.typeWrites().length'), 0);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`); await win.webContents.executeJavaScript(`(${typeSave}).click();true`);
          const executeType = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Execute')`;
          await waitFor(win, `!!(${executeType}) && !(${executeType}).disabled`); await win.webContents.executeJavaScript(`(${executeType}).click();true`);
          await waitFor(win, `document.body.innerText.includes('Simulated second TYPE DDL failure')`);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.typeWrites().length'), 2);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Review remaining changes').click();true`);
          await waitFor(win, `!!(${executeType}) && !(${executeType}).disabled`); await win.webContents.executeJavaScript(`(${executeType}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && window.uiTest.typeWrites().length===3`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Information' && el.getBoundingClientRect().width>0).click();true`);
          await waitFor(win, `document.body.innerText.includes('TYPE_DEPENDENT') && document.body.innerText.includes('ENUM values in order') && document.body.innerText.includes('extra2')`);
          await assertInformationRefresh();

          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_ENUM_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
          const triggerCategory = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>/^Triggers?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${triggerCategory}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_TRG_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_TRG_0 (UI_ITEM_0)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('RETURN NEW'))`);
          assert.ok(await win.webContents.executeJavaScript(`document.body.innerText.includes('Current database settings: DISABLED') && document.body.innerText.includes('UPDATE OF: amount') && document.body.innerText.includes('ActualHandler')`));
          const traceButton = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Trace Analysis...' && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${traceButton}) && !(${traceButton}).disabled`);
          await win.webContents.executeJavaScript(`(${traceButton}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]')?.innerText.includes('Runs only the selected trigger body.')`);
          assert.ok(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]').innerText.includes('not a simulated post-operation state')`));
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Cancel').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          const triggerSave = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Change' && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${triggerSave}) && !(${triggerSave}).disabled && !(${triggerSave}).closest('fieldset')?.disabled`);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];window.uiTest.clear();(${triggerSave}).click();true`);
          await waitFor(win, `window.uiTest.triggerSaves().length===1 && window.__importAlerts.length===1`);
          const savedTrigger = (await win.webContents.executeJavaScript('window.uiTest.triggerSaves()'))[0];
          assert.equal(savedTrigger.body, 'BEGIN RETURN NEW; END;'); assert.deepEqual(savedTrigger.events, ['UPDATE']);
          assert.equal(savedTrigger.tableName, 'UI_ITEM_0');
          assert.equal(savedTrigger.expected.enabled, 'D'); assert.match(savedTrigger.expected.triggerDefinition, /UPDATE OF.*WHEN/);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0, 'The renderer sends a structured trigger request instead of rebuilding raw DDL');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_TRG_0 (UI_ITEM_1)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('RETURN OLD'))`);
          await waitFor(win, `!!(${triggerSave}) && !(${triggerSave}).disabled && !(${triggerSave}).closest('fieldset')?.disabled`);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).filter(el=>el.textContent.includes('UI_TRG_0')).length`), 2);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];(${triggerSave}).click();true`);
          await waitFor(win, `window.uiTest.triggerSaves().length===2 && window.__importAlerts.length===1`);
          const secondTrigger = (await win.webContents.executeJavaScript('window.uiTest.triggerSaves()'))[1];
          assert.equal(secondTrigger.tableName, 'UI_ITEM_1'); assert.equal(secondTrigger.body, 'BEGIN RETURN OLD; END;');
          await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('object-deleted',{detail:{schema:'public',objectName:'UI_TRG_0',objectType:'TRIGGER',tableName:'UI_ITEM_0'}}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=tab]')).filter(el=>el.textContent.includes('UI_TRG_0')).length===1`);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.textContent.includes('UI_ITEM_1') && el.textContent.includes('UI_TRG_0'))`), true);
        }
        if (dbType === 'oracle') {
          const category = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>/^Triggers?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${category}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_TRG_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_TRG_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          await waitFor(win, `document.body.innerText.includes('Current database settings: DISABLED') && document.body.innerText.includes('UPDATE OF: AMOUNT')`);
          const triggerSave = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Change' && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${triggerSave}) && !(${triggerSave}).disabled && !(${triggerSave}).closest('fieldset').disabled`);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];window.uiTest.clear();(${triggerSave}).click();true`);
          await waitFor(win, `window.uiTest.triggerSaves().length===1 && window.__importAlerts.length===1`);
          const saved = (await win.webContents.executeJavaScript('window.uiTest.triggerSaves()'))[0];
          assert.equal(saved.expected.status, 'DISABLED'); assert.match(saved.expected.source, /WHEN/);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Version Control').click();true`);
          await waitFor(win, `!!document.querySelector('[aria-label="Fetch latest source"] button')`);
          await win.webContents.executeJavaScript(`window.uiTest.failTriggerSource();document.querySelector('[aria-label="Fetch latest source"] button').click();true`);
          await waitFor(win, `document.body.innerText.includes('Simulated trigger source failure')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Edit').click();true`);
          assert.equal(await win.webContents.executeJavaScript(`(${triggerSave}).disabled`), true);
          assert.ok(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.cm-content')).some(el=>el.textContent.includes('BEGIN NULL; END;'))`));
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=alert] button')).find(el=>el.textContent.trim()==='Retry').click();true`);
          await waitFor(win, `!document.body.innerText.includes('Simulated trigger source failure') && !(${triggerSave}).disabled`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_TRG_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        await win.webContents.executeJavaScript(`window.uiTest.startTriggerPicker();window.dispatchEvent(new CustomEvent('open-create-trigger-tab',{detail:{schema:'${schema}',tableName:''}}));true`);
        const targetPicker = `Array.from(document.querySelectorAll('button[aria-label="Target Object"]')).find(el=>el.getBoundingClientRect().width>0)`;
        await waitFor(win, `!!(${targetPicker}) && !(${targetPicker}).disabled`);
        await win.webContents.executeJavaScript(`(${targetPicker}).click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===1`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiListItemButton-root').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog] input[type=radio]').checked`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Add').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]') && (${targetPicker}).textContent.includes('UI_TRIGGER_NEXT_')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('input[type=radio][value=VIEW]')).find(el=>el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `(${targetPicker}).textContent.trim()==='Target Object'`);
        await win.webContents.executeJavaScript(`(${targetPicker}).click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
        assert.ok(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]').innerText.includes('View')`));
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()==='Cancel').click();true`);
        await win.webContents.executeJavaScript(`window.uiTest.stopTriggerPicker();Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('[New] Trigger')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        if (dbType === 'oracle') {
          const procedures = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>/^Procedures?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${procedures}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_PROC_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_PROC_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const procedureEditor = `Array.from(document.querySelectorAll('.cm-content')).find(el=>el.textContent.includes('CREATE PROCEDURE DEMO.UI_PROC_0') && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${procedureEditor}) && (${procedureEditor}).isContentEditable`);
          await win.webContents.executeJavaScript(`(${procedureEditor}).focus();true`);
          await win.webContents.insertText('-- Unsaved draft\n');
          await waitFor(win, `(${procedureEditor}).textContent.includes('Unsaved draft')`);
          const draft = await win.webContents.executeJavaScript(`(${procedureEditor}).textContent`);
          await win.webContents.executeJavaScript(`window.uiTest.failStoredSource();window.dispatchEvent(new CustomEvent('sidebar-compile-error',{detail:{schema:'DEMO',objectName:'UI_PROC_0',objectType:'PROCEDURE',errors:[],logs:[]}}));true`);
          await waitFor(win, `document.body.innerText.includes('Simulated stored source refresh failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${procedureEditor}).textContent`), draft);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.textContent.trim()==='Source *')`), true);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute' && el.getBoundingClientRect().width>0).disabled`), true);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=alert] button')).find(el=>el.textContent.trim()==='Retry').click();true`);
          await waitFor(win, `!document.body.innerText.includes('Simulated stored source refresh failure') && !Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute' && el.getBoundingClientRect().width>0).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${procedureEditor}).textContent`), draft);

          await win.webContents.executeJavaScript(`window.__procedureEditor=(${procedureEditor});window.__compileAlerts=[];window.alert=message=>window.__compileAlerts.push(message);true`);
          const replaceProcedure = async source => {
            await win.webContents.executeJavaScript(`window.__procedureEditor.focus();true`);
            await win.webContents.executeJavaScript(`window.__procedureEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',metaKey:${process.platform === 'darwin'},ctrlKey:${process.platform !== 'darwin'},bubbles:true,cancelable:true}));true`);
            await win.webContents.insertText(source);
            await waitFor(win, `window.__procedureEditor.textContent.includes(${JSON.stringify(source.split('\n')[0])})`);
          };
          const compileProcedure = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Compile' && el.getBoundingClientRect().width>0)`;
          await replaceProcedure('CREATE OR REPLACE PROCEDURE DEMO.OTHER_PROC AS BEGIN NULL; END;');
          await win.webContents.executeJavaScript(`(${compileProcedure}).click();true`);
          await waitFor(win, `window.__compileAlerts.some(message=>message.includes('does not match the target'))`);
          assert.equal(await win.webContents.executeJavaScript(`window.uiTest.storedCompiles().length`), 0);
          const safeSource = "CREATE OR REPLACE PROCEDURE DEMO.UI_PROC_0 AS\nv VARCHAR2(100);\nBEGIN\n/* documentation\n/\ncontinued */\nv := q'[owner's\n/\ntext]';\nEND;\n/";
          await waitFor(win, `!(${compileProcedure}).disabled && !window.__procedureEditor.closest('fieldset').disabled`);
          await replaceProcedure(safeSource);
          await win.webContents.executeJavaScript(`(${compileProcedure}).click();true`);
          try { await waitFor(win, `window.uiTest.storedCompiles().length===1`); }
          catch (error) {
            console.error('Compile UI diagnostics:', await win.webContents.executeJavaScript(`JSON.stringify({alerts:window.__compileAlerts,source:window.__procedureEditor.textContent})`));
            throw error;
          }
          assert.equal((await win.webContents.executeJavaScript(`window.uiTest.storedCompiles()`))[0], safeSource.slice(0, -2));
          await waitFor(win, `!(${compileProcedure}).disabled && !window.__procedureEditor.closest('fieldset').disabled`);

        }
        if (dbType === 'postgresql') {
          const functions = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>/^Functions?$/.test(el.textContent.trim()))`;
          await win.webContents.executeJavaScript(`(${functions}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_FN(text)')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-sidebar-object]')).find(el=>el.textContent==='UI_FN(text)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
        }
        const modeSelect = `Array.from(document.querySelectorAll('[role=combobox]')).find(el=>el.textContent==='Specify a value' && el.getBoundingClientRect().width>0)`;
        await waitFor(win, `!!(${modeSelect})`);
        const routineTabLabel = dbType === 'postgresql' ? '[Function]UI_FN' : '[Procedure]UI_PROC_0';
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).some(tab=>tab.textContent===${JSON.stringify(routineTabLabel)})`), true, 'Routine workspace tabs must show the name without an argument signature');
        await win.webContents.executeJavaScript(`(${modeSelect}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=option][data-value="default"]')`);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=option][data-value="null"]')`), false);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="value"]').click();true`);
        const executeRoutine = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute' && el.getBoundingClientRect().width>0)`;
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Ask AI to code"]').getBoundingClientRect().height`), 24);

        await waitFor(win, `!!(${executeRoutine}) && !(${executeRoutine}).disabled`);
        await win.webContents.executeJavaScript(`(${executeRoutine}).click();true`);
        await waitFor(win, `window.uiTest.routineExecutions().length===1 && !(${executeRoutine}).disabled`);
        const sentRoutine = (await win.webContents.executeJavaScript('window.uiTest.routineExecutions()'))[0];
        const parameterName = dbType === 'oracle' ? 'P' : 'p';
        assert.equal(sentRoutine.argumentModes[parameterName], 'value'); assert.equal(sentRoutine.args[parameterName], null);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Information' && el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `document.body.innerText.includes('ROUTINE_LINKED') && document.body.innerText.includes('Return type')`);
        await assertInformationRefresh();
        if (dbType === 'postgresql') assert.ok(await win.webContents.executeJavaScript(`document.body.innerText.includes('public.UI_FN(text)')`));
        if (dbType === 'oracle') {
          const packages = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='Package')`;
          await win.webContents.executeJavaScript(`(${packages}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_PKG_0')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_PKG_0').querySelector('button').click();true`);
          const body = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='Body')`;
          await waitFor(win, `!!(${body})`);
          await win.webContents.executeJavaScript(`(${body}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const target = `Array.from(document.querySelectorAll('[role=combobox]')).find(el=>el.textContent==='A(VARCHAR2)' && el.getBoundingClientRect().width>0)`;
          const packageExecute = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute' && el.getBoundingClientRect().width>0)`;
          const packageTrace = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute (Trace)' && el.getBoundingClientRect().width>0)`;
          await waitFor(win, `!!(${target}) && !!(${packageExecute}) && !(${packageExecute}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).some(tab=>tab.textContent==='[Package Body] UI_PKG_0')`), true, 'Package workspace tabs must remain name-only');
          await win.webContents.executeJavaScript(`(${target}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `!!document.querySelector('[role=option][data-value=B]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value=B]').click();true`);
          await waitFor(win, `document.body.innerText.includes('Simulated package argument failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${packageExecute}).disabled`), true);
          assert.equal(await win.webContents.executeJavaScript(`(${packageTrace}).disabled`), true);
          assert.equal(await win.webContents.executeJavaScript(`window.uiTest.packageExecutions().length`), 0);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=alert] button')).find(el=>el.textContent.trim()==='Retry').click();true`);
          await waitFor(win, `!(${packageExecute}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button[aria-label="Ask AI to code"]')).find(el=>el.getBoundingClientRect().width>0).getBoundingClientRect().height`), 24);

          assert.equal(await win.webContents.executeJavaScript(`!!(${modeSelect})`), false, 'Required scalar arguments have no redundant mode selector');
          await win.webContents.executeJavaScript(`(${packageExecute}).click();true`);
          await waitFor(win, `window.uiTest.packageExecutions().length===1`);
          const executed = (await win.webContents.executeJavaScript(`window.uiTest.packageExecutions()`))[0];
          assert.equal(executed.objectName, 'UI_PKG_0'); assert.equal(executed.subProgram, 'B'); assert.equal(executed.subProgramId, 2);
          assert.equal(executed.argumentModes.B_VALUE, undefined); assert.equal(executed.args.B_VALUE, null);
          assert.deepEqual(Object.keys(executed.args), ['B_VALUE']);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.trim()==='Information' && el.getBoundingClientRect().width>0).click();true`);
          await waitFor(win, `document.body.innerText.includes('PACKAGE BODY: VALID') && document.body.innerText.includes('PACKAGE_LINKED_VIEW') && document.body.innerText.includes('B(VARCHAR2)')`);
          await assertInformationRefresh();
        }
        {
          const category = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='Materialized View')`;
          await waitFor(win, `!!(${category})`); await win.webContents.executeJavaScript(`(${category}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_MV_0')`);
          await win.webContents.executeJavaScript(`window.__mvAlerts=[];window.alert=text=>window.__mvAlerts.push(text);window.uiTest.failMviewRead();Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_MV_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const root = `document.querySelector('[data-testid="mview-window"]')`;
          const refreshMv = `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()==='Refresh stored data')`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Simulated materialized view failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${refreshMv}).disabled`), true);
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Retry').click();true`);
          await waitFor(win, `!(${refreshMv}).disabled`);
          if (dbType === 'postgresql') {
            assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('No data has been populated')`));
            assert.equal(await win.webContents.executeJavaScript(`(${root}).querySelector('input[type=checkbox]').disabled`), true);
          }
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Details / Actions').click();true`);
          if (dbType === 'oracle') {
            const execute = `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Execute')`;
            await win.webContents.executeJavaScript(`window.uiTest.clear();(${execute}).click();true`);
            await waitFor(win, `window.__mvAlerts.some(text=>text.includes('No settings changed'))`); assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0);
            const select = `Array.from((${root}).querySelectorAll('[role=combobox]')).find(el=>el.textContent==='COMPLETE')`;
            await win.webContents.executeJavaScript(`(${select}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
            await waitFor(win, `!!document.querySelector('[role=option][data-value=FORCE]')`);
            await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value=FORCE]').click();true`);
            await win.webContents.executeJavaScript(`(${execute}).click();true`);
            await waitFor(win, `window.uiTest.queries().some(sql=>/^ALTER MATERIALIZED VIEW/.test(sql)) && !(${execute}).disabled`);
          } else {
            const rename = `Array.from((${root}).querySelectorAll('input')).find(el=>el.closest('.MuiFormControl-root')?.textContent.includes('New name'))`;
            await waitFor(win, `!!(${rename})`); await win.webContents.executeJavaScript(`(${rename}).focus();true`); await win.webContents.insertText('UNSAVED_NAME');
          }
          await win.webContents.executeJavaScript(`window.uiTest.clear();(${refreshMv}).click();(${refreshMv}).click();true`);
          await waitFor(win, `!(${refreshMv}).disabled && window.uiTest.queries().some(sql=>/^REFRESH|DBMS_MVIEW.REFRESH/.test(sql))`);
          const calls = await win.webContents.executeJavaScript('window.uiTest.queries()'); assert.equal(calls.filter(sql=>/^REFRESH|DBMS_MVIEW.REFRESH/.test(sql)).length, 1); assert.ok(calls.every(sql=>!sql.includes('UNSAVED_NAME')));
          if (dbType === 'postgresql') {
            await waitFor(win, `!(${root}).querySelector('input[type=checkbox]').disabled`);
            await win.webContents.executeJavaScript(`(${root}).querySelector('input[type=checkbox]').click();window.uiTest.clear();(${refreshMv}).click();true`);
            await waitFor(win, `window.uiTest.queries().some(sql=>sql.includes('CONCURRENTLY')) && !(${refreshMv}).disabled`);
          }
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Information').click();true`);
          await waitFor(win, `(${root}).innerText.includes('MV_BASE_ROWS')`);
          await assertInformationRefresh();
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Version Control').click();true`);
          await waitFor(win, `Array.from((${root}).querySelectorAll('.cm-content')).some(el=>el.textContent.includes('CREATE MATERIALIZED VIEW'))`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_MV_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          const category = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='MView Log')`;
          await waitFor(win, `!!(${category})`); await win.webContents.executeJavaScript(`(${category}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_LOG_MASTER')`);
          await win.webContents.executeJavaScript(`window.logTest.fail();Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_LOG_MASTER').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const root = `document.querySelector('[data-testid="mview-log-window"]')`;
          const execute = `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute')`;
          const remove = `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()==='Delete')`;
          const tab = label => `Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Simulated log metadata failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${execute}).disabled && (${remove}).disabled`), true);
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Retry').click();true`);
          await waitFor(win, `!(${remove}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${execute}).disabled`), true);
          const include = `Array.from((${root}).querySelectorAll('label')).find(el=>el.textContent.startsWith('INCLUDING NEW VALUES')).querySelector('input')`;
          await win.webContents.executeJavaScript(`(${include}).click();true`); await waitFor(win, `!(${execute}).disabled`);
          await win.webContents.executeJavaScript(`(${tab('Source')}).click();true`);
          await waitFor(win, `Array.from((${root}).querySelectorAll('.cm-content')).some(el=>el.textContent.includes('TABLESPACE "USERS"'))`);
          assert.ok(await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('.cm-content')).some(el=>el.textContent.includes('TABLESPACE "USERS"') && el.textContent.includes('INCLUDING NEW VALUES'))`));
          await win.webContents.executeJavaScript(`(${tab('Edit')}).click();window.uiTest.clear();(${execute}).click();true`);
          await waitFor(win, `window.uiTest.queries().some(sql=>sql.includes('EXCLUDING NEW VALUES')) && (${execute}).disabled && !(${remove}).disabled`);
          assert.equal((await win.webContents.executeJavaScript('window.uiTest.queries()')).filter(sql=>sql.startsWith('ALTER MATERIALIZED VIEW LOG')).length, 1);
          await win.webContents.executeJavaScript(`(${tab('Information')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Rows purged') && (${root}).innerText.includes('MLOG$_UI_LOG_MASTER')`);
          await assertInformationRefresh();
          await win.webContents.executeJavaScript(`(${tab('Log')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('An empty log can be normal')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_LOG_MASTER')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
          await win.webContents.executeJavaScript(`(${category}).nextElementSibling.querySelector('[data-testid=AddIcon]').closest('button').click();true`);
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Create MView Log')`);
          await win.webContents.executeJavaScript(`window.logTest.picker(true);Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Select Table').click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_LOG_PICK_98')`);
          assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).find(el=>el.textContent.includes('UI_LOG_MASTER')).getAttribute('aria-disabled')`), 'true');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_LOG_PICK_100')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).find(el=>el.textContent.includes('UI_LOG_PICK_100')).click();true`);
          await waitFor(win, `!Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Add').disabled`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Add').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && !(${execute}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('UI_LOG_PICK_100')`));
          await win.webContents.executeJavaScript(`window.logTest.picker(false);Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('[New] MView Log')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          const category = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='Database Link')`;
          await waitFor(win, `!!(${category})`); await win.webContents.executeJavaScript(`(${category}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_LINK_0')`);
          await win.webContents.executeJavaScript(`window.dbLinkTest.fail();Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_LINK_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const root = `document.querySelector('[data-testid="dblink-window"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const input = label => `Array.from((${root}).querySelectorAll('input,textarea')).find(el=>el.closest('.MuiFormControl-root')?.querySelector('label')?.textContent.startsWith(${JSON.stringify(label)}))`;
          const tab = label => `Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not load database link information')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Execute')}).disabled && (${button('Delete')}).disabled`), true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Delete')}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Execute')}).disabled`), true);
          assert.equal(await win.webContents.executeJavaScript(`(${input('DB Link Name')}).disabled`), true);
          assert.equal(await win.webContents.executeJavaScript('window.dbLinkTest.tests()'), 0);
          const password = `(${root}).querySelector('input[type=password]')`;
          await win.webContents.executeJavaScript(`(${password}).focus();true`); await win.webContents.insertText('UI_SECRET_SENTINEL');
          await waitFor(win, `!(${button('Execute')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`!(${root}).innerText.includes('UI_SECRET_SENTINEL') && Array.from((${root}).querySelectorAll('.cm-content')).some(el=>el.textContent.includes('ALTER DATABASE LINK') && el.textContent.includes('********'))`));
          await win.webContents.executeJavaScript(`(${button('Execute')}).click();(${button('Execute')}).click();true`);
          await waitFor(win, `window.dbLinkTest.writes().length===1 && (${password}).value===''`);
          assert.ok(await win.webContents.executeJavaScript(`!(${root}).innerText.includes('UI_SECRET_SENTINEL')`));
          await win.webContents.executeJavaScript(`(${button('Test connection')}).click();(${button('Test connection')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Saved link connection verified')`); assert.equal(await win.webContents.executeJavaScript('window.dbLinkTest.tests()'), 1);
          await win.webContents.executeJavaScript(`(${tab('Source')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Saved settings (password omitted')`);
          await win.webContents.executeJavaScript(`(${tab('Information')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Fixed user') && (${root}).innerText.includes('2026-10-26')`);
          await assertInformationRefresh();
          await win.webContents.executeJavaScript(`(${tab('Edit')}).click();true`);
          const host = input('Database (USING)');
          await waitFor(win, `!!(${host})`);
          await win.webContents.executeJavaScript(`(${host}).focus();(${host}).select();true`); await win.webContents.insertText('other/service');
          await win.webContents.executeJavaScript(`(${password}).focus();true`); await win.webContents.insertText('UI_SECRET_SENTINEL');
          await waitFor(win, `!(${button('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`window.__savedLinkConfirm=window.confirm;window.confirm=()=>false;(${button('Execute')}).click();window.confirm=window.__savedLinkConfirm;true`);
          assert.equal(await win.webContents.executeJavaScript('window.dbLinkTest.writes().length'), 1);
          await win.webContents.executeJavaScript(`window.confirm=()=>true;window.dbLinkTest.recreateFailure();(${button('Execute')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('The old link was deleted, but recreation failed')`);
          assert.equal(await win.webContents.executeJavaScript(`(${password}).value`), 'UI_SECRET_SENTINEL');
          await waitFor(win, `!(${button('Retry creation')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Retry creation')}).click();true`);
          await waitFor(win, `(${password}).value==='' && !(${button('Delete')}).disabled`);
          assert.equal(await win.webContents.executeJavaScript('window.dbLinkTest.writes().length'), 3);
          assert.equal((await win.webContents.executeJavaScript('window.dbLinkTest.writes()'))[2].action, 'create');
          assert.ok(await win.webContents.executeJavaScript(`!(${root}).innerText.includes('UI_SECRET_SENTINEL')`));
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent.includes('UI_LINK_0')).querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Lock Management')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Lock Management').click();true`);
          const root = `document.querySelector('[data-testid="lock-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not read lock information')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Terminate selected session')}).disabled`), true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="LOCK_WAITER"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="LOCK_WAITER"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Current SQL') && !(${button('Inspect blocker')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('UPDATE DEMO.ORDERS SET TOTAL = 2') && (${root}).innerText.includes('Mode held (s)') && (${root}).innerText.includes('Current wait (s)')`));
          await win.webContents.executeJavaScript(`(${button('Inspect blocker')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Selected session: SID 501 / SERIAL# 11')`);
          await win.webContents.executeJavaScript(`window.lockTest.failRead();(${root}).querySelector('button[aria-label="Refresh to latest state"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not read lock information')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Terminate selected session')}).disabled`), true);
          assert.ok(await win.webContents.executeJavaScript(`!!(${root}).querySelector('[data-id="LOCK_HOLDER"]')`));
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Terminate selected session')}).disabled`);
          await win.webContents.executeJavaScript(`window.__lockConfirm=[];window.confirm=message=>{window.__lockConfirm.push(message);return false};(${button('Terminate selected session')}).click();true`);
          assert.equal(await win.webContents.executeJavaScript('window.lockTest.writes().length'), 0);
          await win.webContents.executeJavaScript(`window.confirm=message=>{window.__lockConfirm.push(message);return true};(${button('Terminate selected session')}).click();(${button('Terminate selected session')}).click();true`);
          await waitFor(win, `window.lockTest.writes().length===1 && (${root}).innerText.includes('The termination command completed')`);
          assert.deepEqual(await win.webContents.executeJavaScript('window.lockTest.writes()'), [{id:'LOCK_HOLDER',fingerprint:'holder_fingerprint'}]);
          assert.ok(await win.webContents.executeJavaScript(`window.__lockConfirm.every(text=>text.includes('SID 501') && text.includes('SERIAL# 11') && text.includes('rolled back'))`));
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Lock Management').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Object Privileges')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Object Privileges').click();true`);
          const root = `document.querySelector('[data-testid="object-privilege-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not load privileges or recipients')`);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Target Object')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Target Object')}).click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] [role=option]')).some(el=>el.textContent.includes('UI_PRIV_0'))`);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length`),100);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] [role=option]')).some(el=>el.textContent.includes('UI_PRIV_TARGET'))`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] [role=option]')).find(el=>el.textContent.includes('UI_PRIV_TARGET')).click();true`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Add').click();true`);
          const check = `(${root}).querySelector('input[aria-label="READER SELECT"]')`;
          await waitFor(win, `!!(${check}) && !(${check}).disabled && !document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="READER"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Grant details: READER') && (${root}).innerText.includes('UPDATE (LABEL)')`);
          assert.equal(await win.webContents.executeJavaScript(`(${root}).querySelector('input[aria-label="READER UPDATE"]').disabled`),true);
          await win.webContents.executeJavaScript(`window.privilegeTest.failDetails();(${root}).querySelector('button[aria-label="Refresh"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not load privileges or recipients') && (${check}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${check}).checked`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${check}) && !(${check}).disabled`);
          await win.webContents.executeJavaScript(`window.__privConfirm=window.confirm;window.confirm=()=>false;(${check}).click();window.confirm=window.__privConfirm;true`);
          assert.equal(await win.webContents.executeJavaScript('window.privilegeTest.writes().length'),0);
          await win.webContents.executeJavaScript(`window.confirm=message=>{window.__privMessage=message;return true;};(${check}).click();(${check}).click();true`);
          await waitFor(win, `window.privilegeTest.writes().length===1 && (${root}).innerText.includes('The change was applied')`);
          const request = (await win.webContents.executeJavaScript('window.privilegeTest.writes()'))[0];
          assert.equal(request.object.name,'UI_PRIV_TARGET'); assert.equal(request.action,'revoke'); assert.equal(request.grantee,'READER');
          assert.ok(await win.webContents.executeJavaScript(`window.__privMessage.includes('Oracle commits pending changes')`));
          await win.webContents.executeJavaScript(`window.confirm=window.__privConfirm;window.privilegeTest.stop();Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Object Privileges').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          console.log('oracle: checking user/role protection, masked review, quota precision and CASCADE confirmation');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='User Settings')`);await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='User Settings').click();true`);
          const root=`document.querySelector('[data-testid="oracle-user-role-tab"]')`,button=label=>`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`,db=label=>`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const setInput=async(selector,value)=>win.webContents.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          await waitFor(win, `!!(${root})&&(${root}).innerText.includes('Could not load user or role information')`);await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!!(${root}).querySelector('[data-id="OR_SELF"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="OR_SELF"]').click();true`);await waitFor(win, `(${root}).innerText.includes('Could not load user or role information')`);await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!(${button('Change Password')}).disabled`);assert.equal(await win.webContents.executeJavaScript(`(${button('Lock account')}).disabled&&(${button('Delete')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="OR_USER"]').click();true`);await waitFor(win, `!(${button('Lock account')}).disabled&&(${root}).innerText.includes('Unlocking alone does not reset')`);await waitFor(win, `(${root}).innerText.includes('9007199254740993123')`);
          await win.webContents.executeJavaScript(`window.oraUserTest.failRead();(${root}).querySelector('button[aria-label="Refresh to latest state"]').click();true`);await waitFor(win, `(${root}).innerText.includes('Could not load user or role information')&&(${button('Lock account')}).disabled`);assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('1048577')`));await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!(${button('Change Password')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Set quota')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=text]')`);assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=text]').value`),'1048577');await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${button('Change Password')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=password]')`);await setInput('[role=dialog] input[type=password]','Dummy123');
          const accept=async()=>{await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('<redacted>')`);assert.ok(await win.webContents.executeJavaScript(`!document.querySelector('[role=dialog] pre').innerText.includes('Dummy')&&window.oraUserTest.reviews().every(row=>!('password' in row))`));await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);await waitFor(win, `!(${db('Execute')}).disabled`);await win.webContents.executeJavaScript(`(${db('Execute')}).click();(${db('Execute')}).click();true`);};
          await accept();await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('It cannot be rolled back')`);assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=password]').value`),'');assert.equal(await win.webContents.executeJavaScript('window.oraUserTest.writes().length'),1);await win.webContents.executeJavaScript(`(${db('Retry')}).click();true`);await waitFor(win, `!(${db('Review SQL')}).disabled`);await setInput('[role=dialog] input[type=password]','Dummy456');await accept();await waitFor(win, `!document.querySelector('[role=dialog]')`);assert.equal(await win.webContents.executeJavaScript('window.oraUserTest.writes().length'),2);
          await waitFor(win, `!(${button('Delete')}).disabled`);await win.webContents.executeJavaScript(`(${button('Delete')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=checkbox]')`);assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').checked`),false);await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('The user owns objects')`);await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('CASCADE')`);await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);assert.equal(await win.webContents.executeJavaScript(`(${db('Execute')}).disabled`),true);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${button('Grant privilege or role')}).click();true`);await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);await win.webContents.executeJavaScript(`(${db('Next')}).click();true`);await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===2`);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);
          const kind=`Array.from((${root}).querySelectorAll('label')).find(el=>el.textContent==='Target type').parentElement.querySelector('[role=combobox]')`;
          await win.webContents.executeJavaScript(`(${kind}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));true`);await waitFor(win, `Array.from(document.querySelectorAll('[role=option]')).some(el=>el.textContent==='Roles')`);await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent==='Roles').click();true`);await waitFor(win, `!!(${root}).querySelector('[data-id="OR_ROLE"]')`);
          await win.webContents.executeJavaScript(`(${button('Create New')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=text]')`);assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog] input[type=password]')`),false);await setInput('[role=dialog] input[type=text]','MixedRole');await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('CREATE ROLE "MixedRole" NOT IDENTIFIED')`);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);
          const sep=`(${root}).querySelector('[role=separator]')`,before=await win.webContents.executeJavaScript(`Number((${sep}).getAttribute('aria-valuenow'))`);await win.webContents.executeJavaScript(`(${sep}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));true`);await waitFor(win, `Number((${sep}).getAttribute('aria-valuenow'))>${before}`);assert.equal(await win.webContents.executeJavaScript('window.oraUserTest.writes().length'),2);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] User Settings').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          console.log('postgresql: checking role identity, protected actions, masked reviews and retries');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='User Settings')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='User Settings').click();true`);
          const root=`document.querySelector('[data-testid="pg-user-role-tab"]')`;
          const button=label=>`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const db=label=>`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const setInput=async(selector,value)=>win.webContents.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          await waitFor(win, `!!(${root})&&(${root}).innerText.includes('Could not load role information')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Create New')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!!(${root}).querySelector('[data-id="role-100"]')`);
          assert.ok(await win.webContents.executeJavaScript(`!!(${root}).querySelector('[data-id="role-600"]')&&!(${root}).querySelector('[data-id="role-500"]')`));
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="role-100"]').click();true`);await waitFor(win, `(${root}).innerText.includes('Could not load role information')`);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!(${button('Change Password')}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Change SUPERUSER')}).disabled&&(${button('Change LOGIN')}).disabled&&(${button('Delete')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="role-200"]').click();true`);await waitFor(win, `(${root}).innerText.includes('Indirect')&&!(${button('Change Password')}).disabled`);
          await win.webContents.executeJavaScript(`window.pgRoleTest.failRead();(${root}).querySelector('button[aria-label="Refresh to latest state"]').click();true`);await waitFor(win, `(${root}).innerText.includes('Could not load role information')&&(${button('Change Password')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('GROUP_000')`));await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!(${button('Change Password')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Change Password')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=password]')`);
          await setInput('[role=dialog] input[type=password]','DUMMY_UI_PASSWORD');
          const accept=async()=>{await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('<redacted>')`);assert.ok(await win.webContents.executeJavaScript(`!document.querySelector('[role=dialog] pre').innerText.includes('DUMMY_UI')&&window.pgRoleTest.reviews().every(row=>!('password' in row))`));assert.equal(await win.webContents.executeJavaScript(`(${db('Execute')}).disabled`),true);await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);await waitFor(win, `!(${db('Execute')}).disabled`);await win.webContents.executeJavaScript(`(${db('Execute')}).click();(${db('Execute')}).click();true`);};
          await accept();await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('The role operation failed')`);assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=password]').value`),'');assert.equal(await win.webContents.executeJavaScript('window.pgRoleTest.writes().length'),1);
          await win.webContents.executeJavaScript(`(${db('Retry')}).click();true`);await waitFor(win, `!(${db('Review SQL')}).disabled`);await setInput('[role=dialog] input[type=password]','DUMMY_UI_RETRY');await accept();await waitFor(win, `!document.querySelector('[role=dialog]')`);assert.equal(await win.webContents.executeJavaScript('window.pgRoleTest.writes().length'),2);
          await waitFor(win, `!(${button('Create New')}).disabled`);await win.webContents.executeJavaScript(`(${button('Create New')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=text]')`);assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog] input[type=password]')`),false);assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').checked`),false);
          await setInput('[role=dialog] input[type=text]','MixedCaseGroup');await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('"MixedCaseGroup" NOLOGIN PASSWORD NULL')`);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${button('Grant membership')}).click();true`);await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);await win.webContents.executeJavaScript(`(${db('Next')}).click();true`);await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===2`);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${button('Delete')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog]')`);await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('DROP ROLE "AppUser"')`);await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);assert.equal(await win.webContents.executeJavaScript(`(${db('Execute')}).disabled`),true);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);assert.equal(await win.webContents.executeJavaScript('window.pgRoleTest.writes().length'),2);
          const separator=`(${root}).querySelector('[role=separator]')`,before=await win.webContents.executeJavaScript(`Number((${separator}).getAttribute('aria-valuenow'))`);await win.webContents.executeJavaScript(`(${separator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));true`);await waitFor(win, `Number((${separator}).getAttribute('aria-valuenow'))>${before}`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] User Settings').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          console.log('postgresql: checking tablespace protection, review and failure recovery');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Tablespace')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Tablespace').click();true`);
          const root=`document.querySelector('[data-testid="pg-tablespace-tab"]')`;
          const button=label=>`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const db=label=>`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root})&&(${root}).innerText.includes('Could not load tablespaces')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Create New')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="ts-1663"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="ts-1663"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not load tablespaces')`);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('900719925474099312345')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Delete')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="ts-60"]').click();true`);
          await waitFor(win, `!(${button('Rename')}).disabled`);
          await win.webContents.executeJavaScript(`window.pgTsTest.failRead();(${root}).querySelector('button[aria-label="Refresh to latest state"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not load tablespaces')&&(${button('Rename')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('900719925474099312345')`));
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);await waitFor(win, `!(${button('Rename')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Rename')}).click();true`);await waitFor(win, `!!document.querySelector('[role=dialog] input[type=text]')`);
          await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[role=dialog] input[type=text]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'RENAMED_SPACE');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          const accept=async()=>{await win.webContents.executeJavaScript(`(${db('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('RENAMED_SPACE')`);assert.equal(await win.webContents.executeJavaScript(`(${db('Execute')}).disabled`),true);await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);await waitFor(win, `!(${db('Execute')}).disabled`);await win.webContents.executeJavaScript(`(${db('Execute')}).click();(${db('Execute')}).click();true`);};
          assert.equal(await win.webContents.executeJavaScript('window.pgTsTest.writes().length'),0);
          await accept();await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('The operation outcome is unknown')`);
          assert.equal(await win.webContents.executeJavaScript('window.pgTsTest.writes().length'),1);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=text]').value`),'RENAMED_SPACE');
          await win.webContents.executeJavaScript(`(${db('Retry')}).click();true`);await waitFor(win, `!(${db('Review SQL')}).disabled`);
          await accept();await waitFor(win, `!document.querySelector('[role=dialog]')&&(${root}).innerText.includes('RENAMED_SPACE')`);
          assert.equal(await win.webContents.executeJavaScript('window.pgTsTest.writes().length'),2);
          await waitFor(win, `!(${button('Create New')}).disabled`);await win.webContents.executeJavaScript(`(${button('Create New')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('Absolute path on the database server')`);await win.webContents.executeJavaScript(`(${db('Cancel')}).click();true`);await waitFor(win, `!document.querySelector('[role=dialog]')`);

          const separator=`(${root}).querySelector('[role=separator]')`,before=await win.webContents.executeJavaScript(`Number((${separator}).getAttribute('aria-valuenow'))`);
          await win.webContents.executeJavaScript(`(${separator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);await waitFor(win, `Number((${separator}).getAttribute('aria-valuenow'))>${before}`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Tablespaces').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          console.log('postgresql: checking verified sessions and protected activity operations');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Session Management')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Session Management').click();true`);
          const root=`document.querySelector('[data-testid="pg-session-tab"]')`;
          const button=label=>`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const refresh=`(${root}).querySelector('button[aria-label="Refresh to latest state"]')`;
          await waitFor(win, `!!(${root})&&(${root}).innerText.includes('Could not retrieve sessions')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Kill Connection')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="PG_SESSION_900"]')`);
          assert.equal(await win.webContents.executeJavaScript(`!!(${root}).querySelector('[data-id="PG_SESSION_903"]')`),false);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_SESSION_900"]').click();true`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Kill Connection')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_SESSION_901"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('This session has an open transaction')&&(${root}).innerText.includes('Last SQL')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Cancel Query')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_SESSION_904"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('SQL is hidden by the current account')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_SESSION_902"]').click();true`);
          await waitFor(win, `!(${button('Cancel Query')}).disabled&&(${root}).innerText.includes('UPDATE DEMO.SESSION_DEMO')`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('Current SQL')&&(${root}).innerText.includes('9007199254740993.000001')`));
          await win.webContents.executeJavaScript(`window.pgSessionTest.failRead();(${refresh}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not retrieve sessions')&&(${button('Kill Connection')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('UPDATE DEMO.SESSION_DEMO')`));
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Cancel Query')}).disabled`);
          await win.webContents.executeJavaScript(`window.__pgSessionConfirm=window.confirm;window.__pgSessionMessages=[];window.confirm=()=>false;(${button('Cancel Query')}).click();true`);
          assert.equal(await win.webContents.executeJavaScript('window.pgSessionTest.commands().length'),0);
          await win.webContents.executeJavaScript(`window.confirm=message=>{window.__pgSessionMessages.push(message);return true;};(${button('Cancel Query')}).click();(${button('Cancel Query')}).click();true`);
          await waitFor(win, `window.pgSessionTest.commands().length===1&&(${root}).innerText.includes('The observed SQL has ended')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Cancel Query')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Kill Connection')}).click();true`);
          await waitFor(win, `window.pgSessionTest.commands().length===2&&(${root}).innerText.includes('The signal result is unknown')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Kill Connection')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Kill Connection')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Kill Connection')}).click();true`);
          await waitFor(win, `window.pgSessionTest.commands().length===3&&(${root}).innerText.includes('The target connection has ended')&&!(${root}).querySelector('[data-id="PG_SESSION_902"]')`);
          assert.ok(await win.webContents.executeJavaScript(`window.__pgSessionMessages.every(message=>message.includes('902')&&message.includes('DEMO')&&message.includes('2026-10-27'))`));
          const scope=`Array.from((${root}).querySelectorAll('label')).find(el=>el.textContent==='Database scope').parentElement.querySelector('[role=combobox]')`;
          await win.webContents.executeJavaScript(`(${scope}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=option]')).some(el=>el.textContent==='All databases')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent==='All databases').click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="PG_SESSION_903"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_SESSION_903"]').click();true`);
          await waitFor(win, `!(${button('Kill Connection')}).disabled`);
          await win.webContents.executeJavaScript(`(${scope}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=option]')).some(el=>el.textContent==='Current database')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent==='Current database').click();true`);
          await waitFor(win, `!(${root}).querySelector('[data-id="PG_SESSION_903"]')&&(${button('Kill Connection')}).disabled`);
          await win.webContents.executeJavaScript(`window.confirm=window.__pgSessionConfirm;Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Session Management').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          console.log('postgresql: checking schema management reviews and navigation');
          await win.webContents.executeJavaScript(`window.schemaTest.start();localStorage.setItem('pg_select_schema_demo_DEMO','DEMO');Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Schema Management')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Schema Management').click();true`);
          const root=`document.querySelector('[data-testid="schema-manager-tab"]')`;
          const button=label=>`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const dialogButton=label=>`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root})&&(${root}).innerText.includes('Could not retrieve schema information')`);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="schema-51"]')&&!!(${root}).querySelector('[data-id="schema-52"]')`);
          assert.equal(await win.webContents.executeJavaScript(`!!(${root}).querySelector('[data-id="schema-54"]')`),false);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="schema-53"]').click();true`);
          await waitFor(win, `(${button('Delete')}).disabled&&(${button('Rename')}).disabled`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="schema-50"]').click();true`);
          await waitFor(win, `!(${button('Delete')}).disabled && !!(${root}).querySelector('input[aria-label="reader CREATE"]') && (${root}).querySelector('input[aria-label="reader USAGE"]')?.getAttribute('data-indeterminate')==='true'`);
          await win.webContents.executeJavaScript(`window.schemaTest.failDetail();(${button('Reload detail')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not retrieve schema information')&&(${button('Rename')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Reload detail')}).click();true`);
          await waitFor(win, `!(${button('Rename')}).disabled`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('input[aria-label="reader CREATE"]').click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog]')`);
          assert.equal(await win.webContents.executeJavaScript('window.schemaTest.aclWrites().length'),0);
          await win.webContents.executeJavaScript(`(${dialogButton('Review SQL')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('GRANT CREATE ON SCHEMA')`);
          assert.equal(await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).disabled`),true);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')&&(${root}).querySelector('input[aria-label="reader CREATE"]').checked`);
          assert.equal(await win.webContents.executeJavaScript('window.schemaTest.aclWrites().length'),1);
          await win.webContents.executeJavaScript(`(${button('Delete')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog]')`);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').checked`),false);
          await win.webContents.executeJavaScript(`(${dialogButton('Review SQL')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('RESTRICT refuses deletion')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);
          await win.webContents.executeJavaScript(`(${dialogButton('Review SQL')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('other.LINKED')&&document.querySelector('[role=dialog]').innerText.includes('DROP SCHEMA')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);
          assert.equal(await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${dialogButton('Cancel')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          assert.equal(await win.webContents.executeJavaScript('window.schemaTest.writes().length'),0);
          const setName=async name=>win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[role=dialog] input[type=text]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(name)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          const reviewAndAccept=async()=>{await win.webContents.executeJavaScript(`(${dialogButton('Review SQL')}).click();true`);await waitFor(win, `document.querySelector('[role=dialog] pre')?.innerText.includes('ALTER SCHEMA')`);await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);await waitFor(win, `!(${dialogButton('Execute')}).disabled`);await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();true`);};
          await win.webContents.executeJavaScript(`(${button('Rename')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] input[type=text]')`);
          await setName('RENAMED_DEMO');await reviewAndAccept();
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('The schema change was not verified')`);
          await win.webContents.executeJavaScript(`(${dialogButton('Retry')}).click();true`);
          await waitFor(win, `!(${dialogButton('Review SQL')}).disabled`);
          await reviewAndAccept();
          await waitFor(win, `!document.querySelector('[role=dialog]')&&!!document.getElementById('schema-RENAMED_DEMO')`);
          assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('pg_select_schema_demo_DEMO')`),'RENAMED_DEMO');
          await waitFor(win, `!(${button('Rename')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Rename')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] input[type=text]')`);
          await setName('DEMO');await reviewAndAccept();
          await waitFor(win, `!document.querySelector('[role=dialog]')&&!!document.getElementById('schema-DEMO')`);
          assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('pg_select_schema_demo_DEMO')`),'DEMO');
          const separator=`(${root}).querySelector('[role=separator]')`,before=await win.webContents.executeJavaScript(`Number((${separator}).getAttribute('aria-valuenow'))`);
          await win.webContents.executeJavaScript(`(${separator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));true`);
          await waitFor(win, `Number((${separator}).getAttribute('aria-valuenow'))>${before}`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Schema Management').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          console.log('postgresql: checking object privilege identities and reviewed changes');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Object Privileges')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Object Privileges').click();true`);
          const root = `document.querySelector('[data-testid="pg-object-privilege-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const dialogButton = label => `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const check = `(${root}).querySelector('input[aria-label="reader SELECT"]')`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not load privilege information')`);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Target Object')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Target Object')}).click();true`);
          await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
          await win.webContents.executeJavaScript(`(${dialogButton('Next 100')}).click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).some(el=>el.innerText.includes('UI_PRIV_TARGET'))`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).find(el=>el.innerText.includes('UI_PRIV_TARGET')).click();true`);
          await win.webContents.executeJavaScript(`(${dialogButton('Select')}).click();true`);
          await waitFor(win, `!!(${check}) && !(${check}).disabled && !document.querySelector('[role=dialog]')`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('PUBLIC') && (${root}).innerText.includes('reader')`));
          await win.webContents.executeJavaScript(`window.pgPrivTest.failDetail();(${root}).querySelector('button[aria-label="Refresh to latest state"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not load privilege information') && (${check}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('UI_PRIV_TARGET')`));
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${check}).disabled`);
          await win.webContents.executeJavaScript(`(${check}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog]')`);
          assert.equal(await win.webContents.executeJavaScript('window.pgPrivTest.writes().length'),0);
          await win.webContents.executeJavaScript(`(${dialogButton('Cancel')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${check}).click();true`);
          await win.webContents.executeJavaScript(`(${dialogButton('Review SQL')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('GRANT SELECT ON TABLE')`);
          assert.equal(await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).disabled`),true);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('The requested change was not verified')`);
          assert.equal(await win.webContents.executeJavaScript('window.pgPrivTest.writes().length'),1);
          assert.equal(await win.webContents.executeJavaScript(`(${check}).checked`),false);
          await win.webContents.executeJavaScript(`(${dialogButton('Retry')}).click();true`);
          await waitFor(win, `!(${dialogButton('Review SQL')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Review SQL')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('GRANT SELECT ON TABLE')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && (${root}).innerText.includes('The change was verified and committed') && (${check}).checked`);
          assert.equal(await win.webContents.executeJavaScript('window.pgPrivTest.writes().length'),2);
          await win.webContents.executeJavaScript(`(${button('Target Object')}).click();true`);
          await waitFor(win, `document.querySelectorAll('[role=dialog] [role=combobox]').length===2`);
          await waitFor(win, `!document.querySelector('[role=dialog] [role=combobox]').getAttribute('aria-disabled')`);
          await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] [role=combobox]')[1].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=option]')).some(el=>el.textContent==='FUNCTION')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=option]')).find(el=>el.textContent==='FUNCTION').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).some(el=>el.innerText.includes('value text'))`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).find(el=>el.innerText.includes('value text')).click();true`);
          await win.webContents.executeJavaScript(`(${dialogButton('Select')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && (${root}).innerText.includes('DEMO.same_name(value text)')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Object Privileges').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'postgresql') {
          console.log('postgresql: checking lock blockers, cancellation and termination');
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Lock Management')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Lock Management').click();true`);
          const root = `document.querySelector('[data-testid="pg-lock-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not retrieve locks')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Terminate connection')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="PG_LOCK_800"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_LOCK_800"]').click();true`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Terminate connection')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_LOCK_801"]').click();true`);
          await waitFor(win, `!(${button('Cancel SQL')}).disabled && (${root}).innerText.includes('UPDATE DEMO.ORDERS')`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('SQL elapsed time is not lock waiting time')`));
          await win.webContents.executeJavaScript(`(${button('Inspect blocker 802')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('PID 802 / User: test')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Cancel SQL')}).disabled`),true);
          await win.webContents.executeJavaScript(`window.pgLockTest.failRead();(${root}).querySelector('button[aria-label="Refresh to latest state"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not retrieve locks') && (${button('Terminate connection')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`!!(${root}).querySelector('[data-id="PG_LOCK_802"]')`));
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Terminate connection')}).disabled`);
          await win.webContents.executeJavaScript(`window.__pgLockConfirm=window.confirm;window.__pgLockMessages=[];window.confirm=()=>false;(${button('Terminate connection')}).click();true`);
          assert.equal(await win.webContents.executeJavaScript('window.pgLockTest.commands().length'),0);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_LOCK_801"]').click();true`);
          await waitFor(win, `!(${button('Cancel SQL')}).disabled`);
          await win.webContents.executeJavaScript(`window.confirm=message=>{window.__pgLockMessages.push(message);return true;};(${button('Cancel SQL')}).click();(${button('Cancel SQL')}).click();true`);
          await waitFor(win, `window.pgLockTest.commands().length===1 && (${root}).innerText.includes('The observed SQL has ended')`);
          assert.equal((await win.webContents.executeJavaScript('window.pgLockTest.commands()'))[0].id,'PG_LOCK_801');
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="PG_LOCK_802"]').click();true`);
          await waitFor(win, `!(${button('Terminate connection')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Terminate connection')}).click();(${button('Terminate connection')}).click();true`);
          await waitFor(win, `window.pgLockTest.commands().length===2 && (${root}).innerText.includes('The target connection has ended')`);
          assert.ok(await win.webContents.executeJavaScript(`window.__pgLockMessages.every(message=>message.includes('test')&&message.includes('demo')&&message.includes('2026-10-26'))`));
          await win.webContents.executeJavaScript(`window.confirm=window.__pgLockConfirm;Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Lock Management').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Tablespace')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Tablespace').click();true`);
          console.log('oracle: checking tablespace review and partial results');
          const root = `document.querySelector('[data-testid="tablespace-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const dialogButton = label => `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const input = label => `Array.from(document.querySelectorAll('[role=dialog] label')).find(el=>el.textContent.startsWith(${JSON.stringify(label)})).parentElement.querySelector('input')`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not retrieve tablespaces')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Create tablespace')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="TEMP"]')`);
          console.log('oracle: tablespace list loaded');
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="SYSTEM"]').click();true`);
          await waitFor(win, `(${button('Drop tablespace')}).disabled`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="UI_BIG"]').click();true`);
          await waitFor(win, `!(${button('Resize BIGFILE')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Resize BIGFILE')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog]')`);
          assert.equal(await win.webContents.executeJavaScript(`(${input('Size (MB)')}).value`),'512');
          console.log('oracle: tablespace resize dialog opened');
          await win.webContents.executeJavaScript(`(()=>{const el=${input('Size (MB)')};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'768');el.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]'))[0].click();})()`);
          await win.webContents.executeJavaScript(`(${dialogButton('Review changes')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('RESIZE 768M')`);
          assert.equal(await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).disabled`),true);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `document.querySelector('[role=dialog]').innerText.includes('ORA-01031')`);
          assert.ok(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog]').innerText.includes('Completed: Resize BIGFILE')`));
          await win.webContents.executeJavaScript(`(${dialogButton('Reload current state')}).click();true`);
          await waitFor(win, `!(${dialogButton('Review changes')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Review changes')}).click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog] pre')).some(el=>el.innerText.includes('AUTOEXTEND OFF'))`);
          assert.ok(await win.webContents.executeJavaScript(`!Array.from(document.querySelectorAll('[role=dialog] pre')).some(el=>el.innerText.includes('RESIZE 768M'))`));
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] input[type=checkbox]')).at(-1).click();true`);
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Tablespaces').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Session Management')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Session Management').click();true`);
          const root = `document.querySelector('[data-testid="session-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not load sessions')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Kill Session')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="OWN_SESSION"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="OWN_SESSION"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Statistics: SID 601')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Kill Session')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="UI_SESSION"]').click();true`);
          await waitFor(win, `!(${button('Cancel SQL')}).disabled && (${root}).innerText.includes('900719925474099300001') && (${root}).innerText.includes('SELECT * FROM DEMO.ORDERS')`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('Previous SQL') && (${root}).innerText.includes('Current wait (s)')`));
          await win.webContents.executeJavaScript(`window.sessionTest.failDetail();(${button('Reload detail')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not load statistics') && (${button('Cancel SQL')}).disabled`);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('900719925474099300001')`));
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Cancel SQL')}).disabled`);
          await win.webContents.executeJavaScript(`window.__sessionConfirm=window.confirm;window.__sessionMessages=[];window.confirm=message=>{window.__sessionMessages.push(message);return true;};(${button('Cancel SQL')}).click();(${button('Cancel SQL')}).click();true`);
          await waitFor(win, `window.sessionTest.commands().length===1 && !(${button('Kill Session')}).disabled`);
          assert.equal((await win.webContents.executeJavaScript('window.sessionTest.commands()'))[0].execution,'sql-exec-1');
          await win.webContents.executeJavaScript(`window.confirm=()=>false;(${button('Kill Session')}).click();true`);
          assert.equal(await win.webContents.executeJavaScript('window.sessionTest.commands().length'),1);
          await win.webContents.executeJavaScript(`window.confirm=message=>{window.__sessionMessages.push(message);return true;};(${button('Kill Session')}).click();(${button('Kill Session')}).click();true`);
          await waitFor(win, `window.sessionTest.commands().length===2 && (${root}).innerText.includes('Oracle marked the session')`);
          assert.equal((await win.webContents.executeJavaScript('window.sessionTest.commands()'))[1].id,'UI_SESSION');
          assert.ok(await win.webContents.executeJavaScript(`window.__sessionMessages.every(message=>message.includes('602')&&message.includes('702'))`));
          const separator = `(${root}).querySelector('[role=separator]')`;
          const before=await win.webContents.executeJavaScript(`Number((${separator}).getAttribute('aria-valuenow'))`);
          await win.webContents.executeJavaScript(`(${separator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);
          await waitFor(win, `Number((${separator}).getAttribute('aria-valuenow'))>${before}`);
          const rect=await win.webContents.executeJavaScript(`(()=>{const r=(${separator}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
          win.webContents.sendInputEvent({type:'mouseMove',x:rect.x,y:rect.y});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:rect.x,y:rect.y});
          await waitFor(win, `document.body.style.cursor==='row-resize'`);
          await win.webContents.executeJavaScript(`window.confirm=window.__sessionConfirm;Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] Session Management').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
          await waitFor(win, `document.body.style.cursor!=='row-resize'`);
          win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:rect.x,y:rect.y});
        }
        if (dbType === 'oracle') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Pluggable DB (PDB) Management')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Pluggable DB (PDB) Management').click();true`);
          const root = `document.querySelector('[data-testid="pdb-manager-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const dialogButton = label => `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('The PDB operation could not be confirmed')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Create New')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="APP_GUID"]')`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="APP_GUID"]').click();true`);
          await waitFor(win, `(${root}).innerText.includes('The PDB used by this application')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Close (Shutdown)')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${button('Create New')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] input[type=password]')`);
          const input = label => `Array.from(document.querySelectorAll('[role=dialog] input')).find(el=>el.closest('.MuiFormControl-root')?.textContent.includes(${JSON.stringify(label)}))`;
          for(const [label,value] of [['Pluggable Database Name','UI_NEW_PDB'],['Admin Username','ADMIN'],['New Password','PDB_SECRET_SENTINEL']]) {
            await win.webContents.executeJavaScript(`(${input(label)}).focus();true`); await win.webContents.insertText(value);
          }
          await win.webContents.executeJavaScript(`(${dialogButton('Review operation')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog] input[type=checkbox]')`);
          assert.equal(await win.webContents.executeJavaScript('window.pdbTest.reviewsContainSecret()'),false);
          assert.equal(await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).disabled`),true);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();window.pdbTest.failMutation();true`);
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `window.pdbTest.writes().length===1 && document.querySelector('[role=dialog] input[type=password]').value===''`);
          assert.ok(await win.webContents.executeJavaScript(`!document.querySelector('[role=dialog]').innerText.includes('PDB_SECRET_SENTINEL')`));
          await win.webContents.executeJavaScript(`(${dialogButton('Cancel')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]')`);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!!(${root}).querySelector('[data-id="UI_PDB_GUID"]') && !(${button('Create New')}).disabled`);
          await win.webContents.executeJavaScript(`(${root}).querySelector('[data-id="UI_PDB_GUID"]').click();true`);
          await waitFor(win, `!(${button('Delete')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Delete')}).click();true`);
          await waitFor(win, `!!(${dialogButton('Review operation')})`);
          await win.webContents.executeJavaScript(`(${dialogButton('Review operation')}).click();true`);
          await waitFor(win, `!!(${input('Type UI_PDB to confirm')})`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input[type=checkbox]').click();true`);
          assert.equal(await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).disabled`),true);
          await win.webContents.executeJavaScript(`(${input('Type UI_PDB to confirm')}).focus();true`); await win.webContents.insertText('UI_PDB');
          await waitFor(win, `!(${dialogButton('Execute')}).disabled`);
          await win.webContents.executeJavaScript(`(${dialogButton('Execute')}).click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && window.pdbTest.writes().length===2 && !(${root}).querySelector('[data-id="UI_PDB_GUID"]')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='[DBA] PDB Management').querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='DBA').click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=menuitem]')).some(el=>el.textContent.trim()==='Directory')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Directory').click();true`);
          const root = `document.querySelector('[data-testid="directory-tab"]')`;
          const button = label => `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
          const tab = label => `Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent===${JSON.stringify(label)})`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Could not load directory information')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Create New')}).disabled`), true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          const row = `(${root}).querySelector('[data-id="UI_DIRECTORY"]')`;
          await waitFor(win, `!!(${row})`); await win.webContents.executeJavaScript(`(${row}).click();true`);
          await waitFor(win, `!(${button('Change path')}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${root}).querySelector('input[aria-label="READ: DEMO"]').checked`), true);
          assert.equal(await win.webContents.executeJavaScript(`(${root}).querySelector('input[aria-label="READ: DEMO"]').disabled`), true);
          assert.ok(await win.webContents.executeJavaScript(`(${root}).innerText.includes('READER') && (${root}).innerText.includes('PUBLIC')`));
          await win.webContents.executeJavaScript(`window.directoryTest.failDetails();(${button('Reload')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Could not load grants')`);
          assert.equal(await win.webContents.executeJavaScript(`(${button('Drop Definition')}).disabled`), true);
          await win.webContents.executeJavaScript(`(${button('Retry')}).click();true`);
          await waitFor(win, `!(${button('Change path')}).disabled`);
          await win.webContents.executeJavaScript(`(${button('Change path')}).click();true`);
          await waitFor(win, `!!document.querySelector('[role=dialog]')`);
          const path = `Array.from(document.querySelectorAll('[role=dialog] input')).find(el=>el.closest('.MuiFormControl-root')?.textContent.includes('Physical OS Path'))`;
          await waitFor(win, `!!(${path})`);
          assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] input').disabled`), true);
          await win.webContents.executeJavaScript(`(${path}).focus();(${path}).select();true`); await win.webContents.insertText("/demo/owner's");
          await win.webContents.executeJavaScript(`window.__directoryConfirm=window.confirm;window.confirm=()=>false;Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Execute').click();window.confirm=window.__directoryConfirm;true`);
          assert.equal(await win.webContents.executeJavaScript('window.directoryTest.writes().length'), 0);
          await win.webContents.executeJavaScript(`window.confirm=()=>true;Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Execute').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && window.directoryTest.writes().length===1 && !(${button('Change path')}).disabled`);
          assert.equal((await win.webContents.executeJavaScript('window.directoryTest.writes()'))[0].path, "/demo/owner's");
          await win.webContents.executeJavaScript(`(${root}).querySelector('input[aria-label="READ: APP_USER"]').click();true`);
          await waitFor(win, `window.directoryTest.writes().length===2 && (${root}).querySelector('input[aria-label="READ: APP_USER"]').checked`);
          await win.webContents.executeJavaScript(`(${tab('Grants')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('Grant option') && (${root}).innerText.includes('APP_USER')`);
          await win.webContents.executeJavaScript(`(${tab('Information')}).click();true`);
          await waitFor(win, `(${root}).innerText.includes("/demo/owner's") && (${root}).innerText.includes('Visible grants applicable to the current session')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==="[DBA] Directories").querySelector('[data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));true`);
        }
        if (dbType === 'oracle') {
          const synonymCategory = `Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='Synonym')`;
          await waitFor(win, `!!(${synonymCategory})`); await win.webContents.executeJavaScript(`(${synonymCategory}).click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_SYN_0')`);
          await win.webContents.executeJavaScript(`window.uiTest.failSynonymRead();Array.from(document.querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent.trim()==='UI_SYN_0').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          const root = `document.querySelector('[data-testid="synonym-window"]')`;
          const execute = `Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute')`;
          const target = `(${root}).querySelector('input[aria-label="[Target] Object"]')`;
          await waitFor(win, `!!(${root}) && (${root}).innerText.includes('Simulated synonym metadata failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${execute}).disabled`), true);
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Retry').click();true`);
          await waitFor(win, `!!(${target}) && (${target}).value==='UI_ITEM_0' && !(${execute}).disabled`);
          assert.equal(await win.webContents.executeJavaScript(`(${root}).querySelector('input[aria-label="Synonym Name"]').disabled`), true);
          await win.webContents.executeJavaScript(`window.__importAlerts=[];window.alert=message=>window.__importAlerts.push(message);window.uiTest.clear();(${execute}).click();true`);
          await waitFor(win, `window.__importAlerts.some(text=>text.includes('No changes'))`); assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0);
          await win.webContents.executeJavaScript(`(${target}).focus();(${target}).select();true`); await win.webContents.insertText('LOCAL_ROWS');
          await win.webContents.executeJavaScript(`window.uiTest.externalSynonym('OTHER_ROWS');(${execute}).click();true`);
          await waitFor(win, `(${root}).innerText.includes('The database definition changed elsewhere')`); assert.equal(await win.webContents.executeJavaScript('window.uiTest.queries().length'), 0);
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent.includes('Keep my edits')).click();true`);
          await win.webContents.executeJavaScript(`(${execute}).click();true`);
          await waitFor(win, `window.uiTest.queries().length===1 && !(${execute}).disabled`);
          assert.ok((await win.webContents.executeJavaScript('window.uiTest.queries()[0]')).includes('"LOCAL_ROWS"'));
          await win.webContents.executeJavaScript(`(${target}).focus();(${target}).select();true`); await win.webContents.insertText('RETAINED_DRAFT');
          await win.webContents.executeJavaScript(`window.uiTest.failSynonymRead();Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Refresh').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Simulated synonym metadata failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${target}).value`), 'RETAINED_DRAFT');
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Retry').click();true`);
          await waitFor(win, `!(${execute}).disabled`);
          await win.webContents.executeJavaScript(`window.uiTest.startSynonymPicker();Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Choose target object').click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_SYN_PICK_99')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
          await waitFor(win, `document.body.innerText.includes('UI_SYN_PICK_100')`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).find(el=>el.textContent.includes('UI_SYN_PICK_100')).click();true`);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Add').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && (${target}).value==='UI_SYN_PICK_100'`);
          await win.webContents.executeJavaScript(`window.uiTest.stopSynonymPicker();Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Source').click();true`);
          await waitFor(win, `!!document.querySelector('[data-testid="synonym-planned-source"]')`);
          assert.ok(await win.webContents.executeJavaScript(`document.querySelector('[data-testid="synonym-saved-source"]').textContent.includes('LOCAL_ROWS') && document.querySelector('[data-testid="synonym-planned-source"]').textContent.includes('UI_SYN_PICK_100')`));
          await win.webContents.executeJavaScript(`window.uiTest.failSynonymSource();Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Refresh').click();true`);
          await waitFor(win, `(${root}).innerText.includes('Simulated synonym source failure')`);
          assert.equal(await win.webContents.executeJavaScript(`(${root}).querySelector('button[aria-label="Copy saved DDL"]').disabled`), true);
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Refresh').click();true`);
          await waitFor(win, `!(${root}).querySelector('button[aria-label="Copy saved DDL"]').disabled`);
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Information').click();true`);
          await waitFor(win, `(${root}).innerText.includes('SYNONYM_DEPENDENT') && (${root}).innerText.includes('TABLE: VALID')`);
          await assertInformationRefresh();
          await win.webContents.executeJavaScript(`Array.from((${root}).querySelectorAll('button')).find(el=>el.textContent==='Open target').click();true`);
          await waitFor(win, `!(${root}) && Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.textContent.includes('LOCAL_ROWS'))`);
        }
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('open-sql-tab',{detail:{initialSql:'SELECT * FROM demo'}}));true`);
        // Exercise the compact toolbar deliberately instead of depending on OS font metrics.
        const planToolbar = `Array.from(document.querySelectorAll('[data-testid="sql-editor-toolbar"]')).find(el=>el.getBoundingClientRect().width>0)`;
        win.setSize(650, 1000);
        await waitFor(win, `(${planToolbar})?.getAttribute('data-compact')==='true' && !!(${planToolbar}).querySelector('button[aria-label="More SQL actions"]')`);
        await win.webContents.executeJavaScript(`(${planToolbar}).querySelector('button[aria-label="More SQL actions"]').click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('label')).some(label=>label.textContent.trim()==='Parse' && label.getBoundingClientRect().width>0)`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('label')).find(label=>label.textContent.trim()==='Parse' && label.getBoundingClientRect().width>0).querySelector('input').click();true`);
        await waitFor(win, `!!document.querySelector('[aria-label="Analyze SQL execution plan"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog][aria-label="More SQL actions"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
        await waitFor(win, `!document.querySelector('[role=dialog][aria-label="More SQL actions"]')`);
        win.setSize(2200, 1000);
        await waitFor(win, `(${planToolbar})?.getAttribute('data-compact')==='false'`);
        if (dbType === 'postgresql') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=combobox]')).find(el=>el.getBoundingClientRect().width>0).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `!!document.querySelector('[role=option][data-value="public"]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="public"]').click();true`);
        }
        await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Analyze SQL execution plan"]').click();true`);
        await waitFor(win, `document.body.innerText.includes('UI_ONLY_IDX')`);
        await win.webContents.executeJavaScript(`window.__planTargets=[];window.addEventListener('open-table-tab',event=>{window.__planTargets.push(event.detail);},{capture:true});true`);
        const planName = name => `Array.from(document.querySelectorAll('p')).find(el=>el.textContent===${JSON.stringify(name)} && el.getBoundingClientRect().width>0)`;
        await win.webContents.executeJavaScript(`(${planName('UI_ONLY_IDX')}).click();true`);
        if (dbType === 'postgresql') await win.webContents.executeJavaScript(`(${planName('UI_ONLY_ALIAS')}).click();true`);
        assert.equal(await win.webContents.executeJavaScript('window.__planTargets.length'), 0, 'Index and alias labels do not open tables');
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('insert-editor-text',{detail:'\\nSELECT 999 AS editor_changed'}));true`);
        if (dbType === 'postgresql') {
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=combobox]')).find(el=>el.getBoundingClientRect().width>0).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `!!document.querySelector('[role=option][data-value="DEMO"]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="DEMO"]').click();true`);
        }
        await waitFor(win, `!!document.querySelector('[aria-label="Ask AI for SQL Tuning"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Ask AI for SQL Tuning"]').click();true`);
        await waitFor(win, `window.uiTest.tuningExports().length===1`);
        const tuningText = (await win.webContents.executeJavaScript('window.uiTest.tuningExports()'))[0];
        assert.equal(tuningText.match(/\[2\. Target SQL\]\n=+\n([\s\S]*?)\n\n=+/)?.[1], 'SELECT * FROM demo');
        assert.ok(!tuningText.includes('editor_changed'), 'Edited SQL must not be paired with the old plan');
        assert.ok(tuningText.includes(`Execution schema: ${dbType === 'oracle' ? 'DEMO' : 'public'}`), 'Tuning retains the schema used for analysis');
        await win.webContents.executeJavaScript(`(${planName('Order.Items')}).click();true`);
        assert.deepEqual(await win.webContents.executeJavaScript('window.__planTargets'), [{ tableName: '"Archive.Mixed"."Order.Items"', targetTab: 'structure' }], 'Plan navigation preserves the real schema and dotted table name');
        await waitFor(win, `Array.from(document.querySelectorAll('[role=tab][aria-selected=true]')).some(tab=>tab.textContent.includes('Order.Items'))`);
        // Exercise compact SQL file actions, retained results and stopping a script.
        win.setSize(2200, 1000);
        await win.webContents.executeJavaScript(`window.__sqlAlerts=[];window.alert=value=>window.__sqlAlerts.push(value);window.confirm=()=>true;window.dispatchEvent(new CustomEvent('open-sql-tab',{detail:{initialSql:''}}));true`);
        const sqlButton = text => `Array.from(document.querySelectorAll('button')).find(el=>el.getBoundingClientRect().width>0 && (el.textContent.trim()===${JSON.stringify(text)} || el.getAttribute('aria-label')===${JSON.stringify(text)}))`;
        await waitFor(win, `!!(${sqlButton('Open SQL')})`);
        const fileActions = await win.webContents.executeJavaScript(`(()=>{const open=(${sqlButton('Open SQL')}),save=(${sqlButton('Save as')}),run=document.querySelector('[aria-label="Execute SQL"]');return {sameRow:Math.abs(open.getBoundingClientRect().top-run.getBoundingClientRect().top)<2,openText:open.textContent,saveText:save.textContent,icons:!!open.querySelector('svg')&&!!save.querySelector('svg'),draft:!!(${sqlButton('Restore draft')})};})()`);
        assert.deepEqual(fileActions, { sameRow: true, openText: '', saveText: '', icons: true, draft: false });
        const beforeBindCalls = await win.webContents.executeJavaScript(`window.uiTest.sqlCalls().length`);
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('insert-editor-text',{detail:'SELECT :amount;'}));true`);
        await waitFor(win, `!!document.querySelector('[data-testid="sql-bind-panel"]')`);
        const bindPanel = `document.querySelector('[data-testid="sql-bind-panel"]')`;
        await win.webContents.executeJavaScript(`(${bindPanel}).querySelector('[role=combobox]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=option][data-value="NUMBER"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="NUMBER"]').click();true`);
        await waitFor(win, `!!(${bindPanel}).querySelector('input[placeholder]')`);
        await win.webContents.executeJavaScript(`window.__bindInput=(${bindPanel}).querySelector('input[placeholder]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(window.__bindInput,'9007199254740993.123456789');window.__bindInput.dispatchEvent(new Event('input',{bubbles:true}));true`);
        const beforeBindWidth = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.cm-editor')).find(el=>el.getBoundingClientRect().width>0).getBoundingClientRect().width`);
        await win.webContents.executeJavaScript(`(${sqlButton('Hide bind variables')}).click();true`);
        await waitFor(win, `!(${bindPanel})`);
        assert.ok(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.cm-editor')).find(el=>el.getBoundingClientRect().width>0).getBoundingClientRect().width>${beforeBindWidth+200}`));
        await win.webContents.executeJavaScript(`(${sqlButton('Show bind variables')}).click();true`);
        await waitFor(win, `(${bindPanel})?.querySelector('input[placeholder]')?.value==='9007199254740993.123456789'`);
        win.setSize(1050, 1000);
        await waitFor(win, `!!document.querySelector('[role=dialog][aria-label="Bind Variables"]')`);
        assert.equal(await win.webContents.executeJavaScript(`(${bindPanel}).querySelector('[role=combobox]').textContent`), 'Number');
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[aria-label="Hide bind variables"]').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]') && !!(${sqlButton('More SQL actions')})`);
        assert.equal(await win.webContents.executeJavaScript(`(()=>{const toolbar=Array.from(document.querySelectorAll('[data-testid="sql-editor-toolbar"]')).find(el=>el.getBoundingClientRect().width>0);return toolbar.scrollWidth<=toolbar.clientWidth+1;})()`), true);
        await win.webContents.executeJavaScript(`(${sqlButton('More SQL actions')}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog][aria-label="More SQL actions"]') && !!(${sqlButton('Open SQL')}) && !!(${sqlButton('Format SQL')})`);
        await win.webContents.executeJavaScript(`(${sqlButton('Format SQL')}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`(${sqlButton('Show bind variables')}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog][aria-label="Bind Variables"]') && (${bindPanel}).querySelector('input[placeholder]').value==='9007199254740993.123456789'`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[aria-label="Hide bind variables"]').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        win.setSize(2200, 1000);
        await waitFor(win, `!!(${sqlButton('Open SQL')}) && !(${sqlButton('More SQL actions')})`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.sqlCalls().length`), beforeBindCalls);

        await win.webContents.executeJavaScript(`(${sqlButton('Open SQL')}).dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=tooltip]')).some(el=>el.textContent==='Open SQL')`);
        await win.webContents.executeJavaScript(`(${sqlButton('Open SQL')}).dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));true`);

        await win.webContents.executeJavaScript(`window.uiTest.startSql(${JSON.stringify('SELECT 1;\nSELECT SQL_BAD;\nSELECT SQL_NEVER;')});(${sqlButton('Open SQL')}).click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SQL_BAD'))`);
        await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Execute SQL"]').click();true`);
        await waitFor(win, `window.__sqlAlerts.some(value=>value.includes('SQL_BAD failed')) && !document.querySelector('[aria-label="Execute SQL"]').disabled`);
        assert.equal((await win.webContents.executeJavaScript('window.uiTest.sqlCalls()')).length, 2);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).some(el=>/^Result [0-9]/.test(el.textContent.trim()))`), false);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='Execution Log').click();true`);
        const errorLine = `Array.from(document.querySelectorAll('[data-testid="sql-log-error-line"]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SQL_BAD failed'))`;
        await waitFor(win, `!!(${errorLine})`);
        const logStateBefore = await win.webContents.executeJavaScript(`({calls:window.uiTest.sqlCalls().length,sql:Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0).textContent})`);
        assert.equal(await win.webContents.executeJavaScript(`(${errorLine}).tagName`), 'BUTTON');
        assert.equal(await win.webContents.executeJavaScript(`(${errorLine}).tabIndex`), 0);
        assert.ok(await win.webContents.executeJavaScript(`(${errorLine}).getAttribute('aria-label').startsWith('Go to SQL line 2: [ERROR] Line 2:')`));
        win.webContents.focus();
        await win.webContents.executeJavaScript(`window.__logJumpClicks=0;(${errorLine}).addEventListener('click',()=>window.__logJumpClicks++);(${errorLine}).focus();true`);
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
        win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
        await waitFor(win, `document.activeElement?.classList.contains('cm-content') && Array.from(document.querySelectorAll('.cm-activeLine')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SQL_BAD'))`);
        assert.equal(await win.webContents.executeJavaScript(`window.__logJumpClicks`), 1);
        await win.webContents.executeJavaScript(`(${errorLine}).focus();true`);
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
        win.webContents.sendInputEvent({type:'char',keyCode:' '});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
        await waitFor(win, `window.__logJumpClicks===2 && document.activeElement?.classList.contains('cm-content')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button[aria-label="Maximize results, logs and history"]')).find(el=>el.getBoundingClientRect().width>0).click();true`);
        await waitFor(win, `!Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0)`);
        await win.webContents.executeJavaScript(`(${errorLine}).click();true`);
        await waitFor(win, `document.activeElement?.classList.contains('cm-content') && Array.from(document.querySelectorAll('.cm-activeLine')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SQL_BAD'))`);
        const logSearch = `Array.from(document.querySelectorAll('[data-testid="sql-log-toolbar"] input')).find(el=>el.type==='search')`;
        const logIssues = `document.querySelector('[data-testid="sql-log-toolbar"] input[type=checkbox]')`;
        const logCount = `document.querySelector('[data-testid="sql-log-toolbar"] [role=status]')`;
        const setLogSearch = value => win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${logSearch}),${JSON.stringify(value)});(${logSearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await win.webContents.executeJavaScript(`(${logIssues}).click();true`);
        await waitFor(win, `(${logCount}).textContent==='1 of 2 logs'`);
        await setLogSearch('select 1');
        await waitFor(win, `(${logCount}).textContent==='0 of 2 logs' && document.body.innerText.includes('No logs match these filters.')`);
        await win.webContents.executeJavaScript(`(${logIssues}).click();true`);
        await waitFor(win, `(${logCount}).textContent==='1 of 2 logs'`);
        await setLogSearch('  SQL_BAD FAILED  ');
        await waitFor(win, `!!(${errorLine}) && (${logCount}).textContent==='1 of 2 logs'`);
        await setLogSearch('');
        await waitFor(win, `(${logCount}).textContent==='2 of 2 logs'`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.sqlCalls().length`), logStateBefore.calls);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0).textContent`), logStateBefore.sql);

        const originalTheme = await win.webContents.executeJavaScript(`window.settingsTest.saved().theme`);
        for (const themeName of ['simple','dark',originalTheme]) {
          await openGeneralSettings();
          await win.webContents.executeJavaScript(`document.querySelectorAll('[role=dialog] [role=tab]')[1].click();true`);
          const themeSelect = `Array.from(document.querySelectorAll('[role=dialog] .MuiFormControl-root')).find(el=>el.textContent.includes('App Theme (Design)')).querySelector('[role=combobox]')`;
          await waitFor(win, `!!(${themeSelect}) && (${themeSelect}).getBoundingClientRect().width>0`);
          await win.webContents.executeJavaScript(`(${themeSelect}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
          await waitFor(win, `!!document.querySelector('[role=option][data-value="${themeName}"]')`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="${themeName}"]').click();true`);
          await waitFor(win, `(${themeSelect}).closest('.MuiInputBase-root').querySelector('input').value==='${themeName}'`);
          await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiDialogActions-root button:last-child').click();true`);
          await waitFor(win, `!document.querySelector('[role=dialog]') && window.settingsTest.saved().theme==='${themeName}' && !!(${errorLine})`);
          const contrast = await win.webContents.executeJavaScript(`(()=>{
            const el=(${errorLine}),box=el.closest('[data-testid="sql-log-error"]');
            const parse=value=>value.match(/[0-9.]+/g).map(Number),bg=parse(getComputedStyle(box).backgroundColor),fg=parse(getComputedStyle(el).color),alpha=fg[3]??1;
            const text=fg.slice(0,3).map((value,i)=>value*alpha+bg[i]*(1-alpha));
            const luminance=rgb=>rgb.slice(0,3).map(value=>value/255).map(value=>value<=0.04045?value/12.92:Math.pow((value+0.055)/1.055,2.4)).reduce((sum,value,i)=>sum+value*[0.2126,0.7152,0.0722][i],0);
            const a=luminance(text),b=luminance(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
          })()`);
          assert.ok(contrast>=4.5,`${dbType}/${themeName}: SQL error contrast ${contrast}`);
          const badge = await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('[data-testid="connection-badge"]'),style=getComputedStyle(el),bounds=el.getBoundingClientRect();return {text:el.innerText,gradient:style.backgroundImage,radius:parseFloat(style.borderRadius),border:style.borderLeftWidth,icon:!!el.querySelector('[data-testid="StorageOutlinedIcon"]'),width:bounds.width,height:bounds.height,x:bounds.x,y:bounds.y};})()`);
          assert.ok(badge.text.includes('Development')); assert.ok(badge.icon);
          assert.ok(badge.gradient.includes('linear-gradient')); assert.ok(badge.radius>4);
          assert.equal(badge.border,'1px'); assert.ok(badge.width<=320 && badge.height<=48);
          if (dbType==='postgresql') assert.ok(badge.text.includes('TLS disabled'));
          if (process.env.MONABASE_UI_CAPTURE_DIR) {
            const x=Math.max(0,Math.floor(badge.x)-8),y=Math.max(0,Math.floor(badge.y)-8);
            fs.mkdirSync(process.env.MONABASE_UI_CAPTURE_DIR,{recursive:true});
            const image=await win.webContents.capturePage({x,y,width:Math.ceil(badge.width)+16,height:Math.ceil(badge.height)+16});
            fs.writeFileSync(path.join(process.env.MONABASE_UI_CAPTURE_DIR,`${dbType}-connection-${themeName}.png`),image.toPNG());
          }

        }

        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='Result').click();true`);
        await waitFor(win, `document.body.innerText.includes('SQL_FIRST_RESULT')`);
        const resultToolbar = `Array.from(document.querySelectorAll('[data-testid="sql-result-toolbar"]')).find(el=>el.getBoundingClientRect().width>0)`;
        await waitFor(win, `!!(${resultToolbar}) && (${resultToolbar}).textContent.includes('1 row') && (${resultToolbar}).textContent.includes('1 ms')`);
        assert.equal(await win.webContents.executeJavaScript(`(()=>{const toolbar=(${resultToolbar}),grid=Array.from(document.querySelectorAll('[role=grid]')).find(el=>el.getBoundingClientRect().width>0);return toolbar.getBoundingClientRect().bottom<=grid.getBoundingClientRect().top;})()`), true);

        await inspectFetchedCell(`Array.from(document.querySelectorAll('.MuiDataGrid-cell')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='SQL_FIRST_RESULT')`, 'SQL_FIRST_RESULT');
        const paneButton = label => `Array.from(document.querySelectorAll('button[aria-label]')).find(el=>el.getBoundingClientRect().width>0 && el.getAttribute('aria-label')===${JSON.stringify(label)})`;
        const paneSeparator = `Array.from(document.querySelectorAll('[role=separator][aria-label="Resize SQL editor and results"]')).find(el=>el.getBoundingClientRect().width>0)`;
        const paneBefore = await win.webContents.executeJavaScript(`({height:Number((${paneSeparator}).getAttribute('aria-valuenow')),calls:window.uiTest.sqlCalls().length,text:Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0).textContent})`);
        await win.webContents.executeJavaScript(`(${paneSeparator}).focus();(${paneSeparator}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);
        await waitFor(win, `Number((${paneSeparator}).getAttribute('aria-valuenow'))===${paneBefore.height+20}`);
        await win.webContents.executeJavaScript(`(${paneButton('Maximize SQL editor')}).click();true`);
        await waitFor(win, `!(${resultToolbar}) && !!(${paneButton('Restore split layout')})`);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0).textContent`), paneBefore.text);
        await win.webContents.executeJavaScript(`(${paneButton('Restore split layout')}).click();true`);
        await waitFor(win, `!!(${paneSeparator})`);
        assert.equal(await win.webContents.executeJavaScript(`Number((${paneSeparator}).getAttribute('aria-valuenow'))`), paneBefore.height+20);
        await win.webContents.executeJavaScript(`(${paneButton('Maximize results, logs and history')}).click();true`);
        await waitFor(win, `!!(${resultToolbar}) && !Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0)`);
        await win.webContents.executeJavaScript(`(${paneButton('Restore split layout')}).click();true`);
        await waitFor(win, `!!(${paneSeparator})`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.sqlCalls().length`), paneBefore.calls);

        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('insert-editor-text',{detail:' -- edit'}));true`);
        await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('-- edit'))`);
        assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('Unsaved changes') || document.body.innerText.includes('No unsaved changes')`), false);
        await win.webContents.executeJavaScript(`(${sqlButton('Save as')}).click();true`);
        await waitFor(win, `window.__sqlAlerts.includes('Could not save the SQL file.')`);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('-- edit'))`), true);
        await win.webContents.executeJavaScript(`(${sqlButton('Save as')}).click();true`);
        await waitFor(win, `!!window.uiTest.sqlSaved()`);
        assert.ok((await win.webContents.executeJavaScript('window.uiTest.sqlSaved()')).sql.includes('-- edit'));
        await win.webContents.executeJavaScript(`window.__historyOriginalTabLabel=document.querySelector('[role=tab][draggable=true][aria-selected=true]').textContent;window.__historyOriginalEditor=Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0);window.__historyOriginalText=window.__historyOriginalEditor.textContent;Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='Execution History').click();true`);
        const historyRow = `Array.from(document.querySelectorAll('[role=row]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SELECT HISTORY_COPY'))`;
        await waitFor(win, `!!(${historyRow})`);
        const historySearch = `Array.from(document.querySelectorAll('input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent==='Search SQL history'))`;
        const beforeHistoryCalls = await win.webContents.executeJavaScript(`window.uiTest.sqlCalls().length`);
        await win.webContents.executeJavaScript(`(${historyRow}).click();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${historySearch}),'no_such_history');(${historySearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `document.querySelector('[data-testid="sql-history-toolbar"]').textContent.includes('0 of 1 entries') && !(${historyRow})`);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Replace current SQL').disabled`), true);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${historySearch}),'  history_copy  ');(${historySearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await waitFor(win, `!!(${historyRow}) && document.querySelector('[data-testid="sql-history-toolbar"]').textContent.includes('1 of 1 entries')`);
        await win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${historySearch}),'');(${historySearch}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.sqlCalls().length`), beforeHistoryCalls);

        const beforeHistoryTabs = await win.webContents.executeJavaScript(`document.querySelectorAll('[role=tab][draggable=true]').length`);
        await win.webContents.executeJavaScript(`(${historyRow}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
        await waitFor(win, `document.querySelectorAll('[role=tab][draggable=true]').length===${beforeHistoryTabs+1} && Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent==='SELECT HISTORY_COPY')`);
        assert.equal(await win.webContents.executeJavaScript(`window.__historyOriginalEditor.textContent===window.__historyOriginalText`), true);
        await win.webContents.executeJavaScript(`document.querySelector('[role=tab][draggable=true][aria-selected=true] button[aria-label]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=tab][draggable=true]').length===${beforeHistoryTabs}`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab][draggable=true]')).find(el=>el.textContent===window.__historyOriginalTabLabel).click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent===window.__historyOriginalText)`);
        await win.webContents.executeJavaScript(`window.__historyOriginalEditor=Array.from(document.querySelectorAll('.cm-content')).find(el=>el.getBoundingClientRect().width>0);Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='Execution History').click();true`);
        await waitFor(win, `!!(${historyRow})`);
        await win.webContents.executeJavaScript(`(${historyRow}).click();true`);
        const replaceHistory = `Array.from(document.querySelectorAll('button')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='Replace current SQL')`;
        await waitFor(win, `!!(${replaceHistory}) && !(${replaceHistory}).disabled`);
        await win.webContents.executeJavaScript(`(${replaceHistory}).click();true`);
        await waitFor(win, `window.__historyOriginalEditor.textContent==='SELECT HISTORY_COPY'`);

        await win.webContents.executeJavaScript(`window.uiTest.startSql('SELECT SQL_SLOW; SELECT SQL_NEVER;');(${sqlButton('Open SQL')}).click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SQL_SLOW'))`);
        await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Execute SQL"]').click();true`);
        await waitFor(win, `document.body.innerText.includes('Executing statement 1 of 2') && window.uiTest.sqlCalls().length===3`);
        await win.webContents.executeJavaScript(`(${sqlButton('Abort Process')}).click();true`);
        await waitFor(win, `document.body.innerText.includes('SQL script stopped.') && !document.querySelector('[aria-label="Execute SQL"]').disabled`);
        assert.equal((await win.webContents.executeJavaScript('window.uiTest.sqlCalls()')).length, 3);
        const privateStatements = dbType === 'oracle' ? [
          ['ALTER USER', 'ALTER USER fixture_demo IDENTIFIED BY "DUMMY_UI_PASSWORD"'],
          ['ALTER USER', `BEGIN EXECUTE IMMEDIATE 'ALTER USER fixture_demo IDENTIFIED BY "DUMMY_UI_PASSWORD"'; END;`],
          ['ADMINISTER KEY MANAGEMENT', 'ADMINISTER KEY MANAGEMENT SET KEYSTORE OPEN IDENTIFIED BY "DUMMY_UI_PASSWORD"']
        ] : [
          ['ALTER ROLE', "ALTER ROLE fixture_demo PASSWORD 'DUMMY_UI_PASSWORD'"],
          ['ALTER ROLE', `DO $$ BEGIN EXECUTE 'ALTER ROLE fixture_demo PASSWORD ''DUMMY_UI_PASSWORD'''; END; $$`],
          ['CREATE SUBSCRIPTION', "CREATE SUBSCRIPTION fixture_demo CONNECTION 'postgresql://demo:DUMMY_UI_PASSWORD@example.invalid/db' PUBLICATION fixture_publication"],
          ['ALTER SUBSCRIPTION', "ALTER SUBSCRIPTION fixture_demo CONNECTION 'host=example.invalid password=DUMMY_UI_PASSWORD'"]
        ];
        let privateCallCount = 3;
        for (const [category, privateSql] of privateStatements) {
          await win.webContents.executeJavaScript(`window.uiTest.startSql(${JSON.stringify(privateSql)});(${sqlButton('Open SQL')}).click();true`);
          await waitFor(win, `Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('DUMMY_UI_PASSWORD'))`);
          await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Execute SQL"]').click();true`);
          privateCallCount++;
          await waitFor(win, `window.uiTest.sqlCalls().length===${privateCallCount} && !document.querySelector('[aria-label="Execute SQL"]').disabled`);
          assert.equal(await win.webContents.executeJavaScript('window.uiTest.sqlCalls().at(-1)[0]'), privateSql);
          await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='Execution Log').click();true`);
          const privateLog = `Array.from(document.querySelectorAll('p')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('<credentials hidden>') && el.textContent.includes(${JSON.stringify(category)}))`;
          await waitFor(win, `!!(${privateLog})`);
          assert.equal(await win.webContents.executeJavaScript(`(${privateLog}).textContent.includes('DUMMY_UI_PASSWORD')`), false);
        }
        const privateToggle = sqlButton('Execute without history');
        assert.equal(await win.webContents.executeJavaScript(`(${privateToggle}).getAttribute('aria-pressed')`), 'false');
        await win.webContents.executeJavaScript(`(${privateToggle}).click();true`);
        await waitFor(win, `(${privateToggle}).getAttribute('aria-pressed')==='true'`);
        await win.webContents.executeJavaScript(`window.uiTest.startSql("SELECT 'DUMMY_UI_PASSWORD' AS SQL_BAD_PRIVATE");(${sqlButton('Open SQL')}).click();true`);
        await waitFor(win, `(${privateToggle}).getAttribute('aria-pressed')==='true' && Array.from(document.querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('SQL_BAD_PRIVATE'))`);
        await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Execute SQL"]').click();true`);
        privateCallCount++;
        await waitFor(win, `window.uiTest.sqlCalls().length===${privateCallCount} && !document.querySelector('[aria-label="Execute SQL"]').disabled && document.body.innerText.includes('<SQL hidden: execution without history>')`);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('p')).filter(el=>el.getBoundingClientRect().width>0).some(el=>el.textContent.includes('SQL_BAD_PRIVATE') || el.textContent.includes('DUMMY_UI_PASSWORD'))`), false);
        await waitFor(win, `!(${privateToggle}).disabled`);
        await win.webContents.executeJavaScript(`(${privateToggle}).click();true`);
        await waitFor(win, `(${privateToggle}).getAttribute('aria-pressed')==='false'`);
        const closedSql = await win.webContents.executeJavaScript(`(()=>{const tab=Array.from(document.querySelectorAll('[role=tab][aria-selected=true]')).find(el=>el.textContent.startsWith('SQL '));window.__sqlCloseConfirms=0;window.confirm=()=>{window.__sqlCloseConfirms++;return false;};const title=tab.textContent;tab.querySelector('[data-testid="CloseIcon"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));return title;})()`);
        await waitFor(win, `!Array.from(document.querySelectorAll('[role=tab]')).some(el=>el.textContent===${JSON.stringify(closedSql)})`);
        assert.equal(await win.webContents.executeJavaScript('window.__sqlCloseConfirms'), 0);
        await win.webContents.executeJavaScript(`window.uiTest.stopSql();true`);
        win.setSize(1600, 1000);
        await win.webContents.executeJavaScript(`window.uiTest.startIndex();window.dispatchEvent(new CustomEvent('open-create-index-tab',{detail:{schema:'${schema}',tableName:''}}));true`);
        const indexRoot = `document.querySelector('[data-testid="index-window"]')`;
        await waitFor(win, `!!(${indexRoot}) && !(${indexRoot}).disabled`);
        await win.webContents.executeJavaScript(`(${indexRoot}).querySelector('button[aria-label="Select Table"]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===1`);
        await win.webContents.executeJavaScript(`window.__pickerSearch=Array.from(document.querySelectorAll('[role=dialog] input')).find(el=>Array.from(el.labels||[]).some(label=>label.textContent==='Search by partial name'));window.__pickerSearch.focus();window.__pickerSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));true`);
        await waitFor(win, `document.activeElement?.getAttribute('role')==='option'`);
        await win.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));true`);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role=dialog]')`), true);
        await win.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true,cancelable:true}));true`);
        await waitFor(win, `document.querySelector('[role=dialog] input[type=radio]').checked`);
        await win.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`);
        await waitFor(win, `!document.querySelector('[role=dialog]') && !(${indexRoot}).disabled && (${indexRoot}).querySelectorAll('li').length===3`);
        for (const column of ['A','B','C']) {
          await win.webContents.executeJavaScript(`Array.from((${indexRoot}).querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent==='${column}').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
          await delay(20);
        }
        await win.webContents.executeJavaScript(`Array.from((${indexRoot}).querySelectorAll('.MuiListItemButton-root')).find(el=>el.textContent==='C').click();true`);
        await waitFor(win, `!(${indexRoot}).querySelector('button[aria-label="Move index column up"]').disabled`);
        await win.webContents.executeJavaScript(`(${indexRoot}).querySelector('button[aria-label="Move index column up"]').click();true`);
        assert.deepEqual(await win.webContents.executeJavaScript(`Array.from((${indexRoot}).querySelectorAll('li')).map(el=>el.textContent)`), ['A','C','B']);
        await win.webContents.executeJavaScript(`(${indexRoot}).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));true`);
        await waitFor(win, `Array.from((${indexRoot}).querySelectorAll('li')).map(el=>el.textContent).join(',')==='A,B,C'`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=tab][aria-selected=true] [data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));window.uiTest.failIndex();window.dispatchEvent(new CustomEvent('open-edit-index-tab',{detail:{schema:'${schema}',indexName:'UI_INDEX'}}));true`);
        await waitFor(win, `!!(${indexRoot}).querySelector('[role=alert] button') && !(${indexRoot}).disabled`);
        const changeIndex = `Array.from((${indexRoot}).querySelectorAll('button')).find(el=>el.textContent==='Change')`;
        assert.equal(await win.webContents.executeJavaScript(`(${changeIndex}).disabled`), true);
        await win.webContents.executeJavaScript(`(${indexRoot}).querySelector('[role=alert] button').click();true`);
        await waitFor(win, `!(${changeIndex}).disabled`);
        await win.webContents.executeJavaScript(`Array.from((${indexRoot}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Source').click();true`);
        await waitFor(win, `Array.from((${indexRoot}).querySelectorAll('.cm-content')).some(el=>el.getBoundingClientRect().width>0 && el.textContent.includes('${dbType === 'postgresql' ? 'INCLUDE' : 'TABLESPACE'}'))`);
        await win.webContents.executeJavaScript(`Array.from((${indexRoot}).querySelectorAll('[role=tab]')).find(el=>el.textContent==='Statistics').click();true`);
        await waitFor(win, `!!(${indexRoot}).querySelector('.MuiDataGrid-root')`);
        await win.webContents.executeJavaScript(`(${indexRoot}).querySelector('[data-field=property] .MuiDataGrid-menuIcon button').click();true`);
        await waitFor(win, `!!document.querySelector('[role=menu]')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=menu]').textContent.includes('Sort')`), true);
        await win.webContents.executeJavaScript(`document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
        await waitFor(win, `!document.querySelector('[role=menu]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=tab][aria-selected=true] [data-testid=CloseIcon]').dispatchEvent(new MouseEvent('click',{bubbles:true}));window.uiTest.stopIndex();true`);
        await win.webContents.executeJavaScript(`window.__generationAlerts=[];window.alert=message=>window.__generationAlerts.push(message);window.confirm=()=>true;window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,bubbles:true}));true`);
        const generatorInput = label => `Array.from(document.querySelectorAll('input')).find(input=>input.getBoundingClientRect().width>0 && Array.from(input.labels||[]).some(el=>el.textContent.startsWith('${label}')))`;
        const generationCount = generatorInput('Generation Count');
        await waitFor(win, `!!(${generationCount}) && !(${generationCount}).disabled`);
        const generatorRoot = `document.querySelector('[data-testid="data-generator"]')`;
        await waitFor(win, `!!(${generatorRoot}).querySelector('button[aria-label="Select Table"]') && !(${generatorRoot}).querySelector('button[aria-label="Select Table"]').matches(':disabled')`);
        await win.webContents.executeJavaScript(`window.uiTest.startGeneratorPicker();(${generatorRoot}).querySelector('button[aria-label="Select Table"]').click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]')`);
        await waitFor(win, `document.querySelector('[role=dialog]').querySelectorAll('[role=combobox]')[1].textContent==='Table'`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiListItemButton-root').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog] input[type=radio]').checked`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===1 && document.querySelector('[role=dialog]').textContent.includes('UI_GEN')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiListItemButton-root').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));true`);
        await waitFor(win, `!document.querySelector('[role=dialog]') && (${generatorRoot}).querySelector('button[aria-label="Select Table"]').textContent.includes('UI_GEN')`);
        await waitFor(win, `!(${generatorRoot}).querySelector('button[aria-label="Select Table"]').matches(':disabled')`);
        await win.webContents.executeJavaScript(`(${generatorRoot}).querySelector('button[aria-label="Select Table"]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100 && document.querySelector('[role=dialog]').textContent.includes('UI_GENERATOR_0')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Cancel').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        const sequenceStart = generatorInput('Start Value');
        await waitFor(win, `!!(${sequenceStart}) && !(${sequenceStart}).disabled`);
        if (dbType === 'postgresql') {
          assert.equal(await win.webContents.executeJavaScript(`document.body.innerText.includes('Random Time') && !!document.querySelector('input[placeholder="HH:mm:ss"]')`), true);
        }
        const setGeneratorInput = (selector, value) => win.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call((${selector}),'${value}');(${selector}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        await setGeneratorInput(sequenceStart, '9007199254740993');
        await setGeneratorInput(generationCount, '1.5');
        const runGenerator = `Array.from((${generatorRoot}).querySelectorAll('button')).find(el=>el.textContent.trim()==='Execute')`;
        await waitFor(win, `!!(${runGenerator}) && (${runGenerator}).disabled && (${generationCount}).getAttribute('aria-invalid')==='true'`);
        assert.equal(await win.webContents.executeJavaScript(`(${generatorRoot}).textContent.includes('positive integer')`), true);
        await win.webContents.executeJavaScript(`window.uiTest.clear();true`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 0);
        assert.equal(await win.webContents.executeJavaScript(`(${sequenceStart}).value`), '9007199254740993');
        await setGeneratorInput(generationCount, '2');
        await waitFor(win, `!(${runGenerator}).disabled && (${generationCount}).getAttribute('aria-invalid')==='false'`);
        await win.webContents.executeJavaScript(`(${runGenerator}).parentElement.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=tooltip]')).some(el=>el.textContent==='Generate and insert data into the selected table using the configured rules and row count')`);
        await win.webContents.executeJavaScript(`(${runGenerator}).parentElement.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));Array.from((${generatorRoot}).querySelectorAll('button')).find(el=>el.textContent==='Preview').click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog] table') && document.querySelectorAll('[role=dialog] tbody tr').length===2`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.queries().length`), 0);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] table').textContent.includes('9007199254740993') && document.querySelector('[role=dialog] table').textContent.includes('9007199254740994')`), true);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Execute').click();true`);
        await waitFor(win, `window.__generationAlerts.some(message=>message.startsWith('2 row generation and insertion completed'))`);
        const generated = await win.webContents.executeJavaScript(`window.uiTest.queries()`);
        assert.equal(generated.length, 1); assert.ok(generated[0].includes('9007199254740993'));
        assert.ok(generated[0].includes('9007199254740994'));
        if (dbType === 'postgresql') {
          assert.ok(generated[0].includes(' AS time without time zone)'));
          assert.ok(!generated[0].includes('"LOCATION"'));
        }
        await setGeneratorInput(generationCount, '1001');
        await win.webContents.executeJavaScript(`window.uiTest.holdGenerator();(${runGenerator}).click();true`);
        await waitFor(win, `window.uiTest.generatorBatches()===1 && !!(${generatorRoot}).querySelector('[role=status] button')`);
        await win.webContents.executeJavaScript(`(${generatorRoot}).querySelector('[role=status] button').click();true`);
        await waitFor(win, `(${generatorRoot}).querySelector('[role=status] button').disabled`);
        await win.webContents.executeJavaScript(`window.uiTest.finishGenerator();true`);
        await waitFor(win, `!(${generatorRoot}).querySelector('[role=status]') && !(${runGenerator}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.generatorBatches()`), 1);
        assert.equal(await win.webContents.executeJavaScript(`(${generatorRoot}).querySelector('[role=alert]').textContent.includes('500')`), true);
        // Exercise the actual query builder, file validation, editing history and mocked AI review.
        await win.webContents.executeJavaScript(`window.__qbStep=1;window.__gridPhase='query-builder-open';window.uiTest.startQb();window.__qbAlerts=[];window.alert=message=>window.__qbAlerts.push(message);Array.from(document.querySelectorAll('header button')).find(button=>button.textContent==='View').click();true`);
        const qbMenu = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.startsWith('Query Builder'))`;
        await waitFor(win, `!!(${qbMenu})`); await win.webContents.executeJavaScript(`window.__qbStep=2;(${qbMenu}).click();true`);
        const qbRoot = `document.querySelector('[data-testid="query-builder"]')`;
        await waitFor(win, `!!(${qbRoot}) && !(${qbRoot}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`!!(${qbRoot}).querySelector('[data-testid="query-builder-canvas"] [data-testid="query-builder-empty"]') && !(${qbRoot}).querySelector('[data-testid="query-builder-toolbar"]').textContent.includes('Tables, views, and fields')`), true);

        await win.webContents.executeJavaScript(`(()=>{const input=(${qbRoot}).querySelector('input[type=file]'),design=window.uiTest.qbDocument(),transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify({...design,queryTables:[design.queryTables.find(table=>table.id==='qa')],queryJoins:[]})],'single-table.json',{type:'application/json'}));Object.defineProperty(input,'files',{configurable:true,value:transfer.files});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
        await waitFor(win, `(${qbRoot}).innerText.includes('QB_A') && !(${qbRoot}).querySelector('[data-testid="query-builder-empty"]')`);
        await win.webContents.executeJavaScript(`window.__qbStep=3;(()=>{const input=(${qbRoot}).querySelector('input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(window.uiTest.qbDocument())],'query.json',{type:'application/json'}));Object.defineProperty(input,'files',{configurable:true,value:transfer.files});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
        await waitFor(win, `(${qbRoot}).innerText.includes('QB_A')`);
        assert.equal(await win.webContents.executeJavaScript(`!!(${qbRoot}).querySelector('[data-testid="query-builder-empty"]')`), false);
        for (const label of ['Undo', 'Redo', 'Read', 'Save']) {
          const appearance = await win.webContents.executeJavaScript(`(()=>{const button=(${qbRoot}).querySelector('[aria-label="${label}"]');return {text:button.textContent,icon:!!button.querySelector('svg')};})()`);
          assert.deepEqual(appearance, { text: '', icon: true });
        }
        const toolbarHelp = { Undo: 'Undo the last design change', Redo: 'Redo the last undone design change', Read: 'Load a query builder design from a JSON file', Save: 'Save the current query builder design to a JSON file', Clear: 'Clear all tables, fields and joins from the design', Execute: 'Execute the SQL generated from the current design' };
        for (const [label, help] of Object.entries(toolbarHelp)) {
          const action = `Array.from((${qbRoot}).querySelector('[data-testid="query-builder-toolbar"]').querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)} || el.textContent===${JSON.stringify(label)})`;
          assert.equal(await win.webContents.executeJavaScript(`!!(${action}).querySelector('svg')`), true);
          await win.webContents.executeJavaScript(`(${action}).parentElement.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=tooltip]')).some(el=>el.textContent===${JSON.stringify(help)})`);
          await win.webContents.executeJavaScript(`(${action}).parentElement.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));true`);
        }

        const aiButtonHeights = await win.webContents.executeJavaScript(`(()=>{const ai=(${qbRoot}).querySelector('[aria-label="Ask AI to generate SQL"]');return {ai:ai.getBoundingClientRect().height,others:Array.from(ai.parentElement.parentElement.querySelectorAll('button')).filter(button=>button!==ai).map(button=>button.getBoundingClientRect().height)};})()`);
        assert.ok(aiButtonHeights.ai > 0);
        assert.ok(aiButtonHeights.others.every(height=>Math.abs(height-aiButtonHeights.ai)<1), JSON.stringify(aiButtonHeights));
        const qbButton = text => `Array.from((${qbRoot}).querySelectorAll('button')).find(el=>el.textContent.trim()==='${text}' || el.getAttribute('aria-label')==='${text}')`;
        await win.webContents.executeJavaScript(`window.__qbStep=4;(()=>{const input=(${qbRoot}).querySelector('input[placeholder]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'> 10');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
        await waitFor(win, `(${qbRoot}).querySelector('input[placeholder]').value==='> 10'`);
        assert.equal(await win.webContents.executeJavaScript(`(${qbRoot}).innerText.includes('Unsaved changes') || (${qbRoot}).innerText.includes('No unsaved changes')`), false);
        await win.webContents.executeJavaScript(`window.__qbStep=5;(${qbButton('Undo')}).click();true`);
        await waitFor(win, `(${qbRoot}).querySelector('input[placeholder]').value===''`);
        await win.webContents.executeJavaScript(`window.__qbStep=6;(${qbButton('Redo')}).click();true`);
        await waitFor(win, `(${qbRoot}).querySelector('input[placeholder]').value==='> 10'`);
        await win.webContents.executeJavaScript(`window.__qbStep=7;(${qbButton('Save')}).click();true`);
        await waitFor(win, `window.__qbAlerts.some(message=>message.includes('Could not save'))`);
        assert.equal(await win.webContents.executeJavaScript(`window.__qbStep=8;(${qbRoot}).querySelector('input[placeholder]').value==='> 10'`), true);
        await waitFor(win, `!(${qbButton('Save')}).disabled && !(${qbRoot}).disabled`);
        await win.webContents.executeJavaScript(`window.__qbStep=9;(${qbButton('Save')}).click();true`);
        await waitFor(win, `!!window.uiTest.qbSaved()`);
        assert.equal((await win.webContents.executeJavaScript('window.uiTest.qbSaved()')).dbType, dbType);
        await win.webContents.executeJavaScript(`window.__qbStep=10;Array.from(document.querySelectorAll('header button')).find(el=>el.textContent==='AI').click();true`);
        await waitFor(win, `!!(${aiSettings})`); await win.webContents.executeJavaScript(`window.__qbStep=11;(${aiSettings}).click();true`);
        await waitFor(win, `!!(${aiSave}) && !(${aiSave}).disabled`);
        await win.webContents.executeJavaScript(`window.__qbStep=12;Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Close').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        await win.webContents.executeJavaScript(`window.__qbStep=13;(${qbRoot}).querySelector('[aria-label="Ask AI to generate SQL"]').click();true`);
        const qbPrompt = `document.querySelector('textarea[placeholder^="Enter an AI request"]')`;
        await waitFor(win, `!!(${qbPrompt}) && !(${qbPrompt}).disabled`);
        await win.webContents.executeJavaScript(`window.__qbStep=14;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call((${qbPrompt}),'Sum the amount');(${qbPrompt}).dispatchEvent(new Event('input',{bubbles:true}));true`);
        const qbSend = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Send')`;
        await waitFor(win, `!!(${qbSend}) && !(${qbSend}).disabled`);
        await win.webContents.executeJavaScript(`(()=>{const details=Array.from(document.querySelectorAll('details')).find(el=>el.querySelector('summary')?.textContent==='Requirements and verification (optional)');details.open=true;const field=Array.from(details.querySelectorAll('.MuiFormControl-root')).find(el=>el.querySelector('label')?.textContent==='Expected result').querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'UI_EXPECTED_SUM');field.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
        await waitFor(win, `Array.from(document.querySelectorAll('details')).some(el=>el.innerText.includes('UI_CONTEXT_VERSION'))`);
        await win.webContents.executeJavaScript(`(${qbPrompt}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.qbAiRequests()`), 0);
        await win.webContents.executeJavaScript(`window.__qbStep=15;(${qbPrompt}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog]')).some(el=>el.textContent.includes('Review query builder proposal') && el.textContent.includes('SUM('))`);
        const submittedAiContext = JSON.stringify(await win.webContents.executeJavaScript('window.uiTest.qbAiPayloads()[0][1]'));
        assert.ok(submittedAiContext.includes('UI_CONTEXT_VERSION')); assert.ok(submittedAiContext.includes('UI_EXPECTED_SUM'));
        assert.ok(submittedAiContext.includes('not a claim that you executed code'));
        assert.equal(await win.webContents.executeJavaScript(`window.__qbStep=16;window.uiTest.qbExecutions()`), 0);
        await win.webContents.executeJavaScript(`window.__qbStep=17;Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Apply to design').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]') && Array.from((${qbRoot}).querySelectorAll('[role=combobox]')).some(el=>el.textContent==='Sum')`);
        const chat = `document.querySelector('[data-testid="ai-conversation-scroll"]')`;
        await waitFor(win, `!!(${chat}) && !!(${chat}).firstElementChild`);
        await win.webContents.executeJavaScript(`window.__chatStyle=(${chat}).style.cssText;window.__chatFirstStyle=(${chat}).firstElementChild.style.cssText;(${chat}).style.flex='0 0 120px';(${chat}).style.maxHeight='120px';(${chat}).firstElementChild.style.minHeight='600px';true`);
        await waitFor(win, `(${chat}).scrollHeight>(${chat}).clientHeight`);
        await win.webContents.executeJavaScript(`(${chat}).scrollTop=0;(${chat}).dispatchEvent(new Event('scroll'));true`);
        const jumpLatest = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Jump to latest')`;
        await waitFor(win, `!!(${jumpLatest})`);
        await win.webContents.executeJavaScript(`(${jumpLatest}).click();true`);
        await waitFor(win, `(${chat}).scrollTop>0 && !(${jumpLatest})`);
        await win.webContents.executeJavaScript(`(${chat}).style.cssText=window.__chatStyle;(${chat}).firstElementChild.style.cssText=window.__chatFirstStyle;true`);
        await win.webContents.executeJavaScript(`window.__qbStep=18;(${qbButton('Undo')}).click();true`);
        await waitFor(win, `!Array.from((${qbRoot}).querySelectorAll('[role=combobox]')).some(el=>el.textContent==='Sum')`);
        await win.webContents.executeJavaScript(`window.__qbStep=19;(${qbButton('Redo')}).click();true`);
        await win.webContents.executeJavaScript(`window.__qbStep=20;(${qbButton('Execute')}).click();(${qbButton('Execute')}).click();true`);
        await waitFor(win, `window.uiTest.qbExecutions()===1 && (${qbRoot}).disabled`);
        await win.webContents.executeJavaScript(`window.__qbStep=21;window.uiTest.finishQb();true`);
        await waitFor(win, `(${qbRoot}).innerText.includes('12:34:56.123456789') && !(${qbRoot}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`window.__qbStep=22;window.uiTest.qbExecutions()`), 1);
        await win.webContents.executeJavaScript(`(async()=>{
          window.__gridPhase='query-builder-result-resize';
          const grid=(${qbRoot}).querySelector('.MuiDataGrid-root'), viewport=grid.parentElement;
          const outer=window.__gridResizeObservers.get(viewport), inner=window.__gridResizeObservers.get(grid.querySelector('.MuiDataGrid-main'));
          if(!outer||!inner) throw new Error('Builder grid resize observers are missing');
          window.__qbViewport=viewport;window.__qbViewportStyle=viewport.style.cssText;
          await new Promise(resolve=>{
            requestAnimationFrame(()=>{viewport.style.flex='0 0 0px';viewport.style.maxHeight='0px';outer.notify();});
            inner.notify();requestAnimationFrame(()=>setTimeout(resolve,0));
          });
        })()`);
        await waitFor(win, `!(${qbRoot}).querySelector('.MuiDataGrid-root')`);
        await win.webContents.executeJavaScript(`window.__qbViewport.style.cssText=window.__qbViewportStyle;true`);
        await waitFor(win, `(${qbRoot}).innerText.includes('12:34:56.123456789')`);
        assert.equal(await win.webContents.executeJavaScript(`window.uiTest.qbExecutions()`), 1);

        // Exercise real ER controls and React Flow with isolated mock diagram data.
        await win.webContents.executeJavaScript(`window.uiTest.startEr();window.__erAlerts=[];window.alert=message=>window.__erAlerts.push(message);Array.from(document.querySelectorAll('header button')).find(button=>button.textContent.trim()==='View').click();true`);
        const erMenu = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.startsWith('ER Diagram Viewer'))`;
        await waitFor(win, `!!(${erMenu})`);
        await win.webContents.executeJavaScript(`(${erMenu}).click();true`);
        const customEr = `Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Custom ER Diagram (Virtual Relations)')`;
        await waitFor(win, `!!(${customEr}) && !(${customEr}).disabled`);
        await win.webContents.executeJavaScript(`(${customEr}).click();true`);
        const erFile = `Array.from(document.querySelectorAll('[role=button]')).find(el=>el.textContent==='er-review.json')`;
        await waitFor(win, `!!(${erFile})`);
        await win.webContents.executeJavaScript(`(${erFile}).click();true`);
        await waitFor(win, `document.querySelectorAll('.react-flow__node').length===2 && document.body.innerText.includes('No unsaved changes')`);
        const erSync = `document.querySelector('button[data-testid="er-sync"]')`;
        await win.webContents.executeJavaScript(`(${erSync}).click();true`);
        await waitFor(win, `Array.from(document.querySelectorAll('[role=dialog]')).some(el=>el.textContent.includes('Review database changes') && el.textContent.includes('ADDED_COLUMN'))`);
        const erButton = text => `Array.from(document.querySelectorAll('button')).find(el=>el.getBoundingClientRect().width>0 && el.textContent==='${text}')`;
        await win.webContents.executeJavaScript(`(${erButton('Cancel')}).click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.react-flow').textContent.includes('ADDED_COLUMN')`), false);
        await win.webContents.executeJavaScript(`(${erSync}).click();true`);
        await waitFor(win, `!!(${erButton('Apply to diagram')})`);
        await win.webContents.executeJavaScript(`(${erButton('Apply to diagram')}).click();true`);
        await waitFor(win, `document.querySelector('.react-flow').textContent.includes('ADDED_COLUMN') && document.body.innerText.includes('Unsaved changes')`);
        await waitFor(win, `!!(${erButton('Undo')}) && !(${erButton('Undo')}).disabled`);
        await win.webContents.executeJavaScript(`(${erButton('Undo')}).click();true`);
        await waitFor(win, `!document.querySelector('.react-flow').textContent.includes('ADDED_COLUMN') && document.body.innerText.includes('No unsaved changes')`);
        await waitFor(win, `!!(${erButton('Redo')}) && !(${erButton('Redo')}).disabled`);
        await win.webContents.executeJavaScript(`(${erButton('Redo')}).click();true`);
        await waitFor(win, `document.querySelector('.react-flow').textContent.includes('ADDED_COLUMN')`);
        await win.webContents.executeJavaScript(`(${erButton('Git Commit')}).click();true`);
        await waitFor(win, `!!Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Record')`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Record').click();true`);
        await waitFor(win, `!!window.uiTest.erSaved() && document.body.innerText.includes('No unsaved changes')`);
        const erSaved = await win.webContents.executeJavaScript('window.uiTest.erSaved()');
        assert.equal(erSaved.version, 2); assert.equal(erSaved.schema, 'DEMO'); assert.equal(erSaved.edges.length, 2);
        // The actual ER history controls load bounded pages and permit navigation back.
        await win.webContents.executeJavaScript(`(${erButton('Compare History')}).click();true`);
        await waitFor(win, `document.body.innerText.includes('ER history page 0') && !!(${erButton('Older history')}) && !(${erButton('Older history')}).disabled`);
        assert.equal(await win.webContents.executeJavaScript(`(${erButton('Newer history')}).disabled`), true);
        await win.webContents.executeJavaScript(`(${erButton('Older history')}).click();true`);
        await waitFor(win, `document.body.innerText.includes('ER history page 1') && !document.body.innerText.includes('ER history page 0') && (${erButton('Older history')}).disabled`);
        await win.webContents.executeJavaScript(`(${erButton('Newer history')}).click();true`);
        await waitFor(win, `document.body.innerText.includes('ER history page 0') && !document.body.innerText.includes('ER history page 1')`);
        await win.webContents.executeJavaScript(`(${erButton('Back to Design Screen')}).click();true`);
        await waitFor(win, `!!document.querySelector('button[data-testid="er-export"]')`);
        const verifyErImage = async (selector, suffix) => {
          const imagePromise = new Promise(resolve => win.webContents.session.once('will-download', (_event, item) => {
            item.setSavePath(path.join(temporary, dbType + '-er-' + suffix + '.png'));
            item.once('done', (_event, state) => resolve({ state, path: item.getSavePath() }));
          }));
          await win.webContents.executeJavaScript(`document.querySelector('${selector}').click();true`);
          let timeout;
          try {
            const exported = await Promise.race([imagePromise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('ER image export timed out')), 15000); })]);
            assert.equal(exported.state, 'completed');
            assert.deepEqual([...fs.readFileSync(exported.path).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
          } finally { clearTimeout(timeout); }
        };
        await verifyErImage('button[data-testid="er-export"]', 'custom');
        await waitFor(win, `!document.querySelector('button[data-testid="er-export"]').disabled`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Auto-gen ER Diagram').click();true`);
        const drawEr = erButton('Draw ER Diagram');
        await waitFor(win, `!!(${drawEr}) && !(${drawEr}).disabled`);
        await win.webContents.executeJavaScript(`(${drawEr}).click();true`);
        await waitFor(win, `document.querySelectorAll('.react-flow__node').length===2 && !document.querySelector('button[data-testid="auto-er-export"]').disabled`);
        await verifyErImage('button[data-testid="auto-er-export"]', 'auto');
        await win.webContents.executeJavaScript(`window.uiTest.startErPicker();Array.from(document.querySelectorAll('[role=tab]')).find(el=>el.textContent==='Custom ER Diagram (Virtual Relations)').click();true`);
        const erAction = text => `Array.from(document.querySelectorAll('button')).find(el=>el.getBoundingClientRect().width>0 && el.textContent.trim()===${JSON.stringify(text)})`;
        for (const [label,help] of [['Add Table','Add tables or views from this diagram’s schema to the canvas'],['Add Relation','Add a virtual relation between objects on the canvas']]) {
          await win.webContents.executeJavaScript(`(${erAction(label)}).parentElement.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));true`);
          await waitFor(win, `Array.from(document.querySelectorAll('[role=tooltip]')).some(el=>el.textContent===${JSON.stringify(help)})`);
          await win.webContents.executeJavaScript(`(${erAction(label)}).parentElement.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));true`);
        }
        await win.webContents.executeJavaScript(`(${erAction('Add Table')}).click();true`);
        await waitFor(win, `!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').textContent.includes('Add tables and views')`);
        const pickerCategory = `document.querySelector('[role=dialog]').querySelectorAll('[role=combobox]')[1]`;
        await win.webContents.executeJavaScript(`(${pickerCategory}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=option][data-value="TABLE"]')`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('[role=option]').length`), 2);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="TABLE"]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
        assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] .MuiListItemButton-root')).find(el=>el.textContent.includes('ER_A')).getAttribute('aria-disabled')`), 'true');
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===1 && document.querySelector('[role=dialog]').textContent.includes('ER_PICK_100')`);
        await win.webContents.executeJavaScript(`window.__multiRow=document.querySelector('[role=dialog] .MuiListItemButton-root');window.__multiRow.focus();window.__multiRow.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));window.__multiRow.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true,cancelable:true}));window.__multiRow.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`);
        await waitFor(win, `document.querySelector('[role=dialog] .MuiListItemButton-root').getAttribute('aria-selected')==='true'`);
        await win.webContents.executeJavaScript(`(${pickerCategory}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=option][data-value="VIEW"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="VIEW"]').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog]').textContent.includes('ER_PICK_VIEW')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiListItemButton-root').click();true`);
        await waitFor(win, `document.querySelector('[role=dialog] .MuiListItemButton-root input').checked`);
        const selectionToggle = `Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent.startsWith('Selected:'))`;
        await win.webContents.executeJavaScript(`(${selectionToggle}).click();true`);
        await waitFor(win, `(${selectionToggle}).getAttribute('aria-expanded')==='true' && !!document.querySelector('[role=dialog] button[aria-label="Remove ER_PICK_100 from selection"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] button[aria-label="Remove ER_PICK_100 from selection"]').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog] button[aria-label="Remove ER_PICK_100 from selection"]') && (${selectionToggle}).textContent==='Selected: 1'`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Clear selection').click();true`);
        await waitFor(win, `(${selectionToggle}).textContent==='Selected: 0' && !document.querySelector('[role=dialog] .MuiListItemButton-root input').checked`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiListItemButton-root').click();(${pickerCategory}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));true`);
        await waitFor(win, `!!document.querySelector('[role=option][data-value="TABLE"]')`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=option][data-value="TABLE"]').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===100`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Next 100').click();true`);
        await waitFor(win, `document.querySelectorAll('[role=dialog] .MuiListItemButton-root').length===1`);
        await win.webContents.executeJavaScript(`document.querySelector('[role=dialog] .MuiListItemButton-root').click();true`);
        await waitFor(win, `(${selectionToggle}).textContent==='Selected: 2'`);
        await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(el=>el.textContent==='Add').click();true`);
        await waitFor(win, `!document.querySelector('[role=dialog]') && document.querySelectorAll('.react-flow__node').length===4`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.react-flow').textContent.includes('ER_PICK_100') && document.querySelector('.react-flow').textContent.includes('ER_PICK_VIEW')`), true);

        assert.ok(!await win.webContents.executeJavaScript(`window.__erAlerts.some(message=>message.includes('failed') || message.includes('error'))`));
        await win.webContents.executeJavaScript(`window.__gridPhase='disconnect-reconnect';true`);
        await win.webContents.executeJavaScript(`window.__disconnectAlerts=[];window.alert=message=>window.__disconnectAlerts.push(message);window.confirm=()=>true;window.loginTest.failDisconnect();Array.from(document.querySelectorAll('header button')).find(button=>button.textContent.trim()==='Connect').click();true`);
        const disconnectItem = `Array.from(document.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Disconnect and return to login')`;
        await waitFor(win, `!!(${disconnectItem})`);
        await win.webContents.executeJavaScript(`(${disconnectItem}).click();true`);
        await waitFor(win, `!!(${connect}) && window.__disconnectAlerts.some(message=>message.includes('cleanup could not be confirmed'))`);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="Commit"]')`), false);
        await waitFor(win, `!!document.querySelector('input[value="Test DB"]')`);
        const connectsBeforeRetry = await win.webContents.executeJavaScript(`window.loginTest.connections()`);
        await win.webContents.executeJavaScript(`window.alert=message=>{throw new Error(message)};(${connect}).click();true`);
        await waitFor(win, `window.loginTest.connections()===${connectsBeforeRetry + 1}`);
        await win.webContents.executeJavaScript(`window.loginTest.finishConnect();true`);
        await waitFor(win, `!!document.querySelector('button[aria-label="Commit"]')`);
        if (errors.length) console.error(`${dbType}: synchronous grid diagnostics: ${await win.webContents.executeJavaScript('JSON.stringify(window.__gridWarnings)')}`);
        assert.deepEqual(errors, []);
        console.log(`${dbType}: lazy workspace, category expansion, pagination, collapse, cached reopening, single page fetch, stable export dialog, empty CSV records, malformed quote rejection, view value preservation, view pagination, view count failure/retry, safe sequence save/restart${dbType === 'postgresql' ? ', unchanged type save, and preserved trigger save' : ''} passed.`);
      } finally {
        if (errors.length && !win.isDestroyed()) console.error('Query builder stage', await win.webContents.executeJavaScript(`JSON.stringify({step:window.__qbStep,dialogs:Array.from(document.querySelectorAll('[role=dialog]')).map(el=>el.textContent),buttons:Array.from(document.querySelectorAll('[data-testid=query-builder] button')).map(el=>el.textContent)})`).catch(() => 'unavailable'));
        if (errors.length && !win.isDestroyed()) console.error(`${dbType}: warning-time diagnostics: ${await win.webContents.executeJavaScript('JSON.stringify(window.__gridWarnings)').catch(() => 'unavailable')}`);
        win.destroy();
      }
    }
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(timeout);
    try { fs.rmSync(temporary, { recursive: true, force: true }); }
    catch { console.error('Could not remove temporary UI test data.'); exitCode = 1; }
    app.exit(exitCode);
  }
});
