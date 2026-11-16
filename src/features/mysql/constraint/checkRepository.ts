// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {backgroundRows,loadTableMetadata} from '../table/tableRepository';
import {mysqlTableName} from '../table/tableModel';
import {nativeCheckDefinition,type MysqlCheckDetails} from './checkModel';
export async function loadMysqlCheck(schema:string,table:string,name:string):Promise<MysqlCheckDetails>{
  const metadata=await loadTableMetadata(schema,table),rows=metadata.checks.filter(row=>row.CONSTRAINT_NAME===name);
  if(rows.length!==1||!['YES','NO'].includes(String(rows[0].ENFORCED)))throw new Error('The CHECK constraint or its enforcement state is unavailable.');
  const source=(await backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(schema,table)}`,{}))[0]?.['Create Table'];
  if(typeof source!=='string')throw new Error('The native table definition is unavailable.');
  const native=nativeCheckDefinition(source,name),enforced=rows[0].ENFORCED==='YES';
  return {...native,enforced,fingerprint:JSON.stringify([native.definition,enforced,metadata.table.ENGINE,metadata.columns.map(c=>[c.COLUMN_NAME,c.COLUMN_TYPE,c.IS_NULLABLE,c.COLLATION_NAME,c.GENERATION_EXPRESSION])])};
}
