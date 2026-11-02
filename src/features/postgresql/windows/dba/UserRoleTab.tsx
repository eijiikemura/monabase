// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, List, ListItemButton, ListItemText, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { useDbaSplit } from '@/features/dba/hooks/useDbaSplit';
import { useTranslation } from 'react-i18next';
import { useUserRoleTab } from './useUserRoleTab';
export default function UserRoleTabPostgresql({isActive}:{isActive:boolean}) {
  const {t,i18n}=useTranslation(),s=useUserRoleTab(isActive),split=useDbaSplit(isActive,'columns');
  const label=(action:string)=>t(({create:'create_new',password:'change_password',login:'pg_role_login_action',superuser:'pg_role_superuser_action',grant:'pg_role_grant',revoke:'pg_role_revoke',drop:'delete'} as Record<string,string>)[action] || action);
  const name=(oid:string | undefined)=>s.snapshot?.roles.find(role=>role.oid===oid)?.name || oid || '-';
  const bool=(value:boolean | null)=>value===null?t('pg_role_version_na'):value?t('yes'):t('no');
  const localeText=(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText;
  const columns:GridColDef[]=[{field:'name',headerName:t('role_user_name'),minWidth:160,flex:1},{field:'login',headerName:'LOGIN',width:90,type:'boolean'},
    {field:'superuser',headerName:'SUPERUSER',width:120,type:'boolean'},{field:'protected',headerName:t('pg_role_protection'),width:100,type:'boolean'}];
  const membershipColumns:GridColDef[]=[{field:'roleId',headerName:t('role_name'),minWidth:150,flex:1,valueFormatter:p=>name(p.value)},
    {field:'grantorId',headerName:t('pg_role_grantor'),minWidth:130,flex:1,valueFormatter:p=>name(p.value)},
    ...(['admin','inherit','set'] as const).map(field=>({field,headerName:field.toUpperCase(),width:95,valueFormatter:(p:{value:boolean | null})=>bool(p.value)})),
    {field:'actions',headerName:t('action'),width:80,sortable:false,renderCell:p=><Tooltip title={t('pg_role_revoke_help')}><span><IconButton aria-label={t('pg_role_revoke')} disabled={!s.can('revoke') || !p.row.canRevoke} onClick={()=>s.open('revoke',p.row)}><DeleteOutlineIcon fontSize="small" /></IconButton></span></Tooltip>}];
  const detail=s.detail,role=s.selected;
  return <Box data-testid="pg-user-role-tab" aria-busy={s.isLoading} sx={{display:isActive?'flex':'none',height:'100%',flex:1,minHeight:0,minWidth:0,flexDirection:'column',p:1,gap:1}}>
    <Paper sx={{p:1}}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle2">{t('pg_role_title')}</Typography><TextField size="small" label={t('search_roles_users')} value={s.search} onChange={e=>s.setSearch(e.target.value)} />
      <FormControlLabel control={<Checkbox checked={s.includeSystem} onChange={e=>s.setIncludeSystem(e.target.checked)} />} label={t('include_system_roles_pg')} />
      <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={s.isLoading} onClick={()=>{void s.reload();}}><RefreshIcon /></IconButton></span></Tooltip>
      <ExportDialog columns={columns} rows={s.rows} defaultFileName="postgres_roles" tableName={t('pg_role_title')} iconType="download" />
      {(['create','password','login','superuser','drop'] as const).map(action=><Tooltip key={action} title={t(s.can(action)?'pg_role_review_help':'pg_role_disabled_help')}><span><Button size="small" color={action==='drop' || action==='superuser'?'error':'primary'} disabled={!s.can(action)} onClick={()=>s.open(action)}>{label(action)}</Button></span></Tooltip>)}
    </Stack><Typography variant="caption">{t('pg_role_scope_help')} {s.snapshot?.context.database} / {s.snapshot?.fetchedAt || '-'}</Typography></Paper>
    {s.error && <Alert severity="error" action={<Button disabled={s.isLoading} onClick={()=>{void s.reload();}}>{t('retry')}</Button>}>{t(s.error)} {s.errorCode}</Alert>}
    {s.applied && <Alert severity="success">{t('pg_role_applied')}</Alert>}
    {s.snapshot?.context.readonly && <Alert severity="info">{t('pg_role_readonly')}</Alert>}
    <Box ref={split.container} sx={{display:'flex',flex:1,minHeight:0,minWidth:0}}>
      <Paper sx={{width:split.leftWidth || '35%',minWidth:0,flexShrink:0,display:'flex',flexDirection:'column'}}><GridViewport active={isActive}><DataGrid rows={s.rows} columns={columns} getRowId={row=>row.identity} loading={s.isLoading} density="compact" localeText={{...localeText,noRowsLabel:t(s.ready?'pg_role_no_rows':'pg_role_unconfirmed')}}
        paginationModel={s.pagination} onPaginationModelChange={s.setPagination} pageSizeOptions={[25,50,100]} keepNonExistentRowsSelected rowSelectionModel={s.rows.some(row=>row.identity===s.selectedId)?[s.selectedId]:[]}
        onRowSelectionModelChange={ids=>s.select(ids.length?String(ids[0]):'')} /></GridViewport></Paper>
      <Box role="separator" tabIndex={0} aria-label={t('pg_role_resize')} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio*100)}
        onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key}
        sx={{width:8,flexShrink:0,cursor:'col-resize',touchAction:'none',bgcolor:split.dragging?'primary.main':'divider','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main'}}} />
      <Paper sx={{p:1,flex:1,minWidth:0,overflow:'auto'}}>
        <Typography variant="subtitle2">{role?.name || t('please_select_a_role_user')}</Typography>
        {s.detailError && <Alert severity="error" action={<Button disabled={s.isLoading} onClick={()=>{void s.retryDetail();}}>{t('retry')}</Button>}>{t(s.detailError)} {s.errorCode}</Alert>}
        {role?.protected && <Alert severity="info">{t(role.self?'pg_role_self_help':'pg_role_system_help')}</Alert>}
        {detail && <>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{my:1}}>{(['login','superuser','createDatabase','createRole','inherit','replication','bypassRls'] as const).map(field=><Chip key={field} size="small" label={`${({login:'LOGIN',superuser:'SUPERUSER',createDatabase:'CREATEDB',createRole:'CREATEROLE',inherit:'INHERIT',replication:'REPLICATION',bypassRls:'BYPASSRLS'})[field]}: ${bool(detail.role[field])}`} color={field==='superuser' && detail.role[field]?'error':'default'} />)}</Stack>
          <Typography variant="body2">OID: {detail.role.oid} / {t('pg_role_connection_limit')}: {detail.role.connectionLimit===-1?t('pg_role_unlimited'):detail.role.connectionLimit} / {t('pg_role_valid_until')}: {detail.role.validUntil || t('pg_role_unlimited')}</Typography>
          <Typography variant="body2">{t('pg_role_settings')}: {detail.role.settings.join(', ') || '-'}</Typography>
          <Typography variant="caption">{t('pg_role_login_help')}</Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{mt:1}}><Typography variant="subtitle2">{t('pg_role_direct')}</Typography><Button size="small" disabled={!s.can('grant') || !detail.candidates.length} onClick={()=>s.open('grant')}>{label('grant')}</Button></Stack>
          <Typography variant="caption">{t('pg_role_membership_help')}</Typography>
          <Box sx={{height:250,minWidth:0}}><GridViewport active={isActive}><DataGrid density="compact" rows={detail.memberships} getRowId={row=>`${row.roleId}:${row.memberId}:${row.grantorId}`} columns={membershipColumns} pageSizeOptions={[25,50,100]} initialState={{pagination:{paginationModel:{page:0,pageSize:25}}}} disableRowSelectionOnClick localeText={localeText} /></GridViewport></Box>
          <Typography variant="subtitle2" sx={{mt:1}}>{t('pg_role_effective')}</Typography><Typography variant="caption">{t('pg_role_effective_help')}</Typography>
          <Box component="ul">{detail.effectiveRoles.map(entry=><li key={entry.oid}>{entry.name} — {t(entry.direct?'pg_role_direct_label':'pg_role_indirect_label')} / USAGE: {bool(entry.usable)} / SET: {bool(entry.settable)}</li>)}</Box>
          <Typography variant="subtitle2">{t('pg_role_members')}</Typography><Box component="ul">{detail.members.map(entry=><li key={`${entry.memberId}:${entry.grantorId}`}>{name(entry.memberId)} / {t('pg_role_grantor')}: {name(entry.grantorId)}</li>)}</Box>
          <Typography variant="subtitle2">{t('pg_role_dependency_title',{total:detail.dependencyCount})}</Typography><Typography variant="caption">{t('pg_role_dependencies_help')}</Typography>
          {detail.dependenciesTruncated && <Alert severity="warning">{t('pg_role_truncated')}</Alert>}
          <Box component="ul">{detail.dependencies.map(entry=><li key={`${entry.database_id}:${entry.class_id}:${entry.object_id}:${entry.sub_id}:${entry.dependency_type}`}>{entry.database || t('pg_role_shared')} / {entry.description || `${entry.class_id}:${entry.object_id}:${entry.sub_id}`} ({entry.dependency_type})</li>)}</Box>
        </>}
      </Paper>
    </Box>
    <Dialog open={!!s.draft} onClose={s.close} maxWidth="md" fullWidth>
      <DialogTitle>{s.draft && label(s.draft.action)} — {s.draft?.target?.name || t('role_user_name')}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        {s.error && <Alert severity="error" action={<Button disabled={s.isLoading} onClick={()=>{void s.reload();}}>{t('retry')}</Button>}>{t(s.error)} {s.errorCode}</Alert>}
        {s.draft?.action==='create' && <><TextField size="small" label={t('role_user_name')} disabled={s.isLoading} value={s.draft.newName || ''} onChange={e=>s.update({newName:e.target.value})} helperText={t('pg_role_name_help')} /><FormControlLabel control={<Checkbox disabled={s.isLoading} checked={s.draft.login || false} onChange={e=>{s.changePassword('');s.update({login:e.target.checked,passwordMode:e.target.checked?'set':'none'});}} />} label={t('pg_role_login_create')} /></>}
        {s.draft && (s.draft.action==='password' || s.draft.action==='create' && s.draft.login) && <><TextField select size="small" label={t('pg_role_password_mode')} value={s.draft.passwordMode || 'none'} disabled={s.isLoading} onChange={e=>{s.changePassword('');s.update({passwordMode:e.target.value==='set'?'set':'none'});}}><MenuItem value="set">{t('pg_role_set_password')}</MenuItem><MenuItem value="none">{t('pg_role_no_password')}</MenuItem></TextField>
          {s.draft.passwordMode==='set' && <TextField size="small" label={t('new_password')} type="password" autoComplete="new-password" disabled={s.isLoading} value={s.password} onChange={e=>s.changePassword(e.target.value)} helperText={t('pg_role_password_help')} />}
          <Alert severity="info">{t('pg_role_password_notice')}</Alert></>}
        {s.draft && ['login','superuser'].includes(s.draft.action) && <Alert severity="warning">{t(s.draft.action==='login'?'pg_role_login_change':'pg_role_superuser_change',{name:s.draft.target?.name,enabled:bool(s.draft.enabled || false)})}</Alert>}
        {s.draft?.action==='grant' && <>
          <TextField size="small" label={t('pg_role_candidate_search')} value={s.candidateSearch} disabled={s.isLoading} onChange={e=>{s.setCandidateSearch(e.target.value);s.setCandidatePage(0);}} />
          <List dense sx={{maxHeight:210,overflow:'auto'}}>{s.candidates.slice(s.candidatePage*100,(s.candidatePage+1)*100).map(candidate=><ListItemButton key={candidate.oid} disabled={s.isLoading} selected={candidate.oid===s.draft?.roleId} onClick={()=>s.update({roleId:candidate.oid,grantorId:candidate.grantorIds[0]})}><ListItemText primary={candidate.name} /></ListItemButton>)}</List>
          <Stack direction="row" spacing={1}><Button disabled={s.isLoading || !s.candidatePage} onClick={()=>s.setCandidatePage(s.candidatePage-1)}>{t('previous')}</Button><Typography>{s.candidatePage+1}</Typography><Button disabled={s.isLoading || (s.candidatePage+1)*100>=s.candidates.length} onClick={()=>s.setCandidatePage(s.candidatePage+1)}>{t('next')}</Button></Stack>
          <Typography>{t('pg_role_selected_membership')}: {name(s.draft.roleId)}</Typography>
          <TextField select size="small" label={t('pg_role_grantor')} value={s.draft.grantorId || ''} disabled={s.isLoading} onChange={e=>s.update({grantorId:e.target.value})}>{(detail?.candidates.find(row=>row.oid===s.draft?.roleId)?.grantorIds || []).map(oid=><MenuItem key={oid} value={oid}>{name(oid)}</MenuItem>)}</TextField>
          {(['admin',...(s.snapshot && s.snapshot.context.version>=160000?['inherit','set'] as const:[])] as const).map(option=><FormControlLabel key={option} control={<Checkbox disabled={s.isLoading} checked={s.draft?.[option] || false} onChange={e=>s.update({[option]:e.target.checked})} />} label={option.toUpperCase()} />)}
          <Alert severity="warning">{t('pg_role_membership_help')}</Alert>
        </>}
        {s.draft?.action==='revoke' && <><Typography>{name(s.draft.roleId)} → {s.draft.target?.name} / {t('pg_role_grantor')}: {name(s.draft.grantorId)}</Typography><TextField select size="small" label={t('pg_role_revoke_scope')} disabled={s.isLoading} value={s.draft.revokeOption || 'membership'} onChange={e=>s.update({revokeOption:e.target.value as 'membership' | 'admin' | 'inherit' | 'set'})}>{(['membership','admin',...(s.snapshot && s.snapshot.context.version>=160000?['inherit','set'] as const:[])] as const).map(option=><MenuItem key={option} value={option}>{option==='membership'?t('pg_role_entire_membership'):option.toUpperCase()}</MenuItem>)}</TextField><Alert severity="warning">{t('pg_role_revoke_help')}</Alert></>}
        {s.draft?.action==='drop' && <Alert severity="warning">{t('pg_role_drop_help',{total:(detail?.memberships.length || 0)+(detail?.members.length || 0)})}</Alert>}
        {s.review && <><Typography variant="subtitle2">{t('pg_role_review')}</Typography><Box component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{s.review.sql}</Box>
          {s.review.request.action==='drop' && <TextField size="small" label={t('pg_role_confirm_name')} value={s.confirmName} disabled={s.isLoading} onChange={e=>s.setConfirmName(e.target.value)} />}
          <FormControlLabel control={<Checkbox disabled={s.isLoading} checked={s.acknowledged} onChange={e=>s.setAcknowledged(e.target.checked)} />} label={t('pg_role_acknowledge')} />
        </>}
      </Stack></DialogContent><DialogActions><Button disabled={s.isLoading} onClick={s.close}>{t('cancel')}</Button><Button disabled={s.isLoading || !s.ready} onClick={()=>{void s.prepare();}}>{t('pg_role_review')}</Button><Button variant="contained" disabled={!s.canExecute} onClick={()=>{void s.execute();}}>{t('execute')}</Button></DialogActions>
    </Dialog>
  </Box>;
}
