// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { hasRequiredPackageHeader } = loadTypeScript('src/features/ai/packageHeaderRequirement.ts');
const { prepareAiSubmission } = loadTypeScript('src/features/ai/prepareAiSubmission.ts', {
  './packageHeaderRequirement': { hasRequiredPackageHeader }
});
const requirement = { schema: 'TEST_USER', objectName: 'SALES_PKG' };
const makeHeader = (changes = {}) => ({
  object: { key: 'header', dbType: 'oracle', schema: 'TEST_USER', category: 'PACKAGE', name: 'SALES_PKG', displayName: 'SALES_PKG' },
  status: 'ready', reference: { definition: 'CREATE PACKAGE SALES_PKG AS PROCEDURE RUN; END;', details: {} },
  ...changes
});

test('Existing package bodies require a loaded header with matching schema and name', () => {
  assert.equal(hasRequiredPackageHeader([], requirement), false);
  assert.equal(hasRequiredPackageHeader([makeHeader()], requirement), true);
  for (const changes of [
    { category: 'TABLE' }, { category: 'PROCEDURE' }, { name: 'OTHER_PKG' },
    { schema: 'OTHER_USER' }, { dbType: 'postgresql' }
  ]) {
    const header = makeHeader();
    header.object = { ...header.object, ...changes };
    assert.equal(hasRequiredPackageHeader([header], requirement), false);
  }
});

test('Loading, failed, or empty headers prevent submission', () => {
  for (const header of [
    makeHeader({ status: 'loading' }), makeHeader({ status: 'error' }),
    makeHeader({ reference: undefined }),
    makeHeader({ reference: { definition: '  ', details: {} } })
  ]) {
    assert.equal(hasRequiredPackageHeader([header], requirement), false);
  }
});

test('New bodies require a header in the same schema while other requests remain unaffected', () => {
  assert.equal(hasRequiredPackageHeader([], { schema: 'TEST_USER' }), false);
  assert.equal(hasRequiredPackageHeader([makeHeader()], { schema: 'TEST_USER' }), true);
  assert.equal(hasRequiredPackageHeader([makeHeader()], { schema: 'OTHER_USER' }), false);
  assert.equal(hasRequiredPackageHeader([], undefined), true);
});

test('Removing the header invalidates the requirement', () => {
  let targets = [makeHeader()];
  assert.equal(hasRequiredPackageHeader(targets, requirement), true);
  targets = [];
  assert.equal(hasRequiredPackageHeader(targets, requirement), false);
});

test('Submission checks current selections and blocks Enter after header removal', () => {
  let targets = [makeHeader()];
  const options = {
    text: ' bodyを作成してください ', isLoading: false, hasActiveRequest: false, isHistoryReady: true,
    context: { requiredPackageHeader: requirement,
      objectSelection: { getSnapshot: () => targets, isAvailable: () => true } },
    allowEmptySelection: true, headerMessage: 'headerを選択してください', targetMessage: '対象を選択してください'
  };
  assert.equal(prepareAiSubmission(options).status, 'ready');
  assert.equal(prepareAiSubmission(options).text, 'bodyを作成してください');
  targets = [];
  const result = prepareAiSubmission(options);
  assert.equal(result.status, 'invalid');
  assert.equal(result.message, 'headerを選択してください');
});

function createPackageRequest(isNew, objectType = 'PACKAGE BODY') {
  const crypto = require('node:crypto');
  const storeExports = loadTypeScript('src/features/ai/useAiObjectSelection.ts', {
    react: {}, 'react-i18next': {}, './aiObjectRepository': {},
    '@/shared/utils/errorUtils': { getErrorMessage: error => error.message }
  }, { crypto });
  const loaded = [];
  const selection = storeExports.createAiObjectSelectionStore('oracle', () => 'TEST_USER', async object => {
    loaded.push(object);
    return { definition: 'CREATE PACKAGE SALES_PKG AS PROCEDURE RUN; END;', details: {} };
  });
  const opened = [];
  const { requestPackageAi } = loadTypeScript('src/features/ai/requestPackageAi.ts', {}, {
    crypto, alert: text => { throw new Error(text); }
  });
  const request = () => requestPackageAi({
    isNew, objectType, schema: 'TEST_USER', objectName: 'SALES_PKG',
    isAiEnabled: true, onOpenAiSidebar: value => opened.push(value),
    objectSelection: selection, responseTarget: {}, t: text => text
  });
  return { request, selection, loaded, opened };
}

test('AI requests for existing bodies select the matching header and wait for loading', async () => {
  const h = createPackageRequest(false);
  h.request();
  assert.equal(h.opened.length, 1);
  const selected = h.selection.getSnapshot();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].object.key, JSON.stringify(['oracle', 'TEST_USER', 'PACKAGE', 'SALES_PKG']));
  assert.equal(selected[0].status, 'loading');
  assert.equal(hasRequiredPackageHeader(selected, requirement), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.loaded.length, 1);
  assert.equal(hasRequiredPackageHeader(h.selection.getSnapshot(), requirement), true);
  h.request();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.selection.getSnapshot().length, 1);
  assert.equal(h.loaded.length, 1);
});

test('New bodies and header editing leave header selection to the user', async () => {
  for (const [isNew, objectType] of [[true, 'PACKAGE BODY'], [false, 'PACKAGE']]) {
    const h = createPackageRequest(isNew, objectType);
    h.request();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.opened.length, 1);
    assert.equal(h.selection.getSnapshot().length, 0);
    assert.equal(h.loaded.length, 0);
  }
});
