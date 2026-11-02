// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { getErrorMessage } from '@/shared/utils/errorUtils';
import type { Condition } from '@/shared/types/queryConditions';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { numericSqlLiteral } from '@/shared/utils/numberValues';

export const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

type SearchErrorCode = 'number' | 'type' | 'operator' | 'sort' | 'priority';
class SearchConditionError extends Error {
  readonly searchConditionCode: SearchErrorCode;
  constructor(code: SearchErrorCode, message: string) {
    super(message);
    this.searchConditionCode = code;
  }
}

export function getSearchErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error && typeof error === 'object' && 'searchConditionCode' in error) {
    switch (error.searchConditionCode) {
      case 'number': return t('search_invalid_number');
      case 'type': return t('search_invalid_type');
      case 'operator': return t('search_invalid_operator');
      case 'sort': return t('search_invalid_sort');
      case 'priority': return t('search_invalid_priority');
    }
  }
  return getErrorMessage(error);
}

function searchNumber(value: string) {
  try { return numericSqlLiteral(value); }
  catch { throw new SearchConditionError('number', 'Invalid numeric value.'); }
}

// The condition panel accepts values, never SQL expressions or ordering fragments.
export function buildTableConditions(conditions: Record<string, Condition>, formatDate: (column: string, value: string) => string, textType: string) {
  const where: string[] = [];
  const order: { column: string; priority: number; direction: string }[] = [];
  for (const [column, condition] of Object.entries(conditions)) {
    if (!condition || condition.type === 'DISABLED') continue;
    if (!['STRING', 'NUMBER', 'DATE', 'TIME'].includes(condition.type)) throw new SearchConditionError('type', 'Invalid search value type.');
    if (!['=', '<>', '<=', '>=', '<', '>', 'LIKE'].includes(condition.operator)) throw new SearchConditionError('operator', 'Invalid search operator.');
    if (condition.value !== '') {
      const value = condition.type === 'STRING' ? condition.value : condition.value.trim();
      if (value !== '') {
        const identifier = quoteIdentifier(column);
        if (condition.operator === 'LIKE') {
          if (condition.type === 'NUMBER') searchNumber(value);
          const literal = value.replace(/[!%_]/g, character => `!${character}`);
          const expression = condition.type === 'STRING' ? identifier : `CAST(${identifier} AS ${textType})`;
          where.push(`${expression} LIKE ${sqlString(`%${literal}%`)} ESCAPE '!'`);
        } else {
          const literal = condition.type === 'NUMBER' ? searchNumber(value)
            : ['DATE', 'TIME'].includes(condition.type) ? formatDate(column, value) : sqlString(value);
          where.push(`${identifier} ${condition.operator} ${literal}`);
        }
      }
    }
    if (condition.sort.trim()) {
      const match = /^(?:(\d+)(?:\s+(ASC|DESC))?|(ASC|DESC))$/i.exec(condition.sort.trim());
      if (!match) throw new SearchConditionError('sort', 'Invalid sort order. Use a positive priority and ASC or DESC.');
      const priority = match[1] ? Number(match[1]) : 99;
      if (!Number.isSafeInteger(priority) || priority < 1) throw new SearchConditionError('priority', 'Invalid sort priority.');
      order.push({ column, priority, direction: (match[2] ?? match[3] ?? 'ASC').toUpperCase() });
    }
  }
  order.sort((left, right) => left.priority - right.priority);
  return { whereStr: where.length ? ` WHERE ${where.join(' AND ')}` : '',
    orderStr: order.length ? ` ORDER BY ${order.map(item => `${quoteIdentifier(item.column)} ${item.direction}`).join(', ')}` : '' };
}

// Tie-break equal sort values so unchanged tables have repeatable page boundaries.
export function stableTableOrder(order: string, conditions: Record<string, Condition>, columns: { COLUMN_NAME: string; PK_POSITION?: string | number | null }[], database: 'oracle' | 'postgresql') {
  const keys = columns.filter(column => column.PK_POSITION !== undefined && column.PK_POSITION !== null && column.PK_POSITION !== '')
    .sort((a, b) => Number(a.PK_POSITION) - Number(b.PK_POSITION));
  const extra = keys.length ? keys.filter(column => conditions[column.COLUMN_NAME]?.type === 'DISABLED' || !conditions[column.COLUMN_NAME]?.sort.trim()).map(column => `${quoteIdentifier(column.COLUMN_NAME)} ASC`)
    : database === 'oracle' ? ['t.ROWID ASC'] : ['t.tableoid ASC', 't.ctid ASC'];
  return order ? order + (extra.length ? ', ' + extra.join(', ') : '') : ' ORDER BY ' + extra.join(', ');
}

export function tableConditionKey(conditions: Record<string, Condition>) {
  return JSON.stringify(Object.entries(conditions).filter(([, condition]) => condition.type !== 'DISABLED' && (condition.value !== '' || condition.sort.trim()))
    .sort(([a], [b]) => a.localeCompare(b)).map(([column, condition]) => [column, condition.value, condition.value ? condition.operator : '', condition.value ? condition.type : '', condition.sort.trim().toUpperCase()]));
}
