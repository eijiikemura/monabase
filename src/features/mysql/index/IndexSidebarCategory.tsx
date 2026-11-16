// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Box, Collapse, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip } from '@mui/material';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import ClearIcon from '@mui/icons-material/Clear';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { ipcRenderer } from '@/shared/api/desktop';
import { navigateSidebar } from '@/features/objects/sidebarNavigation';
import { SidebarCategoryStatus } from '@/features/objects/SidebarCategoryStatus';
import type { MysqlIndexAction } from './useMysqlIndex';
import type { useSidebarTables } from '../useSidebarTables';

export default function IndexSidebarCategory({ indexes, schema, busy, readonly, canOpen, selected, onSelect, onOpen, onCreate }: {
  indexes: ReturnType<typeof useSidebarTables>; schema: string; busy: boolean; readonly: boolean; canOpen: boolean; selected: string;
  onSelect: (key: string) => void; onOpen: (object: DatabaseObject, action?: MysqlIndexAction) => void; onCreate?: (schema: string) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number; object: DatabaseObject } | null>(null);
  const open = indexes.expanded.includes(schema), page = indexes.pages[schema];
  return <>
    <ListItemButton data-sidebar-row data-sidebar-level={2} data-mysql-index-category={schema} aria-expanded={open} onKeyDown={navigateSidebar} onClick={() => indexes.toggle(schema)} sx={{ pl: 4, py: 0.3 }}><ListItemIcon sx={{ minWidth: 28 }}><ViewWeekIcon fontSize="small" sx={{ color: '#ef6c00' }} /></ListItemIcon><ListItemText primary={t('index_2')} />{open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</ListItemButton>
    <Collapse in={open} timeout="auto" unmountOnExit><List dense disablePadding>
      <Box sx={{ display: 'flex', alignItems: 'center', pl: 7, pr: 2, py: 0.5, bgcolor: 'action.hover' }}><TextField size="small" variant="standard" placeholder={t('search', { category: t('index_2') })} inputProps={{ 'aria-label': t('search', { category: t('index_2') }) }} value={page?.filter || ''} onChange={event => indexes.filter(schema, event.target.value)} sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.5 } }} />
        {page?.filter && <Tooltip title={t('sidebar_clear_search')}><IconButton size="small" aria-label={t('sidebar_clear_search')} onClick={() => indexes.filter(schema, '')}><ClearIcon fontSize="small" /></IconButton></Tooltip>}
        <Tooltip title={t('create_index_index')}><span><IconButton size="small" aria-label={t('create_index_index')} disabled={busy || readonly || !canOpen} onClick={() => onCreate?.(schema)}><AddIcon fontSize="small" color="primary" /></IconButton></span></Tooltip>
        <Tooltip title={t('refresh_to_latest_state')}><span><IconButton size="small" aria-label={t('refresh_to_latest_state')} disabled={page?.loading} onClick={() => indexes.refresh(schema)}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
      </Box>
      <SidebarCategoryStatus loading={page?.loading || false} error={page?.error} size={page?.rows?.length} more={page?.more || false} onRetry={() => indexes.retry(schema)} />
      {page?.rows?.map(object => <Tooltip key={object.key} title={object.displayName} placement="right"><ListItemButton data-sidebar-row data-sidebar-object data-sidebar-level={3} data-mysql-index={object.name} data-mysql-index-table={object.parentName} selected={selected === object.key} aria-current={selected === object.key ? 'true' : undefined} onKeyDown={navigateSidebar} onClick={() => onSelect(object.key)} onDoubleClick={() => { if (!busy && canOpen) onOpen(object); }} onContextMenu={event => { event.preventDefault(); onSelect(object.key); setMenu({ x: event.clientX, y: event.clientY, object }); }} sx={{ pl: 7, py: 0.2 }}><ListItemIcon sx={{ minWidth: 28 }}><ViewWeekIcon fontSize="small" /></ListItemIcon><ListItemText primary={object.displayName} primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }} /></ListItemButton></Tooltip>)}
      {page?.rows?.length === 0 && !page.loading && !page.error && <ListItemText primary={t('no_matching_results')} sx={{ pl: 7, color: 'text.disabled' }} />}
      {page?.more && <ListItemButton disabled={page.loading || page.filter !== page.applied} onClick={() => indexes.more(schema)} sx={{ justifyContent: 'center', bgcolor: 'action.hover' }}><ListItemText primary={t('show_100_more')} primaryTypographyProps={{ fontSize: '0.8rem', color: 'primary', textAlign: 'center' }} /></ListItemButton>}
    </List></Collapse>
    <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}>
      <MenuItem disabled={busy || !canOpen} onClick={() => { if (menu) onOpen(menu.object); setMenu(null); }}><ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>{t('open')}</MenuItem>
      <MenuItem onClick={() => { const name = menu?.object.name; setMenu(null); if (name) void ipcRenderer.invoke('copy-to-clipboard', name).then(copied => { if (!copied) window.alert(t('cell_value_copy_failed')); }).catch(() => window.alert(t('cell_value_copy_failed'))); }}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>{t('mysql_index_copy_name')}</MenuItem>
      {(['rename', 'visibility', 'delete'] as const).map(action => <MenuItem key={action} disabled={busy || readonly || !canOpen || menu?.object.name === 'PRIMARY'} onClick={() => { if (menu) onOpen(menu.object, action); setMenu(null); }}>{t(action === 'visibility' ? 'mysql_index_toggle_visibility' : action === 'rename' ? 'mysql_index_rename' : 'delete')}</MenuItem>)}
      <MenuItem disabled={busy || readonly || !canOpen} onClick={() => { setMenu(null); onCreate?.(schema); }}><ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>{t('create_index_index')}</MenuItem>
      <MenuItem disabled={page?.loading} onClick={() => { setMenu(null); indexes.refresh(schema); }}><ListItemIcon><RefreshIcon fontSize="small" /></ListItemIcon>{t('refresh')}</MenuItem>
    </Menu>
  </>;
}
