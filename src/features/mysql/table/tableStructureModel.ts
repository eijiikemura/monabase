// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import type {MysqlColumn,MysqlTableMetadata} from './tableModel';
export interface MysqlUniquePosition {name:string;position:string;composite:boolean;prefix:string;}
export interface MysqlStructureRow extends MysqlColumn {
  TYPE_DISPLAY:string;LENGTH_PRECISION:string;PK_DISPLAY:string;IS_PK_COMPOSITE:boolean;UK_DATA:MysqlUniquePosition[];NULLABLE_DISPLAY:string;
}
export function structureRows(metadata:MysqlTableMetadata):MysqlStructureRow[]{
  const primaryCount=metadata.columns.filter(column=>Number(column.PK_POSITION)>0).length;
  const unique=new Map<string,typeof metadata.indexes>();
  for(const index of metadata.indexes){if(Number(index.NON_UNIQUE)!==0||index.INDEX_NAME==='PRIMARY')continue;const name=String(index.INDEX_NAME);unique.set(name,[...unique.get(name)||[],index]);}
  return metadata.columns.map(column=>{
    const type=column.DATA_TYPE.toUpperCase(),pk=Number(column.PK_POSITION)>0?String(column.PK_POSITION):'';
    const numeric=/^(?:tinyint|smallint|mediumint|int|bigint|decimal|numeric|float|double|real)$/i.test(column.DATA_TYPE);
    const calendar=/^(?:datetime|timestamp|time)$/i.test(column.DATA_TYPE);
    const length=column.CHARACTER_MAXIMUM_LENGTH,precision=column.NUMERIC_PRECISION,scale=column.NUMERIC_SCALE;
    const size=numeric&&precision!=null?`(${precision}${scale!=null?', '+scale:''})`:calendar?column.DATETIME_PRECISION!=null&&Number(column.DATETIME_PRECISION)>0?String(column.DATETIME_PRECISION):'':length!=null?String(length):'';
    const uk:MysqlUniquePosition[]=[];
    if(!pk)for(const [name,parts] of unique){for(const part of parts){if(part.COLUMN_NAME===column.COLUMN_NAME)uk.push({name,position:String(part.SEQ_IN_INDEX),composite:parts.length>1,prefix:part.SUB_PART==null?'':String(part.SUB_PART)});}}
    return {...column,TYPE_DISPLAY:type+(/\bunsigned\b/i.test(column.COLUMN_TYPE)?' UNSIGNED':'')+(/\bzerofill\b/i.test(column.COLUMN_TYPE)?' ZEROFILL':''),LENGTH_PRECISION:size,PK_DISPLAY:pk,IS_PK_COMPOSITE:primaryCount>1,UK_DATA:uk,NULLABLE_DISPLAY:column.IS_NULLABLE==='YES'?'Yes':'No'};
  });
}
