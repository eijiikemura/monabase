// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,MenuItem,TextField,Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {buildColumnChange,columnDefinition,columnForm,columnTypes,type MysqlColumnDefinition,type MysqlColumnForm} from './columnDefinition';
import {backgroundRows,loadTableMetadata} from './tableRepository';
import {mysqlTableName,type MysqlColumn,type MysqlStatement,type MysqlTableMetadata} from './tableModel';
interface Props {schema:string;table:string;columnName?:string;metadata:MysqlTableMetadata;busy:boolean;readonly:boolean;failureMessage:string;onExecute:(statement:MysqlStatement)=>Promise<boolean>;onClose:()=>void;}
export default function ColumnEditorDialog(props:Props){
  const {t}=useTranslation();
  const [snapshot]=useState(props.metadata);
  const [form,setForm]=useState<MysqlColumnForm>(()=>columnForm(snapshot.columns.find(column=>column.COLUMN_NAME===props.columnName)));
  const [column,setColumn]=useState<MysqlColumn>(),[definition,setDefinition]=useState<MysqlColumnDefinition>(),[loading,setLoading]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<MysqlStatement>(),[attempted,setAttempted]=useState(false),[confirm,setConfirm]=useState(''),[retry,setRetry]=useState(0);
  const mounted=useRef(true),submitted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const readSource=async()=>{const row=(await backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(props.schema,props.table)}`,{}))[0];if(typeof row?.['Create Table']!=='string')throw new Error('The native table definition is unavailable.');return row['Create Table'];};
  useEffect(()=>{
    const name=props.columnName;if(!name)return;let current=true;setLoading(true);setError('');
    void backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(props.schema,props.table)}`,{}).then(rows=>{
      if(!current)return;const source=rows[0]?.['Create Table'];if(typeof source!=='string')throw new Error('The native table definition is unavailable.');
      const col=snapshot.columns.find(column=>column.COLUMN_NAME===props.columnName);if(!col)throw new Error('Reload the column metadata before editing.');
      const next=columnDefinition(source,name);setColumn(col);setDefinition(next);setForm(columnForm(col));
    }).catch(failure=>{if(current)setError(failure instanceof Error?failure.message:t('execution_failed'));}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
    // The metadata snapshot is supplied when the dialog opens. Only identity/retry restarts loading.
  },[props.schema,props.table,props.columnName,retry,t,snapshot]);
  const locked=props.busy||props.readonly||loading||checking||attempted;
  const update=(next:Partial<MysqlColumnForm>)=>{if(locked)return;setForm(previous=>({...previous,...next}));setPreview(undefined);setConfirm('');setError('');};
  const isNumeric=/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE)$/.test(form.type),isDecimal=form.type==='DECIMAL',calendar=/^(TIME|DATETIME|TIMESTAMP)$/.test(form.type),measured=/^(CHAR|VARCHAR|BINARY|VARBINARY|BIT|DECIMAL|TIME|DATETIME|TIMESTAMP)$/.test(form.type),generated=Boolean(definition?.generated);
  const execute=async()=>{
    if(locked||!preview||submitted.current||confirm!==props.table)return;submitted.current=true;setAttempted(true);setChecking(true);setError('');
    try{
      const source=await readSource();if(props.columnName&&columnDefinition(source,props.columnName).raw!==definition?.raw)throw new Error(t('mysql_column_changed'));
      const metadata=await loadTableMetadata(props.schema,props.table),checked=buildColumnChange(props.schema,props.table,metadata,form,definition);
      if(checked.sql!==preview.sql||JSON.stringify(checked.binds)!==JSON.stringify(preview.binds))throw new Error(t('mysql_column_changed'));
      if(await props.onExecute(preview))props.onClose();
    }catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:t('execution_failed'));}
    finally{if(mounted.current)setChecking(false);}
  };
  return <Dialog open fullWidth maxWidth="md" onClose={()=>{if(!props.busy&&!checking)props.onClose();}} data-testid="mysql-column-editor">
    <DialogTitle>{t(props.columnName?'change_definition_of_this_column':'mysql_table_ddl_add_column')} · {props.schema}.{props.table}</DialogTitle>
    <DialogContent sx={{display:'flex',flexDirection:'column',gap:2,pt:'12px !important'}}>
      <Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert><Alert severity="warning">{t('mysql_column_conversion_warning')}</Alert>
      {loading&&<Alert severity="info" role="status">{t('loading')}</Alert>}{error&&<Alert severity="error">{error}</Alert>}{attempted&&props.failureMessage&&<Alert severity="error">{props.failureMessage}</Alert>}
      {props.columnName&&!definition&&!loading&&<Button variant="outlined" disabled={props.busy||props.readonly} onClick={()=>setRetry(value=>value+1)}>{t('retry')}</Button>}
      <Box sx={{display:'flex',gap:2,flexWrap:'wrap'}}>
        <TextField label={t('column_name')} size="small" value={form.name} disabled={locked} onChange={event=>update({name:event.target.value})}/>
        <TextField select label={t('data_type')} size="small" value={form.type} disabled={locked} onChange={event=>{const type=event.target.value;update({type,length:type==='DECIMAL'?'10':/^(CHAR|VARCHAR|BINARY|VARBINARY)$/.test(type)?'100':type==='BIT'?'1':'',scale:type==='DECIMAL'?'0':'',unsigned:/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE)$/.test(type)?form.unsigned:false});}}>{[...new Set([...columnTypes,form.type])].map(type=><MenuItem key={type} value={type}>{type}</MenuItem>)}</TextField>
        <TextField label={t(calendar?'mysql_column_fractional_precision':isDecimal?'precision':'length')} size="small" value={form.length} disabled={locked||!measured} inputProps={{inputMode:'numeric'}} onChange={event=>update({length:event.target.value})}/>
        {isDecimal&&<TextField label={t('scale')} size="small" value={form.scale} disabled={locked} inputProps={{inputMode:'numeric'}} onChange={event=>update({scale:event.target.value})}/>}
        {isNumeric&&<FormControlLabel label="UNSIGNED" control={<Checkbox checked={form.unsigned} disabled={locked||Boolean(column&&/\bzerofill\b/i.test(column.COLUMN_TYPE))} onChange={event=>update({unsigned:event.target.checked})}/>}/>}
      </Box>
      {/^(ENUM|SET)$/.test(form.type)&&<TextField label={t('mysql_column_members')} size="small" value={form.members} disabled={locked} helperText={t('mysql_column_members_help')} onChange={event=>update({members:event.target.value})}/>}
      <FormControlLabel label={t('allow_nulls')} control={<Checkbox checked={form.nullable} disabled={locked||Boolean(column&&Number(column.PK_POSITION)>0)} onChange={event=>update({nullable:event.target.checked})}/>}/>
      <Box sx={{display:'flex',gap:2,flexWrap:'wrap'}}><TextField select label={t('default_value')} size="small" value={form.defaultMode} disabled={locked||generated} onChange={event=>update({defaultMode:event.target.value as MysqlColumnForm['defaultMode']})}>{(['keep','none','null','literal','expression'] as const).filter(mode=>mode!=='keep'||props.columnName).map(mode=><MenuItem key={mode} value={mode}>{t('mysql_column_default_'+mode)}</MenuItem>)}</TextField>{['literal','expression'].includes(form.defaultMode)&&<TextField label={t('value')} size="small" value={form.defaultValue} disabled={locked} onChange={event=>update({defaultValue:event.target.value})}/>}</Box>
      <TextField label={t('comment')} size="small" value={form.comment} disabled={locked} multiline onChange={event=>update({comment:event.target.value})}/>
      {column&&<Box sx={{p:1,bgcolor:'action.hover'}}><Typography variant="caption">{t('mysql_column_attributes_help')}</Typography><Typography component="pre" sx={{fontSize:12,whiteSpace:'pre-wrap'}}>{column.EXTRA||'—'}</Typography>{column.GENERATION_EXPRESSION&&<><Typography variant="caption">{t('mysql_column_generated_help')}</Typography><TextField fullWidth size="small" value={column.GENERATION_EXPRESSION} InputProps={{readOnly:true}} multiline/></>}<Typography variant="caption">{t('mysql_column_preserve_help')}</Typography><Typography component="pre" sx={{fontSize:12,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{definition?.raw}</Typography></Box>}
      {preview&&<><Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{preview.sql}</Typography>{Object.keys(preview.binds).length>0&&<Typography component="pre" sx={{whiteSpace:'pre-wrap'}}>{JSON.stringify(preview.binds,null,2)}</Typography>}<TextField label={t('mysql_table_confirm_name',{name:props.table})} size="small" value={confirm} disabled={locked} onChange={event=>setConfirm(event.target.value)}/></>}
      {attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
    </DialogContent><DialogActions><Button disabled={props.busy||checking} onClick={props.onClose}>{t('close')}</Button><Button disabled={locked||Boolean(props.columnName&&!definition)} onClick={()=>{try{setPreview(buildColumnChange(props.schema,props.table,snapshot,form,definition));setError('');}catch(failure){setError(failure instanceof Error?failure.message:t('execution_failed'));}}}>{t('preview')}</Button><Button variant="contained" disabled={locked||!preview||confirm!==props.table} onClick={()=>void execute()}>{t('execute')}</Button></DialogActions>
  </Dialog>;
}
