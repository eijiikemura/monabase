// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { temporalValueSql } from '@/shared/utils/temporalValues';
import { buildTableConditions, stableTableOrder, sqlString } from '@/features/table/searchConditions';
import { numericSqlLiteral } from '@/shared/utils/numberValues';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';
import type { Condition } from '@/shared/types/queryConditions';
import { getOracleFormatForValue } from '@/shared/utils/dateFormatter';

interface TableQueryContext {
  schema: string;
  inputDateFormat: string;
  outputDateFormat: string;
  structureDefs: ColumnDefinition[];
}

export function createTableQueryBuilder({ schema, inputDateFormat, outputDateFormat, structureDefs }: TableQueryContext) {
  const formatSqlValue = (col: ColumnDefinition, val: unknown, isFromGrid: boolean = false) => {
    if (val === null || val === undefined || val === '') return 'NULL';
    const temporal = temporalValueSql(col, val, 'oracle', isFromGrid ? outputDateFormat : inputDateFormat);
    if (temporal) return temporal;
    const typeUpper = col.DATA_TYPE.toUpperCase();

    if (typeUpper.includes('NUMBER') || typeUpper.includes('FLOAT')) return numericSqlLiteral(val);
    
    if (typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP')) {
       const currentFormat = isFromGrid ? outputDateFormat : inputDateFormat;
       const oracleFormat = getOracleFormatForValue(currentFormat, String(val).trim());
       return `${typeUpper.includes('TIMESTAMP') ? 'TO_TIMESTAMP' : 'TO_DATE'}('${String(val).replace(/'/g, "''").trim()}', '${oracleFormat}')`;
    }

    const isStandardType = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB', 'RAW', 'LONG'].some(t => typeUpper.includes(t));
    
    if (!isStandardType) {
      const strVal = String(val).trim();
      
      if (strVal.toUpperCase().startsWith(typeUpper) || (schema && strVal.toUpperCase().startsWith(`${schema.toUpperCase()}.${typeUpper}`))) {
        return strVal;
      }
      
      if (strVal.startsWith('(') && strVal.endsWith(')')) {
        return `${schema ? `${schema}.` : ''}"${typeUpper}"${strVal}`;
      }
      
      let inner = strVal;
      if (!inner.includes("'")) {
         inner = inner.split(',').map(s => `'${s.trim().replace(/'/g, "''")}'`).join(', ');
      }
      return `${schema ? `${schema}.` : ''}"${typeUpper}"(${inner})`;
    }
    
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const buildQueryStrings = (conds: Record<string, Condition>) => {
    const query = buildTableConditions(conds, (column, value) => {
    const definition = structureDefs.find(item => item.COLUMN_NAME === column) ?? { COLUMN_NAME: column, DATA_TYPE: 'DATE' };
    const temporal = temporalValueSql(definition, value, 'oracle', inputDateFormat);
    if (temporal) return temporal;
    const format = getOracleFormatForValue(inputDateFormat, value);
    return `TO_DATE(${sqlString(value)}, ${sqlString(format)})`;
  }, 'VARCHAR2(4000)');
    return { ...query, orderStr: stableTableOrder(query.orderStr, conds, structureDefs, 'oracle') };
  };

  return { formatSqlValue, buildQueryStrings };
}
