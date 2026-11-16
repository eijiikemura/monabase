// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Box, Collapse, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip } from '@mui/material';
import FunctionsIcon from '@mui/icons-material/Functions';
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
import type { useSidebarTables } from '../useSidebarTables';

export default function ProcedureSidebarCategory({ procedures, schema, busy, readonly, canOpen, selected, onSelect, onOpen, onCreate }: {
  procedures: ReturnType<typeof useSidebarTables>; schema: string; busy: boolean; readonly: boolean; canOpen: boolean; selected: string;
  onSelect: (key: string) => void; onOpen: (object: DatabaseObject, action?: 'delete') => void;
  onCreate: (schema: string) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number; object: DatabaseObject } | null>(null);
  const open = procedures.expanded.includes(schema), page = procedures.pages[schema];
  const create = () => onCreate(schema);
  return <>
    <ListItemButton data-sidebar-row data-sidebar-level={2} data-mysql-procedure-category={schema} aria-expanded={open} onKeyDown={navigateSidebar} onClick={() => procedures.toggle(schema)} sx={{ pl: 4, py: 0.3 }}>
      <ListItemIcon sx={{ minWidth: 28 }}><FunctionsIcon color="primary" fontSize="small" /></ListItemIcon><ListItemText primary={t('procedure')} />{open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
    </ListItemButton>
    <Collapse in={open} timeout="auto" unmountOnExit><List dense disablePadding>
      <Box sx={{ display: 'flex', alignItems: 'center', pl: 7, pr: 2, py: 0.5, bgcolor: 'action.hover' }}>
        <TextField size="small" variant="standard" placeholder={t('search', { category: t('procedure') })} inputProps={{ 'aria-label': t('search', { category: t('procedure') }) }} value={page?.filter || ''} onChange={event => procedures.filter(schema, event.target.value)} sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.5 } }} />
        {page?.filter && <Tooltip title={t('sidebar_clear_search')}><IconButton size="small" aria-label={t('sidebar_clear_search')} onClick={() => procedures.filter(schema, '')}><ClearIcon fontSize="small" /></IconButton></Tooltip>}
        <Tooltip title={t('create_procedure')}><span><IconButton size="small" aria-label={t('create_procedure')} disabled={busy || readonly || !canOpen} onClick={create}><AddIcon color="primary" fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title={t('refresh_to_latest_state')}><span><IconButton size="small" aria-label={t('refresh_to_latest_state')} disabled={page?.loading} onClick={() => procedures.refresh(schema)}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
      </Box>
      <SidebarCategoryStatus loading={page?.loading || false} error={page?.error} size={page?.rows?.length} more={page?.more || false} onRetry={() => procedures.retry(schema)} />
      {page?.rows?.map(object => <Tooltip key={object.key} title={object.name} placement="right"><ListItemButton data-sidebar-row data-sidebar-object data-sidebar-level={3} data-mysql-procedure={object.name} selected={selected === object.key} aria-current={selected === object.key ? 'true' : undefined} onKeyDown={navigateSidebar} onClick={() => onSelect(object.key)} onDoubleClick={() => { if (!busy && canOpen) onOpen(object); }} onContextMenu={event => { event.preventDefault(); onSelect(object.key); setMenu({ x: event.clientX, y: event.clientY, object }); }} sx={{ pl: 7, py: 0.2 }}>
        <ListItemIcon sx={{ minWidth: 28 }}><FunctionsIcon fontSize="small" /></ListItemIcon><ListItemText primary={object.name} primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }} />
      </ListItemButton></Tooltip>)}
      {page?.rows?.length === 0 && !page.loading && !page.error && <ListItemText primary={t('no_matching_results')} sx={{ pl: 7, color: 'text.disabled' }} />}
      {page?.more && <ListItemButton disabled={page.loading || page.filter !== page.applied} onClick={() => procedures.more(schema)} sx={{ justifyContent: 'center', bgcolor: 'action.hover' }}><ListItemText primary={t('show_100_more')} primaryTypographyProps={{ fontSize: '0.8rem', textAlign: 'center', color: 'primary' }} /></ListItemButton>}
    </List></Collapse>
    <Menu data-testid="mysql-procedure-menu" open={Boolean(menu)} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}>
      <MenuItem disabled={busy || !canOpen} onClick={() => { if (menu) onOpen(menu.object); setMenu(null); }}>{t('open')}</MenuItem>
      <MenuItem onClick={() => { const name = menu?.object.name; setMenu(null); if (name) void ipcRenderer.invoke('copy-to-clipboard',name).then(ok => { if (!ok) window.alert(t('cell_value_copy_failed')); }).catch(() => window.alert(t('cell_value_copy_failed'))); }}>{t('mysql_procedure_copy_name')}</MenuItem>
      <MenuItem disabled={busy || readonly || !canOpen} onClick={() => { if (menu) onOpen(menu.object,'delete'); setMenu(null); }}>{t('delete')}</MenuItem>
    </Menu>
  </>;
}
