// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Fragment, useEffect, useRef, useState } from 'react';
import { Alert, Box, Collapse, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, TextField, Tooltip, Typography } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import TableChartIcon from '@mui/icons-material/TableChart';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import TerminalIcon from '@mui/icons-material/Terminal';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import type { DatabaseObject, ObjectCategory } from '@/shared/types/objectTypes';
import type { TransactionState } from '@/shared/api/desktopContract';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { navigateSidebar } from '@/features/objects/sidebarNavigation';
import { SidebarCategoryStatus } from '@/features/objects/SidebarCategoryStatus';
import ImportDialog from '@/components/data/ImportDialog';
import ExportDialog from '@/components/data/ExportDialog';
import { runGitOperation } from '@/features/git/gitOperation';
import { useSidebarTables } from './useSidebarTables';
import type { MysqlIndexAction } from './index/useMysqlIndex';
import FunctionSidebarCategory from './function/FunctionSidebarCategory';
import ProcedureSidebarCategory from './procedure/ProcedureSidebarCategory';
import TriggerSidebarCategory from './trigger/TriggerSidebarCategory';
import ViewSidebarCategory from './view/ViewSidebarCategory';
import IndexSidebarCategory from './index/IndexSidebarCategory';
import SidebarTableDialog from './SidebarTableDialog';
import { mainTransferQuery, prepareMysqlTransfer, createMysqlSidebarExport, importMysqlSidebarRows } from './sidebarDataTransfer';
import type { SidebarTableAction } from './sidebarTableActions';
import { loadTableMetadata } from './table/tableRepository';
import { mysqlTableName, type MysqlColumn, type MysqlStatement } from './table/tableModel';

interface Props {
  open: boolean; width: number; schemas: string[]; database: string; busy: boolean; disabled: boolean;
  readonly: boolean; canOpen: boolean; outputDateFormat: string; selected?: DatabaseObject;
  onToggle: () => void; onOpenSql: (schema: string, sql?: string) => void; onCreateTable: (schema: string) => void; onCreateIndex?: (schema: string) => void; onCreateTrigger?: (schema: string) => void; onCreateProcedure?: (schema:string)=>void; onCreateFunction?: (schema:string)=>void;
  onOpenObject: (object: DatabaseObject, action?: MysqlIndexAction) => void; onOpenCategory: (schema: string, category: ObjectCategory) => void;
  setBusy: (value: boolean) => void; onState: (state: TransactionState) => void;
}
type Transfer = Awaited<ReturnType<typeof prepareMysqlTransfer>> & {
  id: string; object: DatabaseObject; kind: 'import' | 'export'; count: number;
  fetch: ReturnType<typeof createMysqlSidebarExport>;
};


