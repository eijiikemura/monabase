// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { randomBytes } = require('node:crypto');
const { simpleGit } = require('simple-git');
const MysqlClient = require('../../electron/mysql/mysqlClient');
const { getAiDatabaseContext } = require('../../electron/services/aiDatabaseContext');
const { registerGitHandlers } = require('../../electron/ipc/git');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const config = { dbType: 'mysql', host: '127.0.0.1', port: '13306', database: 'mb_test', user: 'test', password: 'test' };

test('Disposable MySQL: complete definitions, main-session AI context and actual Git commits/history', { timeout: 60000 }, async t => {
  assert.equal(process.env.MONABASE_MYSQL_DISPOSABLE, '1', 'Opt in to the dedicated disposable MySQL fixture.');
  const client = new MysqlClient();
  const token = 'MBT_' + randomBytes(6).toString('hex');
  const objects = [], handlers = new Map();
  const root = path.resolve('git/MonaBase/.test-runs'); fs.mkdirSync(root, { recursive: true });
  const repository = fs.mkdtempSync(path.join(root, 'mysql-'));
  const git = simpleGit(repository);
  const transport = { invoke: async (channel, sql, binds) => {
    if (channel === 'get-schemas') return { success: true, schemas: await client.getSchemas() };
    assert.equal(channel, 'execute-sql-bg');
    return { success: true, ...await client.execute(sql, binds, null, false, true) };
  } };
  const deps = { '@/shared/api/desktop': { ipcRenderer: transport } };
  const mysqlObjects = loadTypeScript('src/features/objects/mysqlObjects.ts', deps);
  const objectRepository = loadTypeScript('src/features/objects/objectRepository.ts', { ...deps, './mysqlObjects': mysqlObjects });
  const sources = loadTypeScript('src/features/git/gitDatabaseSources.ts', { ...deps, '@/features/objects/objectRepository': objectRepository, '@/features/postgresql/windows/common/ddlHelper': {} });
  const related = loadTypeScript('src/features/ai/relatedObjects.ts', { ...deps, '../objects/objectRepository': objectRepository });
  const q = name => '`' + name.replaceAll('`', '``') + '`';
  try {
    await client.connect(config);
    const definitions = [
      ['TABLE', `${token}_table`, `CREATE TABLE ${q(token + '_table')} (id BIGINT PRIMARY KEY, label VARCHAR(80)) ENGINE=InnoDB`],
      ['VIEW', `${token}_view`, `CREATE VIEW ${q(token + '_view')} AS SELECT id,label FROM ${q(token + '_table')}`],
      ['VIEW', `${token}_nested`, `CREATE VIEW ${q(token + '_nested')} AS SELECT * FROM ${q(token + '_view')}`],
      ['PROCEDURE', `${token}_proc`, `CREATE PROCEDURE ${q(token + '_proc')}(IN p_value INT, OUT p_result INT) BEGIN SET p_result=p_value+1; END`],
      ['FUNCTION', `${token}_function`, `CREATE FUNCTION ${q(token + '_function')}(p_value INT) RETURNS INT DETERMINISTIC NO SQL RETURN p_value+2`],
      ['TRIGGER', `${token}_trigger`, `CREATE TRIGGER ${q(token + '_trigger')} BEFORE INSERT ON ${q(token + '_table')} FOR EACH ROW SET NEW.label=COALESCE(NEW.label,'demo')`]
    ];
    for (const [category, name, ddl] of definitions) { await client.main.promise().query(ddl); objects.push({ category, name }); }
    const mysqlSources = [];
    await t.test('All five categories use native full DDL with parameters and correct identity', async () => {
      for (const { category, name } of objects) {
        const listed = await objectRepository.listObjects({ dbType: 'mysql', schema: 'mb_test', category, searchText: name, offset: 0 });
        const object = listed.find(object => object.name === name);
        assert.ok(object, category);
        const reference = await objectRepository.loadObjectReference(object);
        const dependencies = await related.listRelatedObjects(object);
        if (category === 'VIEW' && name.endsWith('_nested')) assert.ok(dependencies.some(item => item.name === token + '_view' && item.category === 'VIEW'));
        else if (['VIEW', 'TRIGGER'].includes(category)) assert.ok(dependencies.some(item => item.name === token + '_table'), category);
        if (['PROCEDURE', 'FUNCTION'].includes(category)) assert.equal(dependencies.length, 0);
        assert.match(reference.definition, /CREATE/i);
        assert.ok(reference.definition.includes(name), category);
        if (category === 'PROCEDURE') { assert.ok(reference.definition.includes('p_result')); assert.equal(reference.details.parameters.length, 2); }
        if (category === 'FUNCTION') { assert.equal(reference.details.parameters.length, 2); }
        if (category === 'TRIGGER') assert.equal(reference.details.tableName, token + '_table');
        mysqlSources.push(await sources.readGitDatabaseSource(object, key => key));
      }
      assert.deepEqual(await objectRepository.listObjects({ dbType: 'mysql', schema: 'mb_test', category: 'TABLE', searchText: token, offset: 100 }), []);
    });
    await t.test('AI context and definition scans preserve pending rows, ROW_COUNT and the transaction', async () => {
      await client.execute(`INSERT INTO ${q(token + '_table')} VALUES(1,'pending')`);
      const context = await getAiDatabaseContext(client, 'mysql');
      assert.equal(context.dbType, 'mysql'); assert.equal(context.schema, 'mb_test'); assert.equal(context.session, 'main');
      assert.equal(context.readOnlyMode, false); assert.ok(context.sqlMode);
      assert.ok(!Object.keys(context).some(key => /host|password|user|port|connection/i.test(key)));
      assert.equal((await client.execute('SELECT ROW_COUNT() n')).rows[0].n, '1');
      await sources.listGitDatabaseObjects('mysql', 'mb_test', 'PROCEDURE');
      assert.equal(client.getMainTransactionState(), true);
      const outside = await client.execute(`SELECT COUNT(*) n FROM ${q(token + '_table')}`, {}, null, false, true);
      assert.equal(outside.rows[0].n, '0');
      assert.equal((await client.execute(`SELECT COUNT(*) n FROM ${q(token + '_table')}`)).rows[0].n, '1');
      await client.rollback();
    });
    await t.test('Case-distinct native tables retain separate columns and portable Git identities', async () => {
      const names = [token + '_Case', token + '_case'];
      const created = [];
      try {
        for (let i = 0; i < names.length; i++) { await client.main.promise().query(`CREATE TABLE ${q(names[i])} (column_${i} INT)`); created.push(names[i]); }
        const paths = [];
        for (let i = 0; i < names.length; i++) {
          const listed = await objectRepository.listObjects({ dbType: 'mysql', schema: 'mb_test', category: 'TABLE', searchText: names[i], offset: 0 });
          const object = listed.find(row => row.name === names[i]);
          assert.ok(object);
          const reference = await objectRepository.loadObjectReference(object);
          assert.equal(reference.details.columns.length, 1);
          assert.equal(reference.details.columns[0].name, `column_${i}`);
          paths.push(object.key);
        }
        assert.notEqual(paths[0], paths[1]);
      } finally { for (const name of created.reverse()) await client.main.promise().query(`DROP TABLE ${q(name)}`); }
    });
    await t.test('Real Git reviews/commits only MySQL sources and can read immutable history', async () => {
      await git.init(); await git.addConfig('user.name', 'MonaBase test'); await git.addConfig('user.email', 'test@example.invalid');
      registerGitHandlers({ gitDirectory: repository, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, t: key => key });
      const review = await handlers.get('git-review-sources')({}, mysqlSources);
      assert.equal(review.success, true, review.error);
      assert.ok(review.rows.every(row => row.path.includes('/MYSQL/')));
      const result = await handlers.get('git-commit-sources')({}, { head: review.head, rows: review.rows, message: 'Record MySQL source definitions' });
      assert.equal(result.success, true, result.error);
      const request = mysqlSources.find(source => source.objectType === 'PROCEDURE');
      const history = await handlers.get('git-get-history')({}, { ...request, page: 0 });
      assert.equal(history.success, true, history.error); assert.equal(history.history.length, 1);
      const revision = history.history[0].hash || history.history[0].id;
      const saved = await handlers.get('git-get-file-content')({}, { ...request, commitId: revision });
      assert.equal(saved.success, true, saved.error); assert.equal(saved.content.trim(), request.sourceText.trim());
      const revised = { ...request, sourceText: request.sourceText.replace('p_value+1', 'p_value+3') };
      const secondReview = await handlers.get('git-review-sources')({}, [revised]);
      assert.equal(secondReview.success, true, secondReview.error);
      const secondCommit = await handlers.get('git-commit-sources')({}, { head: secondReview.head, rows: secondReview.rows, message: 'Review a revised MySQL draft' });
      assert.equal(secondCommit.success, true, secondCommit.error);
      const updatedHistory = await handlers.get('git-get-history')({}, { ...request, page: 0 });
      assert.equal(updatedHistory.history.length, 2);
      const firstAgain = await handlers.get('git-get-file-content')({}, { ...request, commitId: revision });
      assert.equal(firstAgain.content.trim(), request.sourceText.trim());
      assert.equal((await git.status()).files.length, 0);
    });
  } finally {
    try { if (client.main) await client.main.promise().query('ROLLBACK'); for (const { category, name } of objects.reverse()) await client.main.promise().query(`DROP ${category} IF EXISTS ${q(name)}`); }
    finally { await client.disconnect(); fs.rmSync(repository, { recursive: true, force: true }); }
  }
});
