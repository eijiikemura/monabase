// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { NotificationHistoryButton } from '@/components/feedback/NotificationHost';
import { workspaceTabDescription } from '@/components/navigation/workspaceTabDescription';
import ConnectionBadge from '@/components/ConnectionBadge';
import WorkspaceNavigation from '@/components/navigation/WorkspaceNavigation';
import WorkspaceDivider from '@/components/navigation/WorkspaceDivider';
import { notify } from '@/shared/utils/notifications';
import { qualifiedObjectName, splitObjectName } from '@/shared/utils/objectIdentity';
import type { ConnectionConfig, AppSettings } from "@/shared/types/appTypes";

import React, { useState, useEffect, memo, useCallback } from 'react';
import { 
  Box, AppBar, Toolbar, Typography, Button,
  Divider, Menu, MenuItem, Tabs, Tab, Tooltip, IconButton,
  Backdrop, CircularProgress, SvgIcon
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'; 
import StopIcon from '@mui/icons-material/Stop'; 
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import HelpMenu from '@/components/HelpMenu';
import CableIcon from '@mui/icons-material/Cable';
import SqlWindowOracle from './windows/sql/SqlWindow';
import TableWindowOracle from './windows/table/TableWindow';
import CreateTableWindowOracle from './windows/table/CreateTableWindow';
import ViewWindowOracle from './windows/view/ViewWindow';
import SequenceWindowOracle from './windows/sequence/SequenceWindow';
import StoredWindowOracle from './windows/stored/StoredWindow';
import PackageWindowOracle from './windows/package/PackageWindow';
import TriggerWindowOracle from './windows/trigger/TriggerWindow';
import DbLinkWindowOracle from './windows/dblink/DbLinkWindow';
import SynonymWindowOracle from './windows/synonym/SynonymWindow';
import MaterializedViewWindowOracle from './windows/mview/MaterializedViewWindow';
import MaterializedViewLogWindowOracle from './windows/mview-log/MaterializedViewLogWindow';
import IndexWindowOracle from './windows/index/IndexWindow';
import CheckConstraintWindowOracle from './windows/constraint/CheckConstraintWindow';
import TypeWindowOracle from './windows/type/TypeWindow';
import ObjectPrivilegeTabOracle from './windows/dba/ObjectPrivilegeTab';
import UserRoleTabOracle from './windows/dba/UserRoleTab';
import TablespaceTabOracle from './windows/dba/TablespaceTab';
import DirectoryTabOracle from './windows/dba/DirectoryTab';
import SessionTabOracle from './windows/dba/SessionTab';
import LockTabOracle from './windows/dba/LockTab';
import QueryBuilderWindowOracle from './windows/builder/QueryBuilderWindow';
import DataGeneratorTabOracle from './windows/generator/DataGeneratorTab';
import PdbManagerTabOracle from './windows/dba/PdbManagerTab';
import CrossTabWindowOracle from './windows/bi/CrossTabWindow';
import ErDiagramWindow from "../er/ErDiagramWindow";
import Sidebar from './Sidebar';
import AiChatSidebar from "../ai/AiChatSidebar";
import MonaBaseLogo from "@/components/MonaBaseLogo";
import TopMenuBar from "@/components/TopMenuBar";
import GlobalGitDialog from "../git/GlobalGitDialog";
import AiSettingsDialog from "../ai/AiSettingsDialog"; 
import AiMenu from "../ai/AiMenu";
import AboutDialog from "@/components/AboutDialog"; 

import { useAppOracle } from './useAppOracle';
import { ipcRenderer } from '@/shared/api/desktop';

const styles = {
  appBarMenuBtn: { textTransform: 'none' as const },
  menuItemAction: { mr: 1, color: 'action.active' },
  dbInfoTooltip: { whiteSpace: 'pre-wrap' as const },
  dbInfoBox: { display: 'flex', alignItems: 'center', mr: 2, px: 1.5, py: 0.5, borderRadius: 1, cursor: 'help', transition: 'all 0.3s' },
  dbInfoText: { fontWeight: 'bold' },
  mainContainer: { display: 'flex', flexGrow: 1, width: '100%', height: 'calc(100vh - 48px)', overflow: 'hidden' },
  contentBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, bgcolor: 'background.default', width: '100%', overflow: 'hidden' },
  tabsContainer: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', alignItems: 'center' },
  tabsRoot: { minHeight: 40, flexGrow: 1 },
  tabItem: (isDragged: boolean) => ({ minHeight: 40, py: 0, textTransform: 'none' as const, opacity: isDragged ? 0.5 : 1, cursor: 'grab' }),
  tabLabelBox: { display: 'flex', alignItems: 'center' },
  tabCloseIcon: { ml: 1, fontSize: 16, '&:hover': { color: 'error.main' }, cursor: 'pointer' },
  tabContentWrapper: { flexGrow: 1, overflow: 'hidden', position: 'relative' as const },
  emptyTabBox: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.disabled' },
  emptyTabLogo: { fontSize: 80, mb: 2, opacity: 0.3 },
  emptyTabMt1: { mt: 1 },
  emptyTabBtn: { mt: 3 },
  menuItemText: { fontSize: '0.85rem' },
  resizer: (isResizing: boolean) => ({
    width: 6,
    cursor: 'col-resize',
    backgroundColor: isResizing ? 'primary.main' : 'divider',
    flexShrink: 0,
    zIndex: 10,
    transition: 'background-color 0.2s',
    '&:hover': { backgroundColor: 'primary.main' }
  })
};

function PawIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <g transform="translate(12, 12) scale(1.3)">
        <path d="M -3,-1 C -3,-3 3,-3 3,-1 C 4.5,-0.5 6.5,1.5 6.5,4 C 6.5,7 3,8 0,8 C -3,8 -6.5,7 -6.5,4 C -6.5,1.5 -4.5,-0.5 -3,-1 Z" fill="currentColor"/>
        <ellipse cx="-6.5" cy="-2.5" rx="1.6" ry="2.2" transform="rotate(-35 -6.5 -2.5)" fill="currentColor"/>
        <ellipse cx="-2.5" cy="-6" rx="1.8" ry="2.6" transform="rotate(-12 -2.5 -6)" fill="currentColor"/>
        <ellipse cx="2.5" cy="-6" rx="1.8" ry="2.6" transform="rotate(12 2.5 -6)" fill="currentColor"/>
        <ellipse cx="6.5" cy="-2.5" transform="rotate(35 6.5 -2.5)" rx="1.6" ry="2.2" fill="currentColor"/>
      </g>
    </SvgIcon>
  );
}

// Obtain t inside the standalone component to avoid scope errors.
const GlobalLoader = memo(({ monaStyle, isDarkTheme, onCancel }: { monaStyle: boolean; isDarkTheme: boolean; onCancel: () => void }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sqlProgress, setSqlProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    const handleToggle = (e: WindowEventMap['toggle-global-loader']) => {
      setOpen(e.detail);
    };

    const handleProgress = (event: WindowEventMap['sql-script-progress']) => setSqlProgress(event.detail);
    window.addEventListener('sql-script-progress', handleProgress);
    window.addEventListener('toggle-global-loader', handleToggle);
    return () => {
      window.removeEventListener('sql-script-progress', handleProgress);
      window.removeEventListener('toggle-global-loader', handleToggle);
    };
  }, []);

  return (
    <Backdrop
      data-testid="global-loader"
      transitionDuration={0}
      sx={{
        color: monaStyle ? '#6D4C41' : 'text.primary',
        backgroundColor: monaStyle 
          ? 'rgba(239, 235, 233, 0.85)' 
          : (isDarkTheme ? 'rgba(18, 18, 18, 0.85)' : 'rgba(255, 255, 255, 0.85)'),
        zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 2.5
      }}
      open={open}
    >
      <CircularProgress sx={{ color: monaStyle ? '#BCAAA4' : 'primary.main' }} size={50} thickness={4.5} />
      <Typography variant="h6" fontWeight="bold" sx={{ letterSpacing: 1 }}>{sqlProgress ? t('sql_progress', sqlProgress) : t("processing")}</Typography>
      <Button
        variant="contained"
        startIcon={monaStyle ? <PawIcon sx={{ fontSize: 20 }} /> : <StopIcon sx={{ fontSize: 20 }} />}
        onClick={onCancel}
        sx={{
          mt: 1, px: 3, py: 1,
          bgcolor: monaStyle ? '#D7CCC8' : 'action.disabledBackground',
          color: monaStyle ? '#6D4C41' : 'text.primary',
          fontWeight: 'bold', borderRadius: 6,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.15)', textTransform: 'none',
          transition: 'all 0.2s ease',
          '&:hover': {
            bgcolor: monaStyle ? '#BCAAA4' : 'action.hover',
            color: monaStyle ? '#fff' : 'text.primary',
            boxShadow: '0 6px 10px rgba(0, 0, 0, 0.25)', transform: 'translateY(-2px)'
          }
        }}
      >
        {t("abort_process")}
      </Button>
    </Backdrop>
  );
});
GlobalLoader.displayName = 'GlobalLoader';

