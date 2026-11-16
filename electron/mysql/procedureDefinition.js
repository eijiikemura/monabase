// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {scanSql}=require('../services/sqlTokens');
const {validateBody,validateLexical,quoteTriggerIdentifier:q}=require('./triggerDefinition');
function parseProcedure(source,schema,name,kind='PROCEDURE'){
  if(!['PROCEDURE','FUNCTION'].includes(kind))throw new Error('Invalid MySQL routine kind.');
  q(schema);q(name);
  if(typeof source!=='string'||!source.trim()||source.includes('\0')||Buffer.byteLength(source)>1024*1024)throw new Error('Enter one MySQL procedure definition of at most 1 MiB.');
  validateLexical(source);
  const tokens=scanSql(source,'mysql');let i=0;
  const word=value=>tokens[i]?.kind==='word'&&tokens[i].text.toUpperCase()===value;
  const expect=value=>{if(!word(value))throw new Error('Expected '+value+' in a MySQL CREATE PROCEDURE definition.');i++;};
  const id=()=>{const t=tokens[i++];if(t?.kind==='word')return t.text;if(t?.kind==='quoted'&&t.text.startsWith('`'))return t.text.slice(1,-1).replaceAll('``','`');throw new Error('Invalid procedure identifier.');};
  expect('CREATE');let definer;
  if(word('DEFINER')){i++;if(tokens[i++]?.text!=='=')throw new Error('Invalid procedure definer.');const start=tokens[i]?.start;
    if(word('CURRENT_USER')){i++;if(tokens[i]?.text==='('){i++;if(tokens[i++]?.text!==')')throw new Error('Invalid definer.');}}
    else {const a=tokens[i++];if(!a||!['word','quoted'].includes(a.kind)||tokens[i++]?.text!=='@')throw new Error('Invalid definer.');const b=tokens[i++];if(!b||!['word','quoted'].includes(b.kind))throw new Error('Invalid definer.');}
    definer=source.slice(start,tokens[i-1].end);
  }
  expect(kind);let db=schema,target=id();if(tokens[i]?.text==='.'){i++;db=target;target=id();}
  if(db!==schema||target!==name)throw new Error('The procedure database and name must match the selected target.');
  if(tokens[i]?.text!=='(')throw new Error('The procedure parameter list is missing.');const parameterStart=tokens[i].start;let depth=0;
  do {const token=tokens[i++];if(!token)throw new Error('The parameter list is incomplete.');if(token.text==='(')depth++;if(token.text===')')depth--;if(token.text===';'||token.kind==='word'&&['CREATE','DROP','ALTER','GRANT','REVOKE','DELIMITER'].includes(token.text.toUpperCase()))throw new Error('Invalid procedure parameters.');}while(depth);
  const parameters=source.slice(parameterStart,tokens[i-1].end);
  let returns='';
  if(kind==='FUNCTION'){
    expect('RETURNS');const returnStart=tokens[i]?.start;
    const types=new Set(['BIT','TINYINT','SMALLINT','MEDIUMINT','INT','INTEGER','BIGINT','DECIMAL','DEC','NUMERIC','FIXED','FLOAT','DOUBLE','REAL','BOOL','BOOLEAN','DATE','TIME','TIMESTAMP','DATETIME','YEAR','CHAR','VARCHAR','NCHAR','NVARCHAR','BINARY','VARBINARY','TINYBLOB','BLOB','MEDIUMBLOB','LONGBLOB','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT','ENUM','SET','JSON','GEOMETRY','POINT','LINESTRING','POLYGON','MULTIPOINT','MULTILINESTRING','MULTIPOLYGON','GEOMETRYCOLLECTION']);
    if(!types.has(tokens[i]?.text.toUpperCase()))throw new Error('A supported RETURNS data type is required.');i++;
    if(tokens[i-1].text.toUpperCase()==='DOUBLE'&&word('PRECISION'))i++;
    if(tokens[i]?.text==='('){let level=0;do{const token=tokens[i++];if(!token||token.text===';')throw new Error('Invalid function return type.');if(token.text==='(')level++;if(token.text===')')level--;}while(level);}
    while(word('UNSIGNED')||word('ZEROFILL')||word('BINARY')||word('ASCII')||word('UNICODE')||word('CHARSET')||word('CHARACTER')||word('COLLATE')){
      if(word('CHARSET')||word('COLLATE')){i++;id();}
      else if(word('CHARACTER')){i++;expect('SET');id();}
      else i++;
    }
    returns=source.slice(returnStart,tokens[i-1].end);
  }
  const characterStart=tokens[i]?.start;
  while(tokens[i]){
    if(word('LANGUAGE')){i++;expect('SQL');}
    else if(word('NOT')){i++;expect('DETERMINISTIC');}
    else if(word('DETERMINISTIC'))i++;
    else if(word('CONTAINS')||word('NO')){i++;expect('SQL');}
    else if(word('READS')||word('MODIFIES')){i++;expect('SQL');expect('DATA');}
    else if(word('SQL')){i++;expect('SECURITY');if(!word('DEFINER')&&!word('INVOKER'))throw new Error('Invalid SQL SECURITY.');i++;}
    else if(word('COMMENT')){i++;if(tokens[i]?.kind!=='quoted'||tokens[i].text[0]==='`')throw new Error('Invalid procedure comment.');i++;}
    else break;
  }
  if(!tokens[i])throw new Error('The procedure body is missing.');
  const body=source.slice(tokens[i].start),characteristics=source.slice(characterStart,tokens[i].start).trim();
  const parsedBody=validateBody(body,kind==='FUNCTION'?'function':true);
  if(kind==='FUNCTION'&&!scanSql(parsedBody,'mysql').some(token=>token.kind==='word'&&token.text.toUpperCase()==='RETURN'))throw new Error('A MySQL function body must contain RETURN.');
  return {parameters,characteristics,body:parsedBody,definer,returns};
}
function buildProcedure(source,schema,name,definer='CURRENT_USER',kind='PROCEDURE'){
  const parsed=parseProcedure(source,schema,name,kind);
  return `CREATE DEFINER=${definer} ${kind} ${q(schema)}.${q(name)}${parsed.parameters}${kind==='FUNCTION'?'\nRETURNS '+parsed.returns:''}\n${parsed.characteristics}\n${parsed.body}`;
}
module.exports={parseProcedure,buildProcedure};
