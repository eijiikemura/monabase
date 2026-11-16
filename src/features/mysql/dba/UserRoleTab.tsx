// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,MenuItem,Paper,Stack,TextField,Tooltip,Typography} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import {DataGrid,enUS,jaJP,type GridColDef} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import {GridViewport} from '@/features/data-grid/GridViewport';
import {useDbaSplit} from '@/features/dba/hooks/useDbaSplit';
import type {MysqlAccount,MysqlAccountAction} from '@/shared/types/mysqlUserRoleTypes';
import {useUserRoleTab,type MysqlUserRoleProps} from './useUserRoleTab';
const accountName=(account:MysqlAccount)=>`${account.user}@${account.host}`;
export default function UserRoleTab(props:MysqlUserRoleProps){
 const {t,i18n}=useTranslation(),s=useUserRoleTab(props),split=useDbaSplit(props.active,'columns'),d=s.detail;
 const actionLabel=(action:MysqlAccountAction)=>t(({create:'create_new',password:'change_password',lock:d?.target.locked?'mysql_user_unlock':'mysql_user_lock',drop:'delete',grant:'mysql_user_grant',revoke:'mysql_user_revoke','role-grant':'mysql_user_role_grant','role-revoke':'mysql_user_role_revoke','default-role':'mysql_user_default_role',limits:'mysql_user_limits'} as Record<MysqlAccountAction,string>)[action]);
 const bool=(value:boolean|null)=>value===null?t('unknown'):t(value?'yes':'no');
 const columns:GridColDef[]=[{field:'user',headerName:t('username'),minWidth:140,flex:1},{field:'host',headerName:t('host'),minWidth:120,flex:1},{field:'locked',headerName:t('mysql_user_locked'),width:110,valueFormatter:p=>bool(p.value)},{field:'expired',headerName:t('mysql_user_expired'),width:120,valueFormatter:p=>bool(p.value)},{field:'plugin',headerName:t('mysql_user_auth'),minWidth:180,flex:1}];
 const localeText=(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText;
 const roleValue=(value:MysqlAccount|null|undefined)=>value?JSON.stringify(value):'';
 const roleOptions=s.draft?.action==='role-grant'?d?.roleCandidates||[]:d?.roles||[];
 return <Box data-testid="mysql-user-role-tab" sx={{flex:1,minHeight:0,minWidth:0,p:1,display:'flex',flexDirection:'column',gap:1}}>
  <Paper sx={{p:1}}><Stack direction="row" alignItems="center" gap={1} flexWrap="wrap"><Typography variant="subtitle2">{t('user_settings')}</Typography>
   <TextField size="small" label={t('search_users')} value={s.search} onChange={event=>{s.setSearch(event.target.value);s.setPagination(old=>({...old,page:0}));}}/>
   <FormControlLabel label={t('mysql_user_include_protected')} control={<Checkbox checked={s.includeProtected} onChange={event=>s.setIncludeProtected(event.target.checked)}/>}/>
   <FormControlLabel label={t('mysql_user_referenced_roles')} control={<Checkbox checked={s.rolesOnly} onChange={event=>s.setRolesOnly(event.target.checked)}/>}/>
   <Tooltip title={t('refresh_to_latest_state')}><span><Button variant="outlined" size="small" startIcon={<RefreshIcon/>} disabled={props.busy||s.loading} onClick={()=>void s.reload()}>{t('refresh')}</Button></span></Tooltip>
   <ExportDialog columns={columns} rows={s.rows} defaultFileName="mysql_accounts" tableName={t('user_settings')} iconType="download" disabled={s.loading||props.busy}/>
   {(['create','password','lock','drop'] as const).map(action=><Tooltip key={action} title={t('mysql_user_review_help')}><span><Button size="small" disabled={!s.can(action)} color={action==='drop'?'error':'primary'} onClick={()=>s.open(action)}>{actionLabel(action)}</Button></span></Tooltip>)}
  </Stack><Typography variant="caption">{s.snapshot?.context.server} · {s.snapshot?.fetchedAt}</Typography></Paper>
  {s.error&&<Alert severity="error">{t(s.error.split(' (')[0])}{s.error.includes(' (')?' ('+s.error.split(' (')[1]:''}</Alert>}
  {s.applied&&<Alert severity={s.error?'warning':'success'}>{t(s.error?'mysql_user_applied_unverified':'mysql_user_applied')}</Alert>}
  {s.snapshot?.context.scope==='self'&&<Alert severity="info">{t('mysql_user_self_scope')}</Alert>}
  <Box ref={split.container} sx={{display:'flex',flex:1,minHeight:0,minWidth:0}}>
   <Paper sx={{width:split.leftWidth||'35%',minWidth:0,flexShrink:0,display:'flex',flexDirection:'column'}}><GridViewport active={props.active}><DataGrid rows={s.rows} columns={columns} getRowId={row=>row.id} density="compact" loading={s.loading} paginationModel={s.pagination} onPaginationModelChange={s.setPagination} pageSizeOptions={[25,50,100]} localeText={localeText} rowSelectionModel={s.rows.some(row=>row.id===s.selected)?[s.selected]:[]} onRowSelectionModelChange={ids=>s.select(ids.length?String(ids[0]):'')} /></GridViewport></Paper>
   <Box role="separator" tabIndex={0} aria-label={t('mysql_user_resize')} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio*100)} onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key} sx={{width:8,flexShrink:0,cursor:'col-resize',touchAction:'none',bgcolor:split.dragging?'primary.main':'divider'}}/>
   <Paper sx={{p:1,flex:1,minWidth:0,overflow:'auto'}}>
    <Typography variant="subtitle2">{d?accountName(d.target):t('please_select_a_user')}</Typography>
    {s.detailLoading&&<Typography role="status">{t('loading')}</Typography>}
    {s.detailError&&<Alert severity="error" action={<Button disabled={props.busy||s.detailLoading} onClick={()=>void s.loadDetail()}>{t('retry')}</Button>}>{t(s.detailError)}</Alert>}
    {d&&<>
     {d.target.protected&&<Alert severity="info">{t('mysql_user_protected_help')}</Alert>}
     <Typography variant="body2">{t('mysql_user_auth')}: {d.target.plugin||'—'} · {t('mysql_user_locked')}: {bool(d.target.locked)} · {t('mysql_user_expired')}: {bool(d.target.expired)}</Typography>
     <Typography variant="caption">{t('mysql_user_roles_help')}</Typography>
     <Box sx={{display:'flex',gap:1,flexWrap:'wrap',my:1}}>{(['grant','revoke','role-grant','role-revoke','default-role','limits'] as const).map(action=><Button key={action} size="small" variant="outlined" disabled={!s.can(action)} onClick={()=>s.open(action)}>{actionLabel(action)}</Button>)}</Box>
     <Typography variant="subtitle2">{t('mysql_user_direct_grants')}</Typography>
     <Box component="ul">{d.grants.map((grant,index)=><li key={index}>{grant.privilege} · {grant.scope==='global'?'*.*':grant.database+'.*'} · GRANT OPTION: {bool(grant.grantable)}</li>)}</Box>
     <Typography variant="subtitle2">{t('mysql_user_roles')}</Typography><Box component="ul">{d.roles.map(role=><li key={accountName(role)}>{accountName(role)} · ADMIN: {bool(role.admin)} · DEFAULT: {bool(role.defaultRole)}</li>)}</Box>
     <Typography variant="subtitle2">{t('mysql_user_recipients')}</Typography><Box component="ul">{d.recipients.map(role=><li key={accountName(role)}>{accountName(role)}</li>)}</Box>
     <Typography variant="subtitle2">{t('mysql_user_limits')}</Typography>{s.snapshot?.context.scope==='self'?<Typography>{t('mysql_user_attributes_unavailable')}</Typography>:<Box component="ul">{(Object.keys(d.target.limits) as (keyof typeof d.target.limits)[]).map(key=><li key={key}>{t('mysql_user_limit_'+key)}: {d.target.limits[key]}</li>)}</Box>}
     <Typography variant="subtitle2">{t('mysql_user_definers')}</Typography>{!d.dependenciesComplete&&<Typography>{t('mysql_user_dependencies_unknown')}</Typography>}<Box component="ul">{d.definers.map((object,index)=><li key={index}>{object.schema}.{object.name} ({object.kind})</li>)}</Box>
     <Typography variant="subtitle2">SHOW GRANTS</Typography><Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{d.grantSql.join(';\n')}</Typography>
    </>}
   </Paper>
  </Box>
  {props.active&&s.draft&&<Dialog open fullWidth maxWidth="md" onClose={s.close}><DialogTitle>{actionLabel(s.draft.action)}</DialogTitle><DialogContent><Stack spacing={2} sx={{pt:1}}>
   <Alert severity="warning">{t('mysql_user_ddl_warning')}</Alert>{s.error&&<Alert severity="error">{t(s.error.split(' (')[0])}{s.error.includes(' (')?' ('+s.error.split(' (')[1]:''}</Alert>}
   {s.draft.action==='create'?<><TextField select size="small" label={t('type_4')} value={s.draft.kind} disabled={props.busy} onChange={event=>s.update({kind:event.target.value==='ROLE'?'ROLE':'USER',locked:event.target.value==='ROLE'})}><MenuItem value="USER">USER</MenuItem><MenuItem value="ROLE">ROLE</MenuItem></TextField><TextField size="small" label={t('username')} value={s.draft.target.user} disabled={props.busy} onChange={event=>s.update({target:{...s.draft!.target,user:event.target.value}})}/><TextField size="small" label={t('host')} value={s.draft.target.host} disabled={props.busy} onChange={event=>s.update({target:{...s.draft!.target,host:event.target.value}})}/><FormControlLabel label={t('mysql_user_locked')} control={<Checkbox checked={s.draft.kind==='ROLE'||s.draft.locked||false} disabled={props.busy||s.draft.kind==='ROLE'} onChange={event=>s.update({locked:event.target.checked})}/>}/></>:<Typography>{s.targetName}</Typography>}
   {s.needsPassword&&<TextField size="small" label={t('new_password')} type="password" autoComplete="new-password" value={s.password} disabled={props.busy} onChange={event=>s.setPassword(event.target.value)} helperText={t('mysql_user_password_help')}/>}
   {s.draft.action==='lock'&&<Alert severity="info">{t('mysql_user_lock_help')}</Alert>}
   {s.draft.action==='drop'&&<Alert severity="warning">{t('mysql_user_drop_help',{count:d?.recipients.length||0})}</Alert>}
   {['grant','revoke'].includes(s.draft.action)&&<><TextField select size="small" label={t('mysql_user_scope')} value={s.draft.scope} disabled={props.busy} onChange={event=>s.update({scope:event.target.value==='global'?'global':'database'})}><MenuItem value="database">{t('database')}</MenuItem><MenuItem value="global">*.*</MenuItem></TextField>{s.draft.scope==='database'&&<TextField select size="small" label={t('database')} value={s.draft.database} disabled={props.busy} onChange={event=>s.update({database:event.target.value})}>{d?.databases.map(name=><MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>}<TextField select size="small" label={t('privilege_role')} value={s.draft.privilege} disabled={props.busy} onChange={event=>s.update({privilege:event.target.value})}>{d?.privileges.map(name=><MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField></>}
   {['role-grant','role-revoke','default-role'].includes(s.draft.action)&&<TextField select size="small" label={t('mysql_user_roles')} value={roleValue(s.draft.role)} disabled={props.busy} onChange={event=>s.update({role:event.target.value?JSON.parse(event.target.value) as MysqlAccount:null})}><MenuItem value="">NONE</MenuItem>{roleOptions.map(role=><MenuItem key={accountName(role)} value={roleValue({user:role.user,host:role.host})}>{accountName(role)}</MenuItem>)}</TextField>}
   {s.draft.action==='limits'&&s.draft.limits&&(Object.keys(s.draft.limits) as (keyof typeof s.draft.limits)[]).map(key=><TextField key={key} size="small" label={t('mysql_user_limit_'+key)} helperText={t('mysql_user_zero_unlimited')} value={s.draft?.limits?.[key]??0} disabled={props.busy} inputProps={{inputMode:'numeric'}} onChange={event=>s.update({limits:{...s.draft!.limits!,[key]:event.target.value===''?-1:Number(event.target.value)}})}/>)}
   {s.review&&<><Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{s.review.sql}</Typography><TextField size="small" label={t('mysql_user_confirm',{name:s.targetName})} value={s.confirm} disabled={props.busy} onChange={event=>s.setConfirm(event.target.value)}/><FormControlLabel label={t('mysql_user_acknowledge')} control={<Checkbox checked={s.acknowledged} disabled={props.busy} onChange={event=>s.setAcknowledged(event.target.checked)}/>}/></>}
  </Stack></DialogContent><DialogActions><Button disabled={props.busy} onClick={s.close}>{t('cancel')}</Button><Button disabled={props.busy||!s.can(s.draft.action)} onClick={()=>void s.prepare()}>{t('preview')}</Button><Button variant="contained" disabled={!s.canExecute} onClick={()=>void s.execute()}>{t('execute')}</Button></DialogActions></Dialog>}
 </Box>;
}
