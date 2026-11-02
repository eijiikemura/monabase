// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react';
import { sql } from '@codemirror/lang-sql';
import type { CompletionContext } from '@codemirror/autocomplete';
import { plsqlDialect, oracleBuiltinCompletions } from '../common/plsqlDialect';
import { useDbCompletions } from '@/features/sql/hooks/useDbCompletions';
import { useMviewWindow, type MviewWindowProps } from '@/features/materialized-view/useMviewWindow';
export type MaterializedViewWindowProps = MviewWindowProps;
export function useMaterializedViewWindow(props: MaterializedViewWindowProps) {
  const state = useMviewWindow('oracle', props);
  const { dbCompletions, dbSchema } = useDbCompletions();
  const extensions = useMemo(() => [sql({ dialect: plsqlDialect, upperCaseKeywords: true, schema: dbSchema }),
    plsqlDialect.language.data.of({ autocomplete: (context: CompletionContext) => {
      const word = context.matchBefore(/\w*/);
      if (context.matchBefore(/\.\w*/) || !word || word.from === word.to && !context.explicit) return null;
      return { from: word.from, options: [...dbCompletions, ...oracleBuiltinCompletions] };
    } })], [dbCompletions, dbSchema]);
  return { ...state, extensions };
}
