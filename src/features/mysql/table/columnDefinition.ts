// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {tokenizeSql} from '@/features/sql/sqlScript';
import {tableDefinitionParts} from '../index/indexModel';
import {quoteMysql,mysqlTableName,isGenerated,type MysqlColumn,type MysqlTableMetadata,type MysqlStatement} from './tableModel';
export interface MysqlColumnForm {name:string;type:string;length:string;scale:string;unsigned:boolean;members:string;nullable:boolean;defaultMode:'keep'|'none'|'null'|'literal'|'expression';defaultValue:string;comment:string;}
interface Range {start:number;end:number;}
export interface MysqlColumnDefinition {raw:string;name:string;type:Range;attributes:Partial<Record<'nullable'|'default'|'comment'|'charset'|'collation',Range>>;generated:boolean;}
export const columnTypes=['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','DECIMAL','FLOAT','DOUBLE','CHAR','VARCHAR','BINARY','VARBINARY','BIT','TEXT','TINYTEXT','MEDIUMTEXT','LONGTEXT','BLOB','TINYBLOB','MEDIUMBLOB','LONGBLOB','DATE','TIME','DATETIME','TIMESTAMP','YEAR','JSON','ENUM','SET','GEOMETRY','POINT','LINESTRING','POLYGON','MULTIPOINT','MULTILINESTRING','MULTIPOLYGON','GEOMETRYCOLLECTION'];
const numeric=(type:string)=>/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE)$/.test(type);
const character=(type:string)=>/^(CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET)$/.test(type);
const unquote=(text:string)=>text.startsWith('`')?text.slice(1,-1).replaceAll('``','`'):text;
// Native version comments stay byte-for-byte in the output while their contents remain opaque.
const tokens=(source:string)=>tokenizeSql(source.replace(/\/\*!(?=\d{5,6}\s)/g,'/* '),'mysql');
export function columnDefinition(source:string,name:string):MysqlColumnDefinition{
  const parts=tableDefinitionParts(source).filter(part=>{const first=tokens(part)[0];return first&&first.kind==='quoted'&&first.text.startsWith('`')&&unquote(first.text)===name;});
  if(parts.length!==1)throw new Error('The exact native column definition is unavailable.');
  const raw=parts[0],ts=tokens(raw);let i=2;
  if(!ts[1]||ts[1].kind!=='word')throw new Error('The native column type is unavailable.');
  const word=(at:number,value:string)=>ts[at]?.kind==='word'&&ts[at].text.toUpperCase()===value;
  const group=(at:number)=>{let depth=0;for(let j=at;j<ts.length;j++){if(ts[j].text==='(')depth++;if(ts[j].text===')'&&--depth===0)return j+1;}throw new Error('An attribute expression is incomplete.');};
  if(word(i,'PRECISION')&&word(i-1,'DOUBLE'))i++;
  if(ts[i]?.text==='(')i=group(i);
  while(word(i,'UNSIGNED')||word(i,'ZEROFILL'))i++;
  const type={start:ts[1].start,end:ts[i-1].end},attributes:MysqlColumnDefinition['attributes']={};
  const valueEnd=(at:number)=>{if(ts[at]?.text==='(')return group(at);if(ts[at]?.text==='-'||ts[at]?.text==='+')at++;if(!ts[at])throw new Error('A native column attribute is incomplete.');let end=at+1;if(ts[end]?.kind==='quoted'&&ts[at].kind==='word'&&/^(?:b|x|_[a-z0-9]+)$/i.test(ts[at].text))end++;if(ts[end]?.text==='(')end=group(end);return end;};
  let generated=false;
  while(i<ts.length){
    const start=i;
    if(word(i,'GENERATED')||word(i,'AS')){generated=true;if(word(i,'AS')&&ts[i+1]?.text==='('){i=group(i+1);continue;}}
    if(word(i,'DEFAULT')){i=valueEnd(i+1);attributes.default={start:ts[start].start,end:ts[i-1].end};continue;}
    if(word(i,'COMMENT')){i++;if(ts[i]?.kind!=='quoted')throw new Error('The native column comment is invalid.');attributes.comment={start:ts[start].start,end:ts[i].end};i++;continue;}
    if(word(i,'NOT')&&word(i+1,'NULL')){attributes.nullable={start:ts[i].start,end:ts[i+1].end};i+=2;continue;}
    if(word(i,'NULL')){attributes.nullable={start:ts[i].start,end:ts[i].end};i++;continue;}
    if(word(i,'CHARACTER')&&word(i+1,'SET')||word(i,'CHARSET')){i+=word(i,'CHARACTER')?2:1;if(!ts[i])throw new Error('The native charset is unavailable.');attributes.charset={start:ts[start].start,end:ts[i].end};i++;continue;}
    if(word(i,'COLLATE')){i++;if(!ts[i])throw new Error('The native collation is unavailable.');attributes.collation={start:ts[start].start,end:ts[i].end};i++;continue;}
    if(ts[i].text==='('){i=group(i);continue;}i++;
  }
  return {raw,name,type,attributes,generated};
}
export function columnForm(column?:MysqlColumn):MysqlColumnForm{
  const type=column?.DATA_TYPE.toUpperCase()||'VARCHAR';
  const args=column?.COLUMN_TYPE.match(/^[^(]+\((.*)\)/s)?.[1]||'';
  const measured=/^(CHAR|VARCHAR|BINARY|VARBINARY|BIT|DECIMAL|TIME|DATETIME|TIMESTAMP)$/.test(type);
  return {name:column?.COLUMN_NAME||'',type,length:measured?args.split(',')[0].trim():column?'':'100',scale:type==='DECIMAL'?args.split(',')[1]?.trim()||'0':'',unsigned:column?/\bunsigned\b/i.test(column.COLUMN_TYPE):false,members:/^(ENUM|SET)$/.test(type)?args:'',nullable:column?column.IS_NULLABLE==='YES':true,defaultMode:column?'keep':'none',defaultValue:'',comment:column?.COLUMN_COMMENT||''};
}
function scalarExpression(input:string){
  if(!input.trim()||input.length>4096)throw new Error('Enter a scalar default expression of at most 4096 characters.');
  const ts=tokenizeSql(input,'mysql');let depth=0;
  const denied=new Set(['SELECT','INSERT','UPDATE','DELETE','CREATE','DROP','ALTER','GRANT','REVOKE','INTO','OUTFILE','DUMPFILE','LOAD_FILE','GET_LOCK','RELEASE_LOCK','SLEEP','BENCHMARK','SET','USE']);
  for(const token of ts){if(token.text==='(')depth++;else if(token.text===')'){if(--depth<0)throw new Error('Unbalanced default expression.');}else if(token.text===';'||token.text==='@'||token.text===','&&depth===0||token.kind==='word'&&denied.has(token.text.toUpperCase()))throw new Error('Enter one scalar expression without statements or server operations.');}
  if(depth||!ts.length)throw new Error('Unbalanced default expression.');return ts.map(token=>token.text).join(' ');
}
function formType(form:MysqlColumnForm,column?:MysqlColumn){
  if(!columnTypes.includes(form.type))throw new Error('Choose a supported MySQL column type.');
  let result=form.type;
  const integer=(value:string,min:number,max:number)=>{if(!/^\d{1,5}$/.test(value)||Number(value)<min||Number(value)>max)throw new Error('The column length or precision is out of range.');return String(Number(value));};
  if(/^(CHAR|VARCHAR|BINARY|VARBINARY)$/.test(form.type))result+='('+integer(form.length,1,/^(CHAR|BINARY)$/.test(form.type)?255:65535)+')';
  else if(form.type==='BIT')result+='('+integer(form.length,1,64)+')';
  else if(form.type==='DECIMAL'){const p=integer(form.length,1,65),s=integer(form.scale,0,30);if(Number(s)>Number(p))throw new Error('Scale must not exceed precision.');result+=`(${p},${s})`;}
  else if(/^(TIME|DATETIME|TIMESTAMP)$/.test(form.type)&&form.length!=='')result+='('+integer(form.length,0,6)+')';
  else if(/^(ENUM|SET)$/.test(form.type)){
    const ts=tokenizeSql(form.members,'mysql');if(!ts.length||ts.length%2!==1||ts.some((token,i)=>i%2?token.text!==',':token.kind!=='quoted'||token.text.startsWith('`')))throw new Error('Enter comma-separated quoted ENUM or SET members.');result+='('+ts.map(token=>token.text).join('')+')';
  }
  if(numeric(form.type)&&form.unsigned)result+=' UNSIGNED';
  if(column&&numeric(form.type)&&/\bzerofill\b/i.test(column.COLUMN_TYPE))result+=' ZEROFILL';
  return result;
}
export function buildColumnChange(schema:string,table:string,metadata:MysqlTableMetadata,form:MysqlColumnForm,definition?:MysqlColumnDefinition):MysqlStatement{
  if(metadata.table.TABLE_TYPE!=='BASE TABLE'||metadata.table.ENGINE?.toLowerCase()!=='innodb')throw new Error('Column editing requires an InnoDB base table.');
  quoteMysql(form.name);
  const column=definition?metadata.columns.find(column=>column.COLUMN_NAME===definition.name):undefined;
  if(definition&&!column)throw new Error('Reload the column metadata before editing.');
  if(metadata.columns.some(existing=>existing.COLUMN_NAME.toLowerCase()===form.name.toLowerCase()&&existing.COLUMN_NAME!==column?.COLUMN_NAME))throw new Error('A column with this name already exists.');
  const original=columnForm(column),binds:Record<string,unknown>={},changes:{range:Range;text:string}[]=[],added:string[]=[];
  const replace=(key:keyof MysqlColumnDefinition['attributes'],text:string)=>{const range=definition?.attributes[key];if(range)changes.push({range,text});else if(text)added.push(text);};
  if(column&&Number(column.PK_POSITION)>0&&form.nullable)throw new Error('Primary key columns cannot be nullable.');
  const typeChanged=!column||['type','length','scale','unsigned','members'].some(key=>form[key as keyof MysqlColumnForm]!==original[key as keyof MysqlColumnForm]);
  let native=definition?.raw||quoteMysql(form.name)+' '+formType(form);
  if(definition&&typeChanged){changes.push({range:definition.type,text:formType(form,column)});if(!character(form.type)){replace('charset','');replace('collation','');}}
  if(column&&form.name!==column.COLUMN_NAME)changes.push({range:{start:0,end:tokens(native)[0].end},text:quoteMysql(form.name)});
  if(!column||form.nullable!==original.nullable)replace('nullable',form.nullable?'NULL':'NOT NULL');
  if(form.defaultMode!=='keep'){
    if(column&&isGenerated(column)||definition?.generated)throw new Error('Generated-column defaults are managed by their expression.');
    if(form.defaultMode==='null'&&!form.nullable)throw new Error('DEFAULT NULL requires a nullable column.');
    let clause='';
    if(form.defaultMode==='null')clause='DEFAULT NULL';
    if(form.defaultMode==='literal'){binds.columnDefault=form.defaultValue;clause='DEFAULT :columnDefault';}
    if(form.defaultMode==='expression')clause='DEFAULT ('+scalarExpression(form.defaultValue)+')';
    replace('default',clause);
  }
  if(!column||form.comment!==original.comment){binds.columnComment=form.comment;replace('comment','COMMENT :columnComment');}
  if(!definition&&form.defaultMode==='keep')throw new Error('A new column has no existing default.');
  if(definition&&!changes.length&&!added.length)throw new Error('No column changes to save.');
  for(const change of changes.sort((a,b)=>b.range.start-a.range.start))native=native.slice(0,change.range.start)+change.text+native.slice(change.range.end);
  native=(native+' '+added.join(' ')).trim();
  // MySQL 8.4 accepts INVISIBLE directly; do not pass executable comments through SQL guards.
  // Quoted values are opaque, including comments that merely mention this native syntax.
  native=native.replace(/('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|`(?:``|[^`])*`)|\/\*!\d{5,6}\s+INVISIBLE\s*\*\//gi,(_match,quoted:string|undefined)=>quoted??'INVISIBLE');
  return {sql:`ALTER TABLE ${mysqlTableName(schema,table)} ${definition?'CHANGE COLUMN '+quoteMysql(definition.name):'ADD COLUMN'} ${native}`,binds};
}
