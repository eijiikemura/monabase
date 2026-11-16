// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {createHash}=require('node:crypto');
const {scanSql}=require('../services/sqlTokens');
const {quoteTriggerIdentifier:q}=require('./triggerDefinition');
const {id,word}=require('./traceSql');
const supported=/^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|bool|boolean|date|datetime|timestamp|time|char|varchar)(?:\(\d+(?:,\s*\d+)?\))?(?: unsigned)?$/i;
function tableNames(source,schema){const tokens=scanSql(source,'mysql'),names=new Set();for(let i=0;i<tokens.length;i++){const token=word(tokens[i]);if(token==='FROM'&&word(tokens[i-1])==='NEXT'&&word(tokens[i-2])==='FETCH')continue;if(!['FROM','UPDATE'].includes(token)&&!(token==='INTO'&&word(tokens[i-1])==='INSERT'))continue;let name=id(tokens[i+1]);if(!name)throw new Error('Trace SQL requires literal table names.');if(tokens[i+2]?.text==='.'){if(name!==schema)throw new Error('Trace SQL cannot access another database.');name=id(tokens[i+3]);}if(!name)throw new Error('Invalid trace table name.');q(name);names.add(name);}if(names.size>8)throw new Error('Trace SQL supports at most eight isolated tables.');return [...names];}
async function describeTraceTables(client,info){
 const names=tableNames(info.source,info.schema),tables=[];
 for(const name of names){const binds={schema:info.schema,name},query=async sql=>(await client.execute(sql,binds,null,false,true)).rows;
  const rows=await query('SELECT ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY :schema AND BINARY TABLE_NAME=BINARY :name');if(rows.length!==1||rows[0].ENGINE!=='InnoDB'||rows[0].TABLE_TYPE!=='BASE TABLE')throw new Error('SQL tracing supports accessible InnoDB base tables only; views are refused.');
  const ddl=(await query(`SHOW CREATE TABLE ${q(info.schema)}.${q(name)}`))[0]?.['Create Table'];if(typeof ddl!=='string'||/\b(?:TABLESPACE|DATA DIRECTORY|INDEX DIRECTORY)\b/i.test(ddl))throw new Error('This table storage definition is unsupported for isolated tracing.');
  const fields=await query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY :schema AND BINARY TABLE_NAME=BINARY :name ORDER BY ORDINAL_POSITION');if(!fields.length||fields.length>64)throw new Error('SQL trace tables support 1 to 64 columns.');
  tables.push({name,fingerprint:createHash('sha256').update(ddl).digest('hex'),columns:fields.map(r=>({name:String(r.COLUMN_NAME),type:String(r.COLUMN_TYPE),nullable:r.IS_NULLABLE==='YES',required:r.IS_NULLABLE==='NO'&&r.COLUMN_DEFAULT==null&&!r.GENERATION_EXPRESSION&&!/auto_increment/i.test(String(r.EXTRA)),generated:Boolean(r.GENERATION_EXPRESSION),supported:supported.test(String(r.COLUMN_TYPE))}))});
 }
 return tables;
}
function validateFixtures(fixtures,tables,{targetTable}={}){
 const input=fixtures??{};if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!tables.some(t=>t.name===name)||name===targetTable))throw new Error('Provide fixtures only for the listed SQL tables; use OLD/NEW for the trigger target.');
 let count=0;const result=Object.create(null);for(const [name,rows] of Object.entries(input)){if(!Array.isArray(rows))throw new Error('Each trace table fixture must be an array of row objects.');count+=rows.length;if(count>1000)throw new Error('Trace fixtures exceed 1,000 rows.');const table=tables.find(t=>t.name===name);result[name]=rows.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Trace fixture rows must be JSON objects.');for(const [key,value] of Object.entries(row)){const column=table.columns.find(c=>c.name===key&&!c.generated&&c.supported);if(!column||value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isSafeInteger(value)||typeof value==='string'&&Buffer.byteLength(value)>8192)throw new Error('Unsupported trace fixture column or value; use text for exact decimals.');}return Object.fromEntries(Object.entries(row));});}
 if(Buffer.byteLength(JSON.stringify(result))>1024*1024)throw new Error('Trace fixtures exceed 1 MiB.');return Object.fromEntries(Object.entries(result));
}
function createTableSandbox(query,schema,tables,name,{targetTable,targetCopy}={}){
 const copies=tables.map((t,i)=>({...t,copyName:t.name===targetTable?targetCopy:name+'_t'+i})),created=[],uncertain=[];
 return {tables:copies,
  async create(){for(const t of copies){try{await query(`CREATE TABLE ${q(schema)}.${q(t.copyName)} LIKE ${q(schema)}.${q(t.name)}`);created.push(t);}catch(error){if(!/^ER_/.test(error.code||'')||['ER_QUERY_INTERRUPTED','ER_QUERY_TIMEOUT'].includes(error.code)){uncertain.push(t);error.message='Trace table setup result is unknown: '+schema+'.'+t.copyName+'. Verify this copy manually; no retry was attempted.';}throw error;}}},
  async seed(fixtures){for(const t of copies)for(const row of (Object.hasOwn(fixtures,t.name)?fixtures[t.name]:[])){const entries=Object.entries(row);await query(`INSERT INTO ${q(schema)}.${q(t.copyName)} (${entries.map(([k])=>q(k)).join(',')}) VALUES (${entries.map(()=>'?').join(',')})`,entries.map(([,v])=>v));}},
  async remove(){for(const t of [...created].reverse()){const [rows]=await query('SELECT COUNT(*) FROM '+q(schema)+'.'+q(t.copyName));if(Number(rows[0][0])!==0)throw new Error('Trace rollback could not be confirmed: '+schema+'.'+t.copyName);await query('DROP TABLE '+q(schema)+'.'+q(t.copyName));created.splice(created.indexOf(t),1);}},
  names(){return [...created,...uncertain].map(t=>schema+'.'+t.copyName);}
 };
}
module.exports={tableNames,describeTraceTables,validateFixtures,createTableSandbox};
