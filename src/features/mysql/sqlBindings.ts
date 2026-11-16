// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {findSqlBindNames,replaceSqlBinds} from '@/features/sql/sqlScript';
import {canonicalTemporalInput} from '@/shared/utils/temporalValues';
export interface MysqlBinding {type:'STRING'|'NUMBER'|'DATE';value:string;isNull:boolean;}
export function mysqlBindingNames(sql:string){try{return findSqlBindNames(sql,'mysql');}catch{return [];}}
function numberValue(text:string){
 const match=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text.trim());if(!match||text.length>200)throw new Error('mysql_bind_invalid_number');
 const fraction=match[3]??match[4]??'',exponent=Number(match[5]||0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)throw new Error('mysql_bind_invalid_number');
 let scale=fraction.length-exponent,units=BigInt((match[1]==='-'?'-':'')+((match[2]??'0')+fraction));if(scale<0){units*=10n**BigInt(-scale);scale=0;}while(scale>0&&units%10n===0n){units/=10n;scale--;}
 const negative=units<0n,digits=(negative?-units:units).toString().padStart(scale+1,'0'),whole=digits.length-scale;if(scale>30||whole+scale>65)throw new Error('mysql_bind_invalid_number');return {scale,value:(negative?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits)};
}
export function mysqlBindingValues(names:string[],bindings:Record<string,MysqlBinding>,format:string){
 return Object.fromEntries(names.map(name=>{const field=bindings[name]||{type:'STRING',value:'',isNull:false};if(field.isNull)return [name,null];if(field.type==='NUMBER')return [name,numberValue(field.value).value];if(field.type==='DATE'){const value=canonicalTemporalInput(field.value,format);if(!value)throw new Error('mysql_bind_invalid_date');return [name,value];}return [name,field.value];}));
}
export function mysqlBindingSql(source:string,bindings:Record<string,MysqlBinding>){
 const replacements=Object.fromEntries(mysqlBindingNames(source).flatMap(name=>{const field=bindings[name];if(!field||field.type==='STRING')return [];return [[name,field.type==='DATE'?`CAST(:${name} AS DATETIME(6))`:`CAST(:${name} AS DECIMAL(65,${field.isNull?0:numberValue(field.value).scale}))`]];}));
 return replaceSqlBinds(source,replacements,'mysql');
}
