// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppBar, Box, Button, Chip, Divider, IconButton, Menu, MenuItem, Tab, Tabs, Toolbar, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import { useGlobalGit } from '@/features/git/useGlobalGit';
import GlobalGitDialog from '@/features/git/GlobalGitDialog';
import GitWorkspaceDialog from '@/features/git/GitWorkspaceDialog';
import { useAiSettings } from '@/features/ai/useAiSettings';
import AiSettingsDialog from '@/features/ai/AiSettingsDialog';
import AiMenu from '@/features/ai/AiMenu';
import AiChatSidebar from '@/features/ai/AiChatSidebar';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import type { DatabaseObject, ObjectCategory } from '@/shared/types/objectTypes';
import type { AiContext } from '@/shared/types/aiTypes';
import SourceWindow from './SourceWindow';
import TableWindow from './table/TableWindow';
import type { MysqlIndexProps, MysqlIndexAction } from './index/useMysqlIndex';
import FunctionWindow from './function/FunctionWindow';
import ProcedureWindow from './procedure/ProcedureWindow';
import DefinitionImportDialog from './DefinitionImportDialog';
import TriggerWindow from './trigger/TriggerWindow';
import ViewWindow from './view/ViewWindow';
import IndexWindow from './index/IndexWindow';
import CreateTableWindow from './CreateTableWindow';
import { useTableOpening } from '@/features/table/useTableOpening';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useWorkspacePanelWidth } from '@/shared/hooks/useWorkspacePanelWidth';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { AppSettings, ConnectionConfig } from '@/shared/types/appTypes';
import ConnectionBadge from '@/components/ConnectionBadge';
import TopMenuBar from '@/components/TopMenuBar';
import MonaBaseLogo from '@/components/MonaBaseLogo';
import HelpMenu from '@/components/HelpMenu';
import AboutDialog from '@/components/AboutDialog';
import WorkspaceDivider from '@/components/navigation/WorkspaceDivider';
import WorkspaceNavigation from '@/components/navigation/WorkspaceNavigation';
import { NotificationHistoryButton } from '@/components/feedback/NotificationHost';
import SqlWindow from './SqlWindow';
import CheckConstraintWindow from './constraint/CheckConstraintWindow';
import UserRoleTab from './dba/UserRoleTab';
import LockTab from './dba/LockTab';
import TablespaceTab from './dba/TablespaceTab';
import DatabaseTab from './dba/DatabaseTab';
import SessionTab from './dba/SessionTab';
import ObjectPrivilegeTab from './dba/ObjectPrivilegeTab';
import Sidebar from './Sidebar';
import LoadingOverlay from './LoadingOverlay';
import DataGeneratorTab from './generator/DataGeneratorTab';
import QueryBuilderWindow from './builder/QueryBuilderWindow';
import CrossTabWindow from './bi/CrossTabWindow';
import ErDiagramWindow from '@/features/er/ErDiagramWindow';

