// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const DEPRECATE_EOF = 0x01000000;
const SESSION_TRACK = 0x00800000;

// mysql2 3.24.6 expects legacy EOF packets. On the main connection, negotiate
// OK result terminators so native transaction trackers also arrive after SELECT.
// Only adapt the pinned text Query state transitions; never mutate packet data/offsets.
function observeTransactionState(connection, { trackWrites = false } = {}) {
  if (require('mysql2/package.json').version !== '3.24.6') throw new Error('MySQL driver status adapter requires verification for this version.');
  if (typeof connection.handlePacket !== 'function') throw new Error('MySQL protocol status adapter is unavailable.');
  if (trackWrites) {
    if (!Number.isInteger(connection.config?.clientFlags)) throw new Error('MySQL session tracking capabilities are unavailable.');
    if (connection._command?.constructor?.name !== 'ClientHandshake') throw new Error('MySQL transaction tracking must be installed before the handshake.');
    connection.config.clientFlags |= DEPRECATE_EOF | SESSION_TRACK;
    connection._command.clientFlags |= DEPRECATE_EOF | SESSION_TRACK;
  }
  const original = connection.handlePacket;
  let status, writes = false, protocolInvalid = false;
  const invalidate = () => { status = undefined; };
  connection.on('error', invalidate);
  connection.on('end', invalidate);
  connection.handlePacket = function (packet) {
    const command = this._command;
    if (packet && ['Query', 'Execute', 'Ping'].includes(command?.constructor?.name)) {
      const data = packet.buffer;
      let offset = packet.offset;
      const limit = packet.end;
      const requireBytes = count => { if (offset + count > limit) throw new Error('Invalid status packet.'); };
      const integer = () => {
        requireBytes(1);
        const first = data[offset++];
        const width = first === 252 ? 2 : first === 253 ? 3 : first === 254 ? 8 : 0;
        if (!width) { if (first >= 251) throw new Error('Invalid status length.'); return first; }
        requireBytes(width);
        const value = width === 8 ? data.readBigUInt64LE(offset) : BigInt(data.readUIntLE(offset, width));
        offset += width;
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid status length.');
        return Number(value);
      };
      const skipNumber = () => {
        requireBytes(1); const first = data[offset++];
        const width = first === 252 ? 2 : first === 253 ? 3 : first === 254 ? 8 : 0;
        if (!width && first >= 251) throw new Error('Invalid status packet.');
        requireBytes(width); offset += width;
      };
      const readOk = () => {
        offset++; skipNumber(); skipNumber(); requireBytes(4);
        status = data.readUInt16LE(offset); offset += 4;
        if (!(status & 1)) writes = false;
        if (!trackWrites) return;
        if (offset === limit) { if (status & 0x4000) throw new Error('Missing session tracker.'); return; }
        const infoLength = integer(); requireBytes(infoLength); offset += infoLength;
        if (!(status & 0x4000)) return;
        const stateLength = integer(); requireBytes(stateLength);
        const end = offset + stateLength;
        while (offset < end) {
          const type = data[offset++], length = integer(), itemEnd = offset + length;
          if (itemEnd > end) throw new Error('Invalid session tracker.');
          if (type === 5) {
            const size = integer(); requireBytes(size);
            const state = data.toString('ascii', offset, offset + size);
            if (size !== 8 || offset + size !== itemEnd || !/^[TI_][r_][R_][w_][W_][s_][S_][L_]$/.test(state)) throw new Error('Invalid transaction tracker.');
            writes = state[3] === 'w' || state[4] === 'W' || state[7] === 'L';
          }
          offset = itemEnd;
        }
        if (offset !== end || end !== limit) throw new Error('Invalid session tracker.');
      };
      try {
        if (trackWrites && command.constructor.name === 'Query' && command.next?.name === 'fieldsEOF') command.next = command.row;
        const resultEnd = trackWrites && command.constructor.name === 'Query' && command.next?.name === 'row' && data[offset] === 254 && packet.end - packet.offset < 0xffffff;
        if (data[offset] === 255) invalidate();
        else if (resultEnd) {
          readOk();
          // Complete through the driver's normal execute/done/end path, including
          // sequence IDs, row callbacks and queued commands, without a SQL probe.
          const moreResults=Boolean(status & 8);
          command.next = function transactionResultEnd() {
            if(moreResults){this._resultIndex++;return this.resultsetHeader;}
            return this.done();
          };
        } else if (packet.isEOF()) { status = packet.eofStatusFlags(); if (!(status & 1)) writes = false; }
        else if (data[offset] === 0 && ['resultsetHeader', 'pingResponse'].includes(command.next?.name)) readOk();
      } catch { protocolInvalid = true; invalidate(); }
    }
    return original.call(this, packet);
  };
  return {
    invalidate,
    verifyCapabilities() {
      if (trackWrites && (connection._handshakePacket?.capabilityFlags & (DEPRECATE_EOF | SESSION_TRACK)) !== (DEPRECATE_EOF | SESSION_TRACK)) throw new Error('MySQL server transaction tracking is unavailable.');
    },
    get() { return protocolInvalid || status === undefined ? { transactionStatus: 'unknown' } : {
      transactionStatus: status & 1 ? 'active' : 'idle', autocommit: Boolean(status & 2),
      ...(trackWrites ? { hasUncommittedTx: Boolean(status & 1) && writes } : {})
    }; }
  };
}
module.exports = { observeTransactionState };
