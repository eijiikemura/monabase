// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { loadOracleDdl } from './loadOracleDdl';

export const getFullTableDDL = async (ipcRenderer: { invoke: import('@/shared/api/desktopContract').Invoke }, schema: string, tableName: string, t: ReturnType<typeof import('react-i18next').useTranslation>['t'], includeTriggers = true): Promise<string> => {
  let combinedDDL = '';
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const safeSchema = schema;
  const safeTable = tableName;

  try {

    const tabCommentSql = `SELECT COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER = :owner AND TABLE_NAME = :name`;
    const colCommentSql = `SELECT COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS WHERE OWNER = :owner AND TABLE_NAME = :name AND COMMENTS IS NOT NULL ORDER BY COLUMN_NAME`;
    const idxSql = `SELECT OWNER, INDEX_NAME FROM ALL_INDEXES WHERE TABLE_OWNER = :owner AND TABLE_NAME = :name AND INDEX_TYPE != 'LOB'`;
    const trgSql = `SELECT OWNER, TRIGGER_NAME FROM ALL_TRIGGERS WHERE TABLE_OWNER = :owner AND TABLE_NAME = :name`;

    const [ddlRes, resTab, resCol, resIdx, resTrg] = await Promise.all([
      loadOracleDdl(ipcRenderer, 'TABLE', safeTable, safeSchema),
      ipcRenderer.invoke('execute-sql-bg', tabCommentSql, { owner: safeSchema, name: safeTable }),
      ipcRenderer.invoke<{ COLUMN_NAME: string; COMMENTS: string }>('execute-sql-bg', colCommentSql, { owner: safeSchema, name: safeTable }),
      ipcRenderer.invoke<{ INDEX_NAME: string; OWNER: string }>('execute-sql-bg', idxSql, { owner: safeSchema, name: safeTable }),
      includeTriggers ? ipcRenderer.invoke<{ TRIGGER_NAME: string; OWNER: string }>('execute-sql-bg', trgSql, { owner: safeSchema, name: safeTable }) : Promise.resolve(null)
    ]);

    for (const result of [resTab, resCol, resIdx, resTrg]) {
      if (result && !result.success) throw new Error(result.error);
    }

    // 1. Table DDL.
    combinedDDL += ddlRes.replace(/;\s*$/, '') + ';\n';

    // 2. Table comments.
    if (resTab && resTab.success && resTab.rows && resTab.rows.length > 0) {
      const comment = String(resTab.rows[0].COMMENTS ?? '');
      if (comment) {
        combinedDDL += `\nCOMMENT ON TABLE ${quote(safeSchema)}.${quote(safeTable)} IS '${comment.replace(/'/g, "''")}';\n`;
      }
    }

    // 3. Column comments.
    if (resCol && resCol.success && resCol.rows && resCol.rows.length > 0) {
      resCol.rows.forEach((row: { COLUMN_NAME: string; COMMENTS: string }) => {
         combinedDDL += `COMMENT ON COLUMN ${quote(safeSchema)}.${quote(safeTable)}.${quote(row.COLUMN_NAME)} IS '${row.COMMENTS.replace(/'/g, "''")}';\n`;
      });
    }

    // 4. Index DDL, fetched in parallel.
    if (resIdx && resIdx.success && resIdx.rows && resIdx.rows.length > 0) {
      combinedDDL += `\n${t("index_information")}\n`;
      const idxPromises = resIdx.rows.map((row: { INDEX_NAME: string; OWNER: string }) =>
        loadOracleDdl(ipcRenderer, 'INDEX', row.INDEX_NAME, row.OWNER)
      );
      const idxResults = await Promise.all(idxPromises);
      idxResults.forEach(ddl => { combinedDDL += ddl.replace(/;\s*$/, '') + ';\n'; });
    }

    // 5. Trigger DDL, fetched in parallel.
    if (resTrg && resTrg.success && resTrg.rows && resTrg.rows.length > 0) {
      combinedDDL += `\n${t("trigger_information")}\n`;
      const trgPromises = resTrg.rows.map((row: { TRIGGER_NAME: string; OWNER: string }) =>
        loadOracleDdl(ipcRenderer, 'TRIGGER', row.TRIGGER_NAME, row.OWNER)
      );
      const trgResults = await Promise.all(trgPromises);
      trgResults.forEach(ddl => { combinedDDL += ddl.replace(/\/\s*$/, '') + '\n/\n'; });
    }

  } catch (e) {
    throw e;
  }

  return combinedDDL;
};