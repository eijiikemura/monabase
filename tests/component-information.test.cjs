// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

const fixtures = [
  { file: 'src/features/stored/RoutineInformationTab.tsx', name: 'RoutineInformationTab', dependency: '@/features/stored/routineMetadata', method: 'loadRoutineInformation',
    data: marker => ({ identity: marker, status: 'VALID', language: 'SQL', security: 'INVOKER', result: 'numeric', references: [{ schema: 'test', name: 'source', type: 'TABLE' }], dependents: [] }) },
  { file: 'src/features/type/TypeInformationTab.tsx', name: 'TypeInformationTab', dependency: './typeInformation', method: 'loadTypeInformation',
    data: marker => ({ kind: marker, status: ['VALID'], attributes: [{ name: 'price', type: 'numeric' }], labels: ['line\nbreak'], methods: [], references: ['test.source'], dependents: [], body: { source: 'TYPE BODY', diagnostics: [{ severity: 'error', line: 3, col: 2, text: 'Compile error' }] } }) },
  { file: 'src/features/oracle/windows/package/PackageInformationTab.tsx', name: 'default', dependency: '@/features/stored/packageMetadata', method: 'loadPackageInformation',
    data: marker => ({ status: [{ OBJECT_TYPE: 'PACKAGE', STATUS: marker, AUTHID: 'DEFINER' }], programs: [{ key: 'one', label: 'calculate', SUBPROGRAM_ID: 1 }], args: [{ SUBPROGRAM_ID: 1, POSITION: 0, DATA_TYPE: 'NUMBER' }, { SUBPROGRAM_ID: 1, POSITION: 1, ARGUMENT_NAME: 'p', TYPE_NAME: 'PRICE', TYPE_OWNER: 'TEST', IN_OUT: 'IN', DEFAULTED: 'Y' }, { SUBPROGRAM_ID: 2, POSITION: 1, ARGUMENT_NAME: 'OTHER_OVERLOAD' }], references: [{ OWNER: 'TEST', NAME: 'SOURCE', TYPE: 'TABLE' }], dependents: [] }) },
  { file: 'src/features/sequence/SequenceInformationTab.tsx', name: 'SequenceInformationTab', dependency: './sequenceMetadata', method: 'readSequenceMetadata',
    data: marker => ({ settings: { dataType: marker, increment: '9007199254740993', cycle: false, order: true, keep: false, session: false }, observed: 0 }),
    extra: { readSequenceUsage: async () => ({ owner: { schema: 'test', table: 'orders', column: 'id', identity: true }, dependents: ['test.consumer'] }) } }
];

for (const fixture of fixtures) {
  test(`${fixture.file} rejects stale successes/failures, retries explicitly and ignores reads after unmount`, async () => {
    const requests = [], calls = [];
    const loader = (...args) => { const request = deferred(); requests.push(request); calls.push(args); return request.promise; };
    const f = render(fixture.file, { database: 'postgresql', schema: 'test', name: 'first', kind: 'FUNCTION', args: [
      { POSITION: 0, ARGUMENT_NAME: 'RETURN_VALUE' }, { POSITION: 1, ARGUMENT_NAME: 'amount', DATA_TYPE: 'numeric', IN_OUT: 'IN', DEFAULTED: 'Y' }
    ] }, { name: fixture.name, dependencies: { [fixture.dependency]: { [fixture.method]: loader, ...fixture.extra } } });
    await f.flush(); assert.equal(f.button('refresh').props.disabled, true); assert.equal(requests.length, 1);
    f.props.name = 'second'; await f.flush(); assert.equal(requests.length, 2);
    requests[1].resolve(fixture.data('CURRENT_RESULT')); await f.flush();
    assert.ok(f.text().includes('CURRENT_RESULT')); assert.equal(f.button('refresh').props.disabled, false);
    requests[0].resolve(fixture.data('STALE_RESULT')); await f.flush();
    assert.ok(!f.text().includes('STALE_RESULT')); assert.ok(f.text().includes('CURRENT_RESULT'));
    if (fixture.name === 'RoutineInformationTab') { assert.ok(!f.text().includes('RETURN_VALUE')); assert.ok(f.text().includes('amount')); }
    if (fixture.name === 'default') { assert.ok(!f.text().includes('OTHER_OVERLOAD')); assert.ok(f.text().includes('routine_result_type')); assert.ok(f.text().includes('TEST.PRICE')); }
    if (fixture.name === 'TypeInformationTab') { assert.ok(f.text().includes('"line\\nbreak"')); assert.ok(f.text().includes('Compile error')); }
    if (fixture.name === 'SequenceInformationTab') {
      assert.ok(f.text().includes('9007199254740993')); assert.ok(!f.text().includes('sequence_value_unknown'));
      assert.ok(!f.text().includes('sequence_setting_order')); assert.ok(f.text().includes('test.orders.id (IDENTITY)'));
    }
    await f.click('refresh'); requests[2].reject(new Error('Read failed')); await f.flush();
    assert.ok(f.text().includes('Read failed')); assert.ok(f.text().includes('CURRENT_RESULT'));
    await f.click('retry'); requests[3].resolve(fixture.data('RECOVERED_RESULT')); await f.flush(); assert.ok(f.text().includes('RECOVERED_RESULT')); assert.ok(!f.text().includes('Read failed'));
    await f.click('refresh'); f.props.name = 'third'; await f.flush();
    requests[4].reject(new Error('STALE_FAILURE')); requests[5].resolve(fixture.data('THIRD_RESULT')); await f.flush();
    assert.ok(f.text().includes('THIRD_RESULT')); assert.ok(!f.text().includes('STALE_FAILURE'));
    await f.click('refresh'); f.unmount(); const writesBefore = f.stateWrites.length;
    requests[6].resolve(fixture.data('AFTER_UNMOUNT')); await f.hooks.settle(); assert.equal(f.stateWrites.length, writesBefore);
    assert.equal(calls.length, 7); assert.ok(calls.every(args => args.includes('test')));
  });
}

test('Oracle sequence information includes Oracle-only settings and distinguishes unknown observed values', async () => {
  const f = render('src/features/sequence/SequenceInformationTab.tsx', { database: 'oracle', schema: 'TEST', name: 'S' }, { name: 'SequenceInformationTab', dependencies: { './sequenceMetadata': {
    readSequenceMetadata: async () => ({ settings: { dataType: 'NUMBER', order: true, keep: false, session: true }, observed: null }),
    readSequenceUsage: async () => ({ owner: null, dependents: [] })
  } } });
  await f.flush(); assert.ok(f.text().includes('sequence_setting_order')); assert.ok(f.text().includes('sequence_value_unknown')); assert.ok(f.text().includes('none')); f.unmount();
});