// Obtain t inside the standalone component.
const DbInfoAndActions = memo(({ config, dbInfo, isMonaStyle, hasUncommittedTx, onCommit, onRollback, isDisconnected }: { config: ConnectionConfig; dbInfo: string; isMonaStyle: boolean; isDarkTheme: boolean; hasUncommittedTx: boolean; onCommit: () => void; onRollback: () => void; isDisconnected: boolean; t?: ReturnType<typeof import('react-i18next').useTranslation>['t'] }) => {
  const { t } = useTranslation();



  return (
    <>
      {!isDisconnected && (
        config.readonly ? (
          <Box sx={{
            display: 'flex', alignItems: 'center',
            bgcolor: isMonaStyle ? '#EFEBE9' : 'action.hover',
            px: 2, py: 0.5, borderRadius: 5, border: '1px solid',
            borderColor: isMonaStyle ? '#D7CCC8' : 'divider',
            boxShadow: isMonaStyle ? 'inset 0 1px 3px rgba(109, 76, 65, 0.1)' : 'inset 0 1px 3px rgba(0, 0, 0, 0.1)'
          }}>
            <LockOutlinedIcon sx={{ fontSize: 16, color: isMonaStyle ? '#6D4C41' : 'text.secondary', mr: 0.5 }} />
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: isMonaStyle ? '#6D4C41' : 'text.secondary', letterSpacing: 1 }}>
              {t("read_only_2")}
            </Typography>
          </Box>
        ) : (
          <TopMenuBar onCommit={onCommit} onRollback={onRollback} hasUncommittedTx={hasUncommittedTx} monaStyle={isMonaStyle} />
        )
      )}

      <Divider orientation="vertical" flexItem sx={{ mx: 1, ml: 1, mr: 2 }} />
      
      <NotificationHistoryButton />
      <ConnectionBadge config={config} dbInfo={dbInfo} disconnected={isDisconnected} />
    </>
  );
});
DbInfoAndActions.displayName = 'DbInfoAndActions';

interface AppOracleProps {
  config: ConnectionConfig; dbInfo: string; schemas: string[]; settings: AppSettings; onDisconnect: () => void; onOpenSettings: () => void;
}

