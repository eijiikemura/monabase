// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Box, Button, Collapse, Paper, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ColumnEditorDialog from './ColumnEditorDialog';
import {structureRows,type MysqlUniquePosition} from './tableStructureModel';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';
import VerticalSplit from '../VerticalSplit';
import { GridViewport } from '@/features/data-grid/GridViewport';
import ExportDialog from '@/components/data/ExportDialog';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import { autoIncrementColumn, autoIncrementMaximum } from './tableModel';
import { type TableDdlAction, type TableDdlInput } from './tableDdl';
import TableDdlDialog from './TableDdlDialog';
import type { MysqlTableProps, useMysqlTable } from './useMysqlTable';

export default function TableMetadataTab({ mode, controller: c, props }: { mode: 'structure' | 'relation' | 'statistics'; controller: ReturnType<typeof useMysqlTable>; props: MysqlTableProps }) {
  const { t, i18n } = useTranslation();
  const [dialog, setDialog] = useState<TableDdlInput | null>(null);
  const [columnEditor,setColumnEditor]=useState<{name?:string}|null>(null);
  const [expanded,setExpanded]=useState({checks:false,triggers:false});
  const metadata = c.metadata;
  if (!metadata) return null;
  const autoColumn = autoIncrementColumn(metadata);
  const locked = props.busy || props.disabled, readonly = props.readonly || locked;
  const open = (action: TableDdlAction, name = '', value = '') => setDialog({ action, name, value, type: 'VARCHAR(100)', nullable: true, unique: false, columns: [], targetSchema: props.schema, targetTable: '', targetColumns: [], deleteRule: 'RESTRICT', updateRule: 'RESTRICT' });
  const col = (field: string, label = field): GridColDef => ({ field, headerName: label, width: 170, minWidth: 100, renderCell: params => <Tooltip title={String(params.value ?? '')}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(params.value ?? '')}</span></Tooltip> });
  const remove = (action: TableDdlAction): GridColDef => ({ field: '__actions', headerName: t('action'), width: 100, sortable: false, renderCell: params => <Tooltip title={t('drop')}><span><Button size="small" color="error" disabled={readonly || action === 'drop-index' && params.row.INDEX_NAME === 'PRIMARY'} onClick={() => open(action, String(params.row.INDEX_NAME ?? params.row.CONSTRAINT_NAME))}><DeleteOutlineIcon fontSize="small" /></Button></span></Tooltip> });
  const section = (title: string, rows: object[], columns: GridColDef[], action?: () => void, bounded = false, category?:'checks'|'triggers') => {
    const grid = <DataGrid autoHeight={!bounded} rows={rows.map((row, id) => ({ ...row, __gridId: id }))} getRowId={row => row.__gridId}
      columns={columns} density="compact" disableRowSelectionOnClick pageSizeOptions={[100]}
      initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
      localeText={(i18n.resolvedLanguage || i18n.language).startsWith('ja') ? jaJP.components.MuiDataGrid.defaultProps.localeText : enUS.components.MuiDataGrid.defaultProps.localeText}
      sx={{ border: 0, flex: bounded ? 1 : undefined, minHeight: 0 }} />;
    return <Paper sx={{ mb: bounded ? 0 : 1, flex: bounded ? 1 : undefined, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', flexShrink: 0 }}>
        {category?<Button data-testid={'mysql-structure-'+category} aria-expanded={expanded[category]} aria-controls={'mysql-structure-'+category+'-body'} sx={{flex:1,justifyContent:'flex-start'}} startIcon={<ExpandMoreIcon sx={{transform:expanded[category]?'rotate(180deg)':undefined}}/>} onClick={()=>setExpanded(value=>({...value,[category]:!value[category]}))}>{title}</Button>:<Typography variant="subtitle2" sx={{ flex: 1 }}>{title}</Typography>}
        {action && <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={readonly} onClick={action}>{t('add')}</Button>}
        <ExportDialog rows={rows} columns={columns.filter(column => column.field !== '__actions')} defaultFileName={props.table + '_' + mode} disabled={locked} />
      </Box>
      {category?<Collapse in={expanded[category]} unmountOnExit><Box id={'mysql-structure-'+category+'-body'}>{props.active&&grid}</Box></Collapse>:bounded ? <GridViewport active={props.active}>{grid}</GridViewport> : props.active && grid}
    </Paper>;
  };
  const relationGroups = new Map<string, DatabaseRow>();
  metadata.relations.forEach(relation => {
    const key = JSON.stringify([relation.CONSTRAINT_SCHEMA, relation.TABLE_NAME, relation.CONSTRAINT_NAME]);
    const existing = relationGroups.get(key);
    if (existing) { existing.SOURCE_COLUMNS += ', ' + relation.COLUMN_NAME; existing.TARGET_COLUMNS += ', ' + relation.REFERENCED_COLUMN_NAME; }
    else relationGroups.set(key, { ...relation, SOURCE_COLUMNS: relation.COLUMN_NAME, TARGET_COLUMNS: relation.REFERENCED_COLUMN_NAME,
      DIRECTION: relation.TABLE_SCHEMA === props.schema && relation.TABLE_NAME === props.table ? t('mysql_table_outgoing') : t('mysql_table_incoming') });
  });
  return <Box data-testid={'mysql-table-' + mode} sx={{ p: 1, flex: 1, minHeight: 0, overflow: mode === 'relation' ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
      <Typography variant="body2" sx={{ flex: 1 }}>{metadata.table.TABLE_COMMENT || props.table} · {metadata.table.ENGINE} · {metadata.table.TABLE_COLLATION}</Typography>
      <Button variant="outlined" size="small" startIcon={<RefreshIcon />} disabled={locked} onClick={() => void c.refresh(false)}>{t('refresh')}</Button>
      {mode === 'structure' && <><Button variant="outlined" size="small" startIcon={<EditIcon />} disabled={readonly} onClick={() => open('comment', '', metadata.table.TABLE_COMMENT)}>{t('change_table_comment')}</Button><Button variant="outlined" color="error" size="small" startIcon={<DeleteOutlineIcon />} disabled={readonly} onClick={() => open('drop-table')}>{t('drop_table')}</Button></>}
    </Box>
    {mode === 'structure' && <>

      <VerticalSplit name="structure" active={props.active} initialHeight={300} upper={section(t('structure'), structureRows(metadata), [col('ORDINAL_POSITION', 'No.'), col('COLUMN_NAME', t('column_name')), col('TYPE_DISPLAY', t('data_type')), col('LENGTH_PRECISION',t('length_precision')), {...col('PK_DISPLAY','PK'),width:65,minWidth:50,renderCell:params=><span style={{color:params.row.IS_PK_COMPOSITE?'#8e24aa':'#d32f2f',fontWeight:700}}>{params.value}</span>}, {field:'UK_DATA',headerName:'UK',width:90,minWidth:65,sortable:false,renderCell:params=><Box sx={{display:'flex',gap:1}}>{(params.value as MysqlUniquePosition[]).map(item=><Tooltip key={item.name} title={item.name+(item.prefix?' · '+item.prefix:'')}><span style={{color:item.composite?'#7b1fa2':'#1976d2',fontWeight:700}}>{item.position}</span></Tooltip>)}</Box>}, col('NULLABLE_DISPLAY', t('allow_nulls')), col('COLUMN_DEFAULT', t('default_value')), col('COLUMN_COMMENT', t('comment')), { field: '__actions', headerName: t('action'), width: 180, sortable: false, renderCell: params => <Box sx={{ display: 'flex' }}><Tooltip title={t('change_definition_of_this_column')}><span><Button disabled={readonly} onClick={() => setColumnEditor({name:params.row.COLUMN_NAME})}><EditIcon fontSize="small" /></Button></span></Tooltip><Tooltip title={t('drop_this_column')}><span><Button color="error" disabled={readonly} onClick={() => open('drop-column', params.row.COLUMN_NAME)}><DeleteOutlineIcon fontSize="small" /></Button></span></Tooltip></Box> }], () => setColumnEditor({}), true)} lower={<Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Paper variant="outlined" data-testid="mysql-auto-increment" sx={{p:1,mb:1,flexShrink:0}}>
        <Box sx={{display:'flex',gap:1,alignItems:'center',flexWrap:'wrap'}}>
          <Typography variant="subtitle2">{t('mysql_auto_increment_title')}</Typography>
          {autoColumn ? <Typography variant="body2" sx={{flex:1}}>{autoColumn.COLUMN_NAME} · {autoColumn.COLUMN_TYPE} · {t('mysql_auto_increment_current',{value:metadata.table.AUTO_INCREMENT ?? '—'})} · {t('mysql_auto_increment_maximum',{value:autoIncrementMaximum(autoColumn)})}</Typography> : <Typography variant="body2" color="text.secondary" sx={{flex:1}}>{t('mysql_auto_increment_none')}</Typography>}
          <Tooltip title={t('mysql_auto_increment_change_help')}><span><Button variant="outlined" size="small" startIcon={<EditIcon/>} disabled={readonly||Boolean(c.error)||!autoColumn||metadata.table.ENGINE?.toLowerCase()!=='innodb'||metadata.table.TABLE_TYPE!=='BASE TABLE'||metadata.table.AUTO_INCREMENT==null} onClick={()=>open('auto-increment','',String(metadata.table.AUTO_INCREMENT??''))}>{t('mysql_auto_increment_change')}</Button></span></Tooltip>
        </Box>
      </Paper>
      {section(t('index_2'), metadata.indexes, [col('INDEX_NAME', t('index_name')), col('SEQ_IN_INDEX'), col('COLUMN_NAME', t('column_name')), col('EXPRESSION'), col('NON_UNIQUE'), col('INDEX_TYPE'), col('IS_VISIBLE'), col('SUB_PART'), remove('drop-index')], () => open('add-index'))}
      {section(t('check_constraint_2'), metadata.checks, [{field:'CONSTRAINT_NAME',headerName:t('constraint_name'),minWidth:180,flex:1,renderCell:params=><Tooltip title={t('open')}><span><Button size="small" disabled={locked||!props.onOpenCheck} onClick={()=>props.onOpenCheck?.(String(params.row.CONSTRAINT_NAME))}>{String(params.row.CONSTRAINT_NAME)}</Button></span></Tooltip>}, col('CHECK_CLAUSE', t('condition')), col('ENFORCED',t('enable')), {field:'__actions',headerName:t('action'),width:100,sortable:false,renderCell:params=><Tooltip title={t('delete')}><span><Button size="small" color="error" disabled={readonly||!props.onOpenCheck} onClick={()=>props.onOpenCheck?.(String(params.row.CONSTRAINT_NAME),true)}><DeleteOutlineIcon fontSize="small"/></Button></span></Tooltip>}],props.onOpenCheck?()=>props.onOpenCheck?.():undefined,false,'checks')}
      {section(t('trigger_2'), metadata.triggers, [{ field: 'TRIGGER_NAME', headerName: t('trigger_name'), minWidth: 180, flex: 1, renderCell: params => <Tooltip title={t('open')}><span><Button size="small" disabled={locked || !props.onOpenTrigger} onClick={() => props.onOpenTrigger?.(String(params.row.TRIGGER_NAME))}>{String(params.row.TRIGGER_NAME)}</Button></span></Tooltip> }, col('ACTION_TIMING', t('timing')), col('EVENT_MANIPULATION', t('event')), col('ACTION_ORDER'), col('ACTION_STATEMENT'), { field: '__actions', headerName: t('action'), width: 100, sortable: false, renderCell: params => <Button size="small" color="error" aria-label={t('delete') + ' ' + String(params.row.TRIGGER_NAME)} title={t('delete')} disabled={readonly || !props.onOpenTrigger} onClick={() => props.onOpenTrigger?.(String(params.row.TRIGGER_NAME), true)}><DeleteOutlineIcon fontSize="small" /></Button> }], props.onCreateTrigger,false,'triggers')}
      </Box>} />
    </>}
    {mode === 'relation' && section(t('relation'), [...relationGroups.values()], [col('DIRECTION', t('type_2')), col('CONSTRAINT_NAME', t('constraint_name')), col('TABLE_SCHEMA', t('schema')), col('TABLE_NAME', t('table_name')), col('SOURCE_COLUMNS', t('column_name')), col('REFERENCED_TABLE_SCHEMA'), col('REFERENCED_TABLE_NAME', t('referenced_table')), col('TARGET_COLUMNS'), col('DELETE_RULE'), col('UPDATE_RULE'), { field: '__actions', headerName: t('action'), width: 100, renderCell: params => <Button color="error" disabled={readonly || params.row.TABLE_SCHEMA !== props.schema || params.row.TABLE_NAME !== props.table} onClick={() => open('drop-relation', params.row.CONSTRAINT_NAME)}><DeleteOutlineIcon fontSize="small" /></Button> }], () => open('add-relation'))}
    {mode === 'statistics' && <VerticalSplit name="statistics" active={props.active} initialHeight={200} upper={section(t('table_statistics'), Object.entries(metadata.table).map(([property, value]) => ({ property, value })), [col('property', t('item_name')), col('value', t('value'))], undefined, true)} lower={section(t('column_statistics'), metadata.indexes, [col('INDEX_NAME', t('index_name')), col('COLUMN_NAME', t('column_name')), col('EXPRESSION'), col('CARDINALITY'), col('SEQ_IN_INDEX')], undefined, true)} />}
    {columnEditor&&<ColumnEditorDialog key={columnEditor.name??'new'} schema={props.schema} table={props.table} columnName={columnEditor.name} metadata={metadata} busy={Boolean(locked)} readonly={Boolean(props.readonly||props.disabled)} failureMessage={c.error} onClose={()=>setColumnEditor(null)} onExecute={c.executeDdl}/>}
    {dialog && <TableDdlDialog schema={props.schema} table={props.table} metadata={metadata} initial={dialog} busy={locked} failureMessage={c.error} onClose={() => setDialog(null)} onExecute={c.executeDdl} />}
  </Box>;
}
