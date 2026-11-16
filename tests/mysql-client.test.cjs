// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSql, assertReadOnly } = require('../electron/mysql/sqlText');
const { observeTransactionState } = require('../electron/mysql/transactionState');
const { EventEmitter } = require('node:events');

test('MySQL SQL boundaries preserve quoting, comments, duplicate bindings and default escape semantics', () => {
  const statement = inspectSql("SELECT 'a;:id', `a``b`, :id, :ID # :missing\n-- ignored\n;", { id: '9007199254740993' });
  assert.deepEqual(statement.values, ['9007199254740993', '9007199254740993']);
  assert.match(statement.sql, /'a;:id'/);
  assert.match(inspectSql("SELECT 1--2").sql, /1--2/);
  assert.doesNotThrow(() => inspectSql('CREATE TABLE t(i INT) ENGINE = InnoDB'));
  assert.throws(() => inspectSql('CREATE TABLE t(i INT) ENGINE = `MyISAM`'));
  assert.throws(() => inspectSql("SELECT `get_lock`('test',0)"));
  assert.doesNotThrow(() => inspectSql(String.raw`SELECT 'a\';b'`));
  for (const sql of ['SELECT 1; DELETE FROM t', '/*!50000 DELETE FROM t */', 'DELIMITER $$', 'CREATE PROCEDURE p() BEGIN SELECT 1; END', "SET sql_mode='ANSI_QUOTES'", 'SET autocommit=1', 'START TRANSACTION READ WRITE', 'COMMIT AND CHAIN', 'CREATE TABLE t(i INT) ENGINE=MyISAM', "SELECT LOAD_FILE('/tmp/x')", "SELECT 1 INTO OUTFILE '/tmp/x'", 'SELECT :missing', "SELECT 'unclosed"]) assert.throws(() => inspectSql(sql), undefined, sql);
});

test('MySQL read-only policy rejects DML CTEs, locking reads and ANALYZE execution', () => {
  for (const sql of ['SELECT 1', 'SHOW TABLES', 'EXPLAIN SELECT 1', 'WITH c AS (SELECT 1) SELECT * FROM c']) assert.doesNotThrow(() => assertReadOnly(inspectSql(sql)));
  for (const sql of ['DELETE FROM t', 'WITH c AS (SELECT 1) UPDATE t SET a=1', 'SELECT * FROM t FOR UPDATE', 'EXPLAIN ANALYZE SELECT 1', 'SELECT 1 INTO @x']) assert.throws(() => assertReadOnly(inspectSql(sql)));
});

test('MySQL status observer does not modify packets or send commands and invalidates errors', () => {
  class Query {}
  const connection = new EventEmitter();
  connection._command = new Query();
  connection._command.next = function resultsetHeader() {};
  const seen = [];
  connection.handlePacket = packet => seen.push(packet);
  const monitor = observeTransactionState(connection);
  assert.equal(monitor.get().transactionStatus, 'unknown');
  const buffer = Buffer.from([0, 0, 0, 3, 0, 0, 0]);
  const packet = { buffer, offset: 0, end: 7, isEOF: () => false };
  connection.handlePacket(packet);
  assert.deepEqual(monitor.get(), { transactionStatus: 'active', autocommit: true });
  assert.deepEqual(buffer, Buffer.from([0, 0, 0, 3, 0, 0, 0]));
  assert.equal(packet.offset, 0);
  connection.handlePacket({ buffer: Buffer.from([255]), offset: 0, end: 1 });
  assert.equal(monitor.get().transactionStatus, 'unknown');
  assert.equal(seen.length, 2);
});

test('MySQL rejects unsafe numeric and oversized bind inputs before constructing a query', () => {
  assert.throws(() => inspectSql('SELECT :value', { value: 9007199254740992 }), /inexact/);
  assert.throws(() => inspectSql('SELECT :value', { value: Infinity }), /inexact/);
  assert.throws(() => inspectSql('SELECT :value', { value: 'x'.repeat(1024 * 1024 + 1) }), /exceed/);
  assert.throws(() => inspectSql('SELECT :value', { value: {} }), /Unsupported bind/);
});

