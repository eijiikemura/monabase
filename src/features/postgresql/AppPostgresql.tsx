// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { NotificationHistoryButton } from '@/components/feedback/NotificationHost';
import { workspaceTabDescription } from '@/components/navigation/workspaceTabDescription';
import ConnectionBadge from '@/components/ConnectionBadge';
import WorkspaceNavigation from '@/components/navigation/WorkspaceNavigation';
import WorkspaceDivider from '@/components/navigation/WorkspaceDivider';
import { notify } from '@/shared/utils/notifications';
import { splitObjectName } from '@/shared/utils/objectIdentity';
import type { ConnectionConfig, AppSettings } from "@/shared/types/appTypes";

import { useState, useEffect, memo, useCallback } from 'react';
import { 
  Box, AppBar, Toolbar, Typography, Button,
  Divider, Menu, MenuItem, Tabs, Tab, Tooltip, IconButton,
  Backdrop, CircularProgress, SvgIcon
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'; 
import StopIcon from '@mui/icons-material/Stop'; 
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import HelpMenu from '@/components/HelpMenu';
import CableIcon from '@mui/icons-material/Cable';

import AiChatSidebar from "../ai/AiChatSidebar";

import SqlWindowPostgresql from './windows/sql/SqlWindow';
import TableWindowPostgresql from './windows/table/TableWindow';
import CreateTableWindowPostgresql from './windows/table/CreateTableWindow';
import ViewWindowPostgresql from './windows/view/ViewWindow';
import SequenceWindowPostgresql from './windows/sequence/SequenceWindow';
import StoredWindowPostgresql from './windows/stored/StoredWindow';
import TriggerWindowPostgresql from './windows/trigger/TriggerWindow';
import IndexWindowPostgresql from './windows/index/IndexWindow';
import CheckConstraintWindowPostgresql from './windows/constraint/CheckConstraintWindow';
import TypeWindowPostgresql from './windows/type/TypeWindow';
import MaterializedViewWindowPostgresql from './windows/mview/MaterializedViewWindow';
import ObjectPrivilegeTabPostgresql from './windows/dba/ObjectPrivilegeTab';
import UserRoleTabPostgresql from './windows/dba/UserRoleTab';
import SessionTabPostgresql from './windows/dba/SessionTab';
import TablespaceTabPostgresql from './windows/dba/TablespaceTab';
import LockTabPostgresql from './windows/dba/LockTab';
import SchemaManagerTabPostgresql from './windows/dba/SchemaManagerTab';
import QueryBuilderWindowPostgresql from './windows/builder/QueryBuilderWindow';
import DataGeneratorTabPostgresql from './windows/generator/DataGeneratorTab';
import CrossTabWindowPostgresql from './windows/bi/CrossTabWindow';

import Sidebar from './Sidebar';
import MonaBaseLogo from "@/components/MonaBaseLogo";
import TopMenuBar from "@/components/TopMenuBar";
import ErDiagramWindow from "../er/ErDiagramWindow";
import GlobalGitDialog from "../git/GlobalGitDialog";
import AiSettingsDialog from "../ai/AiSettingsDialog";
import AiMenu from "../ai/AiMenu";
import AboutDialog from "@/components/AboutDialog"; 

import { useAppPostgresql } from './useAppPostgresql';
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
  }),
  aiSidebarPaper: (width: number) => ({ 
    width, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, 
    overflow: 'hidden', bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider' 
  }),
  headerBox: (isOpen: boolean) => ({
    display: 'flex', alignItems: 'center', justifyContent: isOpen ? 'space-between' : 'center', 
    p: 1, minHeight: 48, flexShrink: 0
  }),
  headerText: { fontWeight: 'bold', color: 'text.secondary', whiteSpace: 'nowrap' as const, overflow: 'hidden' },
  divider: { flexShrink: 0 }
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

