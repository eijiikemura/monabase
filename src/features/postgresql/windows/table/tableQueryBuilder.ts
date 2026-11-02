// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { temporalValueSql } from '@/shared/utils/temporalValues';
import { postgresColumnKind, postgresCastType, postgresIsDateTime } from '@/features/postgresql/columnTypes';
import { buildTableConditions, stableTableOrder, sqlString } from '@/features/table/searchConditions';
import { numericSqlLiteral } from '@/shared/utils/numberValues';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';
import type { Condition } from '@/shared/types/queryConditions';
import { getPostgresFormatForValue } from '@/shared/utils/dateFormatter';

interface TableQueryContext {
  schema: string;
  inputDateFormat: string;
  outputDateFormat: string;
  structureDefs: ColumnDefinition[];
}

export function createTableQueryBuilder({ inputDateFormat, outputDateFormat, structureDefs }: TableQueryContext) {
  const formatSqlValue = (col: ColumnDefinition, val: unknown, isFromGrid: boolean = false) => {
    if (val === null || val === undefined || val === '') return 'NULL';
    const temporal = temporalValueSql(col, val, 'postgresql', isFromGrid ? outputDateFormat : inputDateFormat);
    if (temporal) return temporal;
    const kind = postgresColumnKind(col);

    if (kind === 'number') return numericSqlLiteral(val);
    
    if (postgresIsDateTime(col)) {
       let currentFormat = isFromGrid ? outputDateFormat : inputDateFormat;
       if (kind === 'date' && currentFormat.match(/H|h|m|s/i)) {
           currentFormat = currentFormat.split(' ')[0];
       }
       const pgFormat = getPostgresFormatForValue(currentFormat, String(val).trim());
       
       if (kind === 'date') {
          return `TO_DATE('${String(val).replace(/'/g, "''").trim()}', '${pgFormat}')`; 
       }
       return `TO_TIMESTAMP('${String(val).replace(/'/g, "''").trim()}', '${pgFormat}')`; 
    }

    if (kind === 'other') return `'${String(val).replace(/'/g, "''")}'::${postgresCastType(col)}`;

    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const buildQueryStrings = (conds: Record<string, Condition>) => {
    const query = buildTableConditions(conds, (column, value) => {
    const definition = structureDefs.find(item => item.COLUMN_NAME === column) ?? { COLUMN_NAME: column, DATA_TYPE: 'timestamp' };
    const temporal = temporalValueSql(definition, value, 'postgresql', inputDateFormat);
    if (temporal) return temporal;
    const isDate = definition ? postgresColumnKind(definition) === 'date' : false;
    const format = isDate ? inputDateFormat.split(' ')[0] : inputDateFormat;
    const pgFormat = getPostgresFormatForValue(format, value);
    return `${isDate ? 'TO_DATE' : 'TO_TIMESTAMP'}(${sqlString(value)}, ${sqlString(pgFormat)})`;
  }, 'TEXT');
    return { ...query, orderStr: stableTableOrder(query.orderStr, conds, structureDefs, 'postgresql') };
  };

  return { formatSqlValue, buildQueryStrings };
}
