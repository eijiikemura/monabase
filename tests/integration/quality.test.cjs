// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadModule}=require('../helpers/loadModule.cjs');
const {verifyQualityDatabase}=require('../helpers/qualityDatabase.cjs');
assert.equal(process.env.MONABASE_DB_TEST_ALLOW_WRITE,'1');
const configs=process.env.MONABASE_TEST_CONFIG?JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG,'utf8')):{};
for(const db of (process.env.MONABASE_TEST_DATABASES||'oracle,postgresql').split(','))test(`${db}: data masking, result comparison and stored regression tests`,{timeout:90000},async t=>{
 assert.ok(['oracle','postgresql'].includes(db));const config={...configs[db]},prefix=db==='oracle'?'MONABASE_ORACLE_':'MONABASE_PG_';
 for(const key of ['host','port','database','user','password'])if(process.env[prefix+key.toUpperCase()]!==undefined)config[key]=process.env[prefix+key.toUpperCase()];
 config.schema=config.schema||(db==='oracle'?config.user:process.env.MONABASE_PG_SCHEMA||'public');
 const Client=loadModule(`electron/${db==='oracle'?'oracle/oracleClient':'postgres/postgresClient'}.js`,{electron:{app:{isPackaged:true}}},{},{strict:false});
 try{await verifyQualityDatabase(t,db,new Client(),new Client(),config);}catch(error){if(error.code==='ERR_ASSERTION')throw error;throw new Error(db+' quality DB checks failed ('+String(error.code||error.errorNum||'operation').replace(/[^A-Za-z0-9_-]/g,'')+'); connection details omitted.');}
});
