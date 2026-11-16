// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next';
import { useQueryBuilderController, type QueryBuilderProps } from '@/features/query-builder/useQueryBuilderController';
import type { AiTableColumn } from '@/features/ai/useQueryBuilderAi';
import { parseObjectName } from '@/features/objects/objectRepository';
import { ipcRenderer } from '@/shared/api/desktop';
import { getFullTableDDL } from '../common/ddlHelper';
export type { QueryBuilderProps } from '@/features/query-builder/useQueryBuilderController';
export type { QueryTable, QueryField, QueryJoin } from '@/features/query-builder/queryBuilderModel';
interface ObjectColumn extends AiTableColumn { objectType: 'TABLE' | 'VIEW'; tableComment: string | null; }
export function useQueryBuilderWindow(props: QueryBuilderProps) {
  const { t } = useTranslation();
  const userName = props.userName || '';
  const loadAiTableInfo = async (fullTableName: string) => {
    const { schema: owner, name: tableName } = parseObjectName(fullTableName, userName.toUpperCase());
    const result: { success: boolean; rows?: ObjectColumn[] } =
      await ipcRenderer.invoke('execute-sql-bg', `
        SELECT c.COLUMN_NAME AS "name",
               c.DATA_TYPE AS "dataType",
               cc.COMMENTS AS "comment",
               CASE WHEN EXISTS (
                 SELECT 1 FROM ALL_VIEWS v WHERE v.OWNER = c.OWNER AND v.VIEW_NAME = c.TABLE_NAME
               ) THEN 'VIEW' ELSE 'TABLE' END AS "objectType",
               (SELECT tc.COMMENTS FROM ALL_TAB_COMMENTS tc
                WHERE tc.OWNER = c.OWNER AND tc.TABLE_NAME = c.TABLE_NAME) AS "tableComment"
        FROM ALL_TAB_COLUMNS c
        LEFT JOIN ALL_COL_COMMENTS cc
          ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME
         AND cc.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.OWNER = :owner AND c.TABLE_NAME = :tableName
        ORDER BY c.COLUMN_ID
      `, { owner, tableName });
    if (!result.success || !result.rows?.length) {
      throw new Error(t("failed_to_load_table_and_view_information_for_the_ai_request"));
    }
    const objectType = result.rows[0].objectType;
    let ddl: string;
    if (objectType === 'VIEW') {
      const viewResult: { success: boolean; rows?: { DDL: string }[] } =
        await ipcRenderer.invoke<{ DDL: string }>('execute-sql-bg', `
          SELECT DBMS_METADATA.GET_DDL('VIEW', :viewName, :owner) AS DDL FROM DUAL
        `, { viewName: tableName, owner });
      if (!viewResult.success || !viewResult.rows?.[0]?.DDL?.trim()) {
        throw new Error(t("failed_to_retrieve_view_definitions_for_the_ai_request"));
      }
      ddl = viewResult.rows[0].DDL;
    } else if (objectType === 'TABLE') {
      ddl = await getFullTableDDL(ipcRenderer, owner, tableName, t);
    } else {
      throw new Error(t("failed_to_load_table_and_view_information_for_the_ai_request"));
    }
    if (!ddl.trim()) throw new Error(t("failed_to_retrieve_definitions_for_the_ai_request"));
    return {
      ddl, objectType, comment: result.rows[0].tableComment,
      columns: result.rows.map(({ name, dataType, comment }) => ({ name, dataType, comment }))
    };
  };

  return useQueryBuilderController(props, { dbType: 'oracle', defaultSchema: userName.toUpperCase(), loadTableInfo: loadAiTableInfo,
    loadColumns: async object => {
      const result = await ipcRenderer.invoke<{ name: string }>('execute-sql-bg',
        'SELECT COLUMN_NAME AS "name" FROM ALL_TAB_COLUMNS WHERE OWNER = :schema AND TABLE_NAME = :name ORDER BY COLUMN_ID', { schema: object.schema, name: object.name });
      if (!result.success || !result.rows?.length) throw new Error(t('failed_to_fetch_columns') + ` ${object.schema}.${object.name}` + (result.success ? '' : `\n${result.error}`));
      return result.rows.map(row => row.name);
    }
  });
}
