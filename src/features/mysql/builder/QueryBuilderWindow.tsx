// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import QueryBuilderPanel from '@/features/query-builder/QueryBuilderPanel';
import { useQueryBuilderWindow, type MysqlBuilderProps } from './useQueryBuilderWindow';
export default function QueryBuilderWindow(props: MysqlBuilderProps) {
  const controller = useQueryBuilderWindow(props);
  return <QueryBuilderPanel {...props} controller={controller} disabled={props.disabled} />;
}
