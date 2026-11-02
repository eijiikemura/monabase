// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { environmentColors, environmentColor } from '@/shared/utils/connectionDisplay';
import { notify } from '@/shared/utils/notifications';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { ConnectionConfig } from "../shared/types/appTypes";
import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, CssBaseline, Typography, TextField, Button,
  Divider, MenuItem, Select, FormControl, InputLabel, Card,
  IconButton, Tooltip, List, ListItem, ListItemButton, ListItemText, Checkbox, FormControlLabel, Paper,
  Tabs, Tab, RadioGroup, Radio, Backdrop, CircularProgress, useTheme, Alert
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import LoginIcon from '@mui/icons-material/Login';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';

import MonaBaseLogo from "./MonaBaseLogo";
import { ipcRenderer } from '../shared/api/desktop';

interface LoginScreenProps {
  onLoginSuccess: (config: ConnectionConfig, schemas: string[]) => void;
}

function TabPanel(props: { children?: React.ReactNode; index: number; value: number }) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`connection-tabpanel-${index}`}
      style={{ flexGrow: 1, minHeight: 0, display: value === index ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}
      {...other}
    >
      {value === index && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', p: 1, pt: 2, pb: 4, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  
  const [savedConnections, setSavedConnections] = useState<ConnectionConfig[]>([]);
  const [selectedConnName, setSelectedConnName] = useState<string>('');
  
  const [shouldSave, setShouldSave] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<number>(0);
  
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const connecting = useRef(false);
  const needsConnectionCleanup = useRef(false);
  const [isReordering, setIsReordering] = useState(false);
  const reordering = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleting = useRef(false);
  const draftRevision = useRef(0);
  const loadRequest = useRef(0);

  const [connectionSearch, setConnectionSearch] = useState('');
  const searchTerm = connectionSearch.trim().toLocaleLowerCase();
  const visibleConnections = savedConnections.filter(connection => !searchTerm || [connection.name, connection.environmentLabel, connection.database, connection.user].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(searchTerm)));
  const [savedListOpen, setSavedListOpen] = useState(false);
  const [config, setConfigState] = useState<ConnectionConfig>({
    name: 'Oracle Local', dbType: 'oracle', host: 'localhost', 
    port: '1521', database: 'FREEPDB1', user: 'SYSTEM', password: '', readonly: false,
    useOsAuth: false,
    useSysdba: false,
    useSshTunnel: false,
    sshHost: '',
    sshPort: '22',
    sshUser: '',
    sshAuthType: 'password', 
    sshPassword: '',
    sshKeyFile: ''
  });

  const setConfig = (next: ConnectionConfig) => {
    draftRevision.current++;
    setConfigState(next);
  };

  const loadConnections = useEventCallback(async () => {
    const request = ++loadRequest.current;
    const revision = draftRevision.current;
    try {
      const conns = await ipcRenderer.invoke('get-connections');
      if (request !== loadRequest.current) return;
      setSavedConnections(conns);
      if (conns.length > 0 && !selectedConnName && revision === draftRevision.current) {
        setSelectedConnName(conns[0].name || '');
        setConfigState({
          ...conns[0],
          readonly: conns[0].readonly || false,
          useOsAuth: conns[0].useOsAuth || false,
          useSysdba: conns[0].useSysdba || false,
          useSshTunnel: conns[0].useSshTunnel || false,
          sshHost: conns[0].sshHost || '',
          sshPort: conns[0].sshPort || '22',
          sshUser: conns[0].sshUser || '',
          sshAuthType: conns[0].sshAuthType || 'password',
          sshPassword: conns[0].sshPassword || '',
          sshKeyFile: conns[0].sshKeyFile || ''
        });
        setShouldSave(false);
      }
    } catch {
      if (request === loadRequest.current) notify(t('failed_to_load_connections'), { actionLabel:t('retry'), onAction:()=>{void loadConnections();} });
    }
  });

  const cancelConnectionLoads = useEventCallback(() => { loadRequest.current++; });
  useEffect(() => {
    loadConnections();
    return cancelConnectionLoads;
  }, [loadConnections, cancelConnectionLoads]);

  const handleSelectConnection = (conn: ConnectionConfig) => {
    setSelectedConnName(conn.name ?? '');
    setConfig({ 
      ...conn, 
      readonly: conn.readonly || false, 
      useOsAuth: conn.useOsAuth || false, 
      useSysdba: conn.useSysdba || false,
      useSshTunnel: conn.useSshTunnel || false,
      sshHost: conn.sshHost || '',
      sshPort: conn.sshPort || '22',
      sshUser: conn.sshUser || '',
      sshAuthType: conn.sshAuthType || 'password',
      sshPassword: conn.sshPassword || '',
      sshKeyFile: conn.sshKeyFile || ''
    });
    setShouldSave(false);
  };

  const handleNewConnection = () => {
    setSelectedConnName(''); 
    setConfig({ 
      name: t("new_connection"), dbType: 'oracle', host: 'localhost',
      port: '1521', database: '', user: '', password: '', readonly: false, useOsAuth: false, useSysdba: false,
      useSshTunnel: false, sshHost: '', sshPort: '22', sshUser: '', sshAuthType: 'password', sshPassword: '', sshKeyFile: ''
    });
    setShouldSave(true);
    setActiveTab(0); 
  };

  const handleDuplicateConnection = (conn: ConnectionConfig) => {
    setSelectedConnName(''); 
    setConfig({ 
      ...conn, 
      name: `${conn.name} - ${t("copy")}`,
      readonly: conn.readonly || false, 
      useOsAuth: conn.useOsAuth || false, 
      useSysdba: conn.useSysdba || false,
      useSshTunnel: conn.useSshTunnel || false,
      sshHost: conn.sshHost || '',
      sshPort: conn.sshPort || '22',
      sshUser: conn.sshUser || '',
      sshAuthType: conn.sshAuthType || 'password',
      sshPassword: conn.sshPassword || '',
      sshKeyFile: conn.sshKeyFile || ''
    });
    setShouldSave(true);
  };

  const finishConnectionDeletion = useEventCallback((name: string, revision: number) => {
    setSavedConnections(previous => previous.filter(connection => connection.name !== name));
    if (selectedConnName !== name) return;
    if (draftRevision.current === revision) handleNewConnection();
    else {
      // Keep edits to a deleted record as a new, unsaved connection.
      setSelectedConnName('');
      setShouldSave(true);
    }
  });

  const handleDeleteConnection = async (nameToDelete: string) => {
    if (reordering.current || deleting.current || connecting.current) return;
    if (!window.confirm(t("delete_saved_connection_this_operation_cannot_be_undone", { name: nameToDelete }))) return;
    const revision = draftRevision.current;
    deleting.current = true;
    setIsDeleting(true);
    try {
      const res = await ipcRenderer.invoke('delete-connection', nameToDelete);
      if (res.success) {
        finishConnectionDeletion(nameToDelete, revision);
        notify(t("deleted"), { severity: 'success' });
      } else {
        notify(res.error || t('failed_to_delete_connection'));
      }
    } catch {
      notify(t('failed_to_delete_connection'));
    } finally {
      deleting.current = false;
      setIsDeleting(false);
    }
  };

  const handleMoveConnection = async (index: number, offset: number) => {
    const destination = index + offset;
    if (searchTerm || reordering.current || deleting.current || connecting.current || destination < 0 || destination >= savedConnections.length) return;
    reordering.current = true;
    setIsReordering(true);
    const newConns = [...savedConnections];
    const temp = newConns[destination];
    newConns[destination] = newConns[index];
    newConns[index] = temp;
    
    try {
      const result = await ipcRenderer.invoke('save-connections-order', newConns);
      if (result.success) setSavedConnections(newConns);
      else notify(result.error || t('failed_to_save_connection'));
    } catch {
      notify(t('failed_to_save_connection'));
    } finally {
      reordering.current = false;
      setIsReordering(false);
    }
  };

  const handleSelectKeyFile = async () => {
    const options = {
      title: t("select_private_key_file"),
      properties: ['openFile'] satisfies import('electron').OpenDialogOptions['properties']
    };
    try {
      const res = await ipcRenderer.invoke('show-open-dialog', options);
      if (res && res.filePaths && res.filePaths.length > 0) {
        setConfig({ ...config, sshKeyFile: res.filePaths[0] });
      }
    } catch (e) {
      console.error(e);
      notify(t('ux_browse_failed_enter_path'));
    }
  };

  const ensureOracleClientPathForOsAuth = async (): Promise<'ready' | 'canceled' | 'failed'> => {
    let savingClientSettings = false;
    try {
      const currentSettings = await ipcRenderer.invoke('load-settings');
      if (currentSettings && currentSettings.oracleClientPath && currentSettings.oracleClientPath.trim()) {
        return 'ready';
      }

      const needPick = window.confirm(
        t(
          "confirm_select_oracle_client_folder"
        )
      );
      if (!needPick) return 'canceled';

      const pickRes = await ipcRenderer.invoke('show-open-folder-dialog', t("select_the_oracle_client_64_bit_instant_client_folder"));
      if (pickRes && !pickRes.canceled && pickRes.filePaths && pickRes.filePaths.length > 0) {
        const selectedFolder = pickRes.filePaths[0];
        const updatedSettings = {
          ...currentSettings,
          oracleClientPath: selectedFolder
        };
        savingClientSettings = true;
        const saved = await ipcRenderer.invoke('save-settings', updatedSettings);
        if (!saved.success) {
          notify(t('oracle_client_settings_save_failed'));
          return 'failed';
        }
        return 'ready';
      }
      return 'canceled';
    } catch {
      notify(savingClientSettings ? t('oracle_client_settings_save_failed') : t('oracle_client_setup_failed'));
      return 'failed';
    }
  };

  const cleanupFailedLogin = async () => {
    try {
      if (await ipcRenderer.invoke('disconnect-db') !== true) throw new Error('Connection cleanup was not confirmed.');
      needsConnectionCleanup.current = false;
      return true;
    } catch {
      notify(t('connection_cleanup_failed_retry'));
      return false;
    }
  };

  const handleConnect = async () => {
    if (connecting.current || reordering.current || deleting.current) return;
    connecting.current = true;
    setIsConnecting(true);
    try {
      if (needsConnectionCleanup.current && !await cleanupFailedLogin()) return;
      if (config.useSshTunnel) {
        if (!config.sshHost || !config.sshUser) {
          notify(t("when_using_ssh_tunnel_please_enter_the_host_and_username_of_the_ssh_server"));
          return;
        }
        if (config.sshAuthType === 'key' && !config.sshKeyFile) {
          notify(t("if_auth_method_is_private_key_please_specify_the_key_file_path"));
          return;
        }
      }

      if (config.dbType === 'oracle' && config.useOsAuth) {
        const setup = await ensureOracleClientPathForOsAuth();
        if (setup !== 'ready') {
          if (setup === 'canceled') notify(t("os_authentication_was_canceled_because_no_oracle_client_folder_was_selected"));
          return;
        }
      }

      if (shouldSave) {
        const saved = await ipcRenderer.invoke('save-connection', config, selectedConnName);
        if (!saved.success) {
          notify(saved.error || t('failed_to_save_connection'));
          return;
        }
        if (saved.credentialsPersisted === false) notify(t('credentials_session_only'), { severity: 'warning' });
        setSelectedConnName(config.name ?? '');
        await loadConnections();
      }

      const res = await ipcRenderer.invoke('connect-db', config);
      if (res.success) {
        needsConnectionCleanup.current = true;
        try {
          const schemaRes = await ipcRenderer.invoke('get-schemas');
          if (schemaRes.success) {
            needsConnectionCleanup.current = false;
            onLoginSuccess({ ...config, aiHistoryScope: res.aiHistoryScope }, schemaRes.schemas);
          } else {
            notify(t("db_connection_succeeded_but_failed_to_fetch_schemas") + '\n' + schemaRes.error);
            await cleanupFailedLogin();
          }
        } catch (schemaErr) {
          notify(t("connection_error_7") + '\n' + schemaErr);
          await cleanupFailedLogin();
        }
      } else { notify(t("connection_error_2") + '\n' + res.error); }
    } catch (err) { 
      notify(t("an_unexpected_error_occurred") + '\n' + err);
    } finally {
      connecting.current = false;
      setIsConnecting(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh', width: '100%', bgcolor: 'background.default', position: 'relative', p: { xs: 1, md: 2 }, overflow: 'auto' }}>
      <CssBaseline />
      <Card data-testid="connection-card" sx={{ width: '100%', maxWidth: 850, height: '100%', maxHeight: 650, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, boxShadow: 3, borderRadius: 2 }}>
        <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', justifyContent: 'space-between', p: 1, flexShrink: 0 }}>
          <Typography fontWeight="bold">MonaBase</Typography>
          <Button size="small" aria-controls="saved-connection-list" aria-expanded={savedListOpen} onClick={() => setSavedListOpen(open => !open)}>{t('saved_connections')}</Button>
        </Box>
        
        <Box id="saved-connection-list" sx={{ width: { xs: '100%', md: 350 }, minHeight: 0, flexShrink: 0, maxHeight: { xs: '35%', md: '100%' }, borderRight: '1px solid', borderColor: 'divider', display: { xs: savedListOpen ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column', p: { xs: 1, md: 3 }, bgcolor: 'background.paper' }}>
          <Typography variant="h5" sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', fontWeight: 900, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", letterSpacing: '0.05em', color: 'primary.dark', mb: 2 }}>
            <MonaBaseLogo sx={{ mr: 1.5, fontSize: 36, color: 'primary.main' }} /> MonaBase
          </Typography>
          <Divider sx={{ mb: 2, display: { xs: 'none', md: 'block' } }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
              {t("saved_connections")}
            </Typography>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleNewConnection}>
              {t("new")}
            </Button>
          </Box>

          <TextField size="small" label={t('ux_search_connections')} value={connectionSearch} onChange={event => setConnectionSearch(event.target.value)} sx={{ mb: 1 }} />
          {searchTerm && <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>{t('ux_filtered_order_help')}</Typography>}
          <Paper variant="outlined" sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', bgcolor: 'background.paper', borderRadius: 1 }}>
            {visibleConnections.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                {t(searchTerm ? 'ux_no_connections_match' : 'no_saved_connections')}
              </Typography>
            ) : (
              <List dense disablePadding>
                {visibleConnections.map((conn) => {
                  const idx = savedConnections.indexOf(conn);
                  return (
                  <ListItem
                    key={conn.name}
                    disablePadding
                    secondaryAction={
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Tooltip title={t("move_up")}>
                          <span>
                            <IconButton size="small" aria-label={t("move_up")} onClick={(e) => { e.stopPropagation(); handleMoveConnection(idx, -1); }} disabled={!!searchTerm || isReordering || isDeleting || isConnecting || idx === 0}>
                              <ArrowUpwardIcon fontSize="small" sx={{ fontSize: '1rem' }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t("move_down")}>
                          <span>
                            <IconButton size="small" aria-label={t("move_down")} onClick={(e) => { e.stopPropagation(); handleMoveConnection(idx, 1); }} disabled={!!searchTerm || isReordering || isDeleting || isConnecting || idx === savedConnections.length - 1}>
                              <ArrowDownwardIcon fontSize="small" sx={{ fontSize: '1rem' }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t("duplicate_connection")}>
                          <IconButton size="small" aria-label={t("duplicate_connection")} color="primary" onClick={(e) => { e.stopPropagation(); handleDuplicateConnection(conn); }}>
                            <ContentCopyIcon fontSize="small" sx={{ fontSize: '1rem' }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("delete_connection")}>
                          <IconButton size="small" aria-label={t("delete_connection")} color="error" disabled={isReordering || isDeleting || isConnecting} onClick={(e) => { e.stopPropagation(); handleDeleteConnection(conn.name ?? ''); }}>
                            <DeleteIcon fontSize="small" sx={{ fontSize: '1rem' }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                    sx={{ 
                      borderBottom: '1px solid', 
                      borderColor: 'divider',
                      bgcolor: idx % 2 === 1 ? 'action.hover' : 'transparent', borderLeft:'3px solid', borderLeftColor:environmentColor(conn.environmentColor)
                    }}
                  >
                    <ListItemButton 
                      selected={config.name === conn.name} 
                      onClick={() => handleSelectConnection(conn)}
                      sx={{ pr: 12 }} 
                    >
                      <ListItemText 
                        primary={conn.environmentLabel?`${conn.environmentLabel} · ${conn.name}`:conn.name}
                        secondary={`${conn.dbType === 'oracle' ? 'Oracle' : 'PostgreSQL'} - ${conn.database || t("not_set")}`}
                        primaryTypographyProps={{ fontWeight: config.name === conn.name ? 'bold' : 'normal', noWrap: true }}
                        secondaryTypographyProps={{ noWrap: true }}
                      />
                    </ListItemButton>
                  </ListItem>
                ); })}
              </List>
            )}
          </Paper>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', p: 0 }}>
          
          <Box sx={{ px: { xs: 1.5, md: 4 }, pt: { xs: 1, md: 4 }, flexShrink: 0 }}>
            <Typography variant="h6" fontWeight="bold" color="text.primary" sx={{ mb: 2 }}>
              {config.name === t("new_connection") || config.name === '新規接続' ? t("create_new_connection") : t("edit_connection")}
            </Typography>
            
            {config.unavailableCredentials?.some(field => !config[field]) && (
              <Alert severity="warning" sx={{ mb: 1 }}>{t('credentials_could_not_be_unlocked')}</Alert>
            )}

            <Tabs value={activeTab} onChange={(_e, val) => setActiveTab(val)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 36 }}>
              <Tab label={t("basic_settings")} sx={{ minHeight: 36, py: 0, fontWeight: 'bold' }} />
              <Tab label={t("ssh_tunnel")} sx={{ minHeight: 36, py: 0, fontWeight: 'bold' }} />
            </Tabs>
          </Box>

          <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', px: { xs: 1.5, md: 4 } }}>
            <TabPanel value={activeTab} index={0}>
              <TextField label={t("connection_name_save_as")} size="small" fullWidth value={config.name} onChange={e => setConfig({...config, name: e.target.value})} />
              <Box sx={{display:'flex',gap:1,flexDirection:{xs:'column',sm:'row'},flexWrap:'wrap'}}>
                <TextField label={t('ux_environment_label')} helperText={t('ux_environment_help')} size="small" sx={{flex:{xs:'0 0 auto',sm:'1 1 180px'},minWidth:0}} inputProps={{maxLength:40}} value={config.environmentLabel || ''} onChange={e=>setConfig({...config,environmentLabel:e.target.value})} />
                <TextField select label={t('ux_environment_color')} size="small" sx={{minWidth:160}} value={config.environmentColor || 'neutral'} onChange={e=>setConfig({...config,environmentColor:e.target.value as NonNullable<ConnectionConfig['environmentColor']>})}>{Object.keys(environmentColors).map(color=><MenuItem key={color} value={color}>{t('ux_color_'+color)}</MenuItem>)}</TextField>
              </Box>
              
              <FormControl fullWidth size="small">
                <InputLabel>{t("database_type")}</InputLabel>
                <Select value={config.dbType} label={t("database_type")} onChange={e => setConfig({...config, dbType: e.target.value})}>
                  <MenuItem value="oracle">Oracle Database</MenuItem>
                  <MenuItem value="postgresql">PostgreSQL</MenuItem>
                </Select>
              </FormControl>
              
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField label={t("host")} size="small" sx={{ flexGrow: 1 }} value={config.host} onChange={e => setConfig({...config, host: e.target.value})} />
                <TextField label={t("port")} size="small" sx={{ width: 120 }} value={config.port} onChange={e => setConfig({...config, port: e.target.value})} />
              </Box>
              
              <TextField label={t("db_name_service_name")} size="small" fullWidth value={config.database} onChange={e => setConfig({...config, database: e.target.value})} />
              
              {config.dbType === 'oracle' && (
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <FormControlLabel
                    control={
                      <Checkbox 
                        size="small" 
                        checked={config.useOsAuth || false} 
                        onChange={(e) => setConfig({...config, useOsAuth: e.target.checked})} 
                        color="primary" 
                      />
                    }
                    label={<Typography variant="body2" fontWeight="bold" color="text.secondary">{t("os_authentication_external")}</Typography>}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox 
                        size="small" 
                        checked={config.useSysdba || false} 
                        onChange={(e) => setConfig({...config, useSysdba: e.target.checked})} 
                        color="primary" 
                      />
                    }
                    label={<Typography variant="body2" fontWeight="bold" color="text.secondary">{t("log_in_with_sysdba_privilege")}</Typography>}
                  />
                </Box>
              )}

              {config.dbType === 'postgresql' && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <TextField select size="small" label={t('security_tls_mode')} value={config.pgSslMode || 'disable'} onChange={event => setConfig({ ...config, pgSslMode: event.target.value === 'verify-full' ? 'verify-full' : 'disable' })}>
                  <MenuItem value="disable">{t('security_tls_disabled')}</MenuItem>
                  <MenuItem value="verify-full">{t('security_tls_verified')}</MenuItem>
                </TextField>
                {config.pgSslMode === 'verify-full' && <>
                  <TextField size="small" label={t('security_tls_ca_file')} helperText={t('security_tls_ca_help')} value={config.pgSslCaFile || ''} onChange={event => setConfig({ ...config, pgSslCaFile: event.target.value })} />
                  <TextField size="small" label={t('security_tls_server_name')} helperText={t('security_tls_name_help')} value={config.pgSslServerName || ''} onChange={event => setConfig({ ...config, pgSslServerName: event.target.value })} />
                </>}
              </Box>}

              <TextField 
                label={t("username")}
                size="small" 
                fullWidth 
                value={config.user} 
                onChange={e => setConfig({...config, user: e.target.value})} 
                disabled={config.useOsAuth} 
                sx={{ bgcolor: config.useOsAuth ? 'action.disabledBackground' : 'transparent', borderRadius: 1 }}
              />
              <TextField 
                label={t("password")}
                type="password" 
                size="small" 
                fullWidth 
                value={config.password} 
                onChange={e => setConfig({...config, password: e.target.value})} 
                disabled={config.useOsAuth} 
                sx={{ bgcolor: config.useOsAuth ? 'action.disabledBackground' : 'transparent', borderRadius: 1 }}
              />
            </TabPanel>

            <TabPanel value={activeTab} index={1}>
              <FormControlLabel
                control={
                  <Checkbox 
                    checked={config.useSshTunnel || false} 
                    onChange={(e) => setConfig({...config, useSshTunnel: e.target.checked})} 
                    color="primary" 
                  />
                }
                label={<Typography variant="body1" fontWeight="bold">{t("use_ssh_tunnel_port_forwarding")}</Typography>}
                sx={{ mb: 1 }}
              />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, opacity: config.useSshTunnel ? 1 : 0.5, pointerEvents: config.useSshTunnel ? 'auto' : 'none' }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField label={t("ssh_host_bastion_server")} size="small" sx={{ flexGrow: 1 }} value={config.sshHost} onChange={e => setConfig({...config, sshHost: e.target.value})} />
                  <TextField label={t("port")} size="small" sx={{ width: 120 }} value={config.sshPort} onChange={e => setConfig({...config, sshPort: e.target.value})} />
                </Box>

                <TextField label={t("ssh_username")} size="small" fullWidth value={config.sshUser} onChange={e => setConfig({...config, sshUser: e.target.value})} />

                <FormControl component="fieldset">
                  <Typography variant="caption" color="text.secondary">{t("auth_method")}</Typography>
                  <RadioGroup row value={config.sshAuthType} onChange={(e) => setConfig({...config, sshAuthType: e.target.value})}>
                    <FormControlLabel value="password" control={<Radio size="small" />} label={<Typography variant="body2">{t("password")}</Typography>} />
                    <FormControlLabel value="key" control={<Radio size="small" />} label={<Typography variant="body2">{t("private_key_file")}</Typography>} />
                  </RadioGroup>
                </FormControl>

                {config.sshAuthType === 'password' ? (
                  <TextField 
                    label={t("ssh_password")}
                    type="password" 
                    size="small" 
                    fullWidth 
                    value={config.sshPassword} 
                    onChange={e => setConfig({...config, sshPassword: e.target.value})} 
                  />
                ) : (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField 
                      label={t("path_to_private_key_pem_id_rsa_etc")}
                      size="small" 
                      fullWidth 
                      value={config.sshKeyFile} 
                      onChange={e => setConfig({...config, sshKeyFile: e.target.value})} 
                    />
                    <Tooltip title={t("select_file")}>
                      <IconButton color="primary" onClick={handleSelectKeyFile} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                        <FolderOpenIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
                
                {config.sshAuthType === 'key' && (
                  <TextField 
                    label={t("passphrase_if_key_is_protected")}
                    type="password" 
                    size="small" 
                    fullWidth 
                    value={config.sshPassword} 
                    onChange={e => setConfig({...config, sshPassword: e.target.value})} 
                  />
                )}

              </Box>
            </TabPanel>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 1, mt: 'auto', p: { xs: 1.5, md: 4 }, pt: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <FormControlLabel
                control={
                  <Checkbox 
                    size="small" 
                    checked={config.readonly || false} 
                    onChange={(e) => setConfig({...config, readonly: e.target.checked})} 
                    color="primary" 
                  />
                }
                label={<Typography variant="body2" fontWeight="bold" color="text.secondary">{t("connect_as_read_only")}</Typography>}
              />
              <FormControlLabel
                control={<Checkbox checked={shouldSave} onChange={(e) => { draftRevision.current++; setShouldSave(e.target.checked); }} color="primary" />}
                label={<Typography variant="body2" fontWeight="bold">{selectedConnName === '' ? t("save_connection") : t("overwrite_connection")}</Typography>}
              />
            </Box>
            <Button 
              variant="contained" 
              size="large" 
              startIcon={<LoginIcon />} 
              onClick={handleConnect}
              disabled={isConnecting || isReordering || isDeleting}
              sx={{ px: 5, py: 1.5, fontWeight: 'bold' }}
            >
              {t("connect")}
            </Button>
          </Box>
        </Box>
      </Card>

      <Backdrop
        sx={{
          color: 'primary.main',
          backgroundColor: theme.palette.background.default + 'B3',
          zIndex: (theme) => theme.zIndex.drawer + 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5
        }}
        open={isConnecting}
      >
        <CircularProgress sx={{ color: 'primary.main' }} size={50} thickness={4.5} />
        <Typography variant="h6" fontWeight="bold" sx={{ letterSpacing: 1, color: 'primary.main' }}>
          {t("connecting_to_database")}
        </Typography>
      </Backdrop>

    </Box>
  );
}