const GlobalLoader = memo(({ monaStyle, isDarkTheme, onCancel, t }: { monaStyle: boolean; isDarkTheme: boolean; onCancel: () => void; t: ReturnType<typeof import('react-i18next').useTranslation>['t'] }) => {
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

const DbInfoAndActions = memo(({ config, dbInfo, isMonaStyle, t, hasUncommittedTx, onCommit, onRollback, isDisconnected }: { config: ConnectionConfig; dbInfo: string; isMonaStyle: boolean; isDarkTheme: boolean; hasUncommittedTx: boolean; onCommit: () => void; onRollback: () => void; isDisconnected: boolean; t: ReturnType<typeof import('react-i18next').useTranslation>['t'] }) => {
  


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

      <Divider orientation="vertical" flexItem sx={{ mx: 1, ml: 2, mr: 2 }} />
      
      <NotificationHistoryButton />
      <ConnectionBadge config={config} dbInfo={dbInfo} disconnected={isDisconnected} />
    </>
  );
});
DbInfoAndActions.displayName = 'DbInfoAndActions';

interface AppPostgresqlProps {
  config: ConnectionConfig; dbInfo: string; schemas: string[]; settings: AppSettings; onDisconnect: () => void; onOpenSettings: () => void;
}

export default function AppPostgresql({ config, dbInfo, schemas, settings, onDisconnect, onOpenSettings }: AppPostgresqlProps) {
  const logic = useAppPostgresql(config, settings, schemas);
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
            <MenuItem onClick={() => { logic.handleAddTab('schema-manager'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("schema_management")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('object-privilege'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("object_privileges")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('user-role'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("user_settings")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('tablespace'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("tablespace")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('session'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("session_management")}</MenuItem>
            <MenuItem onClick={() => { logic.handleAddTab('lock'); logic.setDbaMenuAnchorEl(null); }} disabled={isDisconnected}>{t("lock_management")}</MenuItem>
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
            config={config} dbInfo={dbInfo} isMonaStyle={isMonaStyle} isDarkTheme={isDarkTheme} t={t}
            hasUncommittedTx={logic.hasUncommittedTx} onCommit={logic.handleCommit} onRollback={logic.handleRollback}
            isDisconnected={isDisconnected}
          />
        </Toolbar>
      </AppBar>

      <Box sx={styles.mainContainer}>
        
        <Sidebar 
          isSidebarOpen={logic.isSidebarOpen} sidebarWidth={currentSidebarWidth} onToggleSidebar={() => logic.setIsSidebarOpen(!logic.isSidebarOpen)}
          schemas={logic.localSchemas} expandedSchemas={logic.expandedSchemas} onToggleSchema={logic.toggleSchema} onAddTab={logic.handleAddTab}
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
                  return (
                    <SqlWindowPostgresql
                      key={tab.id} tabId={tab.id} type={tab.type} title={tab.title} initialSql={tab.initialSql} isActive={tab.id === logic.activeTabId} 
                      dateFormat={settings.outputDateFormat} dbInfo={dbInfo} inputDateFormat={settings.inputDateFormat} schemas={logic.localSchemas} 
                      dbName={config.database} userName={config.user} 
                      isAiEnabled={logic.aiLogic.isAiEnabled} 
                      onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)}
                    />
                  );
                } else if (tab.type === 'table') {
                  return <TableWindowPostgresql key={tab.id} tabId={tab.id} fullTableName={tab.fullObjectName || ''} isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat} inputDateFormat={settings.inputDateFormat} />;
                } else if (tab.type === 'create-table') {
                  return <CreateTableWindowPostgresql key={tab.id} tabId={tab.id} schema={tab.fullObjectName || tab.initialSql} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'view') {
                  return <ViewWindowPostgresql key={tab.id} tabId={tab.id} fullViewName={tab.fullObjectName || ''} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'sequence' || tab.type === 'create-sequence') {
                  const isNew = tab.type === 'create-sequence';
                  const fullObj = tab.fullObjectName || '';
                  return <SequenceWindowPostgresql key={tab.id} tabId={tab.id} schema={isNew ? fullObj : splitObjectName(fullObj)[0]} sequenceName={isNew ? '' : splitObjectName(fullObj)[1]} isNew={isNew} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'stored' || tab.type === 'create-stored') {
                  const isNew = tab.type === 'create-stored';
                  const fullObj = tab.fullObjectName || tab.initialSql.split(':')[0];
                  const identity = tab.storedIdentity || {
                    schema: isNew ? fullObj : splitObjectName(fullObj)[0] || '',
                    objectName: isNew ? '' : splitObjectName(fullObj)[1] || '',
                    objectType: (tab.initialSql.split(':')[1] || 'FUNCTION') as 'FUNCTION' | 'PROCEDURE'
                  };
                  return <StoredWindowPostgresql key={tab.id} tabId={tab.id} {...identity} isNew={isNew}
                    isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat}
                    inputDateFormat={settings.inputDateFormat} onDirtyStateChange={logic.handleDirtyStateChange}
                    monaStyle={isMonaStyle} onCreated={logic.handleStoredCreated}
                    isAiEnabled={logic.aiLogic.isAiEnabled} onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)} />;
                } else if (tab.type === 'trigger' || tab.type === 'create-trigger') {
                  const isNew = tab.type === 'create-trigger';
                  const fullObj = tab.fullObjectName || '';
                  const schemaName = tab.triggerIdentity?.schema ?? (isNew ? fullObj.split(':')[0] : splitObjectName(fullObj)[0] || '');
                  const initialTable = tab.triggerIdentity?.tableName ?? (isNew ? fullObj.split(':')[1] || '' : '');
                  const triggerName = tab.triggerIdentity?.objectName ?? (isNew ? '' : splitObjectName(fullObj)[1] || '');
                  return <TriggerWindowPostgresql key={tab.id} tabId={tab.id} schema={schemaName} triggerName={triggerName} initialTable={initialTable} isNew={isNew} isActive={tab.id === logic.activeTabId} outputDateFormat={settings.outputDateFormat} inputDateFormat={settings.inputDateFormat} monaStyle={isMonaStyle}
                    isAiEnabled={logic.aiLogic.isAiEnabled} onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)} />;
                } else if (tab.type === 'index' || tab.type === 'create-index') {
                  const isNew = tab.type === 'create-index';
                  const fullObj = tab.fullObjectName || '';
                  return <IndexWindowPostgresql key={tab.id} tabId={tab.id} schema={isNew ? fullObj.split(':')[0] : splitObjectName(fullObj)[0] || ''} indexName={isNew ? '' : splitObjectName(fullObj)[1] || ''} initialTable={isNew ? fullObj.split(':')[1] || '' : ''} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={logic.localSchemas} />;
                } else if (tab.type === 'constraint' || tab.type === 'create-constraint') {
                  const isNew = tab.type === 'create-constraint';
                  const fullObj = tab.fullObjectName || '';
                  return <CheckConstraintWindowPostgresql key={tab.id} tabId={tab.id} schema={isNew ? fullObj.split(':')[0] : splitObjectName(fullObj)[0] || ''} tableName={isNew ? fullObj.split(':')[1] || '' : tab.initialSql} constraintName={isNew ? '' : splitObjectName(fullObj)[1] || ''} isNew={isNew} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'type') {
                  const fullObj = tab.fullObjectName || '';
                  return <TypeWindowPostgresql key={tab.id} tabId={tab.id} schema={splitObjectName(fullObj)[0] || ''} typeName={splitObjectName(fullObj)[1] || ''} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'mview' || tab.type === 'create-mview') {
                  const isNew = tab.type === 'create-mview';
                  const fullObj = tab.fullObjectName || '';
                  return <MaterializedViewWindowPostgresql key={tab.id} tabId={tab.id} schema={isNew ? fullObj : splitObjectName(fullObj)[0]} mviewName={isNew ? '' : splitObjectName(fullObj)[1]} isNew={isNew} isActive={tab.id === logic.activeTabId} allSchemas={logic.localSchemas} />;
                } else if (tab.type === 'schema-manager') {
                  return <SchemaManagerTabPostgresql key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'object-privilege') {
                  return <ObjectPrivilegeTabPostgresql key={tab.id} isActive={tab.id === logic.activeTabId} schemas={logic.localSchemas} dbName={config.database} userName={config.user} />;
                } else if (tab.type === 'user-role') {
                  return <UserRoleTabPostgresql key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'tablespace') {
                  return <TablespaceTabPostgresql key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'session') {
                  return <SessionTabPostgresql key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'lock') {
                  return <LockTabPostgresql key={tab.id} isActive={tab.id === logic.activeTabId} />;
                } else if (tab.type === 'builder') {
                  return (
                    <QueryBuilderWindowPostgresql
                      key={tab.id} tabId={tab.id} title={tab.title}
                      isActive={tab.id === logic.activeTabId}
                      dateFormat={settings.outputDateFormat} dbInfo={dbInfo}
                      initialSchema={config.user} dbName={config.database} userName={config.user}
                      isAiEnabled={logic.aiLogic.isAiEnabled}
                      onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)}
                    />
                  );
                } else if (tab.type === 'data-generator') {
                  return (
                    <DataGeneratorTabPostgresql
                      key={tab.id}
                      isActive={tab.id === logic.activeTabId}
                      initialSchema={config.user}
                      dbName={config.database}
                      userName={config.user}
                      isAiEnabled={logic.aiLogic.isAiEnabled}
                      onOpenAiSidebar={logic.getOpenAiSidebarForTab(tab.id)}
                    />
                  );
                } else if (tab.type === 'bi') {
                  return <CrossTabWindowPostgresql key={tab.id} tabId={tab.id} isActive={tab.id === logic.activeTabId} schemas={logic.localSchemas} initialSchema={config.user} inputDateFormat={settings.inputDateFormat} dbName={config.database} userName={config.user} />;
                } else if (tab.type === 'er-diagram') {
                  return <ErDiagramWindow key={tab.id} tabId={tab.id} isActive={tab.id === logic.activeTabId} schemas={logic.localSchemas} initialSchema={config.user} dbType="postgres" dbName={config.database} userName={config.user} />;
                }
                return <Box key={tab.id} sx={{ p: 3 }}><Typography color="error">{t("unsupported_feature_in_postgresql")} {tab.type}</Typography></Box>;
              })
            )}
          </Box>
        </Box>

        {logic.isAiSidebarOpen && (
          <WorkspaceDivider label={t('ux_resize_ai')} value={currentAiSidebarWidth} min={Math.min(300,window.innerWidth*0.8)} max={window.innerWidth*0.8} reverse onChange={logic.setAiSidebarWidth} onMouseDown={logic.startAiSidebarResize} />
        )}
        
        {logic.isAiSidebarOpen && (
          <Box sx={styles.aiSidebarPaper(currentAiSidebarWidth)}>
            <AiChatSidebar connectionScope={config.aiHistoryScope} sendKey={settings.aiSendKey}
              onClose={() => logic.setIsAiSidebarOpen(false)} 
              aiContext={logic.aiContext}
              setAiContext={logic.setAiContext}
            />
          </Box>
        )}

      </Box>

      <GlobalGitDialog gitLogic={logic.gitLogic} />
      <AiSettingsDialog aiLogic={logic.aiLogic} />
      <AboutDialog open={logic.aboutDialogOpen} onClose={() => logic.setAboutDialogOpen(false)} />

      <GlobalLoader monaStyle={isMonaStyle} isDarkTheme={isDarkTheme} onCancel={logic.handleCancelExecution} t={t} />

      <Menu open={logic.tabContextMenu !== null} onClose={() => logic.setTabContextMenu(null)} anchorReference="anchorPosition" anchorPosition={logic.tabContextMenu !== null ? { top: logic.tabContextMenu.mouseY, left: logic.tabContextMenu.mouseX } : undefined}>
        <MenuItem onClick={logic.handleCloseAllTabs} disabled={logic.tabs.length === 0} sx={styles.menuItemText}>{t("close_all_tabs")}</MenuItem>
        <MenuItem onClick={logic.handleCloseOtherTabs} disabled={logic.tabs.length <= 1} sx={styles.menuItemText}>{t("close_other_tabs")}</MenuItem>
        <MenuItem onClick={logic.handleCloseRightTabs} disabled={!logic.tabContextMenu || logic.tabContextMenu.tabIndex === logic.tabs.length - 1} sx={styles.menuItemText}>{t("close_tabs_to_the_right")}</MenuItem>
      </Menu>
    </>
  );
}