export default function AppOracle({ config, dbInfo, schemas, settings, onDisconnect, onOpenSettings }: AppOracleProps) {
  const logic = useAppOracle(config, settings);
  const { t } = logic;
  const theme = useTheme(); 
  
  const currentSidebarWidth = logic.isSidebarOpen ? logic.sidebarWidth : 56;
  const currentAiSidebarWidth = logic.isAiSidebarOpen ? logic.aiSidebarWidth : 0;

  const isMonaStyle = settings?.theme === 'mona';
  const isDarkTheme = theme.palette.mode === 'dark';

  const [isDisconnected, setIsDisconnected] = useState<boolean>(false);
  const [connMenuAnchorEl, setConnMenuAnchorEl] = useState<null | HTMLElement>(null);

  useEffect(() => {
    const handleDbDisconnected = () => { setIsDisconnected(true); };
    window.addEventListener('db-disconnected-error', handleDbDisconnected);
    return () => window.removeEventListener('db-disconnected-error', handleDbDisconnected);
  }, []);

  const handleReconnect = async () => {
    setConnMenuAnchorEl(null);
    window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: true }));
    try {
      const res = await ipcRenderer.invoke('connect-db', config);
      if (res.success) {
        setIsDisconnected(false);
      } else {
        notify(t("failed_to_reconnect") + res.error);
      }
    } finally {
      window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: false }));
    }
  };

  const handleOpenSqlWindow = useCallback(() => { logic.handleAddTab('sql'); logic.setMenuAnchorEl(null); }, [logic]);
  const handleOpenBuilder = useCallback(() => { logic.handleAddTab('builder'); logic.setMenuAnchorEl(null); }, [logic]);
  const handleOpenBi = useCallback(() => { logic.handleAddTab('bi'); logic.setMenuAnchorEl(null); }, [logic]);
  const handleOpenDataGen = useCallback(() => { logic.handleAddTab('data-generator'); logic.setMenuAnchorEl(null); }, [logic]);
  const handleOpenEr = useCallback(() => { logic.handleAddTab('er-diagram'); logic.setMenuAnchorEl(null); }, [logic]);

  return (
    <>
      <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: 'background.paper' }}>
        <Toolbar variant="dense">
          <MonaBaseLogo sx={{ mr: 3, fontSize: 36 }} />
          
          <Button color="inherit" onClick={(e) => setConnMenuAnchorEl(e.currentTarget)} sx={{ ...styles.appBarMenuBtn, color: isDisconnected ? 'error.main' : 'inherit', fontWeight: isDisconnected ? 'bold' : 'normal' }}>
            {t("connect")}
          </Button>
          <Menu anchorEl={connMenuAnchorEl} open={Boolean(connMenuAnchorEl)} onClose={() => setConnMenuAnchorEl(null)}>
            <MenuItem onClick={handleReconnect} disabled={!isDisconnected} sx={styles.menuItemText}>
              <CableIcon fontSize="small" sx={styles.menuItemAction} color={isDisconnected ? "primary" : "inherit"} />
              {t("reconnect")}
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setConnMenuAnchorEl(null); onDisconnect(); }} sx={styles.menuItemText}>
              <CloseIcon fontSize="small" sx={styles.menuItemAction} color="error" />
              {t("disconnect_and_return_to_login")}
            </MenuItem>
          </Menu>

          <Button color="inherit" onClick={(e) => logic.setMenuAnchorEl(e.currentTarget)} sx={styles.appBarMenuBtn}>{t("view_4")}</Button>
          <Menu anchorEl={logic.menuAnchorEl} open={Boolean(logic.menuAnchorEl)} onClose={() => logic.setMenuAnchorEl(null)}>
            <MenuItem onClick={handleOpenSqlWindow} disabled={isDisconnected}>{t("sql_window")} (Ctrl+N)</MenuItem>
            <MenuItem onClick={handleOpenBuilder} disabled={isDisconnected}>{t("query_builder")} (Ctrl+Q)</MenuItem>
            <MenuItem onClick={handleOpenBi} disabled={isDisconnected}>{t("cross_tabulation")} (Ctrl+P)</MenuItem>
            <MenuItem onClick={handleOpenDataGen} disabled={isDisconnected}>{t("data_generator")} (Ctrl+G)</MenuItem>
            <MenuItem onClick={handleOpenEr} disabled={isDisconnected}>{t("er_diagram_viewer")} (Ctrl+E)</MenuItem>
          </Menu>

          <Button color="inherit" onClick={(e) => logic.setDbaMenuAnchorEl(e.currentTarget)} sx={styles.appBarMenuBtn}>{t("dba")}</Button>
          <Menu anchorEl={logic.dbaMenuAnchorEl} open={Boolean(logic.dbaMenuAnchorEl)} onClose={() => logic.setDbaMenuAnchorEl(null)}>
            <MenuItem onClick={() => { logic.handleAddTab('object-privilege'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("object_privileges")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('user-role'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("user_settings")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('tablespace'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("tablespace")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('directory'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("directory")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('session'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("session_management")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('lock'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("lock_management")}</MenuItem>
            <Divider />
            <MenuItem onClick={() => { logic.handleAddTab('pdb-manager'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("pluggable_db_pdb_management")}</MenuItem>
          </Menu>

          <Button color="inherit" onClick={(e) => logic.setGitMenuAnchorEl(e.currentTarget)} sx={styles.appBarMenuBtn}>GIT</Button>
          <Menu anchorEl={logic.gitMenuAnchorEl} open={Boolean(logic.gitMenuAnchorEl)} onClose={() => logic.setGitMenuAnchorEl(null)}>
            <MenuItem onClick={logic.gitLogic.handleGitPull}>
              <DownloadIcon fontSize="small" sx={styles.menuItemAction} />
              {t("git_pull_fetch_latest_source")}
            </MenuItem>
            <MenuItem onClick={logic.gitLogic.handleGitPush}>
              <UploadIcon fontSize="small" sx={styles.menuItemAction} />
              {t("git_push_send_local_changes")}
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { logic.gitLogic.setTempRemoteUrl(logic.gitLogic.remoteUrl || ''); logic.gitLogic.setGitSettingsDialogOpen(true); logic.setGitMenuAnchorEl(null); }}>
              <SettingsIcon fontSize="small" sx={styles.menuItemAction} />
              {t("git_settings")}
            </MenuItem>
          </Menu>

          <AiMenu
            onOpenSettings={() => logic.aiLogic.setAiSettingsDialogOpen(true)}
            outputDateFormat={settings.outputDateFormat}
          />

          <Button color="inherit" onClick={(e) => logic.setSettingsMenuAnchorEl(e.currentTarget)} sx={styles.appBarMenuBtn}>{t("settings")}</Button>
          <Menu anchorEl={logic.settingsMenuAnchorEl} open={Boolean(logic.settingsMenuAnchorEl)} onClose={() => logic.setSettingsMenuAnchorEl(null)}>
            <MenuItem onClick={() => { onOpenSettings(); logic.setSettingsMenuAnchorEl(null); }}>
              <SettingsIcon fontSize="small" sx={styles.menuItemAction} />
              {t("settings_2")}
            </MenuItem>
          </Menu>

          <HelpMenu
            anchorEl={logic.helpMenuAnchorEl}
            onOpen={(event) => logic.setHelpMenuAnchorEl(event.currentTarget)}
            onClose={() => logic.setHelpMenuAnchorEl(null)}
            onAbout={() => logic.setAboutDialogOpen(true)}
          />

          <Box sx={{ flexGrow: 1 }} />

          <DbInfoAndActions 
            config={config} dbInfo={dbInfo} isMonaStyle={isMonaStyle} isDarkTheme={isDarkTheme}
            hasUncommittedTx={logic.hasUncommittedTx} onCommit={logic.handleCommit} onRollback={logic.handleRollback}
            isDisconnected={isDisconnected}
          />
        </Toolbar>
      </AppBar>

      <Box sx={styles.mainContainer}>
        <Sidebar 
          isSidebarOpen={logic.isSidebarOpen} sidebarWidth={currentSidebarWidth} onToggleSidebar={() => logic.setIsSidebarOpen(!logic.isSidebarOpen)}
          schemas={schemas} expandedSchemas={logic.expandedSchemas} onToggleSchema={logic.toggleSchema} onAddTab={logic.handleAddTab}
          outputDateFormat={settings.outputDateFormat}
        />

        {logic.isSidebarOpen && (
          <WorkspaceDivider label={t('ux_resize_sidebar')} value={currentSidebarWidth} min={Math.min(200,window.innerWidth/2)} max={window.innerWidth/2} onChange={logic.setSidebarWidth} onMouseDown={logic.startSidebarResize} />
        )}

        <Box sx={styles.contentBox}>
          <Box sx={styles.tabsContainer}>
            <Tabs value={logic.tabs.some(t => t.id === logic.activeTabId) ? logic.activeTabId : false} onChange={(_e, newValue) => logic.setActiveTabId(newValue)} variant="scrollable" scrollButtons="auto" sx={styles.tabsRoot}>
              {logic.tabs.map((tab, index) => (
                <Tab 
                  key={tab.id} value={tab.id} draggable component="div"
                  onKeyDown={e=>{if(e.target===e.currentTarget && e.key==='Delete'){e.preventDefault();logic.closeTab(tab.id);}}}
                  onDragStart={() => logic.handleDragStart(index)} onDragEnter={() => logic.handleDragEnter(index)} onDragEnd={logic.handleDragEnd} onDragOver={(e) => e.preventDefault()}
                  onContextMenu={(e) => logic.handleTabContextMenu(e, tab.id, index)} 
                  sx={styles.tabItem(logic.draggedIndex === index)}
                  label={
                    <Box sx={styles.tabLabelBox}>
                      <Tooltip title={workspaceTabDescription(tab, t)}><span>{tab.title}</span></Tooltip>
                      <IconButton size="small" aria-label={t('ux_close_tab',{name:tab.title})} onClick={e=>{e.stopPropagation();logic.closeTab(tab.id);}} onKeyDown={e=>e.stopPropagation()} sx={{ml:0.5}}><CloseIcon sx={{fontSize:16}} /></IconButton>
                    </Box>
                  } 
                />
              ))}
            </Tabs>
            <WorkspaceNavigation tabs={logic.tabs.map(tab=>({id:String(tab.id),label:tab.title,detail:workspaceTabDescription(tab, t),run:()=>logic.setActiveTabId(tab.id)}))} commands={[
              {id:'sql',shortcut:'Ctrl/⌘+N',label:t('sql_window'),disabled:isDisconnected,run:handleOpenSqlWindow},
              {id:'builder',shortcut:'Ctrl/⌘+Q',label:t('query_builder'),disabled:isDisconnected,run:handleOpenBuilder},
              {id:'bi',shortcut:'Ctrl/⌘+P',label:t('cross_tabulation'),disabled:isDisconnected,run:handleOpenBi},
              {id:'generator',shortcut:'Ctrl/⌘+G',label:t('data_generator'),disabled:isDisconnected,run:handleOpenDataGen},
              {id:'er',shortcut:'Ctrl/⌘+E',label:t('er_diagram_viewer'),disabled:isDisconnected,run:handleOpenEr},
              {id:'sessions',label:t('session_management'),disabled:isDisconnected,run:()=>logic.handleAddTab('session')},
              {id:'locks',label:t('lock_management'),disabled:isDisconnected,run:()=>logic.handleAddTab('lock')},
              {id:'users',label:t('user_settings'),disabled:isDisconnected,run:()=>logic.handleAddTab('user-role')},
              {id:'tablespaces',label:t('tablespace'),disabled:isDisconnected,run:()=>logic.handleAddTab('tablespace')},
              {id:'git',label:t('git_settings'),run:()=>{logic.gitLogic.setTempRemoteUrl(logic.gitLogic.remoteUrl || '');logic.gitLogic.setGitSettingsDialogOpen(true);}},
              {id:'ai',label:t('ai_settings'),run:()=>logic.aiLogic.setAiSettingsDialogOpen(true)},
              {id:'settings',label:t('settings'),run:onOpenSettings}
            ]} />
          </Box>
          
          <Box sx={styles.tabContentWrapper}>
            {logic.tabs.length === 0 ? (
              <Box sx={styles.emptyTabBox}>
                <MonaBaseLogo sx={styles.emptyTabLogo} />
                <Typography variant="body1" fontWeight="bold">{t("no_open_tabs")}</Typography>
                <Typography variant="body2" sx={styles.emptyTabMt1}>{t("select_an_object_from_the_left_sidebar_or")}</Typography>
                <Typography variant="body2">{t("press_ctrl_n_to_open_a_new_sql_window")}</Typography>
                <Button variant="outlined" sx={styles.emptyTabBtn} onClick={handleOpenSqlWindow} disabled={isDisconnected}>{t("open_sql_window")}</Button>
              </Box>
            ) : (
              logic.tabs.map(tab => {
                if (tab.type === 'sql') {
                  return <SqlWindowOracle
                      key={tab.id} tabId={tab.id} type={tab.type} title={tab.title} initialSql={tab.initialSql} isActive={tab.id === logic.activeTabId} dateFormat={settings.outputDateFormat} dbInfo={dbInfo} inputDateFormat={settings.inputDateFormat} isAiEnabled={logic.aiLogic.isAiEnabled} onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)} initialSchema={(config.user || '').toUpperCase()} />;
                } else if (tab.type === 'table') {
                  return <TableWindowOracle key={tab.id} tabId={tab.id} fullTableName={tab.fullObjectName || ''} isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat} inputDateFormat={settings.inputDateFormat} />;
                } else if (tab.type === 'create-table') {
                  return <CreateTableWindowOracle key={tab.id} tabId={tab.id} schema={tab.fullObjectName || tab.initialSql} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'view') {
                  return <ViewWindowOracle key={tab.id} tabId={tab.id} fullViewName={tab.fullObjectName || ''} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'sequence' || tab.type === 'create-sequence') {
                  const isNew = tab.type === 'create-sequence';
                  const fullObj = tab.fullObjectName || '';
                  const schemaName = isNew ? fullObj : splitObjectName(fullObj)[0];
                  const sequenceName = isNew ? '' : splitObjectName(fullObj)[1];
                  return <SequenceWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} sequenceName={sequenceName} isNew={isNew} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'stored' || tab.type === 'create-stored') {
                  const isNew = tab.type === 'create-stored';
                  const fullObj = tab.fullObjectName || tab.initialSql.split(':')[0];
                  const identity = tab.storedIdentity || {
                    schema: isNew ? fullObj : splitObjectName(fullObj)[0] || '',
                    objectName: isNew ? '' : splitObjectName(fullObj)[1] || '',
                    objectType: (tab.initialSql.split(':')[1] || 'FUNCTION') as 'FUNCTION' | 'PROCEDURE'
                  };
                  return <StoredWindowOracle key={tab.id} tabId={tab.id} {...identity} isNew={isNew}
                    isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat}
                    inputDateFormat={settings.inputDateFormat} onDirtyStateChange={logic.handleDirtyStateChange}
                    monaStyle={isMonaStyle} onCreated={logic.handleStoredCreated}
                    isAiEnabled={logic.aiLogic.isAiEnabled} onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)} />;
                } else if (tab.type === 'package' || tab.type === 'create-package') {
                  const isNew = tab.type === 'create-package';
                  const fullObj = tab.fullObjectName || '';
                  const identity = tab.packageIdentity || {
                    schema: isNew ? fullObj : splitObjectName(fullObj)[0] || '',
                    objectName: isNew ? '' : splitObjectName(fullObj)[1] || '',
                    objectType: (tab.initialSql.split(':')[1] || 'PACKAGE') as 'PACKAGE' | 'PACKAGE BODY'
                  };
                  return <PackageWindowOracle key={tab.id} tabId={tab.id} {...identity} isNew={isNew}
                    isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat}
                    inputDateFormat={settings.inputDateFormat} onDirtyStateChange={logic.handleDirtyStateChange}
                    monaStyle={isMonaStyle} onCreated={logic.handlePackageCreated}
                    isAiEnabled={logic.aiLogic.isAiEnabled} onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)} />;
                } else if (tab.type === 'trigger' || tab.type === 'create-trigger') {
                  const isNew = tab.type === 'create-trigger';
                  let schemaName = '';
                  let triggerName = '';
                  let initialTable = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    const parts = fullObj.split(':');
                    schemaName = parts[0];
                    initialTable = parts[1] || '';
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    triggerName = splitObjectName(fullObj)[1] || '';
                  }
                  return <TriggerWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} triggerName={triggerName} initialTable={initialTable} isNew={isNew} isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat} inputDateFormat={settings.inputDateFormat} monaStyle={isMonaStyle}
                    isAiEnabled={logic.aiLogic.isAiEnabled} onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)} />;
                } else if (tab.type === 'dblink' || tab.type === 'create-dblink') {
                  const isNew = tab.type === 'create-dblink';
                  let schemaName = '';
                  let dbLinkName = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    schemaName = fullObj;
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    dbLinkName = splitObjectName(fullObj)[1] || '';
                  }
                  return <DbLinkWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} dbLinkName={dbLinkName} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={schemas} />;
                } else if (tab.type === 'synonym' || tab.type === 'create-synonym') {
                  const isNew = tab.type === 'create-synonym';
                  let schemaName = '';
                  let synonymName = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    schemaName = fullObj;
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    synonymName = splitObjectName(fullObj)[1] || '';
                  }
                  return <SynonymWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} synonymName={synonymName} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={schemas} onOpenTarget={(type, schema, objectName) => logic.handleAddTab(type, qualifiedObjectName({ schema, objectName }))} />;
                } else if (tab.type === 'mview' || tab.type === 'create-mview') {
                  const isNew = tab.type === 'create-mview';
                  let schemaName = '';
                  let mviewName = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    schemaName = fullObj;
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    mviewName = splitObjectName(fullObj)[1] || '';
                  }
                  return <MaterializedViewWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} mviewName={mviewName} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={schemas} />;
                } else if (tab.type === 'mview-log' || tab.type === 'create-mview-log') {
                  const isNew = tab.type === 'create-mview-log';
                  let schemaName = '';
                  let tableName = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    schemaName = fullObj;
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    tableName = splitObjectName(fullObj)[1] || '';
                  }
                  return <MaterializedViewLogWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} tableName={tableName} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={schemas} />;
                } else if (tab.type === 'index' || tab.type === 'create-index') {
                  const isNew = tab.type === 'create-index';
                  let schemaName = '';
                  let indexName = '';
                  let initialTable = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    const parts = fullObj.split(':');
                    schemaName = parts[0];
                    initialTable = parts[1] || '';
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    indexName = splitObjectName(fullObj)[1] || '';
                  }
                  return <IndexWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} indexName={indexName} initialTable={initialTable} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={schemas} />;
                } else if (tab.type === 'constraint' || tab.type === 'create-constraint') {
                  const isNew = tab.type === 'create-constraint';
                  let schemaName = '';
                  let constraintName = '';
                  let initialTable = '';
                  const fullObj = tab.fullObjectName || '';
                  if (isNew) {
                    const parts = fullObj.split(':');
                    schemaName = parts[0];
                    initialTable = parts[1] || '';
                  } else {
                    schemaName = splitObjectName(fullObj)[0] || '';
                    constraintName = splitObjectName(fullObj)[1] || '';
                    initialTable = tab.initialSql; 
                  }
                  return <CheckConstraintWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} tableName={initialTable} constraintName={constraintName} isNew={isNew} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'type') {
                  const fullObj = tab.fullObjectName || '';
                  const schemaName = splitObjectName(fullObj)[0] || '';
                  const typeName = splitObjectName(fullObj)[1] || '';
                  return <TypeWindowOracle key={tab.id} tabId={tab.id} schema={schemaName} typeName={typeName} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'object-privilege') {
                  return <ObjectPrivilegeTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} schemas={schemas} />;
                } else if (tab.type === 'user-role') {
                  return <UserRoleTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'tablespace') {
                  return <TablespaceTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'directory') {
                  return <DirectoryTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'session') {
                  return <SessionTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'lock') {
                  return <LockTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'builder') {
                  return (
                    <QueryBuilderWindowOracle
                      key={tab.id} tabId={tab.id} title={tab.title}
                      isActive={tab.id === logic.activeTabId}
                      dateFormat={settings.outputDateFormat} dbInfo={dbInfo}
                      userName={config.user}
                      isAiEnabled={logic.aiLogic.isAiEnabled}
                      onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)}
                    />
                  );
                } else if (tab.type === 'data-generator') {
                  return (
                    <DataGeneratorTabOracle
                      key={tab.id}
                      isActive={tab.id === logic.activeTabId}
                      isAiEnabled={logic.aiLogic.isAiEnabled}
                      onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)}
                    />
                  );
                } else if (tab.type === 'pdb-manager') {
                  return <PdbManagerTabOracle key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'bi') {
                  return <CrossTabWindowOracle key={tab.id} tabId={tab.id} isActive={tab.id === logic.activeTabId} schemas={schemas} initialSchema={config.user} inputDateFormat={settings.inputDateFormat} />;
                } else if (tab.type === 'er-diagram') {
                  return <ErDiagramWindow key={tab.id} tabId={tab.id} isActive={tab.id === logic.activeTabId} schemas={schemas} initialSchema={config.user} dbType="oracle" />;
                }
                return null;
              })
            )}
          </Box>
        </Box>

        {logic.isAiSidebarOpen && (
          <>
            <WorkspaceDivider label={t('ux_resize_ai')} value={currentAiSidebarWidth} min={Math.min(300,window.innerWidth*0.8)} max={window.innerWidth*0.8} reverse onChange={logic.setAiSidebarWidth} onMouseDown={logic.startAiSidebarResize} />
            <Box sx={{ width: currentAiSidebarWidth, height: '100%', flexShrink: 0, bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider' }}>
              <AiChatSidebar connectionScope={config.aiHistoryScope} sendKey={settings.aiSendKey}
                onClose={() => logic.setIsAiSidebarOpen(false)}
                aiContext={logic.aiContext}
                setAiContext={logic.setAiContext}
              />
            </Box>
          </>
        )}
      </Box>

      <GlobalGitDialog gitLogic={logic.gitLogic} />

      <AiSettingsDialog aiLogic={logic.aiLogic} />

      <AboutDialog open={logic.aboutDialogOpen} onClose={() => logic.setAboutDialogOpen(false)} />

      <GlobalLoader monaStyle={isMonaStyle} isDarkTheme={isDarkTheme} onCancel={logic.handleCancelExecution} />

      <Menu open={logic.tabContextMenu !== null} onClose={() => logic.setTabContextMenu(null)} anchorReference="anchorPosition" anchorPosition={logic.tabContextMenu !== null ? { top: logic.tabContextMenu.mouseY, left: logic.tabContextMenu.mouseX } : undefined}>
        <MenuItem onClick={logic.handleCloseAllTabs} disabled={logic.tabs.length === 0} sx={styles.menuItemText}>{t("close_all_tabs")}</MenuItem>
        <MenuItem onClick={logic.handleCloseOtherTabs} disabled={logic.tabs.length <= 1} sx={styles.menuItemText}>{t("close_other_tabs")}</MenuItem>
        <MenuItem onClick={logic.handleCloseRightTabs} disabled={!logic.tabContextMenu || logic.tabContextMenu.tabIndex === logic.tabs.length - 1} sx={styles.menuItemText}>{t("close_tabs_to_the_right")}</MenuItem>
      </Menu>
    </>
  );
}