test('MySQL native session trackers separate reads from writes without mutating result packets', () => {
  class ClientHandshake { constructor() { this.clientFlags = 0; } }
  class Query { constructor() { this.next = function row() {}; } row() {} done() { this.finished = true; } }
  const connection = new EventEmitter(), packets = [];
  connection.config = { clientFlags: 0 }; connection._command = new ClientHandshake();
  connection._handshakePacket = { capabilityFlags: 0x01800000 };
  connection.handlePacket = packet => { packets.push(packet); if (connection._command.next?.name === 'transactionResultEnd') connection._command.next(); };
  const monitor = observeTransactionState(connection, { trackWrites: true }); monitor.verifyCapabilities();
  assert.equal(connection.config.clientFlags & 0x01800000, 0x01800000);
  assert.equal(connection._command.clientFlags & 0x01800000, 0x01800000);
  const send = (state, status = 1, marker = 254) => {
    const tracker = state === undefined ? [] : [11, 5, 9, 8, ...Buffer.from(state)];
    const flags = status | (state === undefined ? 0 : 0x4000);
    const buffer = Buffer.from([marker, 0, 0, flags & 255, flags >> 8, 0, 0, 0, ...tracker]);
    const before = Buffer.from(buffer), packet = { buffer, offset: 0, end: buffer.length, isEOF: () => buffer[0] === 254 && buffer.length < 13 };
    connection._command = new Query(); connection.handlePacket(packet);
    assert.equal(packet.offset, 0); assert.deepEqual(buffer, before); if (state !== 'INVALID!') assert.equal(connection._command.finished, marker === 254 ? true : undefined);
  };
  send('I_R___S_'); assert.equal(monitor.get().transactionStatus, 'active'); assert.equal(monitor.get().hasUncommittedTx, false);
  send('I_R_W_S_'); assert.equal(monitor.get().hasUncommittedTx, true);
  send(undefined); assert.equal(monitor.get().hasUncommittedTx, true, 'A later SELECT must not clear earlier writes.');
  send('________', 0); assert.equal(monitor.get().hasUncommittedTx, false);
  send('T_______'); assert.equal(monitor.get().hasUncommittedTx, false, 'BEGIN alone is not a pending write.');
  connection._command = new Query(); connection._command.next = function fieldsEOF() {};
  const row = { buffer: Buffer.from([0]), offset: 0, end: 1, isEOF: () => false };
  connection.handlePacket(row); assert.equal(connection._command.next, connection._command.row); assert.equal(monitor.get().hasUncommittedTx, false);
  assert.equal(packets.at(-1), row);
  const large = Buffer.alloc(0xffffff + 1); large[0] = 254;
  connection._command = new Query(); connection.handlePacket({ buffer: large, offset: 0, end: large.length, isEOF: () => false });
  assert.equal(connection._command.finished, undefined, 'A large length-coded row is not a result terminator.');
  send('INVALID!'); assert.equal(monitor.get().transactionStatus, 'unknown');
  send('________', 0); assert.equal(monitor.get().transactionStatus, 'unknown', 'A malformed tracker requires reconnection, not a later guessed idle state.');
});


test('MySQL tracked result terminators continue CALL result sets until the final server status',()=>{
  class ClientHandshake{constructor(){this.clientFlags=0;}}
  class Query{constructor(){this.next=function row(){};this._resultIndex=0;}done(){this.finished=true;}resultsetHeader(){}}
  const connection=new EventEmitter();connection.config={clientFlags:0};connection._command=new ClientHandshake();connection._handshakePacket={capabilityFlags:0x01800000};
  connection.handlePacket=()=>{connection._command.next=connection._command.next.call(connection._command);};
  const monitor=observeTransactionState(connection,{trackWrites:true});monitor.verifyCapabilities();const command=new Query();connection._command=command;
  const packet=flags=>{const buffer=Buffer.from([254,0,0,flags,0,0,0,0]);return {buffer,offset:0,end:buffer.length,isEOF:()=>true};};
  connection.handlePacket(packet(9));assert.equal(command.finished,undefined);assert.equal(command._resultIndex,1);assert.equal(command.next,command.resultsetHeader);
  command.next=function row(){};connection.handlePacket(packet(1));assert.equal(command.finished,true);assert.equal(monitor.get().transactionStatus,'active');
});
