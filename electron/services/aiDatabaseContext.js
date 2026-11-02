// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Read the actual main session without starting, ending or replacing its transaction.
async function getAiDatabaseContext(client, database) {
  if (!['oracle', 'postgres', 'postgresql'].includes(database)) throw new Error('Unsupported database context.');
  if (!client || client.isExecuting) throw new Error('AI context requires an idle connected database session.');
  const dbType = database === 'oracle' ? 'oracle' : 'postgresql';
  client.isExecuting = true;
  try {
    let row;
    if (dbType === 'oracle') {
      const result = await client.connection.execute(`SELECT
        SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS "schema", SESSIONTIMEZONE AS "timezone",
        (SELECT VALUE FROM NLS_SESSION_PARAMETERS WHERE PARAMETER = 'NLS_DATE_FORMAT') AS "dateFormat",
        (SELECT VALUE FROM NLS_SESSION_PARAMETERS WHERE PARAMETER = 'NLS_TIMESTAMP_FORMAT') AS "timestampFormat",
        (SELECT VALUE FROM NLS_SESSION_PARAMETERS WHERE PARAMETER = 'NLS_NUMERIC_CHARACTERS') AS "numericCharacters"
        FROM DUAL`, {}, { outFormat: require('oracledb').OUT_FORMAT_OBJECT });
      row = { ...result.rows?.[0], version: client.connection.oracleServerVersionString };
    } else {
      const result = await client.client.query(`SELECT current_setting('server_version') AS "version",
        current_schema() AS "schema", current_setting('TimeZone') AS "timezone",
        current_setting('search_path') AS "searchPath", current_setting('DateStyle') AS "dateStyle",
        current_setting('standard_conforming_strings') AS "standardConformingStrings"`);
      row = result.rows?.[0];
    }
    if (!row || !row.schema) throw new Error('Database environment information is unavailable.');
    const environment = { dbType, session: 'main', readOnlyMode: Boolean(client.isReadonly) };
    // Never serialize a driver, connection configuration, host, password or user record.
    for (const name of ['version', 'schema', 'timezone', 'dateFormat', 'timestampFormat', 'numericCharacters', 'searchPath', 'dateStyle', 'standardConformingStrings']) {
      if (typeof row[name] === 'string') environment[name] = row[name].slice(0, 4000);
    }
    return environment;
  } finally { client.isExecuting = false; }
}

module.exports = { getAiDatabaseContext };
