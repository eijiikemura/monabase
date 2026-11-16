// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useQueryBuilderController, type QueryBuilderProps } from '@/features/query-builder/useQueryBuilderController';
import type { TransactionState } from '@/shared/api/desktopContract';
import { loadBuilderColumns, loadBuilderTableInfo } from './builderRepository';
export interface MysqlBuilderProps extends QueryBuilderProps {
  schema: string; disabled: boolean;
  onState: (state: TransactionState) => void; onBusyChange: (busy: boolean) => void;
}
export function useQueryBuilderWindow(props: MysqlBuilderProps) {
  return useQueryBuilderController(props, { dbType: 'mysql', defaultSchema: props.schema,
    loadTableInfo: loadBuilderTableInfo, loadColumns: async object => (await loadBuilderColumns(object.schema, object.name)).map(column => column.name),
    isBlocked: () => props.disabled, onState: props.onState, onBusyChange: props.onBusyChange });
}
