// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Box, Collapse, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip } from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import { useTranslation } from 'react-i18next';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { ipcRenderer } from '@/shared/api/desktop';
import { navigateSidebar } from '@/features/objects/sidebarNavigation';
import { SidebarCategoryStatus } from '@/features/objects/SidebarCategoryStatus';
import { mysqlTableName } from '../table/tableModel';
import type { useSidebarTables } from '../useSidebarTables';

export default function ViewSidebarCategory({ views, schema, busy, readonly, canOpen, selected, onSelect, onOpen, onSql, onExport }: {
  views: ReturnType<typeof useSidebarTables>; schema: string; busy: boolean; readonly: boolean; canOpen: boolean; selected: string;
  onSelect: (key: string) => void; onOpen: (object: DatabaseObject, action?: 'delete') => void;
  onSql: (schema: string, sql?: string) => void; onExport: (object: DatabaseObject) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number; object: DatabaseObject } | null>(null);
  const open = views.expanded.includes(schema), page = views.pages[schema];
  const create = () => onSql(schema, `CREATE VIEW ${mysqlTableName(schema, 'NEW_VIEW_NAME')} AS\nSELECT * FROM ${mysqlTableName(schema, 'table_name')};\n`);
  return <>
    <ListItemButton data-sidebar-row data-sidebar-level={2} data-mysql-view-category={schema} aria-expanded={open} onKeyDown={navigateSidebar} onClick={() => views.toggle(schema)} sx={{ pl: 4, py: 0.3 }}>
      <ListItemIcon sx={{ minWidth: 28 }}><ViewListIcon color="primary" fontSize="small" /></ListItemIcon><ListItemText primary={t('view_2')} />{open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
    </ListItemButton>
    <Collapse in={open} timeout="auto" unmountOnExit><List dense disablePadding>
      <Box sx={{ display: 'flex', alignItems: 'center', pl: 7, pr: 2, py: 0.5, bgcolor: 'action.hover' }}>
        <TextField size="small" variant="standard" placeholder={t('search', { category: t('view_2') })} inputProps={{ 'aria-label': t('search', { category: t('view_2') }) }} value={page?.filter || ''} onChange={event => views.filter(schema, event.target.value)} sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.5 } }} />
        {page?.filter && <Tooltip title={t('sidebar_clear_search')}><IconButton size="small" aria-label={t('sidebar_clear_search')} onClick={() => views.filter(schema, '')}><ClearIcon fontSize="small" /></IconButton></Tooltip>}
        <Tooltip title={t('new_view_opens_sql_window')}><span><IconButton size="small" aria-label={t('new_view_opens_sql_window')} disabled={busy || readonly || !canOpen} onClick={create}><AddIcon color="primary" fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title={t('refresh_to_latest_state')}><span><IconButton size="small" aria-label={t('refresh_to_latest_state')} disabled={page?.loading} onClick={() => views.refresh(schema)}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
      </Box>
      <SidebarCategoryStatus loading={page?.loading || false} error={page?.error} size={page?.rows?.length} more={page?.more || false} onRetry={() => views.retry(schema)} />
      {page?.rows?.map(object => <Tooltip key={object.key} title={object.name} placement="right"><ListItemButton data-sidebar-row data-sidebar-object data-sidebar-level={3} data-mysql-view={object.name} selected={selected === object.key} aria-current={selected === object.key ? 'true' : undefined} onKeyDown={navigateSidebar} onClick={() => onSelect(object.key)} onDoubleClick={() => { if (!busy && canOpen) onOpen(object); }} onContextMenu={event => { event.preventDefault(); onSelect(object.key); setMenu({ x: event.clientX, y: event.clientY, object }); }} sx={{ pl: 7, py: 0.2 }}>
        <ListItemIcon sx={{ minWidth: 28 }}><ViewListIcon fontSize="small" /></ListItemIcon><ListItemText primary={object.name} primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }} />
      </ListItemButton></Tooltip>)}
      {page?.rows?.length === 0 && !page.loading && !page.error && <ListItemText primary={t('no_matching_results')} sx={{ pl: 7, color: 'text.disabled' }} />}
      {page?.more && <ListItemButton disabled={page.loading || page.filter !== page.applied} onClick={() => views.more(schema)} sx={{ justifyContent: 'center', bgcolor: 'action.hover' }}><ListItemText primary={t('show_100_more')} primaryTypographyProps={{ fontSize: '0.8rem', textAlign: 'center', color: 'primary' }} /></ListItemButton>}
    </List></Collapse>
    <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}>
      <MenuItem disabled={busy || !canOpen} onClick={() => { if (menu) onOpen(menu.object); setMenu(null); }}>{t('open')}</MenuItem>
      <MenuItem disabled={busy || !canOpen} onClick={() => { if (menu) onSql(schema, `SELECT * FROM ${mysqlTableName(schema,menu.object.name)};`); setMenu(null); }}>{t('open_in_sql_window')}</MenuItem>
      <MenuItem onClick={() => { const name = menu?.object.name; setMenu(null); if (name) void ipcRenderer.invoke('copy-to-clipboard',name).then(ok => { if (!ok) window.alert(t('cell_value_copy_failed')); }).catch(() => window.alert(t('cell_value_copy_failed'))); }}>{t('mysql_view_copy_name')}</MenuItem>
      <MenuItem disabled={busy} onClick={() => { if (menu) onExport(menu.object); setMenu(null); }}>{t('export')}</MenuItem>
      <MenuItem disabled={busy || readonly || !canOpen} onClick={() => { if (menu) onOpen(menu.object,'delete'); setMenu(null); }}>{t('delete')}</MenuItem>
    </Menu>
  </>;
}
