// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Tooltip } from '@mui/material';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { GridColDef } from '@mui/x-data-grid';
import type { TFunction } from 'i18next';
import type { Condition } from "@/shared/types/queryConditions";

// Show conditions applied to the current results rather than unfinished input.
export function decorateTableResultColumns(
  columns: GridColDef[], conditions: Record<string, Condition>, t: TFunction
): GridColDef[] {
  return columns.map(column => {
    const condition = conditions[column.field];
    if (!condition || condition.type === 'DISABLED') return column;
    const filtered = condition.value.trim() !== '';
    const sort = condition.sort.trim();
    if (!filtered && !sort) return column;
    const descending = /\bDESC\b/i.test(sort);
    const priority = parseInt(sort, 10) || 99;
    const details = [
      filtered ? `${t("filter")}${condition.operator} ${condition.value}` : '',
      sort ? `${t("sort")}${sort}` : ''
    ].filter(Boolean).join('\n');
    const SortIcon = descending ? ArrowDownwardIcon : ArrowUpwardIcon;
    return {
      ...column,
      renderHeader: () => (
        <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{details}</span>}>
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, color: 'primary.main', fontWeight: 'bold' }}>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{column.headerName || column.field}</Box>
            {filtered && <FilterAltIcon sx={{ fontSize: 16, flexShrink: 0 }} aria-label={t("filter_applied")} />}
            {sort && <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontSize: '0.75rem' }}>
              <SortIcon sx={{ fontSize: 16 }} aria-label={descending ? t("desc") : t("asc")} />{priority}
            </Box>}
          </Box>
        </Tooltip>
      )
    };
  });
}
