// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Build Oracle category and filter SQL using OFFSET / FETCH NEXT.
export const buildCategoryQuery = (schema: string, type: string, filterText: string, offset: number, limit: number) => {
  const filterClause = filterText ? `AND UPPER(OBJECT_NAME) LIKE UPPER(:filter) ESCAPE '!'` : '';
  const binds: Record<string, string> = { schema };
  if (filterText) binds.filter = '%' + filterText.replace(/[!%_]/g, '!$&') + '%';

  let baseSql = '';
  switch (type) {
    case 'TABLE':
      baseSql = `
        SELECT OBJECT_NAME
        FROM ALL_OBJECTS
        WHERE OWNER = :schema
          AND OBJECT_TYPE = 'TABLE'
          AND NOT OBJECT_NAME LIKE 'MLOG$%'
          AND NOT OBJECT_NAME LIKE 'RUPD$%'
          AND OBJECT_NAME NOT IN (SELECT MVIEW_NAME FROM ALL_MVIEWS WHERE OWNER = :schema)
      `;
      break;
    case 'VIEW':
      baseSql = `SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE = 'VIEW'`;
      break;
    case 'MATERIALIZED VIEW':
      baseSql = `SELECT MVIEW_NAME AS OBJECT_NAME FROM ALL_MVIEWS WHERE OWNER = :schema`;
      break;
    case 'MATERIALIZED VIEW LOG':
      baseSql = `SELECT MASTER AS OBJECT_NAME FROM ALL_MVIEW_LOGS WHERE LOG_OWNER = :schema`;
      break;
    case 'SEQUENCE':
      baseSql = `SELECT SEQUENCE_NAME AS OBJECT_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = :schema`;
      break;
    case 'FUNCTION':
      baseSql = `SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE = 'FUNCTION'`;
      break;
    case 'PROCEDURE':
      baseSql = `SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE = 'PROCEDURE'`;
      break;
    case 'PACKAGE':
      baseSql = `SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE = 'PACKAGE'`;
      break;
    case 'TRIGGER':
      baseSql = `SELECT TRIGGER_NAME AS OBJECT_NAME FROM ALL_TRIGGERS WHERE OWNER = :schema`;
      break;
    case 'DATABASE LINK':
      baseSql = `SELECT DB_LINK AS OBJECT_NAME FROM ALL_DB_LINKS WHERE OWNER = :schema`;
      break;
    case 'SYNONYM':
      baseSql = `SELECT SYNONYM_NAME AS OBJECT_NAME FROM ALL_SYNONYMS WHERE OWNER = :schema`;
      break;
    case 'INDEX':
      baseSql = `SELECT INDEX_NAME AS OBJECT_NAME FROM ALL_INDEXES WHERE OWNER = :schema`;
      break;
    case 'TYPE':
      baseSql = `SELECT TYPE_NAME AS OBJECT_NAME FROM ALL_TYPES WHERE OWNER = :schema`;
      break;
    default:
      baseSql = `SELECT '' AS OBJECT_NAME FROM DUAL WHERE 1=0`;
  }

  const sql = `
    WITH list AS (${baseSql})
    SELECT OBJECT_NAME FROM list
    WHERE 1=1 ${filterClause}
    ORDER BY OBJECT_NAME ASC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;
  return { sql, binds };
};