interface Props { config: ConnectionConfig; settings: AppSettings; dbInfo: string; schemas: string[]; onDisconnect: () => void; onOpenSettings: () => void; }
interface SqlTab { checkName?:string; checkRequest?:string; initialTable?: string; functionRequest?:string; procedureRequest?:string; triggerRequest?: string; viewRequest?: string; indexRequest?: MysqlIndexProps['request']; id: number; schema: string; object?: DatabaseObject; kind?: 'database' | 'tablespace' | 'lock' | 'session' | 'object-privilege' | 'user-role' | 'check' | 'create-function' | 'create-procedure' | 'create-trigger' | 'create-index' | 'create-table' | 'generator' | 'builder' | 'cross-tab' | 'er-diagram'; initialSql?: string; }
export default function AppMysql({ config, settings, dbInfo, schemas:initialSchemas, onDisconnect, onOpenSettings }: Props) {
  const { t } = useTranslation();
  const [transaction, setTransaction] = useState<TransactionState>({ transactionStatus: 'idle', autocommit: false });
  const [operationBusy, setBusy] = useState(false);
  const [triggerMutating, setTriggerMutating] = useState(false);
  const setTriggerOperationBusy = useCallback((value: boolean) => { setBusy(value); setTriggerMutating(value); }, []);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [generatorBusy, setGeneratorBusy] = useState(false);
  const [builderTab, setBuilderTab] = useState<number | null>(null);
  const builderBusy = builderTab !== null;
  const [crossTabOwner, setCrossTabOwner] = useState<number | null>(null);
  const crossTabBusy = crossTabOwner !== null;
  const busy = operationBusy || globalLoading || generatorBusy || builderBusy || crossTabBusy;
  const openTable = useTableOpening();
  useEffect(() => {
    const receive = (event: WindowEventMap['toggle-global-loader']) => setGlobalLoading(event.detail);
    window.addEventListener('toggle-global-loader', receive);
    return () => window.removeEventListener('toggle-global-loader', receive);
  }, []);
  const [error, setError] = useState('');
  const [schemas,setSchemas]=useState(initialSchemas);
  useEffect(()=>{setSchemas(initialSchemas);let alive=true,version=0;const reload=()=>{const request=++version;void ipcRenderer.invoke('get-schemas').then(r=>{if(!alive||request!==version)return;if(!r.success)throw new Error(r.error);setSchemas(r.schemas.filter((name):name is string=>typeof name==='string'));}).catch(()=>{if(alive)setError('mysql_database_read_failed');});};window.addEventListener('mysql-databases-changed',reload);return()=>{alive=false;window.removeEventListener('mysql-databases-changed',reload);};},[initialSchemas]);
  const [tabs, setTabs] = useState<SqlTab[]>([{ id: 1, schema: config.database || '' }]);
  const [selected, setSelected] = useState(1);
  const nextTab = useRef(2);
  const changingTransaction = useRef(false);
  const [menu, setMenu] = useState<{ name: 'connection' | 'view' | 'settings' | 'git' | 'dba'; anchor: HTMLElement } | null>(null);
  const [help, setHelp] = useState<HTMLElement | null>(null);
  const [about, setAbout] = useState(false);
  const [definitionImport,setDefinitionImport]=useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useWorkspacePanelWidth('mysql', 'sidebar', 280);
  const [resizing, setResizing] = useState<'sidebar' | 'ai' | null>(null);
  const [aiContext, setAiContext] = useState<AiContext | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useWorkspacePanelWidth('mysql', 'ai', 400);
  const [gitBusy, setGitBusy] = useState(false);
  const git = useGlobalGit({ setIsGlobalLoading: setGitBusy, onMenuClose: () => setMenu(null) });
  const aiSettings = useAiSettings();
  const [gitWorkspace, setGitWorkspace] = useState(false);
  const [picker, setPicker] = useState<{ schema: string; category: ObjectCategory } | null>(null);
  const openAi = useCallback((context: AiContext) => { setAiContext(context); setAiOpen(true); }, []);
  useEffect(() => {
    if (aiContext?.targetTabId !== undefined && !tabs.some(tab => tab.id === aiContext.targetTabId)) {
      aiContext.sqlResponse?.cancel(); aiContext.codingResponse?.cancel(); setAiContext(null); setAiOpen(false);
    }
  }, [tabs, aiContext]);
  const monaStyle = settings.theme === 'mona';
  const receiveState = useCallback((state: TransactionState) => setTransaction({
    transactionStatus: state.transactionStatus || 'unknown', autocommit: state.autocommit, hasUncommittedTx: state.hasUncommittedTx
  }), []);
  const unknown = transaction.transactionStatus === 'unknown';
  const addSql = useEventCallback((_schema: string = config.database || '', initialSql?: string) => {
    if (busy || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema: config.database || '', initialSql }]); setSelected(id); setMenu(null);
  });
  const addGenerator = useEventCallback(() => {
    if (busy || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema: config.database || '', kind: 'generator' }]); setSelected(id); setMenu(null);
  });
  const addBuilder = useEventCallback(() => {
    if (busy || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema: config.database || '', kind: 'builder' }]); setSelected(id); setMenu(null);
  });
  const addCrossTab = useEventCallback(() => {
    if (busy || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema: config.database || '', kind: 'cross-tab' }]); setSelected(id); setMenu(null);
  });
  const addEr = useEventCallback(() => {
    if (busy || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema: config.database || '', kind: 'er-diagram' }]); setSelected(id); setMenu(null);
  });
  const openHistorySql = useEventCallback((event: WindowEventMap['open-sql-tab']) => {
    addSql(tabs.find(tab => tab.id === selected)?.schema || config.database || '', event.detail.initialSql);
  });
  useEffect(() => {
    window.addEventListener('open-sql-tab', openHistorySql);
    return () => window.removeEventListener('open-sql-tab', openHistorySql);
  }, [openHistorySql]);
  const openObject = useEventCallback((object: DatabaseObject, indexAction?: MysqlIndexAction) => {
    if (busy) return;
    const existing = tabs.find(tab => tab.object?.key === object.key);
    const functionRequest=object.category==='FUNCTION'&&indexAction==='delete'?crypto.randomUUID():undefined;
    const procedureRequest=object.category==='PROCEDURE'&&indexAction==='delete'?crypto.randomUUID():undefined;
    const triggerRequest = object.category === 'TRIGGER' && indexAction === 'delete' ? crypto.randomUUID() : undefined;
    const viewRequest = object.category === 'VIEW' && indexAction === 'delete' ? crypto.randomUUID() : undefined;
    const indexRequest = object.category === 'INDEX' && indexAction ? { id: crypto.randomUUID(), kind: indexAction } : undefined;
    if (existing) { if (indexRequest || viewRequest || triggerRequest || procedureRequest || functionRequest) setTabs(previous => previous.map(tab => tab.id === existing.id ? { ...tab, indexRequest, viewRequest, triggerRequest, procedureRequest, functionRequest } : tab)); setSelected(existing.id); return; }
    if (tabs.length >= settings.maxTabs) return;
    const open = () => { const id = nextTab.current++; setTabs(previous => [...previous, { id, schema: object.schema, object, indexRequest, viewRequest, triggerRequest, procedureRequest, functionRequest }]); setSelected(id); };
    if (object.category === 'TABLE' || object.category === 'VIEW') void openTable(open); else open();
  });
  useEffect(()=>{const receive=(event:Event)=>{const value=(event as CustomEvent<{schema?:unknown;name?:unknown;type?:unknown}>).detail;if(!value||typeof value.schema!=='string'||typeof value.name!=='string'||!['TABLE','VIEW','FUNCTION','PROCEDURE','TRIGGER'].includes(String(value.type)))return;const category=value.type as 'TABLE'|'VIEW'|'FUNCTION'|'PROCEDURE'|'TRIGGER';openObject({key:JSON.stringify(['mysql',value.schema,category,value.name]),dbType:'mysql',schema:value.schema,name:value.name,displayName:value.name,category});};window.addEventListener('mysql-open-object',receive);return()=>window.removeEventListener('mysql-open-object',receive);},[openObject]);

  const openCheck=useEventCallback((schema:string,table:string,name?:string,drop=false)=>{
    if(busy||unknown)return;
    const existing=tabs.find(tab=>tab.kind==='check'&&tab.schema===schema&&tab.initialTable===table&&tab.checkName===name);
    const checkRequest=drop?crypto.randomUUID():undefined;
    if(existing){if(checkRequest)setTabs(old=>old.map(tab=>tab.id===existing.id?{...tab,checkRequest}:tab));setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs||(!name&&config.readonly))return;
    const id=nextTab.current++;setTabs(old=>[...old,{id,schema,kind:'check',initialTable:table,checkName:name,checkRequest}]);setSelected(id);
  });
  const openUsers=useEventCallback(()=>{
    setMenu(null);if(busy)return;const existing=tabs.find(tab=>tab.kind==='user-role');if(existing){setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs)return;const id=nextTab.current++;setTabs(old=>[...old,{id,schema:config.database||'',kind:'user-role'}]);setSelected(id);
  });
  const openDatabases=useEventCallback(()=>{
    setMenu(null);if(busy)return;const existing=tabs.find(tab=>tab.kind==='database');if(existing){setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs)return;const id=nextTab.current++;setTabs(old=>[...old,{id,schema:config.database||'',kind:'database'}]);setSelected(id);
  });
  const openTablespaces=useEventCallback(()=>{
    setMenu(null);if(busy)return;const existing=tabs.find(tab=>tab.kind==='tablespace');if(existing){setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs)return;const id=nextTab.current++;setTabs(old=>[...old,{id,schema:config.database||'',kind:'tablespace'}]);setSelected(id);
  });
  const openLocks=useEventCallback(()=>{
    setMenu(null);if(busy)return;const existing=tabs.find(tab=>tab.kind==='lock');if(existing){setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs)return;const id=nextTab.current++;setTabs(old=>[...old,{id,schema:config.database||'',kind:'lock'}]);setSelected(id);
  });
  const openSessions=useEventCallback(()=>{
    setMenu(null);if(busy)return;const existing=tabs.find(tab=>tab.kind==='session');if(existing){setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs)return;const id=nextTab.current++;setTabs(old=>[...old,{id,schema:config.database||'',kind:'session'}]);setSelected(id);
  });
  const openPrivileges=useEventCallback(()=>{
    setMenu(null);if(busy)return;const existing=tabs.find(tab=>tab.kind==='object-privilege');if(existing){setSelected(existing.id);return;}
    if(tabs.length>=settings.maxTabs)return;const id=nextTab.current++;setTabs(old=>[...old,{id,schema:config.database||'',kind:'object-privilege'}]);setSelected(id);
  });
  const createTable = useEventCallback((schema: string) => {
    if (busy || unknown || config.readonly || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema, kind: 'create-table' }]); setSelected(id);
  });
  const createIndex = useEventCallback((schema: string) => {
    if (busy || unknown || config.readonly || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++;
    setTabs(previous => [...previous, { id, schema, kind: 'create-index' }]); setSelected(id);
  });
  const createFunction=useEventCallback((schema:string)=>{
    if(busy||config.readonly||unknown||tabs.length>=settings.maxTabs)return;
    const id=nextTab.current++;setTabs(previous=>[...previous,{id,schema,kind:'create-function'}]);setSelected(id);
  });
  const createProcedure=useEventCallback((schema:string)=>{
    if(busy||config.readonly||unknown||tabs.length>=settings.maxTabs)return;
    const id=nextTab.current++;setTabs(previous=>[...previous,{id,schema,kind:'create-procedure'}]);setSelected(id);
  });
  const createTrigger = useEventCallback((schema: string, initialTable?: string) => {
    if (busy || unknown || config.readonly || tabs.length >= settings.maxTabs) return;
    const id = nextTab.current++; setTabs(previous => [...previous, { id, schema, initialTable, kind: 'create-trigger' }]); setSelected(id);
  });
  const changedIndex = useEventCallback((id: number, object: DatabaseObject) => {
    // A renamed index keeps its editor tab. Close only an already-open tab for that exact table/index.
    setTabs(previous => previous.filter(tab => tab.id === id || tab.object?.key !== object.key).map(tab => tab.id === id ? { id, schema: object.schema, object } : tab));
    setSelected(id);
  });
  const createdTable = useEventCallback((id: number, schema: string, name: string) => {
    const object: DatabaseObject = { dbType: 'mysql', schema, category: 'TABLE', name, displayName: name, key: JSON.stringify(['mysql', schema, 'TABLE', name]) };
    setTabs(previous => previous.map(tab => tab.id === id ? { id, schema, object } : tab));
    window.dispatchEvent(new CustomEvent('table-created', { detail: { tabId: id, schema, tableName: name } }));
  });
  const deletedObject = useEventCallback((event: WindowEventMap['object-deleted']) => {
    const target = event.detail;
    if (target.objectType !== 'TABLE') return;
    const remaining = tabs.filter(tab => !(tab.kind==='check'&&tab.schema===target.schema&&tab.initialTable===target.objectName) && (tab.object?.category !== 'TABLE' || tab.object.schema !== target.schema || tab.object.name !== target.objectName));
    setTabs(remaining);
    if (!remaining.some(tab => tab.id === selected)) setSelected(remaining[0]?.id || 0);
  });
  useEffect(() => { window.addEventListener('object-deleted', deletedObject); return () => window.removeEventListener('object-deleted', deletedObject); }, [deletedObject]);
  const tabTitle = (tab: SqlTab) => tab.kind==='database'?t('mysql_database_title'):tab.kind==='tablespace'?t('mysql_storage_title'):tab.kind==='lock'?t('lock_management'):tab.kind==='session'?t('session_management'):tab.kind==='object-privilege'?t('object_privileges'):tab.kind==='user-role'?t('user_settings'):tab.kind==='check'?(tab.checkName||t('create_check_constraint_check')):tab.object ? tab.object.displayName : tab.kind === 'create-function' ? t('create_function') : tab.kind === 'create-procedure' ? t('create_procedure') : tab.kind === 'create-trigger' ? t('create_trigger') : tab.kind === 'create-index' ? t('create_index_index') : tab.kind === 'create-table' ? t('create_table') : tab.kind === 'er-diagram' ? t('er_diagram_viewer') : tab.kind === 'cross-tab' ? t('cross_tabulation') : tab.kind === 'builder' ? t('query_builder') : tab.kind === 'generator' ? t('data_generator') : `SQL ${tab.id}`;
  const closeTab = useEventCallback((id: number) => {
    if (busy) return;
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    if (selected === id) setSelected(remaining[0]?.id || 0);
  });
  const keyboard = useEventCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || document.querySelector('[role="dialog"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'e') { event.preventDefault(); addEr(); }
    if (key === 'p') { event.preventDefault(); addCrossTab(); }
    if (key === 'q') { event.preventDefault(); addBuilder(); }
    if (key === 'n') { event.preventDefault(); addSql(); }
    if (key === 'w' && tabs.length) { event.preventDefault(); closeTab(selected); }
  });
  useEffect(() => { window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard); }, [keyboard]);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: MouseEvent) => resizing === 'ai' ? setAiWidth(window.innerWidth - event.clientX) : setSidebarWidth(event.clientX);
    const end = () => setResizing(null);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); };
  }, [resizing, setSidebarWidth, setAiWidth]);
  const finish = async (commit: boolean) => {
    if (busy || changingTransaction.current || unknown) return;
    changingTransaction.current = true; setBusy(true); setError('');
    try {
      const response = await ipcRenderer.invoke(commit ? 'commit-db' : 'rollback-db');
      receiveState(response);
      if (!response.success) setError(response.error);
      else window.dispatchEvent(new Event('mysql-transaction-finished'));
    } catch { receiveState({ transactionStatus: 'unknown' }); setError(t('mysql_transaction_unknown')); }
    finally { changingTransaction.current = false; setBusy(false); }
  };
  const cancel = async () => {
    window.dispatchEvent(new CustomEvent('cancel-sql-script'));
    try {
      const response = await ipcRenderer.invoke('cancel-execution');
      if (!response.success) setError(response.error || t('execution_failed'));
    } catch { setError(t('execution_failed')); }
  };
  const atLimit = tabs.length >= settings.maxTabs;
  return <>
    <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper', overflowX: 'auto', flexShrink: 0 }}>
      <Toolbar variant="dense" sx={{ minWidth: 'max-content' }}>
        <MonaBaseLogo sx={{ mr: 3, fontSize: 36 }} />
        <Button color="inherit" disabled={busy} onClick={event => setMenu({ name: 'connection', anchor: event.currentTarget })} sx={{ textTransform: 'none' }}>{t('connect')}</Button>
        <Button color="inherit" disabled={busy} onClick={event => setMenu({ name: 'view', anchor: event.currentTarget })} sx={{ textTransform: 'none' }}>{t('view_4')}</Button>
        <Button color="inherit" disabled={busy} onClick={event=>setMenu({name:'dba',anchor:event.currentTarget})}>{t('dba')}</Button>
        <Button color="inherit" disabled={busy || gitBusy} onClick={event => setMenu({ name: 'git', anchor: event.currentTarget })}>GIT</Button>
        <AiMenu onOpenSettings={() => aiSettings.setAiSettingsDialogOpen(true)} outputDateFormat={settings.outputDateFormat} />
        <Button color="inherit" disabled={busy} onClick={event => setMenu({ name: 'settings', anchor: event.currentTarget })} sx={{ textTransform: 'none' }}>{t('settings')}</Button>
        <HelpMenu anchorEl={help} onOpen={event => setHelp(event.currentTarget)} onClose={() => setHelp(null)} onAbout={() => setAbout(true)} />
        <Box sx={{ flexGrow: 1, minWidth: 16 }} />
        {unknown && <Chip size="small" color="error" label={t('mysql_state_unknown')} />}
        {config.readonly && <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: monaStyle ? '#EFEBE9' : 'action.hover', px: 2, py: 0.5, borderRadius: 5, border: 1, borderColor: monaStyle ? '#D7CCC8' : 'divider' }}>
          <LockOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} /><Typography variant="body2" fontWeight="bold">{t('read_only_2')}</Typography>
        </Box>}
        <TopMenuBar onCommit={() => void finish(true)} onRollback={() => void finish(false)} hasUncommittedTx={transaction.hasUncommittedTx === true} disabled={busy || unknown} monaStyle={monaStyle} />
        <Divider orientation="vertical" flexItem sx={{ mx: 1, mr: 2 }} />
        <NotificationHistoryButton />
        <ConnectionBadge config={config} dbInfo={dbInfo} disconnected={false} />
      </Toolbar>
    </AppBar>
    {definitionImport&&<DefinitionImportDialog database={config.database||''} schemas={schemas} blocked={busy||unknown||Boolean(config.readonly)} setBusy={setTriggerOperationBusy} onState={receiveState} onClose={()=>setDefinitionImport(false)}/>}
    <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
      {menu?.name === 'connection' && <MenuItem onClick={() => { setMenu(null); onDisconnect(); }}><CloseIcon color="error" fontSize="small" sx={{ mr: 1 }} />{t('disconnect_and_return_to_login')}</MenuItem>}
      {menu?.name === 'view' && [
        <MenuItem key="sql" disabled={atLimit} onClick={() => addSql()}>{t('sql_window')} (Ctrl+N)</MenuItem>,
        <MenuItem key="definition-import" disabled={busy||unknown||Boolean(config.readonly)} onClick={()=>{setMenu(null);setDefinitionImport(true);}}>{t('mysql_definition_import')}</MenuItem>,
        <MenuItem key="generator" disabled={atLimit || busy} onClick={addGenerator}>{t('data_generator')}</MenuItem>,
        <MenuItem key="builder" disabled={atLimit || busy} onClick={addBuilder}>{t('query_builder')} (Ctrl+Q)</MenuItem>,
        <MenuItem key="cross-tab" disabled={atLimit || busy} onClick={addCrossTab}>{t('cross_tabulation')} (Ctrl+P)</MenuItem>,
        <MenuItem key="er" disabled={atLimit || busy} onClick={addEr}>{t('er_diagram_viewer')} (Ctrl+E)</MenuItem>
      ]}
      {menu?.name==='dba'&&[<MenuItem key="databases" disabled={atLimit||busy} onClick={openDatabases}>{t('mysql_database_title')}</MenuItem>,<MenuItem key="tablespaces" disabled={atLimit||busy} onClick={openTablespaces}>{t('mysql_storage_title')}</MenuItem>,<MenuItem key="locks" disabled={atLimit||busy} onClick={openLocks}>{t('lock_management')}</MenuItem>,<MenuItem key="sessions" disabled={atLimit||busy} onClick={openSessions}>{t('session_management')}</MenuItem>,<MenuItem key="privileges" disabled={atLimit||busy} onClick={openPrivileges}>{t('object_privileges')}</MenuItem>,<MenuItem key="users" disabled={atLimit||busy} onClick={openUsers}>{t('user_settings')}</MenuItem>]}
      {menu?.name === 'git' && [
        <MenuItem key="pull" onClick={git.handleGitPull}><DownloadIcon fontSize="small" sx={{ mr: 1 }} />{t('git_pull_fetch_latest_source')}</MenuItem>,
        <MenuItem key="push" onClick={git.handleGitPush}><UploadIcon fontSize="small" sx={{ mr: 1 }} />{t('git_push_send_local_changes')}</MenuItem>,
        <Divider key="divider" />,
        <MenuItem key="workspace" onClick={() => { setMenu(null); setGitWorkspace(true); }}>{t('git_schema_changes')}</MenuItem>,
        <MenuItem key="settings" onClick={() => { setMenu(null); git.setTempRemoteUrl(git.remoteUrl || ''); git.setGitSettingsDialogOpen(true); }}><SettingsIcon fontSize="small" sx={{ mr: 1 }} />{t('git_settings')}</MenuItem>
      ]}
      {menu?.name === 'settings' && <MenuItem onClick={() => { setMenu(null); onOpenSettings(); }}><SettingsIcon fontSize="small" sx={{ mr: 1, color: 'action.active' }} />{t('settings_2')}</MenuItem>}
    </Menu>
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' }}>
      <Sidebar open={sidebarOpen} width={sidebarWidth} schemas={schemas} database={config.database || ''} busy={busy} disabled={unknown} readonly={Boolean(config.readonly)} canOpen={!atLimit} selected={tabs.find(tab => tab.id === selected)?.object} outputDateFormat={settings.outputDateFormat} setBusy={setBusy} onState={receiveState} onToggle={() => setSidebarOpen(previous => !previous)} onOpenSql={addSql} onCreateTable={createTable} onCreateIndex={createIndex} onCreateTrigger={createTrigger} onCreateProcedure={createProcedure} onCreateFunction={createFunction} onOpenObject={openObject} onOpenCategory={(schema, category) => setPicker({ schema, category })} />
      {sidebarOpen && <WorkspaceDivider label={t('ux_resize_sidebar')} value={sidebarWidth} min={Math.min(200, window.innerWidth / 2)} max={window.innerWidth / 2} onChange={setSidebarWidth} onMouseDown={event => { event.preventDefault(); setResizing('sidebar'); }} />}
      <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', alignItems: 'center' }}>
          <Tabs value={tabs.some(tab => tab.id === selected) ? selected : false} onChange={(_event, value: number) => setSelected(value)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 40, flex: 1 }}>
            {tabs.map(tab => <Tab component="div" key={tab.id} value={tab.id} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Delete') { event.preventDefault(); closeTab(tab.id); } }} sx={{ minHeight: 40, py: 0, textTransform: 'none' }} label={<Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Tooltip title={tab.kind==='check'?`${t('check_constraint_2')} · ${tab.schema}.${tab.initialTable}`:tab.object ? `${tab.object.category} · ${tab.object.schema}.${tab.object.name}` : `${t('sql_window')} · ${tab.schema}`}><span>{tabTitle(tab)}</span></Tooltip>
              <IconButton size="small" disabled={busy} aria-label={t('ux_close_tab', { name: tabTitle(tab) })} onClick={event => { event.stopPropagation(); closeTab(tab.id); }} onKeyDown={event => event.stopPropagation()} sx={{ ml: 0.5 }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
            </Box>} />)}
          </Tabs>
          <WorkspaceNavigation tabs={tabs.map(tab => ({ id: String(tab.id), label: tabTitle(tab), detail: tab.object ? `${tab.object.category} · ${tab.schema}` : tab.schema, run: () => setSelected(tab.id) }))} commands={[
            { id: 'er', label: t('er_diagram_viewer'), shortcut: 'Ctrl/⌘+E', disabled: busy || atLimit, run: addEr },
            { id: 'cross-tab', label: t('cross_tabulation'), shortcut: 'Ctrl/⌘+P', disabled: busy || atLimit, run: addCrossTab },
            { id: 'builder', label: t('query_builder'), shortcut: 'Ctrl/⌘+Q', disabled: busy || atLimit, run: addBuilder },
            { id: 'generator', label: t('data_generator'), disabled: busy || atLimit, run: addGenerator },
            { id: 'sql', label: t('sql_window'), shortcut: 'Ctrl/⌘+N', disabled: busy || atLimit, run: () => addSql() },
            { id:'databases',label:t('mysql_database_title'),disabled:busy||atLimit,run:openDatabases },
            { id:'tablespaces',label:t('mysql_storage_title'),disabled:busy||atLimit,run:openTablespaces },
            { id:'locks',label:t('lock_management'),disabled:busy||atLimit,run:openLocks },
              { id:'sessions',label:t('session_management'),disabled:busy||atLimit,run:openSessions },
              { id:'privileges',label:t('object_privileges'),disabled:busy||atLimit,run:openPrivileges },
              { id:'users',label:t('user_settings'),disabled:busy||atLimit,run:openUsers },
            { id:'definition-import',label:t('mysql_definition_import'),disabled:busy||unknown||Boolean(config.readonly),run:()=>setDefinitionImport(true) },
            { id: 'settings', label: t('settings'), disabled: busy, run: onOpenSettings }
          ]} />
        </Box>
        {unknown && <Alert severity="error">{t('mysql_transaction_unknown')}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {tabs.length === 0 && <Box sx={{ m: 'auto', textAlign: 'center', color: 'text.secondary' }}>
          <MonaBaseLogo sx={{ fontSize: 80, mb: 2, opacity: 0.3 }} /><Typography>{t('no_open_tabs')}</Typography>
          <Button variant="outlined" sx={{ mt: 3 }} onClick={() => addSql()}>{t('open_sql_window')}</Button>
        </Box>}
        {tabs.map(tab => <Box key={tab.id} role="tabpanel" hidden={tab.id !== selected} sx={{ display: tab.id === selected ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {tab.kind==='database'?<DatabaseTab active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)||unknown} setBusy={setTriggerOperationBusy} onState={receiveState}/>:tab.kind==='tablespace'?<TablespaceTab active={tab.id===selected} busy={busy}/>:tab.kind==='lock'?<LockTab active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)||unknown} setBusy={setTriggerOperationBusy} onState={receiveState}/>:tab.kind==='session'?<SessionTab active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)||unknown} setBusy={setTriggerOperationBusy} onState={receiveState}/>:tab.kind==='object-privilege'?<ObjectPrivilegeTab active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)||unknown} setBusy={setTriggerOperationBusy} onState={receiveState} database={config.database||''}/>:tab.kind==='user-role'?<UserRoleTab active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)||unknown} setBusy={setTriggerOperationBusy} onState={receiveState}/>:tab.kind==='check'?<CheckConstraintWindow key={JSON.stringify([tab.schema,tab.initialTable,tab.checkName])} schema={tab.schema} table={tab.initialTable||''} constraintName={tab.checkName} request={tab.checkRequest} active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)||unknown} theme={settings.theme} setBusy={setTriggerOperationBusy} onState={receiveState} onChanged={name=>setTabs(old=>old.filter(item=>item.id===tab.id||item.kind!=='check'||item.schema!==tab.schema||item.initialTable!==tab.initialTable||item.checkName!==name).map(item=>item.id===tab.id?{...item,checkName:name,checkRequest:undefined}:item))} onDropped={()=>{const remaining=tabs.filter(item=>item.id!==tab.id);setTabs(remaining);if(selected===tab.id)setSelected(remaining[0]?.id||0);}}/>:tab.kind==='create-function' ||tab.object?.category==='FUNCTION'?<FunctionWindow tabId={tab.id} schema={tab.schema} object={tab.object} request={tab.functionRequest} active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)} disabled={unknown} settings={settings} setBusy={setBusy} setDdlBusy={setTriggerOperationBusy} onState={receiveState} onChanged={object=>changedIndex(tab.id,object)} onDropped={()=>{const remaining=tabs.filter(item=>item.id!==tab.id);setTabs(remaining);if(selected===tab.id)setSelected(remaining[0]?.id||0);}} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi}/>:tab.kind === 'create-procedure'||tab.object?.category==='PROCEDURE'?<ProcedureWindow tabId={tab.id} schema={tab.schema} object={tab.object} request={tab.procedureRequest} active={tab.id===selected} busy={busy} readonly={Boolean(config.readonly)} disabled={unknown} settings={settings} setBusy={setBusy} setDdlBusy={setTriggerOperationBusy} onState={receiveState} onChanged={object=>changedIndex(tab.id,object)} onDropped={()=>{const remaining=tabs.filter(item=>item.id!==tab.id);setTabs(remaining);if(selected===tab.id)setSelected(remaining[0]?.id||0);}} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi}/>:tab.kind === 'create-trigger' || tab.object?.category === 'TRIGGER' ? <TriggerWindow tabId={tab.id} schema={tab.schema} initialTable={tab.initialTable} object={tab.object} request={tab.triggerRequest} active={tab.id === selected} busy={busy} readonly={Boolean(config.readonly)} disabled={unknown} theme={settings.theme} setBusy={setTriggerOperationBusy} onState={receiveState} onChanged={object => changedIndex(tab.id, object)} onDropped={() => { const remaining = tabs.filter(item => item.id !== tab.id); setTabs(remaining); if (selected === tab.id) setSelected(remaining[0]?.id || 0); }} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi} /> : tab.object?.category === 'VIEW' ? <ViewWindow key={tab.object.key} object={tab.object} request={tab.viewRequest} tabId={tab.id} active={tab.id === selected} busy={busy} readonly={Boolean(config.readonly)} disabled={unknown} settings={settings} setBusy={setBusy} onState={receiveState} onDropped={() => { const remaining = tabs.filter(item => item.id !== tab.id); setTabs(remaining); if (selected === tab.id) setSelected(remaining[0]?.id || 0); }} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi} /> : tab.kind === 'create-index' || tab.object?.category === 'INDEX' ? <IndexWindow request={tab.indexRequest} schema={tab.schema} object={tab.object} active={tab.id === selected} busy={busy} readonly={Boolean(config.readonly) || unknown} theme={settings.theme} setBusy={setBusy} onState={receiveState} onChanged={object => changedIndex(tab.id, object)} onDropped={() => { const remaining = tabs.filter(item => item.id !== tab.id); setTabs(remaining); if (selected === tab.id) setSelected(remaining[0]?.id || 0); }} /> : tab.kind === 'er-diagram' ? <ErDiagramWindow tabId={tab.id} isActive={tab.id === selected} schemas={schemas} initialSchema={tab.schema} dbType="mysql" dbName={config.database} userName={config.user} disabled={unknown || operationBusy || globalLoading || gitBusy || generatorBusy || builderBusy || crossTabBusy} /> : tab.kind === 'cross-tab' ? <CrossTabWindow tabId={tab.id} isActive={tab.id === selected} schemas={schemas} initialSchema={tab.schema} inputDateFormat={settings.inputDateFormat} numberFormat={settings.numberFormat} language={settings.language} disabled={unknown || operationBusy || globalLoading || gitBusy || generatorBusy || builderBusy || (crossTabBusy && crossTabOwner !== tab.id)} onState={receiveState} onBusyChange={value => setCrossTabOwner(value ? tab.id : null)} /> : tab.kind === 'builder' ? <QueryBuilderWindow tabId={tab.id} title={t('query_builder')} isActive={tab.id === selected} dateFormat={settings.outputDateFormat} dbInfo={dbInfo} schema={tab.schema} disabled={unknown || operationBusy || globalLoading || gitBusy || generatorBusy || crossTabBusy || (builderBusy && builderTab !== tab.id)} isAiEnabled={aiSettings.isAiEnabled} onOpenAiSidebar={context => { if (context) openAi(context); }} onState={receiveState} onBusyChange={value => setBuilderTab(value ? tab.id : null)} /> : tab.kind === 'generator' ? <DataGeneratorTab active={tab.id === selected} initialSchema={tab.schema} schemas={schemas} settings={settings} externalBusy={operationBusy || globalLoading || gitBusy || builderBusy || crossTabBusy} disabled={unknown} readonly={Boolean(config.readonly)} aiEnabled={aiSettings.isAiEnabled} tabId={tab.id} onOpenAi={openAi} onState={receiveState} onBusyChange={setGeneratorBusy} /> : tab.kind === 'create-table' ? <CreateTableWindow schema={tab.schema} active={tab.id === selected} busy={busy} readonly={Boolean(config.readonly) || unknown} setBusy={setBusy} onState={receiveState} onCreated={name => createdTable(tab.id, tab.schema, name)} /> : tab.object?.category === 'TABLE' ? <TableWindow onOpenCheck={(name,drop)=>openCheck(tab.schema,tab.object?.name||'',name,drop)} onCreateTrigger={() => createTrigger(tab.schema, tab.object?.name)} onOpenTrigger={(name, drop) => { const object: DatabaseObject = { key: JSON.stringify(['mysql',tab.schema,'TRIGGER',name]), dbType: 'mysql', schema: tab.schema, category: 'TRIGGER', name, displayName: name, parentName: tab.object?.name }; openObject(object, drop ? 'delete' : undefined); }} onDropped={() => { if (tab.object) { window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: tab.object.schema, objectName: tab.object.name, objectType: 'TABLE' } })); window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: tab.object.schema, objType: 'TABLE' } })); } }} object={tab.object} tabId={tab.id} active={tab.id === selected} schema={tab.object.schema} table={tab.object.name} settings={settings} readonly={Boolean(config.readonly)} busy={busy} disabled={unknown} setBusy={setBusy} onState={receiveState} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi} /> : tab.object ? <SourceWindow object={tab.object} tabId={tab.id} active={tab.id === selected} theme={settings.theme} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi} /> : <SqlWindow dbInfo={dbInfo} initialSql={tab.initialSql} tabId={tab.id} aiEnabled={aiSettings.isAiEnabled} onOpenAi={openAi} active={tab.id === selected} database={config.database || ''} settings={settings} busy={busy} disabled={unknown} setBusy={setBusy} onState={receiveState} />}
        </Box>)}
      </Box>
      {aiOpen && <>
        <WorkspaceDivider label={t('ux_resize_ai')} value={aiWidth} min={Math.min(300, window.innerWidth * 0.8)} max={window.innerWidth * 0.8} reverse onChange={setAiWidth} onMouseDown={event => { event.preventDefault(); setResizing('ai'); }} />
        <Box sx={{ width: aiWidth, height: '100%', flexShrink: 0, borderLeft: 1, borderColor: 'divider', bgcolor: 'background.paper' }}><AiChatSidebar connectionScope={config.aiHistoryScope} sendKey={settings.aiSendKey} aiContext={aiContext} setAiContext={setAiContext} onClose={() => setAiOpen(false)} /></Box>
      </>}
    </Box>
    {picker && <ObjectPickerDialog open dbType="mysql" initialSchema={picker.schema} fixedSchema={picker.schema} initialCategory={picker.category} categories={[picker.category]} multiple={false} onClose={() => setPicker(null)} onConfirm={objects => {
      const object = objects[0]; if (!object || busy || tabs.length >= settings.maxTabs) return;
      setPicker(null); openObject(object);
    }} />}
    {gitWorkspace && <GitWorkspaceDialog dbType="mysql" schema={config.database || ''} onClose={() => setGitWorkspace(false)} />}
    <GlobalGitDialog gitLogic={git} />
    <AiSettingsDialog aiLogic={aiSettings} />
    <LoadingOverlay open={operationBusy || globalLoading || gitBusy} monaStyle={monaStyle} cancelable={!changingTransaction.current && !gitBusy && !triggerMutating} onCancel={() => void cancel()} />
    <AboutDialog open={about} onClose={() => setAbout(false)} />
  </>;
}