export default function Sidebar(props: Props) {
  const { open, width, database, busy, disabled, readonly, canOpen, onOpenObject, onOpenSql, onToggle } = props;
  const { t } = useTranslation();
  const tables = useSidebarTables(), indexes = useSidebarTables('INDEX'), views = useSidebarTables('VIEW'), triggers = useSidebarTables('TRIGGER'), procedures=useSidebarTables('PROCEDURE'),functions=useSidebarTables('FUNCTION');
  const [expanded, setExpanded] = useState<string[]>([database]), [selected, setSelected] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; object: DatabaseObject } | null>(null);
  const [action, setAction] = useState<{ target: DatabaseObject; type: SidebarTableAction; columns: MysqlColumn[] } | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null), [error, setError] = useState('');
  const running = useRef(false), mounted = useRef(true), transferHost = useRef<HTMLDivElement>(null), openedTransfer = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (props.selected) setSelected(props.selected.key); }, [props.selected]);
  useEffect(() => {
    if (transfer && !busy && openedTransfer.current !== transfer.id) {
      const button = transferHost.current?.querySelector('button');
      if (button) { openedTransfer.current = transfer.id; button.click(); }
    }
  }, [transfer, busy]);
  const names = [...new Set([database, ...props.schemas])].filter(name => name === database || !['mysql', 'information_schema', 'performance_schema', 'sys'].includes(name.toLowerCase()));
  const blocked = busy || disabled;
  const mutationsBlocked = blocked || readonly;
  const perform = async (work: () => Promise<void>) => {
    if (running.current || blocked) return;
    running.current = true; props.setBusy(true); setError('');
    try { await work(); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : t('execution_failed')); }
    finally { running.current = false; props.setBusy(false); }
  };
  const prepareAction = (type: SidebarTableAction) => {
    const target = menu?.object; setMenu(null);
    if (!target || mutationsBlocked) return;
    void perform(async () => {
      const metadata = type === 'copy' ? await loadTableMetadata(target.schema, target.name) : undefined;
      if (mounted.current) setAction({ target, type, columns: metadata?.columns || [] });
    });
  };
  const executeAction = async (statement: MysqlStatement, newName: string) => {
    if (!action || mutationsBlocked) return false;
    let applied = false;
    const target = action.target;
    await perform(async () => {
      const result = await mainTransferQuery(statement.sql, statement.binds, props.onState);
      const failure = result.rows.find(row => String(row.Msg_type).toLowerCase() === 'error');
      if (failure) throw new Error(String(failure.Msg_text));
      applied = true;
      if (action.type === 'rename' || action.type === 'drop') {
        window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: target.schema, objectName: target.name, objectType: 'TABLE', ...(action.type === 'rename' ? { reason: 'rename' as const } : {}) } }));
        const gitResult = action.type === 'rename'
          ? await runGitOperation(t, 'git-rename-object', { dbType: 'MYSQL', schema: target.schema, objectType: 'TABLE', oldName: target.name, newName })
          : await runGitOperation(t, 'git-delete-object', { dbType: 'MYSQL', schema: target.schema, objectType: 'TABLE', objectName: target.name });
        if (!gitResult.success) setError(t('mysql_sidebar_database_applied_git_failed'));
      }
    });
    window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: target.schema, objType: 'TABLE' } }));
    window.dispatchEvent(new Event('mysql-transaction-finished'));
    window.dispatchEvent(new CustomEvent('reload-statistics', { detail: { schema: target.schema, tableName: target.name } }));
    return applied;
  };
  const prepareTransfer = (kind: 'import' | 'export', supplied?: DatabaseObject) => {
    const object = supplied || menu?.object; setMenu(null);
    if (!object || blocked || kind === 'import' && readonly) return;
    void perform(async () => {
      const prepared = await prepareMysqlTransfer(object.schema, object.name, props.outputDateFormat);
      if (kind === 'import' && prepared.metadata.table.ENGINE?.toLowerCase() !== 'innodb') throw new Error('Inserts require an InnoDB table.');
      let count = 0;
      if (kind === 'export') {
        const response = await mainTransferQuery(`SELECT COUNT(*) AS total FROM ${mysqlTableName(object.schema, object.name)}`, {}, props.onState);
        const value = String(response.rows[0]?.total ?? '');
        if (!/^\d+$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(t('failed_to_fetch_row_count'));
        count = Number(value);
      }
      if (mounted.current) setTransfer({ ...prepared, id: crypto.randomUUID(), object, kind, count, fetch: createMysqlSidebarExport(object.schema, object.name, prepared.metadata, prepared.formatRows, props.onState, props.setBusy) });
    });
  };
  const openContext = (event: React.MouseEvent, object: DatabaseObject) => {
    event.preventDefault(); setSelected(object.key); setMenu({ x: event.clientX, y: event.clientY, object });
  };
  const importRows = async (records: string[][], progress: (percent: number, text: string) => void, header: boolean) => {
    if (!transfer || running.current || blocked || readonly) throw new Error(t('mysql_table_edit_unavailable'));
    running.current = true; props.setBusy(true); setError('');
    try { await importMysqlSidebarRows(transfer.object.schema, transfer.object.name, transfer.metadata, records, header, progress, props.onState, t); }
    finally { running.current = false; props.setBusy(false); window.dispatchEvent(new Event('mysql-transaction-finished')); }
  };
  return <>
    <Paper component="aside" aria-label={t('db_objects')} square elevation={0} sx={{ width: open ? width : 56, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: open ? 'space-between' : 'center', p: 1, minHeight: 48, flexShrink: 0 }}>
        {open && <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.secondary', whiteSpace: 'nowrap' }}>{t('db_objects')}</Typography>}
        <Tooltip title={t(open ? 'sidebar_collapse' : 'sidebar_expand')}><IconButton size="small" aria-label={t(open ? 'sidebar_collapse' : 'sidebar_expand')} onClick={onToggle}>{open ? <ChevronLeftIcon /> : <ChevronRightIcon />}</IconButton></Tooltip>
      </Box>
      <Divider />
      <Box data-sidebar-list sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: open ? 'block' : 'none' }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        <List dense disablePadding>{names.map(schema => {
          const schemaOpen = expanded.includes(schema), tableOpen = tables.expanded.includes(schema), page = tables.pages[schema];
          return <Fragment key={schema}>
            <ListItemButton data-sidebar-row data-sidebar-level={1} aria-expanded={schemaOpen} onKeyDown={navigateSidebar} onClick={() => setExpanded(previous => previous.includes(schema) ? previous.filter(name => name !== schema) : [...previous, schema])} sx={{ py: 0.5, px: 2 }}>
              <ListItemIcon sx={{ minWidth: 0, mr: 2 }}><PersonIcon color="primary" fontSize="small" /></ListItemIcon><ListItemText primary={schema} primaryTypographyProps={{ noWrap: true }} />{schemaOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </ListItemButton>
            <Collapse in={schemaOpen} timeout="auto" unmountOnExit><List dense disablePadding>
              <ListItemButton data-sidebar-row data-sidebar-level={2} data-mysql-table-category={schema} aria-expanded={tableOpen} onKeyDown={navigateSidebar} onClick={() => tables.toggle(schema)} sx={{ pl: 4, py: 0.3 }}>
                <ListItemIcon sx={{ minWidth: 28 }}><TableChartIcon fontSize="small" sx={{ color: '#0d47a1' }} /></ListItemIcon><ListItemText primary={t('table_2')} />{tableOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
              </ListItemButton>
              <Collapse in={tableOpen} timeout="auto" unmountOnExit><List dense disablePadding>
                <Box sx={{ display: 'flex', alignItems: 'center', pl: 7, pr: 2, py: 0.5, bgcolor: 'action.hover' }}>
                  <TextField size="small" variant="standard" placeholder={t('search', { category: t('table_2') })} inputProps={{ 'aria-label': t('search', { category: t('table_2') }) }} value={page?.filter || ''} onChange={event => tables.filter(schema, event.target.value)} sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.5 } }} />
                  {page?.filter && <Tooltip title={t('sidebar_clear_search')}><IconButton size="small" aria-label={t('sidebar_clear_search')} onClick={() => tables.filter(schema, '')}><ClearIcon fontSize="small" /></IconButton></Tooltip>}
                  <Tooltip title={t('create_new_table')}><span><IconButton aria-label={t('create_new_table')} size="small" disabled={mutationsBlocked || !canOpen} onClick={() => props.onCreateTable(schema)}><AddIcon fontSize="small" color="primary" /></IconButton></span></Tooltip>
                  <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} size="small" disabled={page?.loading} onClick={() => tables.refresh(schema)}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
                </Box>
                <SidebarCategoryStatus loading={page?.loading || false} error={page?.error} size={page?.rows?.length} more={page?.more || false} onRetry={() => tables.retry(schema)} />
                {page?.rows?.map(object => <Tooltip key={object.key} title={object.name} placement="right"><ListItemButton data-sidebar-row data-sidebar-object data-sidebar-level={3} data-mysql-table={object.name} aria-current={selected === object.key ? 'true' : undefined} selected={selected === object.key} onKeyDown={navigateSidebar} onClick={() => setSelected(object.key)} onDoubleClick={() => { if (!blocked && canOpen) { setSelected(object.key); onOpenObject(object); } }} onContextMenu={event => openContext(event, object)} sx={{ pl: 7, py: 0.2 }}>
                  <ListItemIcon sx={{ minWidth: 28 }}><TableChartIcon fontSize="small" /></ListItemIcon><ListItemText primary={object.name} primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }} />
                </ListItemButton></Tooltip>)}
                {page?.rows?.length === 0 && !page.loading && !page.error && <ListItemText primary={t('no_matching_results')} sx={{ pl: 7, py: 0.3, color: 'text.disabled', fontStyle: 'italic', '& .MuiListItemText-primary': { fontSize: '0.8rem' } }} />}
                {page?.more && <ListItemButton disabled={page.loading || page.filter !== page.applied} onClick={() => tables.more(schema)} sx={{ justifyContent: 'center', py: 1, bgcolor: 'action.hover' }}><ListItemText primary={t('show_100_more')} primaryTypographyProps={{ fontSize: '0.8rem', color: 'primary', textAlign: 'center', fontWeight: 'bold' }} /></ListItemButton>}
              </List></Collapse>
              <ProcedureSidebarCategory procedures={procedures} schema={schema} busy={blocked} readonly={readonly} canOpen={canOpen} selected={selected} onSelect={setSelected} onOpen={onOpenObject} onCreate={schema=>props.onCreateProcedure?.(schema)}/>
              <TriggerSidebarCategory triggers={triggers} schema={schema} busy={blocked} readonly={readonly} canOpen={canOpen} selected={selected} onSelect={setSelected} onOpen={onOpenObject} onCreate={schema => props.onCreateTrigger?.(schema)} />
              <ViewSidebarCategory views={views} schema={schema} busy={blocked} readonly={readonly} canOpen={canOpen} selected={selected} onSelect={setSelected} onOpen={onOpenObject} onSql={onOpenSql} onExport={object => prepareTransfer('export',object)} />
              <IndexSidebarCategory indexes={indexes} schema={schema} busy={blocked} readonly={readonly} canOpen={canOpen} selected={selected} onSelect={setSelected} onOpen={onOpenObject} onCreate={props.onCreateIndex} />
              <FunctionSidebarCategory functions={functions} schema={schema} busy={blocked} readonly={readonly} canOpen={canOpen} selected={selected} onSelect={setSelected} onOpen={onOpenObject} onCreate={schema=>props.onCreateFunction?.(schema)}/>
            </List></Collapse>
          </Fragment>;
        })}</List>
      </Box>
    </Paper>
    <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}>
      <MenuItem disabled={blocked || !canOpen} onClick={() => { if (menu) onOpenObject(menu.object); setMenu(null); }}><ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>{t('open')}</MenuItem>
      <MenuItem disabled={blocked || !canOpen} onClick={() => { if (menu) onOpenSql(menu.object.schema, `SELECT * FROM ${mysqlTableName(menu.object.schema, menu.object.name)};`); setMenu(null); }}><ListItemIcon><TerminalIcon fontSize="small" /></ListItemIcon>{t('open_in_sql_window')}</MenuItem>
      <Divider />
      <MenuItem onClick={() => { const name = menu?.object.name; setMenu(null); if (name) void ipcRenderer.invoke('copy-to-clipboard', name).then(copied => { if (!copied) setError(t('cell_value_copy_failed')); }).catch(() => setError(t('cell_value_copy_failed'))); }}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>{t('copy_table_name')}</MenuItem>
      <Divider />
      <MenuItem disabled={mutationsBlocked} onClick={() => prepareAction('rename')}>{t('rename_table')}</MenuItem><MenuItem disabled={mutationsBlocked} onClick={() => prepareAction('copy')}>{t('copy_table')}</MenuItem><MenuItem disabled={mutationsBlocked} onClick={() => prepareAction('analyze')}>{t('gather_stats_analyze_2')}</MenuItem>
      <Divider />
      <MenuItem disabled={mutationsBlocked} onClick={() => prepareTransfer('import')}><ListItemIcon><FileUploadIcon fontSize="small" color="primary" /></ListItemIcon>{t('import')}</MenuItem><MenuItem disabled={blocked} onClick={() => prepareTransfer('export')}><ListItemIcon><FileDownloadIcon fontSize="small" color="primary" /></ListItemIcon>{t('export')}</MenuItem>
      <Divider />
      <MenuItem disabled={mutationsBlocked} sx={{ color: 'error.main' }} onClick={() => prepareAction('truncate')}><ListItemIcon><DeleteSweepIcon fontSize="small" color="error" /></ListItemIcon>{t('truncate')}</MenuItem><MenuItem disabled={mutationsBlocked} sx={{ color: 'error.main' }} onClick={() => prepareAction('drop')}><ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>{t('drop')}</MenuItem>
    </Menu>
    {action && <SidebarTableDialog key={JSON.stringify([action.target.key, action.type])} target={action.target} action={action.type} columns={action.columns} busy={busy} failureMessage={error} onClose={() => setAction(null)} onExecute={executeAction} />}
    <Box ref={transferHost} sx={{ display: 'none' }}>{transfer && (transfer.kind === 'import'
      ? <ImportDialog key={transfer.id} targetKey={transfer.object.key} columns={transfer.metadata.columns.filter(column => !column.GENERATION_EXPRESSION).map(column => column.COLUMN_NAME)} tableName={transfer.object.name} onImport={importRows} />
      : <ExportDialog key={transfer.id} columns={transfer.columns} rows={[]} defaultFileName={transfer.object.name + '_export'} tableName={transfer.object.name} totalCount={transfer.count} fetchDataChunk={transfer.fetch} iconType="download" />)}</Box>
  </>;
}
