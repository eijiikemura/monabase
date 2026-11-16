// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,Divider,FormControlLabel,IconButton,MenuItem,Paper,Stack,TextField,Tooltip,Typography} from '@mui/material';
import {DataGrid,enUS,jaJP,type GridColDef} from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import CancelIcon from '@mui/icons-material/Cancel';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockPersonIcon from '@mui/icons-material/LockPerson';
import {useTranslation} from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import {GridViewport} from '@/features/data-grid/GridViewport';
import type {MysqlLock} from '@/shared/types/mysqlLockTypes';
import type {MysqlUserRoleProps} from './useUserRoleTab';
import {useLockTab} from './useLockTab';
export default function LockTab(props:MysqlUserRoleProps){
 const {t,i18n}=useTranslation(),s=useLockTab(props),busy=props.busy||s.loading||s.acting,selected=s.selected;
 const pid=(id:string)=>s.snapshot?.locks.find(row=>row.id===id)?.session?.connectionId||t('lock_object_unknown');
 const columns:GridColDef<MysqlLock>[]=[
  {field:'connection',headerName:t('mysql_session_connection'),width:110,valueGetter:p=>p.row.session?.connectionId||'—'},
  {field:'user',headerName:t('db_user'),width:130,valueGetter:p=>p.row.session?.user||'—'},
  {field:'blockers',headerName:t('lock_waits_for'),width:150,valueGetter:p=>p.row.blockers.map(pid).join(', ')||'—'},
  {field:'waiterCount',headerName:t('lock_waiter_count'),width:110,valueGetter:p=>new Set(p.row.waiters.map(id=>s.snapshot?.locks.find(row=>row.id===id)?.threadId||id)).size},
  {field:'object',headerName:t('target_object_2'),minWidth:210,flex:1,valueGetter:p=>p.row.table?`${p.row.schema}.${p.row.table}`:t('lock_object_unknown')},
  {field:'index',headerName:t('index_name'),width:150},
  {field:'type',headerName:t('lock_type'),width:100},
  {field:'mode',headerName:t('mysql_lock_mode'),width:150},
  {field:'status',headerName:t('status'),width:120},
  {field:'transactionId',headerName:t('mysql_lock_transaction'),width:160},
  {field:'seconds',headerName:t('mysql_session_seconds'),width:150,valueGetter:p=>p.row.session?.seconds||'—'},
  {field:'state',headerName:t('session_wait_state'),width:190,valueGetter:p=>p.row.session?.state||'—'},
  {field:'host',headerName:t('host'),width:160,valueGetter:p=>p.row.session?.host||'—'}
 ];
 return <Box data-testid="mysql-lock-tab" aria-busy={busy} sx={{flex:1,height:'100%',minWidth:0,minHeight:0,display:props.active?'flex':'none',flexDirection:'column',p:1,gap:1,overflow:'hidden'}}>
  <Paper sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
   <Stack direction="row" alignItems="center" spacing={1} sx={{p:1,flexWrap:'wrap',rowGap:1}}>
    <LockPersonIcon color="action"/><Typography variant="subtitle2" fontWeight="bold">{t('lock_management')}</Typography>
    <TextField size="small" label={t('lock_search')} value={s.search} onChange={event=>s.setSearch(event.target.value)}/>
    <TextField select size="small" label={t('lock_filter')} value={s.filter} onChange={event=>s.setFilter(event.target.value==='waiting'?'waiting':event.target.value==='blocking'?'blocking':'all')} sx={{minWidth:130}}>
     <MenuItem value="all">{t('lock_all')}</MenuItem><MenuItem value="waiting">{t('lock_waiting')}</MenuItem><MenuItem value="blocking">{t('lock_blocking')}</MenuItem>
    </TextField>
    <TextField select size="small" label={t('lock_auto_refresh')} value={s.refreshSeconds} onChange={event=>s.setRefreshSeconds(Number(event.target.value))} sx={{minWidth:130}}>{[0,5,10,30].map(value=><MenuItem key={value} value={value}>{value?t('lock_refresh_seconds',{seconds:value}):t('lock_refresh_off')}</MenuItem>)}</TextField>
    <Box sx={{flexGrow:1}}/><ExportDialog columns={columns} rows={s.rows} defaultFileName="mysql_locks" iconType="download" tableName={t('lock_management')}/>
    <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={busy||s.detailLoading} onClick={()=>void s.reload()}><RefreshIcon/></IconButton></span></Tooltip>
    <Tooltip title={t('lock_inspect_blocker_help')}><span><Button size="small" disabled={!s.ready||busy||!selected?.blockers.length} onClick={()=>s.inspectBlocker()}>{t('lock_inspect_blocker')}</Button></span></Tooltip>
    <Tooltip title={t('mysql_session_cancel_help')}><span><Button size="small" color="warning" startIcon={<CancelIcon/>} disabled={!s.canCancel} onClick={()=>void s.command('cancel')}>{t('cancel_sql')}</Button></span></Tooltip>
    <Tooltip title={t('mysql_session_kill_help')}><span><Button size="small" variant="outlined" color="error" startIcon={<CloseIcon/>} disabled={!s.canKill} onClick={()=>void s.command('kill')}>{t('lock_kill_selected')}</Button></span></Tooltip>
   </Stack>
   <Typography variant="caption" sx={{px:1,pb:1}}>{t('mysql_lock_scope')} {t('lock_row_count',{shown:s.rows.length,total:s.snapshot?.locks.length||0})} · {t('lock_fetched_at')}: {s.snapshot?.fetchedAt||'—'}</Typography>
   {s.error&&<Alert severity="error" action={<Button disabled={busy||s.detailLoading} onClick={()=>void s.reload()}>{t('retry')}</Button>}>{t(s.error)}</Alert>}
   {s.notice&&<Alert severity="info">{t(s.notice)}</Alert>}
   {s.snapshot&&!s.snapshot.context.consistent&&<Alert severity="warning">{t('mysql_lock_inconsistent')}</Alert>}
   {s.snapshot&&!s.snapshot.context.canManage&&<Typography variant="caption" sx={{px:1}}>{t(s.snapshot.context.readonly?'lock_readonly':s.snapshot.context.protectionReady?'mysql_session_privilege_required':'mysql_session_protection_unavailable')}</Typography>}
   <Box sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><GridViewport active={props.active}><DataGrid rows={s.rows} columns={columns} loading={busy} density="compact"
    rowSelectionModel={s.rows.some(row=>row.id===s.selectedId)?[s.selectedId]:[]} onRowSelectionModelChange={ids=>s.select(String(ids[0]||''))} keepNonExistentRowsSelected
    paginationModel={s.pagination} onPaginationModelChange={s.setPagination} pageSizeOptions={[25,50,100]}
    localeText={{...(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText,noRowsLabel:t(s.ready?'lock_no_rows':'lock_unconfirmed')}}
    getRowClassName={p=>p.row.status==='WAITING'?'lock-waiting':p.row.waiters.length?'lock-blocking':''}
    sx={{border:0,'& .lock-waiting':{bgcolor:'action.hover'},'& .lock-blocking':{fontWeight:'bold'}}}/></GridViewport></Box>
  </Paper>
  {selected&&<Paper sx={{p:1,maxHeight:'36%',overflow:'auto',flexShrink:0}}>
   <Typography variant="subtitle2">{t('mysql_session_selected',{id:selected.session?.connectionId||'—',user:selected.session?.user||'—',host:selected.session?.host||'—'})}</Typography>
   <Typography variant="body2">{selected.schema}.{selected.table} · {selected.index||'—'} · {selected.type} / {selected.mode} / {selected.status}</Typography>
   <Typography variant="caption">ENGINE_LOCK_ID: {selected.lockId} · THREAD_ID: {selected.threadId||'—'} · {t('mysql_lock_time_help')}</Typography>
   {selected.protected&&<Typography variant="body2">{t('lock_session_protected')}</Typography>}
   {!!selected.blockers.length&&<Stack direction="row" spacing={1} alignItems="center"><Typography variant="caption">{t('lock_waits_for')}</Typography>{selected.blockers.map(id=><Button key={id} size="small" disabled={busy||!s.ready} onClick={()=>s.inspectBlocker(id)}>{pid(id)}</Button>)}</Stack>}
   <Divider sx={{my:1}}/>
   {s.detailError&&<Alert severity="warning" action={<Button disabled={busy||s.detailLoading} onClick={s.retryDetail}>{t('retry')}</Button>}>{t(s.detailError)}</Alert>}
   {s.detailLoading&&<Typography role="status" variant="caption">{t('loading')}</Typography>}
   {(['sqlText','previousSqlText'] as const).map(field=><Box key={field}><Stack direction="row" alignItems="center"><Typography variant="subtitle2">{t(field==='sqlText'?'lock_current_sql':'lock_previous_sql')}</Typography><Tooltip title={t(field==='sqlText'?'lock_copy_current':'lock_copy_previous')}><span><IconButton size="small" aria-label={t(field==='sqlText'?'lock_copy_current':'lock_copy_previous')} disabled={!s.detail?.session[field]} onClick={()=>void s.copy(s.detail?.session[field]||'')}><ContentCopyIcon fontSize="small"/></IconButton></span></Tooltip></Stack><Box component="pre" sx={{m:0,whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:'0.75rem'}}>{s.detail?.session[field]||t('lock_sql_unavailable')}</Box></Box>)}
   <Typography variant="caption">{t('mysql_session_history_help')}</Typography>
  </Paper>}
  {props.active&&s.review&&<Dialog open fullWidth maxWidth="sm" onClose={s.close}><DialogTitle>{t(s.review.action==='kill'?'kill_session':'cancel_sql')}</DialogTitle><DialogContent><Stack spacing={2} sx={{pt:1}}>
   <Alert severity="warning">{t(s.review.action==='kill'?'mysql_session_kill_warning':'mysql_session_cancel_warning')} {t('mysql_lock_action_help')}</Alert>
   <Typography variant="body2">{s.review.target.schema}.{s.review.target.table} · {s.review.target.mode} · {s.review.target.session?.user}@{s.review.target.session?.host}</Typography>
   <Typography component="pre">{s.review.sql}</Typography>
   <TextField size="small" disabled={props.busy} label={t('mysql_session_confirm',{id:s.review.target.session?.connectionId})} value={s.confirm} onChange={event=>s.setConfirm(event.target.value)}/>
   <FormControlLabel label={t('mysql_session_acknowledge')} control={<Checkbox disabled={props.busy} checked={s.acknowledged} onChange={event=>s.setAcknowledged(event.target.checked)}/>}/>
  </Stack></DialogContent><DialogActions><Button disabled={props.busy} onClick={s.close}>{t('cancel')}</Button><Button variant="contained" color="warning" disabled={!s.canExecute} onClick={()=>void s.execute()}>{t('execute')}</Button></DialogActions></Dialog>}
 </Box>;
}
